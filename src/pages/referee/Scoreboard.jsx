// ============================================================
// 심판 태블릿 점수판 — /referee/:matchId
// - 좌우 초대형 탭 영역(누르면 +1점), BWF 규칙은 src/lib/bwf.js 엔진 사용
// - 모든 득점은 match_events INSERT(append-only), 언두도 undo 이벤트 추가
// - 새로고침해도 이벤트 재로드(foldEvents)로 상태 복원
// - 매 득점마다 tournament_matches live_* 캐시 UPDATE (관전 뷰용)
// - 매치 종료 확정은 src/lib/advancement.js#completeMatch (영역 D 계약)
// - Screen Wake Lock으로 태블릿 화면 꺼짐 방지 (미지원 브라우저 무시)
// ============================================================
import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import {
  initMatchState, applyPoint, applyForfeit, foldEvents, serviceCourt, scoreSummary, matchCall,
} from '../../lib/bwf'
import { completeMatch } from '../../lib/advance'
import Spinner from '../../components/Spinner'
import ConnectionStatus from '../../components/ConnectionStatus'
import { useOnline } from '../../lib/useOnline'
import { ChevronLeft, Undo2, Flag, AlertTriangle, Trophy, Play, Volume2, VolumeX } from 'lucide-react'

const RED = '#C60C30'
const BLUE = '#003478'

// ── 음성 콜(TTS): 브라우저 SpeechSynthesis, 키·서버 불필요. 미지원 시 조용히 무시 ──
function speak(text) {
  try {
    const synth = window.speechSynthesis
    if (!synth || !text) return
    synth.cancel() // 직전 콜이 밀리지 않게 취소 후 최신 콜만
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'ko-KR'
    u.rate = 1.05
    synth.speak(u)
  } catch { /* 무시 */ }
}

// 이름이 길면(복식 등) 첫 사람만 — 음성이 장황해지지 않게
function shortName(n) {
  if (!n) return ''
  return n.length > 8 ? n.split(' · ')[0] : n
}

// 심판 콜 → 화면 배너 스타일 (동적 클래스 대신 정적 매핑)
const CALL_STYLE = {
  golden:     { bg: '#FBBF24', fg: '#111827' },
  matchPoint: { bg: RED,       fg: '#fff' },
  gamePoint:  { bg: BLUE,      fg: '#fff' },
  deuce:      { bg: 'rgba(255,255,255,.14)', fg: '#E5E7EB' },
}

const NO_FLAGS = { intervalNow: false, gameJustEnded: false, matchJustEnded: false, goldenPoint: false }

const RESULT_LABEL = {
  normal: '정상 종료',
  retired: '경기 중 기권',
  walkover: '부전승 (불참)',
  disqualified: '실격',
}

function teamLabel(entry, fallback) {
  const names = [entry?.player1?.name, entry?.player2?.name].filter(Boolean)
  if (names.length) return names.join(' · ')
  return entry?.team_name || fallback
}

export default function Scoreboard() {
  const { matchId } = useParams()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [retryTick, setRetryTick] = useState(0)     // '다시 시도' 재로드 트리거
  const [match, setMatch] = useState(null)
  const [events, setEvents] = useState([])
  const [state, setState] = useState(null)          // bwf 엔진 상태
  const [overlay, setOverlay] = useState(null)      // 인터벌/게임종료/기권 오버레이
  const [syncError, setSyncError] = useState(false) // 저장 실패 배너
  const [saving, setSaving] = useState(false)
  const [firstServer, setFirstServer] = useState(1) // 경기 시작 전 첫 서브 팀 선택
  const [forfeitInfo, setForfeitInfo] = useState(null) // { team, type, reason }
  const [voiceOn, setVoiceOn] = useState(() => {
    try { return localStorage.getItem('bmg_ref_voice') === '1' } catch { return false }
  })

  const online = useOnline() // 네트워크 상태 상시 표시 (7-6)

  const stateRef = useRef(null)
  const eventsRef = useRef([])
  const userIdRef = useRef(null)
  const voiceOnRef = useRef(voiceOn)
  stateRef.current = state
  eventsRef.current = events
  voiceOnRef.current = voiceOn

  function toggleVoice() {
    setVoiceOn(v => {
      const next = !v
      try { localStorage.setItem('bmg_ref_voice', next ? '1' : '0') } catch { /* 무시 */ }
      if (!next) { try { window.speechSynthesis?.cancel() } catch { /* 무시 */ } }
      return next
    })
  }

  const config = {
    gamesPerMatch: match?.category?.games_per_match ?? 3,
    pointsPerGame: match?.category?.points_per_game ?? 21,
  }

  // ── 로드: 매치(카테고리·선수 join) + 이벤트 → foldEvents 복원 ──
  useEffect(() => {
    let alive = true
    async function load() {
      try {
      const [{ data: m, error: me }, { data: evs }, { data: auth }] = await Promise.all([
        supabase
          .from('tournament_matches')
          .select(`
            *,
            category:tournament_categories!category_id(
              id, sport_type, games_per_match, points_per_game, tournament_id,
              tournament:tournaments!tournament_id(id, title)
            ),
            team1:tournament_entries!team1_entry_id(
              id, team_name,
              player1:profiles!player1_id(id, name),
              player2:profiles!player2_id(id, name)
            ),
            team2:tournament_entries!team2_entry_id(
              id, team_name,
              player1:profiles!player1_id(id, name),
              player2:profiles!player2_id(id, name)
            )
          `)
          .eq('id', matchId)
          .single(),
        supabase
          .from('match_events')
          .select('*')
          .eq('match_id', matchId)
          .order('created_at', { ascending: true }),
        supabase.auth.getUser(),
      ])
      if (!alive) return
      if (me || !m) {
        setLoadError('경기를 찾을 수 없어요.')
        setLoading(false)
        return
      }
      userIdRef.current = auth?.user?.id ?? null

      const cfg = {
        gamesPerMatch: m.category?.games_per_match ?? 3,
        pointsPerGame: m.category?.points_per_game ?? 21,
      }
      // 첫 서브 팀: match_start 이벤트 meta에 저장해 둔 값 복원 (없으면 1)
      const startEv = (evs ?? []).find(e => e.event_type === 'match_start')
      const fs = startEv?.meta?.first_server_team === 2 ? 2 : 1
      const folded = foldEvents(evs ?? [], cfg, fs)

      setMatch(m)
      setEvents(evs ?? [])
      setFirstServer(fs)
      // 새로고침 복원 시 인터벌/게임종료 모달이 다시 뜨지 않게 플래그만 비움
      setState({ ...folded, flags: { ...NO_FLAGS } })
      setLoading(false)
      } catch (err) {
        // 네트워크 flap 등으로 조회가 throw 하면 무한 스피너에 갇히지 않도록 에러 상태로 탈출
        console.error('[점수판] 경기 로드 실패:', err)
        if (!alive) return
        setLoadError('경기 정보를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.')
        setLoading(false)
      }
    }
    load()
    return () => { alive = false }
  }, [matchId, retryTick])

  // ── Screen Wake Lock (화면 꺼짐 방지, 미지원 시 조용히 무시) ──
  useEffect(() => {
    let lock = null
    async function acquire() {
      try { lock = await navigator.wakeLock?.request?.('screen') } catch { /* 무시 */ }
    }
    acquire()
    const onVisible = () => { if (document.visibilityState === 'visible') acquire() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      try { lock?.release?.() } catch { /* 무시 */ }
    }
  }, [])

  // ── 오버레이 카운트다운 ──
  useEffect(() => {
    if (!overlay?.seconds) return
    const t = setInterval(() => {
      setOverlay(o => {
        if (!o?.seconds) return o
        if (o.seconds <= 1) return null // 시간 끝 → 자동 닫기
        return { ...o, seconds: o.seconds - 1 }
      })
    }, 1000)
    return () => clearInterval(t)
  }, [overlay?.type])

  // ── DB 헬퍼 ──
  async function insertEvent(row) {
    const { error } = await supabase.from('match_events').insert({
      ...row,
      match_id: matchId,
      created_by: userIdRef.current,
    })
    if (error) { console.error('[점수판] 이벤트 저장 실패:', error); setSyncError(true) }
    return !error
  }

  async function updateLiveCache(s) {
    const { error } = await supabase.from('tournament_matches').update({
      live_game_no: s.gameNo,
      live_score_t1: s.score[0],
      live_score_t2: s.score[1],
      live_server_team: s.serverTeam,
      games_won_team1: s.gamesWon[0],
      games_won_team2: s.gamesWon[1],
    }).eq('id', matchId)
    if (error) { console.error('[점수판] 라이브 캐시 저장 실패:', error); setSyncError(true) }
  }

  // ── 경기 시작 ──
  async function startMatch() {
    setSaving(true)
    const { error } = await supabase.from('tournament_matches').update({
      status: 'in_progress',
      actual_start: new Date().toISOString(),
      live_game_no: 1,
      live_score_t1: 0,
      live_score_t2: 0,
      live_server_team: firstServer,
    }).eq('id', matchId)
    if (error) {
      alert('경기 시작 저장에 실패했어요. (주최자 계정으로 로그인되어 있는지 확인)')
      setSaving(false)
      return
    }
    await insertEvent({
      event_type: 'match_start',
      game_no: 1, score_t1: 0, score_t2: 0,
      server_team: firstServer,
      meta: { first_server_team: firstServer },
    })
    const init = initMatchState({ ...config, firstServerTeam: firstServer })
    setMatch(m => ({ ...m, status: 'in_progress' }))
    setState(init)
    setEvents(e => [...e, { event_type: 'match_start', team_no: null, meta: { first_server_team: firstServer } }])
    setSaving(false)
  }

  // ── 음성 콜: 상황(점수+게임/매치 포인트·듀스·게임/경기 종료)을 읽어준다 ──
  function announce(next) {
    if (!voiceOnRef.current || !next) return
    const t1 = teamLabel(match?.team1, '팀 1')
    const t2 = teamLabel(match?.team2, '팀 2')
    if (next.flags?.matchJustEnded) {
      speak(`경기 종료. ${shortName(next.winnerTeam === 1 ? t1 : t2)} 팀 승리.`)
      return
    }
    if (next.flags?.gameJustEnded) {
      const g = next.completedGames[next.completedGames.length - 1]
      speak(`${g.gameNo}게임 종료. ${g.score[0]} 대 ${g.score[1]}, ${shortName(g.winnerTeam === 1 ? t1 : t2)} 팀.`)
      return
    }
    // 진행 중: 서버 팀 점수를 먼저 부르는 BWF 관례 + 상황 콜
    const srv = next.serverTeam
    let phrase = `${next.score[srv - 1]} 대 ${next.score[2 - srv]}`
    const call = matchCall(next)
    if (call) {
      phrase += call.team ? `. ${call.label}, ${shortName(call.team === 1 ? t1 : t2)} 팀` : `. ${call.label}`
    } else if (next.flags?.intervalNow) {
      phrase += '. 인터벌'
    }
    speak(phrase)
  }

  // ── 득점 (초대형 탭 영역) ──
  async function scorePoint(teamNo) {
    const cur = stateRef.current
    if (!cur || cur.finished || overlay || saving) return
    const next = applyPoint(cur, teamNo)
    if (next === cur) return

    // 이벤트 스냅샷: 득점이 속한 게임의 점수 (게임 종료 점이면 그 게임의 최종 스코어)
    const ended = next.flags.gameJustEnded
      ? next.completedGames[next.completedGames.length - 1]
      : null
    const evGameNo = ended ? ended.gameNo : next.gameNo
    const evScore = ended ? ended.score : next.score

    // 낙관적 반영 (태블릿 반응성)
    setState(next)
    setEvents(e => [...e, {
      event_type: 'point', team_no: teamNo, game_no: evGameNo,
      score_t1: evScore[0], score_t2: evScore[1], server_team: next.serverTeam,
    }])
    announce(next) // 음성 콜 (켜져 있을 때만)

    // 오버레이: 매치 종료 > 게임 종료(120초) > 인터벌(60초)
    if (next.flags.matchJustEnded) {
      // 확정 패널은 state.finished 로 렌더됨 — 별도 오버레이 없음
    } else if (next.flags.gameJustEnded) {
      setOverlay({
        type: 'gameEnd', seconds: 120,
        title: '게임 종료!',
        big: `${ended.score[0]} - ${ended.score[1]}`,
        sub: `${ended.gameNo}게임 승리 — ${ended.winnerTeam === 1 ? t1name : t2name}\n코트를 바꿔 주세요 (휴식 최대 2분)`,
      })
    } else if (next.flags.intervalNow) {
      const isFinalGame = next.gameNo === next.config.gamesPerMatch
      setOverlay({
        type: 'interval', seconds: 60,
        title: '인터벌',
        big: `${next.score[0]} - ${next.score[1]}`,
        sub: isFinalGame
          ? '휴식 최대 1분 — 마지막 게임이므로 코트를 바꿔 주세요'
          : '휴식 최대 1분',
      })
    }

    // DB 기록 (append-only 이벤트 + 관전용 라이브 캐시)
    await insertEvent({
      event_type: 'point', team_no: teamNo, game_no: evGameNo,
      score_t1: evScore[0], score_t2: evScore[1], server_team: next.serverTeam,
    })
    if (next.flags.intervalNow) {
      insertEvent({
        event_type: 'interval', game_no: next.gameNo,
        score_t1: next.score[0], score_t2: next.score[1], server_team: next.serverTeam,
      })
    }
    if (next.flags.gameJustEnded && !next.flags.matchJustEnded) {
      insertEvent({
        event_type: 'game_end', game_no: ended.gameNo,
        score_t1: ended.score[0], score_t2: ended.score[1], server_team: next.serverTeam,
        meta: { winner_team: ended.winnerTeam },
      })
    }
    await updateLiveCache(next)
  }

  // ── 언두: undo 이벤트 append 후 전체 이벤트를 다시 접어 복원 ──
  const pointCount = events.filter(e => e.event_type === 'point').length
  const undoCount = events.filter(e => e.event_type === 'undo').length
  const canUndo = pointCount - undoCount > 0

  async function undoLast() {
    if (!canUndo || saving) return
    const newEvents = [...eventsRef.current, { event_type: 'undo', team_no: null }]
    const folded = foldEvents(newEvents, config, firstServer)
    const restored = { ...folded, flags: { ...NO_FLAGS } }
    setEvents(newEvents)
    setState(restored)
    setOverlay(null)
    await insertEvent({
      event_type: 'undo',
      game_no: restored.gameNo,
      score_t1: restored.score[0], score_t2: restored.score[1],
      server_team: restored.serverTeam,
    })
    await updateLiveCache(restored)
  }

  // ── 기권 / 워크오버 / 실격 ──
  async function confirmForfeit(team, type, reason) {
    const cur = stateRef.current
    if (!cur || cur.finished) return
    const next = applyForfeit(cur, team, type)
    setForfeitInfo({ team, type, reason })
    setState(next)
    setOverlay(null)
    if (voiceOnRef.current) {
      const t1 = teamLabel(match?.team1, '팀 1')
      const t2 = teamLabel(match?.team2, '팀 2')
      speak(`${RESULT_LABEL[type] ?? '경기 종료'}. ${shortName(next.winnerTeam === 1 ? t1 : t2)} 팀 승리.`)
    }
    await insertEvent({
      event_type: type === 'walkover' ? 'walkover' : 'retired',
      team_no: team,
      game_no: cur.gameNo,
      score_t1: cur.score[0], score_t2: cur.score[1],
      server_team: cur.serverTeam,
      meta: { result_type: type, reason: reason || null },
    })
  }

  // ── 최종 확정 → advancement.js#completeMatch (점수 저장 + 승자 진출 연결) ──
  async function finalize() {
    const s = stateRef.current
    if (!s?.finished || saving) return
    setSaving(true)
    const winnerEntryId = s.winnerTeam === 1 ? match.team1_entry_id : match.team2_entry_id
    const games = s.completedGames.map(g => [g.score[0], g.score[1]])
    // 경기 중 기권/실격: 진행 중이던 게임의 부분 점수도 기록 (BWF 관례)
    if ((s.resultType === 'retired' || s.resultType === 'disqualified') &&
        (s.score[0] > 0 || s.score[1] > 0)) {
      games.push([s.score[0], s.score[1]])
    }
    try {
      await completeMatch(supabase, matchId, {
        winnerEntryId,
        gamesWonT1: s.gamesWon[0],
        gamesWonT2: s.gamesWon[1],
        games,
        resultType: s.resultType,
        forfeitTeam: s.resultType === 'normal' ? null : (forfeitInfo?.team ?? null),
        forfeitReason: s.resultType === 'normal' ? null : (forfeitInfo?.reason || RESULT_LABEL[s.resultType]),
      })
      insertEvent({
        event_type: 'match_end',
        game_no: s.gameNo,
        score_t1: s.score[0], score_t2: s.score[1],
        meta: { winner_team: s.winnerTeam, result_type: s.resultType, summary: scoreSummary(s) },
      })
      setMatch(m => ({
        ...m,
        status: s.resultType === 'normal' ? 'completed' : 'forfeited',
        winner_entry_id: winnerEntryId,
      }))
    } catch (e) {
      console.error('[점수판] 최종 확정 실패:', e)
      alert('결과 저장에 실패했어요. 네트워크와 로그인 상태를 확인한 뒤 다시 눌러 주세요.')
    }
    setSaving(false)
  }

  // ── 렌더 ──────────────────────────────────────────────
  if (loading) {
    return (
      <div className="fixed inset-0 z-50 bg-gray-950 flex items-center justify-center">
        <Spinner size={36} />
      </div>
    )
  }
  if (loadError) {
    return (
      <div className="fixed inset-0 z-50 bg-gray-950 text-white flex flex-col items-center justify-center gap-4 px-6 text-center">
        <AlertTriangle size={40} className="text-yellow-400" />
        <p className="text-lg font-bold">{loadError}</p>
        <div className="flex gap-3">
          <button
            onClick={() => { setLoadError(null); setLoading(true); setRetryTick(t => t + 1) }}
            className="px-5 py-2.5 rounded-xl bg-white text-gray-900 text-sm font-bold"
          >
            다시 시도
          </button>
          <button onClick={() => navigate(-1)} className="px-5 py-2.5 rounded-xl bg-white/10 text-sm font-bold">
            돌아가기
          </button>
        </div>
      </div>
    )
  }

  const t1name = teamLabel(match.team1, '팀 1')
  const t2name = teamLabel(match.team2, '팀 2')
  const done = ['completed', 'forfeited', 'bye'].includes(match.status)
  const sc = state && !state.finished ? serviceCourt(state) : null
  const gamesToWin = Math.ceil(config.gamesPerMatch / 2)
  // 심판 콜 배너: 현재 점수에서 파생(새로고침 복원에도 유지). 오버레이 중엔 숨김.
  const liveCall = state && !state.finished && !overlay ? matchCall(state) : null

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 text-white flex flex-col select-none" style={{ touchAction: 'manipulation' }}>
      {/* ── 상단 바 ── */}
      <header className="flex items-center gap-2 px-3 h-12 shrink-0 bg-gray-900 border-b border-white/10">
        <button onClick={() => navigate(-1)} className="p-1 -ml-1 rounded-full active:bg-white/10">
          <ChevronLeft size={22} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate">
            {match.category?.tournament?.title ?? '대회'} · {match.category?.sport_type ?? '경기'}
            {match.court_number ? ` · ${match.court_number}번 코트` : ''}
          </p>
        </div>
        {state && !done && match.status === 'in_progress' && (
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-white/10">
            {state.finished ? '경기 끝' : `${state.gameNo}번째 게임 · ${config.pointsPerGame}점제`}
          </span>
        )}
        <button onClick={toggleVoice}
          title={voiceOn ? '음성 콜 끄기' : '음성 콜 켜기 (점수·게임/매치 포인트 자동 안내)'}
          aria-label={voiceOn ? '음성 콜 끄기' : '음성 콜 켜기'} aria-pressed={voiceOn}
          className={`p-1.5 rounded-full active:bg-white/10 ${voiceOn ? 'text-emerald-400' : 'text-gray-500'}`}
        >
          {voiceOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
        </button>
        <ConnectionStatus online={online} live={null} dark />
        {syncError && (
          <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-amber-500/20 text-amber-300 flex items-center gap-1">
            <AlertTriangle size={11} /> 저장 실패 있음
          </span>
        )}
      </header>

      {/* ── 경기 시작 전 화면 ── */}
      {match.status === 'scheduled' && !done && (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6">
          <p className="text-gray-400 text-sm font-semibold">경기 준비</p>
          <div className="flex items-center gap-6 w-full max-w-2xl">
            <div className="flex-1 rounded-2xl p-5 text-center" style={{ background: 'rgba(198,12,48,.15)', border: `2px solid ${RED}` }}>
              <p className="text-lg font-bold break-keep">{t1name}</p>
            </div>
            <span className="text-gray-500 font-bold">VS</span>
            <div className="flex-1 rounded-2xl p-5 text-center" style={{ background: 'rgba(0,52,120,.2)', border: `2px solid ${BLUE}` }}>
              <p className="text-lg font-bold break-keep">{t2name}</p>
            </div>
          </div>

          <div className="text-center">
            <p className="text-sm text-gray-400 mb-2 font-semibold">첫 서브는 어느 팀인가요?</p>
            <div className="flex gap-2">
              {[1, 2].map(t => (
                <button key={t} onClick={() => setFirstServer(t)}
                  className="px-5 py-2.5 rounded-xl text-sm font-bold transition"
                  style={firstServer === t
                    ? { background: t === 1 ? RED : BLUE, color: '#fff' }
                    : { background: 'rgba(255,255,255,.08)', color: '#9CA3AF' }}
                >
                  {t === 1 ? t1name : t2name}
                </button>
              ))}
            </div>
          </div>

          <button onClick={startMatch} disabled={saving}
            className="flex items-center gap-2 px-10 py-4 rounded-2xl text-lg font-bold text-white active:opacity-80 disabled:opacity-40"
            style={{ background: `linear-gradient(135deg, ${RED}, ${BLUE})` }}
          >
            <Play size={20} /> 경기 시작
          </button>
        </div>
      )}

      {/* ── 메인 점수판 ── */}
      {match.status !== 'scheduled' && state && !done && !state.finished && (
        <>
          <div className="flex-1 flex min-h-0">
            <TeamPanel
              color={RED} name={t1name} score={state.score[0]}
              gamesWon={state.gamesWon[0]} gamesToWin={gamesToWin}
              serving={state.serverTeam === 1} serveSide={sc?.team === 1 ? sc.side : null}
              onTap={() => scorePoint(1)}
            />
            <div className="w-px bg-white/15 shrink-0" />
            <TeamPanel
              color={BLUE} name={t2name} score={state.score[1]}
              gamesWon={state.gamesWon[1]} gamesToWin={gamesToWin}
              serving={state.serverTeam === 2} serveSide={sc?.team === 2 ? sc.side : null}
              onTap={() => scorePoint(2)}
            />
          </div>

          {liveCall && (
            <div className="shrink-0 text-center py-1.5 text-sm font-bold flex items-center justify-center gap-2"
              style={{ background: CALL_STYLE[liveCall.key].bg, color: CALL_STYLE[liveCall.key].fg }}
            >
              {liveCall.key === 'golden'
                ? '골든 포인트! 다음 1점으로 이 게임이 끝납니다'
                : liveCall.key === 'deuce'
                  ? `듀스 — ${config.pointsPerGame - 1}점 이후 2점 차로 승부`
                  : (
                    <>
                      <span className="uppercase tracking-wide">{liveCall.label}</span>
                      <span className="opacity-90 break-keep">
                        {(liveCall.team === 1 ? t1name : t2name)}
                      </span>
                    </>
                  )}
            </div>
          )}

          {/* ── 하단 컨트롤 바 ── */}
          <div className="shrink-0 bg-gray-900 border-t border-white/10 px-3 py-2.5 flex items-center gap-3">
            <button onClick={undoLast} disabled={!canUndo}
              className="flex items-center gap-1.5 px-4 py-3 rounded-xl bg-white/10 text-sm font-bold active:bg-white/20 disabled:opacity-30"
            >
              <Undo2 size={16} /> 되돌리기
            </button>

            {/* 서비스 코트 다이어그램 (오른쪽 코트끼리 대각선) */}
            {sc && <CourtDiagram sc={sc} />}

            {/* 끝난 게임 히스토리 */}
            <div className="flex-1 flex items-center gap-1.5 overflow-x-auto">
              {state.completedGames.map(g => (
                <span key={g.gameNo}
                  className="shrink-0 text-xs font-bold font-mono px-2 py-1 rounded-lg bg-white/10"
                  style={{ color: g.winnerTeam === 1 ? '#FCA5A5' : '#93C5FD' }}
                >
                  {g.gameNo}G {g.score[0]}-{g.score[1]}
                </span>
              ))}
            </div>

            <button onClick={() => setOverlay({ type: 'forfeit' })}
              className="flex items-center gap-1.5 px-4 py-3 rounded-xl bg-amber-500/15 text-amber-300 text-sm font-bold active:bg-amber-500/30"
            >
              <Flag size={15} /> 기권/실격
            </button>
          </div>
        </>
      )}

      {/* ── 매치 종료 → 최종 확정 패널 ── */}
      {!done && state?.finished && (
        <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6 fade-up">
          <Trophy size={44} className="text-amber-400" />
          <div className="text-center">
            <p className="text-sm text-gray-400 font-semibold mb-1">{RESULT_LABEL[state.resultType]}</p>
            <p className="text-2xl font-bold break-keep">
              <span style={{ color: state.winnerTeam === 1 ? '#F87171' : '#60A5FA' }}>
                {state.winnerTeam === 1 ? t1name : t2name}
              </span> 승리
            </p>
            {scoreSummary(state) && (
              <p className="text-lg font-mono text-gray-300 mt-2">{scoreSummary(state)}</p>
            )}
            {state.resultType !== 'normal' && forfeitInfo?.reason && (
              <p className="text-sm text-gray-400 mt-1">사유: {forfeitInfo.reason}</p>
            )}
          </div>
          <div className="flex gap-3">
            {state.resultType === 'normal' && (
              <button onClick={undoLast} disabled={saving}
                className="flex items-center gap-1.5 px-5 py-3.5 rounded-xl bg-white/10 text-sm font-bold active:bg-white/20 disabled:opacity-40"
              >
                <Undo2 size={16} /> 마지막 점수 취소
              </button>
            )}
            <button onClick={finalize} disabled={saving}
              className="px-10 py-3.5 rounded-xl text-base font-bold text-white active:opacity-80 disabled:opacity-40"
              style={{ background: `linear-gradient(135deg, ${RED}, ${BLUE})` }}
            >
              {saving ? '저장 중…' : '결과 최종 확정'}
            </button>
          </div>
          <p className="text-xs text-gray-500">확정하면 점수가 저장되고 승자가 다음 경기로 올라갑니다.</p>
        </div>
      )}

      {/* ── 이미 끝난 경기 (읽기 전용) ── */}
      {done && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
          <Trophy size={40} className="text-amber-400" />
          <p className="text-xl font-bold break-keep text-center">
            {match.winner_entry_id === match.team1_entry_id ? t1name
              : match.winner_entry_id === match.team2_entry_id ? t2name : '결과'} 승리
          </p>
          {state && scoreSummary(state) && (
            <p className="text-lg font-mono text-gray-300">{scoreSummary(state)}</p>
          )}
          <p className="text-sm text-gray-400">이미 끝난 경기예요.</p>
          <button onClick={() => navigate(-1)} className="px-6 py-2.5 rounded-xl bg-white/10 text-sm font-bold">
            돌아가기
          </button>
        </div>
      )}

      {/* ── 인터벌/게임 종료 카운트다운 오버레이 ── */}
      {(overlay?.type === 'interval' || overlay?.type === 'gameEnd') && (
        <div className="absolute inset-0 z-10 bg-gray-950/90 flex flex-col items-center justify-center gap-4 fade-up">
          <p className="text-lg font-bold text-gray-300">{overlay.title}</p>
          <p className="text-6xl font-bold font-mono">{overlay.big}</p>
          <p className="text-sm text-gray-400 whitespace-pre-line text-center leading-relaxed">{overlay.sub}</p>
          <div className="w-24 h-24 rounded-full flex items-center justify-center border-4"
            style={{ borderColor: overlay.seconds <= 10 ? RED : 'rgba(255,255,255,.25)' }}
          >
            <span className="text-3xl font-bold font-mono">{overlay.seconds}</span>
          </div>
          <button onClick={() => setOverlay(null)}
            className="px-8 py-3 rounded-xl bg-white/10 text-sm font-bold active:bg-white/20"
          >
            건너뛰고 계속하기
          </button>
        </div>
      )}

      {/* ── 기권/워크오버/실격 오버레이 ── */}
      {overlay?.type === 'forfeit' && (
        <ForfeitSheet
          t1name={t1name} t2name={t2name}
          onCancel={() => setOverlay(null)}
          onConfirm={confirmForfeit}
        />
      )}
    </div>
  )
}

// ── 팀 절반 패널: 화면 절반 전체가 득점 버튼 ─────────────────
function TeamPanel({ color, name, score, gamesWon, gamesToWin, serving, serveSide, onTap }) {
  return (
    <button onClick={onTap}
      className="flex-1 min-w-0 flex flex-col items-center justify-center gap-2 active:brightness-125 transition"
      style={{ background: `linear-gradient(180deg, ${color}26, ${color}0D)` }}
    >
      {/* 게임 승수 점 */}
      <div className="flex gap-1.5">
        {Array.from({ length: gamesToWin }).map((_, i) => (
          <span key={i} className="w-2.5 h-2.5 rounded-full"
            style={{ background: i < gamesWon ? color : 'rgba(255,255,255,.15)' }} />
        ))}
      </div>

      <span className="block text-base sm:text-lg font-bold break-keep px-3 leading-snug text-white">
        {name}
      </span>

      <span className="block font-bold leading-none tabular-nums" style={{ fontSize: 'min(26vh, 30vw)', color }}>
        {score}
      </span>

      {/* 서브권 표시 */}
      <div className="h-7 flex items-center">
        {serving ? (
          <span className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full pulse-glow"
            style={{ background: color, color: '#fff' }}
          >
            🏸 서브 · {serveSide === 'right' ? '오른쪽' : '왼쪽'} 코트
          </span>
        ) : (
          <span className="text-[11px] text-gray-500 font-semibold">누르면 +1점</span>
        )}
      </div>
    </button>
  )
}

// ── 서비스 코트 다이어그램: 위에서 본 코트, 오른쪽 코트끼리 대각선 ──
function CourtDiagram({ sc }) {
  // 팀1(왼쪽 절반): 위=왼쪽 코트, 아래=오른쪽 코트
  // 팀2(오른쪽 절반): 위=오른쪽 코트, 아래=왼쪽 코트 (거울 대칭)
  const cells = [
    { team: 1, side: 'left' }, { team: 2, side: 'right' },
    { team: 1, side: 'right' }, { team: 2, side: 'left' },
  ]
  return (
    <div className="shrink-0 grid grid-cols-2 gap-px bg-white/25 border border-white/25 rounded-md overflow-hidden"
      style={{ width: 76, height: 44 }}
      title="서브 위치"
    >
      {cells.map((c, i) => {
        const active = c.team === sc.team && c.side === sc.side
        return (
          <div key={i} className="flex items-center justify-center text-[9px] font-bold"
            style={{
              background: active ? (c.team === 1 ? RED : BLUE) : '#111827',
              color: active ? '#fff' : 'transparent',
            }}
          >
            {active ? '서브' : '·'}
          </div>
        )
      })}
    </div>
  )
}

// ── 기권/워크오버/실격 입력 시트 ─────────────────────────────
function ForfeitSheet({ t1name, t2name, onCancel, onConfirm }) {
  const [team, setTeam] = useState(null)     // 포기/실격당한 팀
  const [type, setType] = useState('retired')
  const [reason, setReason] = useState('')

  const TYPES = [
    { v: 'retired', label: '경기 중 기권', desc: '부상 등으로 경기를 이어갈 수 없어요' },
    { v: 'walkover', label: '불참 (부전승)', desc: '코트에 나오지 않았어요' },
    { v: 'disqualified', label: '실격', desc: '규정 위반으로 심판이 실격 처리' },
  ]

  return (
    <div className="absolute inset-0 z-10 bg-gray-950/90 flex items-center justify-center p-5 fade-up">
      <div className="w-full max-w-md bg-gray-900 border border-white/10 rounded-2xl p-5 space-y-4">
        <p className="text-base font-bold">기권 · 실격 처리</p>

        <div>
          <p className="text-xs text-gray-400 font-semibold mb-1.5">어느 팀이 포기(실격)했나요?</p>
          <div className="flex gap-2">
            {[1, 2].map(t => (
              <button key={t} onClick={() => setTeam(t)}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold transition break-keep"
                style={team === t
                  ? { background: t === 1 ? RED : BLUE, color: '#fff' }
                  : { background: 'rgba(255,255,255,.08)', color: '#9CA3AF' }}
              >
                {t === 1 ? t1name : t2name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs text-gray-400 font-semibold mb-1.5">사유 종류</p>
          <div className="space-y-1.5">
            {TYPES.map(o => (
              <button key={o.v} onClick={() => setType(o.v)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-left transition
                  ${type === o.v ? 'bg-white/15 border border-white/30' : 'bg-white/5 border border-transparent'}`}
              >
                <span className="text-sm font-bold">{o.label}</span>
                <span className="text-[11px] text-gray-400">{o.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs text-gray-400 font-semibold mb-1.5">자세한 사유 (선택)</p>
          <input value={reason} onChange={e => setReason(e.target.value)}
            placeholder="예: 발목 부상"
            className="w-full bg-white/5 border border-white/15 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-white/40 placeholder:text-gray-600"
          />
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onCancel}
            className="flex-1 py-3 rounded-xl bg-white/10 text-sm font-bold text-gray-300 active:bg-white/20">
            취소
          </button>
          <button onClick={() => team && onConfirm(team, type, reason.trim())} disabled={!team}
            className="flex-1 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-30 active:opacity-80"
            style={{ background: RED }}
          >
            처리하기
          </button>
        </div>
      </div>
    </div>
  )
}

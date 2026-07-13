import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { getGradeInfo, getMMRPercentile } from '../../lib/grades'
import BottomNav from '../../components/BottomNav'
import GradeChip from '../../components/GradeChip'
import TournamentCard from '../../components/TournamentCard'
import Spinner from '../../components/Spinner'
import InstallPrompt from '../../components/InstallPrompt'
import { Bell, ChevronRight, TrendingUp, TrendingDown, Award, AlertTriangle } from 'lucide-react'

// ── 다음 경기 위젯용 헬퍼 ───────────────────────────────────────
const DONE_STATUSES = ['completed', 'forfeited', 'bye']

function cmpMatches(a, b) {
  const ta = a.scheduled_time ? new Date(a.scheduled_time).getTime() : Infinity
  const tb = b.scheduled_time ? new Date(b.scheduled_time).getTime() : Infinity
  if (ta !== tb) return ta - tb
  const ra = a.round_number ?? Infinity, rb = b.round_number ?? Infinity
  if (ra !== rb) return ra - rb
  return (a.match_number ?? Infinity) - (b.match_number ?? Infinity)
}

// 진행중 우선 → 없으면 가장 이른 예정 경기
function pickNextMatch(list) {
  const live = list.find(m => m.status === 'in_progress')
  if (live) return { match: live, live: true }
  const scheduled = list.filter(m => m.status === 'scheduled').sort(cmpMatches)
  if (!scheduled.length) return null
  return { match: scheduled[0], live: false }
}

function fmtTime(ms) {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function opponentOf(m) {
  const iAmTeam1 = m.team1_entry_id === m.myTeamEntryId
  return (iAmTeam1 ? m.team2Name : m.team1Name) || '상대 팀 미정'
}

export default function Home() {
  const navigate = useNavigate()
  const [profile, setProfile]       = useState(null)
  const [upcoming, setUpcoming]     = useState([])
  const [mmrHistory, setMmrHistory] = useState([])
  const [nextMatch, setNextMatch]   = useState(null)
  const [loading, setLoading]       = useState(true)
  const [loadError, setLoadError]   = useState(false)
  const [retryTick, setRetryTick]   = useState(0)

  useEffect(() => {
    let alive = true
    async function load() {
     try {
      const { data: { session } } = await supabase.auth.getSession(); const user = session?.user ?? null
      if (!user) { if (alive) setLoading(false); return }

      const [{ data: p }, { data: t }, { data: h }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('tournaments')
          .select('*, categories:tournament_categories(*)')
          .eq('status', 'open')
          .order('date', { ascending: true })
          .limit(3),
        supabase.from('mmr_history')
          .select('*')
          .eq('player_id', user.id)
          .order('created_at', { ascending: false })
          .limit(10),
      ])

      if (!alive) return
      setProfile(p)
      setUpcoming(t ?? [])
      setMmrHistory(h ?? [])

      // ── 내 다음 경기 (홈 위젯: scheduled_time 기반 간단 표시) ──
      const { data: myEntries } = await supabase
        .from('tournament_entries')
        .select('id')
        .or(`player1_id.eq.${user.id},player2_id.eq.${user.id}`)
      const entryIds = (myEntries ?? []).map(e => e.id)
      if (entryIds.length) {
        const { data: ms } = await supabase
          .from('tournament_matches')
          .select(`
            id,status,scheduled_time,court_number,round_number,match_number,
            live_score_t1,live_score_t2,team1_entry_id,team2_entry_id,
            team1:tournament_entries!team1_entry_id(player1:profiles!player1_id(name),player2:profiles!player2_id(name)),
            team2:tournament_entries!team2_entry_id(player1:profiles!player1_id(name),player2:profiles!player2_id(name))
          `)
          .or(`team1_entry_id.in.(${entryIds.join(',')}),team2_entry_id.in.(${entryIds.join(',')})`)
          .order('scheduled_time', { ascending: true })
        const fmt = (ms ?? []).map(m => ({
          ...m,
          team1Name: [m.team1?.player1?.name, m.team1?.player2?.name].filter(Boolean).join(' / '),
          team2Name: [m.team2?.player1?.name, m.team2?.player2?.name].filter(Boolean).join(' / '),
          myTeamEntryId: entryIds.includes(m.team1_entry_id) ? m.team1_entry_id : m.team2_entry_id,
        }))
        if (!alive) return
        setNextMatch(pickNextMatch(fmt))
      } else {
        if (!alive) return
        setNextMatch(null)
      }

      if (alive) setLoading(false)
     } catch (e) {
      // 네트워크 flap 등으로 홈이 무한 스피너에 갇히던 구멍 봉인 — 에러 상태로 탈출
      console.error('[배드민국] 홈 로딩 실패', e)
      if (!alive) return
      setLoadError(true)
      setLoading(false)
     }
    }
    load()
    return () => { alive = false }
  }, [retryTick])

  function retryLoad() {
    setLoadError(false)
    setLoading(true)
    setRetryTick(t => t + 1)
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center h-screen">
      <Spinner size={36} />
    </div>
  )

  if (loadError) return (
    <div className="safe-bottom flex-1 flex flex-col items-center justify-center h-screen px-8 text-center">
      <AlertTriangle size={40} className="text-amber-500 mb-3" />
      <p className="text-sm font-semibold text-gray-700">정보를 불러오지 못했어요</p>
      <p className="text-xs text-gray-400 mt-1">인터넷 연결을 확인한 뒤 다시 시도해 주세요.</p>
      <button
        onClick={retryLoad}
        className="mt-4 px-5 py-2.5 rounded-xl text-white text-sm font-bold active:scale-[.97]"
        style={{ background: '#003478' }}
      >
        다시 시도
      </button>
      <BottomNav mode="player" />
    </div>
  )

  const mmr        = profile?.mmr ?? 1000
  const grade      = profile?.official_grade ?? '왕초심'
  const gradeInfo  = getGradeInfo(grade)
  const pct        = getMMRPercentile(mmr)
  const gamesPlayed = profile?.mmr_games_played ?? 0

  // 최근 5경기 MMR 변동 합계
  const recent5    = mmrHistory.slice(0, 5)
  const recentSum  = recent5.reduce((a, h) => a + (h.delta ?? 0), 0)

  return (
    <div className="safe-bottom">
      {/* 헤더 */}
      <header
        className="px-5 pt-14 pb-6 text-white"
        style={{ background: 'linear-gradient(160deg, #C60C30 0%, #003478 100%)' }}
      >
        <div className="flex items-start justify-between mb-5">
          <div>
            <p className="text-white/70 text-sm">안녕하세요</p>
            <h1 className="text-2xl font-black">{profile?.name ?? '게스트'}님</h1>
          </div>
          <button className="p-2 rounded-full bg-white/10 active:bg-white/20">
            <Bell size={20} className="text-white" />
          </button>
        </div>

        {/* 급수 / MMR 분리 카드 */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          {/* 공인 급수 — 내려가지 않음 */}
          <div className="bg-white/15 backdrop-blur rounded-2xl p-3.5">
            <div className="flex items-center gap-1 mb-1.5">
              <Award size={12} className="text-white/60" />
              <p className="text-white/60 text-xs">내 급수</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">{gradeInfo?.flair}</span>
              <p className="text-xl font-black">{grade}</p>
            </div>
            <p className="text-white/50 text-xs mt-1">하락 없음</p>
          </div>

          {/* 플랫폼 MMR — 매 경기 변동 */}
          <div className="bg-white/15 backdrop-blur rounded-2xl p-3.5">
            <div className="flex items-center gap-1 mb-1.5">
              <TrendingUp size={12} className="text-white/60" />
              <p className="text-white/60 text-xs">플랫폼 MMR</p>
            </div>
            <p className="text-2xl font-black tabular-nums">{mmr.toLocaleString()}</p>
            <p className="text-white/50 text-xs mt-1">{pct} · {gamesPlayed}경기</p>
          </div>
        </div>

        {/* 최근 경기 MMR 흐름 */}
        {recent5.length > 0 && (
          <div className="bg-white/10 rounded-xl px-3 py-2 flex items-center gap-2">
            <p className="text-xs text-white/60 shrink-0">최근 {recent5.length}경기</p>
            <div className="flex gap-1.5 flex-1">
              {recent5.map((h, i) => (
                <div key={i} className="flex items-center gap-0.5">
                  {h.delta >= 0
                    ? <TrendingUp size={10} className="text-emerald-300" />
                    : <TrendingDown size={10} className="text-red-300" />
                  }
                  <span className={`text-xs font-bold tabular-nums ${h.delta >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                    {h.delta >= 0 ? '+' : ''}{h.delta}
                  </span>
                </div>
              ))}
            </div>
            <span className={`text-xs font-bold shrink-0 ${recentSum >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
              합계 {recentSum >= 0 ? '+' : ''}{recentSum}
            </span>
          </div>
        )}
      </header>

      {/* 다음 경기 위젯 */}
      {nextMatch && (
        <section className="px-4 mt-4">
          <button
            onClick={() => navigate('/my-matches')}
            className="w-full rounded-2xl p-4 text-left text-white flex items-center gap-3
                       active:scale-[.98] transition-transform"
            style={{ background: 'linear-gradient(135deg, #C60C30, #003478)' }}
          >
            {/* 코트 배지 */}
            <div className="shrink-0 w-14 h-14 rounded-xl bg-white/15 flex flex-col items-center justify-center leading-none">
              {nextMatch.match.court_number != null ? (
                <>
                  <span className="text-xl font-black">{nextMatch.match.court_number}</span>
                  <span className="text-[9px] text-white/70 mt-1">번 코트</span>
                </>
              ) : (
                <span className="text-[9px] text-white/70 text-center">코트<br />대기</span>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                {nextMatch.live ? (
                  <span className="flex items-center gap-1 bg-white text-[#C60C30] text-[10px] font-black px-1.5 py-0.5 rounded-full">
                    <span className="w-1 h-1 rounded-full bg-[#C60C30] animate-pulse" /> LIVE
                  </span>
                ) : (
                  <span className="bg-white/20 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                    다음 경기
                  </span>
                )}
              </div>
              <p className="font-black truncate">{opponentOf(nextMatch.match)}</p>
              <p className="text-white/80 text-xs mt-0.5">
                {nextMatch.live
                  ? `현재 ${nextMatch.match.live_score_t1} : ${nextMatch.match.live_score_t2}`
                  : nextMatch.match.scheduled_time
                    ? `예상 시작 약 ${fmtTime(new Date(nextMatch.match.scheduled_time).getTime())}쯤`
                    : '코트에서 대기 중'}
              </p>
            </div>
            <ChevronRight size={18} className="text-white/50" />
          </button>
        </section>
      )}

      {/* 급수 미인증 안내 */}
      {profile && !profile.grade_verified && (
        <div className="mx-4 mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3">
          <span className="text-xl">⚠️</span>
          <div className="flex-1 text-sm">
            <p className="font-semibold text-amber-800">급수 미인증</p>
            <p className="text-amber-600 text-xs">급수 증빙 업로드 시 인증 뱃지가 부여됩니다.</p>
          </div>
          <button onClick={() => navigate('/profile')} className="text-xs font-bold text-amber-700 shrink-0">
            인증하기
          </button>
        </div>
      )}

      {/* 급수 vs MMR 설명 */}
      {!profile && (
        <div className="mx-4 mt-4 bg-blue-50 rounded-2xl p-4 border border-blue-100">
          <p className="text-sm font-bold text-blue-800 mb-1">🏸 배드민국 MMR이란?</p>
          <p className="text-xs text-blue-600 leading-relaxed">
            <strong>내 급수</strong>는 대회에서 인정받은 자격 등급으로 절대 내려가지 않습니다.<br/>
            <strong>플랫폼 MMR</strong>은 매 경기 Elo 공식으로 자동 계산되는 실력 점수입니다.<br/>
            강한 상대를 이기면 더 많이 올라가고, 약한 상대에게 지면 더 많이 떨어집니다.
          </p>
        </div>
      )}

      {/* 접수 중인 대회 */}
      <section className="px-4 mt-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-base">접수 중인 대회</h2>
          <button onClick={() => navigate('/tournaments')}
            className="flex items-center text-xs text-[#C60C30] font-semibold">
            전체 보기 <ChevronRight size={14} />
          </button>
        </div>

        {upcoming.length === 0 ? (
          <div className="bg-white rounded-2xl p-6 text-center text-gray-400 text-sm border border-gray-100">
            현재 접수 중인 대회가 없습니다.
          </div>
        ) : (
          <div className="space-y-3">
            {upcoming.map(t => <TournamentCard key={t.id} tournament={t} />)}
          </div>
        )}
      </section>

      {/* 주최자 배너 */}
      <section className="px-4 mt-6">
        <button
          onClick={() => navigate('/organizer')}
          className="w-full rounded-2xl p-4 text-left text-white flex items-center gap-3
                     active:scale-[.98] transition-transform"
          style={{ background: 'linear-gradient(135deg, #003478, #001f4d)' }}
        >
          <span className="text-3xl">🏟️</span>
          <div className="flex-1">
            <p className="font-bold">대회 주최자이신가요?</p>
            <p className="text-white/70 text-xs">AI 대진표 + MMR 자동 반영</p>
          </div>
          <ChevronRight size={18} className="text-white/50" />
        </button>
      </section>

      <BottomNav mode="player" />
      <InstallPrompt />
    </div>
  )
}

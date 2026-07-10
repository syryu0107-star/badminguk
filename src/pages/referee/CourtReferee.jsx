// ============================================================
// 코트별 심판 모드 — /referee/court/:tournamentId[/:courtNo]
// ------------------------------------------------------------
// 목적(심판 완주 갭 메우기): 코트에 배치된 심판이 "자기 코트의 지금 경기"를
//   스스로 찾아 점수판을 열 수 있게 한다. 지금껏 심판은 주최자가 LiveDashboard에서
//   새 탭으로 열어주거나 URL을 손으로 공유해야만 /referee/:matchId 에 도달했다
//   (audit L1 · 심판 플로우 잔여 공백). 이 화면은:
//     1) 코트를 고르면 그 코트의 "현재 경기 / 다음 경기"를 보여주고,
//     2) 현재 경기 점수판(/referee/:matchId)으로 바로 이동시키고,
//     3) 경기가 끝나 다음 경기가 그 코트로 자동 배정되면(advance.js/scheduler)
//        실시간 구독으로 화면이 스스로 갱신된다(코트배정 자동배포).
//   즉 심판은 한 화면만 열어두면 코트에서 벌어지는 경기를 사람 안내 없이 따라간다.
//
// 스키마·외부 키 불필요 — 기존 tournament_matches 만 읽고, 실제 점수 저장·승자 진출은
// 기존 심판 점수판(Scoreboard.jsx)이 담당한다. 이 페이지는 "도달 경로"만 채운다.
// ============================================================
import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import Spinner from '../../components/Spinner'
import ConnectionStatus from '../../components/ConnectionStatus'
import { useOnline } from '../../lib/useOnline'
import { ChevronLeft, Gavel, Clock, Play, Trophy, LayoutGrid, Zap } from 'lucide-react'

const RED = '#C60C30'
const BLUE = '#003478'
const REFRESH_MS = 15_000
const DONE_STATUSES = ['completed', 'forfeited', 'bye']

function teamLabel(entry, fallback = '미정') {
  if (!entry) return fallback
  const names = [entry.player1?.name, entry.player2?.name].filter(Boolean)
  if (names.length) return names.join(' · ')
  return entry.team_name || fallback
}

const fmtTime = (iso) =>
  iso ? new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : null

export default function CourtReferee() {
  const { tournamentId, courtNo } = useParams()
  const navigate = useNavigate()
  const selectedCourt = courtNo != null ? Number(courtNo) : null

  const [tournament, setTournament] = useState(null)
  const [categories, setCategories] = useState([])
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [rtState, setRtState] = useState('connecting')

  const catIdsRef = useRef(new Set())
  const hadDropRef = useRef(false)

  const online = useOnline(() => fetchData())

  const fetchData = useCallback(async () => {
    if (!tournamentId) return
    try {
      const [{ data: trn, error: te }, { data: cats }] = await Promise.all([
        supabase
          .from('tournaments')
          .select('id, title, court_count, date, status')
          .eq('id', tournamentId)
          .single(),
        supabase
          .from('tournament_categories')
          .select('id, sport_type')
          .eq('tournament_id', tournamentId),
      ])
      if (te || !trn) { setLoadError('대회를 찾을 수 없어요.'); setLoading(false); return }
      setTournament(trn)
      const catList = cats ?? []
      setCategories(catList)
      const catIds = catList.map(c => c.id)
      catIdsRef.current = new Set(catIds)

      if (!catIds.length) { setMatches([]); setLoading(false); return }

      const { data: mts, error: me } = await supabase
        .from('tournament_matches')
        .select(`
          id, category_id, status, court_number, scheduled_time, actual_start,
          round_number, match_number, match_phase,
          live_game_no, live_score_t1, live_score_t2, live_server_team,
          team1_entry_id, team2_entry_id, winner_entry_id,
          team1:tournament_entries!team1_entry_id(
            id, team_name,
            player1:profiles!player1_id(name), player2:profiles!player2_id(name)
          ),
          team2:tournament_entries!team2_entry_id(
            id, team_name,
            player1:profiles!player1_id(name), player2:profiles!player2_id(name)
          )
        `)
        .in('category_id', catIds)
      if (me) throw me
      setMatches(mts ?? [])
      setLoading(false)
    } catch (err) {
      console.error('[CourtReferee] load error', err)
      setLoadError('경기 정보를 불러오지 못했어요. 네트워크를 확인해주세요.')
      setLoading(false)
    }
  }, [tournamentId])

  // 폴링 폴백 (실시간이 끊겨도 최신 유지)
  useEffect(() => {
    fetchData()
    const t = setInterval(fetchData, REFRESH_MS)
    return () => clearInterval(t)
  }, [fetchData])

  // 실시간: 경기 상태·코트 배정이 바뀌면(다음 경기 자동 진출/재배치) 전체 재조회
  useEffect(() => {
    if (!tournamentId) return
    const channel = supabase
      .channel(`court-ref-${tournamentId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'tournament_matches' },
        (payload) => {
          const row = payload.new ?? payload.old
          if (!row || !catIdsRef.current.has(row.category_id)) return
          fetchData()
        })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setRtState('connected')
          if (hadDropRef.current) { hadDropRef.current = false; fetchData() }
        } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
          setRtState('connecting')
          hadDropRef.current = true
        }
      })
    return () => { supabase.removeChannel(channel) }
  }, [tournamentId, fetchData])

  // ── 파생값 ──────────────────────────────────────────────
  const catNameById = {}
  for (const c of categories) catNameById[c.id] = c.sport_type

  const playable = matches.filter(m => !DONE_STATUSES.includes(m.status))

  // 코트 목록 = 대회 court_count 범위 ∪ 실제 배정된 코트 번호
  const courtCount = tournament?.court_count ?? 4
  const courtSet = new Set(Array.from({ length: courtCount }, (_, i) => i + 1))
  for (const m of matches) if (m.court_number != null) courtSet.add(m.court_number)
  const courtList = [...courtSet].sort((a, b) => a - b)

  // 한 코트의 현재/다음 경기 계산
  function courtQueue(cn) {
    const onCourt = playable
      .filter(m => m.court_number === cn)
      .sort((a, b) => new Date(a.scheduled_time ?? 0) - new Date(b.scheduled_time ?? 0))
    const live = onCourt.find(m => m.status === 'in_progress')
    const sched = onCourt.filter(m => m.status === 'scheduled')
    return {
      current: live ?? sched[0] ?? null,
      queue: live ? sched : sched.slice(1),
    }
  }

  // ── 렌더: 로딩/에러 ──────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Spinner size={32} />
      </div>
    )
  }
  if (loadError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gray-50 px-6 text-center">
        <p className="text-gray-700 font-bold">{loadError}</p>
        <button onClick={() => navigate(-1)} className="px-5 py-2.5 rounded-xl bg-gray-200 text-sm font-bold">
          돌아가기
        </button>
      </div>
    )
  }

  const done = tournament?.status === 'completed'

  return (
    <div className="min-h-screen bg-gray-50 pb-10">
      {/* 헤더 */}
      <header className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => selectedCourt != null
            ? navigate(`/referee/court/${tournamentId}`)
            : navigate(-1)}
          className="p-1 -ml-1 rounded-full active:bg-gray-100"
          aria-label="뒤로"
        >
          <ChevronLeft size={22} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate flex items-center gap-1.5">
            <Gavel size={15} className="text-[#C60C30] shrink-0" />
            {selectedCourt != null ? `${selectedCourt}번 코트 심판` : '코트별 심판 모드'}
          </p>
          <p className="text-[11px] text-gray-400 truncate">{tournament?.title}</p>
        </div>
        <ConnectionStatus online={online} live={online ? rtState === 'connected' : null} />
      </header>

      {done && (
        <div className="mx-4 mt-4 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700 flex items-center gap-2">
          <Trophy size={15} /> 이미 종료된 대회예요. 심판 점수판은 열 수 없어요.
        </div>
      )}

      {/* ── 코트 선택 화면 ── */}
      {selectedCourt == null && (
        <div className="px-4 py-4">
          <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4 mb-4">
            <p className="font-bold flex items-center gap-1.5 mb-1">
              <LayoutGrid size={16} className="text-[#003478]" /> 담당 코트를 선택하세요
            </p>
            <p className="text-xs text-gray-400 leading-relaxed">
              코트를 고르면 그 코트의 <strong>지금 경기</strong>가 나와요. 경기가 끝나면
              다음 경기가 <strong>자동으로</strong> 그 코트에 올라와 화면이 스스로 바뀌어요 —
              심판은 이 화면만 열어두면 됩니다.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {courtList.map(cn => {
              const { current, queue } = courtQueue(cn)
              const live = current?.status === 'in_progress'
              const waitN = (current && !live ? 1 : 0) + queue.length
              return (
                <button
                  key={cn}
                  onClick={() => navigate(`/referee/court/${tournamentId}/${cn}`)}
                  className="rounded-2xl bg-white border border-gray-100 shadow-sm p-4 text-left active:scale-[.98] transition"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-3xl font-black tabular-nums" style={{ color: live ? RED : BLUE }}>
                      {cn}
                    </span>
                    {live ? (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> 경기 중
                      </span>
                    ) : current ? (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-600">대기</span>
                    ) : (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">비어있음</span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1">코트</p>
                  {current ? (
                    <p className="text-xs font-semibold text-gray-600 mt-1.5 leading-snug line-clamp-2">
                      {teamLabel(current.team1)} vs {teamLabel(current.team2)}
                    </p>
                  ) : (
                    <p className="text-xs text-gray-300 mt-1.5">예정 경기 없음</p>
                  )}
                  {waitN > 0 && (
                    <p className="text-[11px] text-gray-400 mt-1">대기 {waitN}경기</p>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── 선택된 코트 화면 ── */}
      {selectedCourt != null && (
        <CourtPanel
          court={selectedCourt}
          {...courtQueue(selectedCourt)}
          catNameById={catNameById}
          done={done}
          onOpenScoreboard={(mid) => navigate(`/referee/${mid}`)}
        />
      )}
    </div>
  )
}

// ── 한 코트의 현재/다음 경기 패널 ─────────────────────────────
function CourtPanel({ court, current, queue, catNameById, done, onOpenScoreboard }) {
  const live = current?.status === 'in_progress'

  return (
    <div className="px-4 py-4 space-y-4">
      {/* 현재 경기 */}
      <section className="rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
          <span className="text-xs font-bold text-gray-500 flex items-center gap-1.5">
            {live ? <Zap size={13} className="text-emerald-500" /> : <Clock size={13} className="text-amber-500" />}
            {live ? '지금 경기 중' : current ? '다음 차례 경기' : '현재 경기'}
          </span>
          {current && catNameById[current.category_id] && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-[#003478]">
              {catNameById[current.category_id]}
            </span>
          )}
        </div>

        {!current ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm text-gray-400 font-semibold">이 코트에 예정된 경기가 없어요.</p>
            <p className="text-xs text-gray-300 mt-1.5 leading-relaxed">
              다음 경기가 이 코트로 배정되면 화면이 자동으로 바뀌어요.<br />이 화면을 열어둔 채 기다려주세요.
            </p>
          </div>
        ) : (
          <div className="px-4 py-4">
            <div className="flex items-center gap-3">
              <div className="flex-1 text-center min-w-0">
                <p className="text-base font-bold break-keep leading-snug" style={{ color: RED }}>
                  {teamLabel(current.team1)}
                </p>
              </div>
              <div className="shrink-0 text-center px-1">
                {live ? (
                  <p className="text-2xl font-black tabular-nums">
                    <span style={{ color: RED }}>{current.live_score_t1 ?? 0}</span>
                    <span className="text-gray-300 mx-1">:</span>
                    <span style={{ color: BLUE }}>{current.live_score_t2 ?? 0}</span>
                  </p>
                ) : (
                  <span className="text-sm text-gray-400 font-semibold">VS</span>
                )}
                {live && current.live_game_no && (
                  <p className="text-[11px] text-gray-400 mt-0.5">{current.live_game_no}게임</p>
                )}
              </div>
              <div className="flex-1 text-center min-w-0">
                <p className="text-base font-bold break-keep leading-snug" style={{ color: BLUE }}>
                  {teamLabel(current.team2)}
                </p>
              </div>
            </div>

            {!live && fmtTime(current.scheduled_time) && (
              <p className="text-center text-xs text-gray-400 mt-2 flex items-center justify-center gap-1">
                <Clock size={12} /> {fmtTime(current.scheduled_time)} 예정
              </p>
            )}

            <button
              onClick={() => onOpenScoreboard(current.id)}
              disabled={done || !(current.team1_entry_id && current.team2_entry_id)}
              className="w-full mt-4 py-3.5 rounded-xl text-white text-base font-bold active:opacity-80 disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: live ? RED : `linear-gradient(135deg, ${RED}, ${BLUE})` }}
            >
              {live ? <><Gavel size={18} /> 점수판 이어서 열기</> : <><Play size={18} /> 이 경기 점수 입력 시작</>}
            </button>
            {!(current.team1_entry_id && current.team2_entry_id) && (
              <p className="text-center text-[11px] text-gray-400 mt-2">
                아직 양 팀이 확정되지 않았어요 (앞선 경기 결과 대기 중).
              </p>
            )}
          </div>
        )}
      </section>

      {/* 이 코트 대기열 */}
      {queue.length > 0 && (
        <section>
          <p className="text-xs font-bold text-gray-500 mb-2 px-1">이 코트 대기 경기 {queue.length}개</p>
          <div className="space-y-2">
            {queue.map((m, i) => (
              <div key={m.id} className="rounded-xl bg-white border border-gray-100 shadow-sm px-3.5 py-2.5 flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-gray-100 text-gray-500 text-xs font-bold flex items-center justify-center shrink-0">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold break-keep leading-snug">
                    {teamLabel(m.team1)} <span className="text-gray-300">vs</span> {teamLabel(m.team2)}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-2">
                    {catNameById[m.category_id] && <span>{catNameById[m.category_id]}</span>}
                    {fmtTime(m.scheduled_time) && (
                      <span className="flex items-center gap-0.5"><Clock size={10} /> {fmtTime(m.scheduled_time)}</span>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="text-[11px] text-gray-300 text-center leading-relaxed px-4">
        경기를 확정하면 승자가 다음 라운드로 자동 진출하고,<br />
        이 코트의 다음 경기가 자동으로 올라옵니다.
      </p>
    </div>
  )
}

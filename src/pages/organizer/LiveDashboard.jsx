import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { resolveMatchMMR, CERT_LEVELS } from '../../lib/mmr'
import { calculatePoolStandings, prizeLabel } from '../../lib/tournament'
import { completeMatch, finalizeTournament, scoresToPairs } from '../../lib/advance'
import TopBar from '../../components/TopBar'
import Spinner from '../../components/Spinner'
import { Clock, Shield, UserCheck, Flag, CheckCircle, Gavel, Trophy, ListOrdered } from 'lucide-react'

function fmt(dt) {
  if (!dt) return '--:--'
  const d = new Date(dt)
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

function maskBirth(birth) {
  if (!birth || birth.length < 6) return '미인증'
  // 1990-01-01 → 1990-**-**
  return birth.slice(0, 4) + '-**-**'
}

function maskName(name) {
  if (!name || name.length < 2) return '미인증'
  return name[0] + '*'.repeat(name.length - 1)
}

const CERT_COLOR = { none: 'bg-gray-100 text-gray-500', c: 'bg-blue-100 text-blue-700', b: 'bg-purple-100 text-purple-700', a: 'bg-red-100 text-red-700' }

const DONE_STATUSES = ['completed', 'forfeited', 'bye']

function statusLabel(m) {
  if (m.status === 'scheduled')   return '예정'
  if (m.status === 'in_progress') return '진행중'
  if (m.status === 'completed')   return '완료'
  if (m.status === 'bye')         return '부전승'
  if (m.status === 'forfeited') {
    if (m.result_type === 'walkover')     return '부전승 (불참)'
    if (m.result_type === 'retired')      return '중도 기권'
    if (m.result_type === 'disqualified') return '실격'
    return '기권'
  }
  return m.status
}

export default function LiveDashboard() {
  const { id } = useParams()
  const [tournament, setTournament] = useState(null)
  const [categories, setCategories] = useState([])
  const [matches, setMatches]       = useState([])
  const [activeCat, setActiveCat]   = useState(null)
  const [loading, setLoading]       = useState(true)
  const [scoring, setScoring]       = useState(null)
  const [viewMode, setViewMode]     = useState('matches') // 'matches' | 'standings' | 'checkin'
  const [finishing, setFinishing]   = useState(false)

  // 체크인 상태
  const [entries, setEntries]         = useState([])
  const [checkins, setCheckins]       = useState([])
  const [checkinLoading, setCheckinLoading] = useState(false)

  // 조별 순위표 상태
  const [standings, setStandings]             = useState(null) // { groups, rankedEntries }
  const [standingsLoading, setStandingsLoading] = useState(false)

  useEffect(() => {
    async function load() {
      const [{ data: t }, { data: cats }] = await Promise.all([
        supabase.from('tournaments').select('*').eq('id', id).single(),
        supabase.from('tournament_categories').select('*').eq('tournament_id', id),
      ])
      setTournament(t)
      setCategories(cats ?? [])
      setActiveCat(cats?.[0]?.id)
      setLoading(false)
    }
    load()
  }, [id])

  useEffect(() => {
    if (!activeCat) return
    loadMatches()
    const sub = supabase
      .channel(`matches-${activeCat}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_matches' }, loadMatches)
      .subscribe()
    return () => supabase.removeChannel(sub)
  }, [activeCat])

  useEffect(() => {
    if (viewMode === 'checkin') loadCheckins()
    if (viewMode === 'standings') loadStandings()
  }, [viewMode, activeCat])

  async function loadMatches() {
    const { data } = await supabase
      .from('tournament_matches')
      .select(`
        *,
        team1:tournament_entries!team1_entry_id(
          id,
          player1:profiles!player1_id(id,name,mmr,mmr_games_played,official_grade),
          player2:profiles!player2_id(id,name,mmr,mmr_games_played,official_grade)
        ),
        team2:tournament_entries!team2_entry_id(
          id,
          player1:profiles!player1_id(id,name,mmr,mmr_games_played,official_grade),
          player2:profiles!player2_id(id,name,mmr,mmr_games_played,official_grade)
        ),
        scores:match_scores(*)
      `)
      .eq('category_id', activeCat)
      .order('scheduled_time', { ascending: true })
    setMatches(data ?? [])
  }

  async function loadCheckins() {
    if (!activeCat) return
    setCheckinLoading(true)
    const [{ data: ents }, { data: chk }] = await Promise.all([
      supabase.from('tournament_entries')
        .select(`
          id, player1_id, player2_id,
          player1:profiles!player1_id(id, name, verified_name, verified_birth, identity_verified),
          player2:profiles!player2_id(id, name, verified_name, verified_birth, identity_verified)
        `)
        .eq('category_id', activeCat),
      supabase.from('tournament_checkins')
        .select('*')
        .eq('tournament_id', id),
    ])
    setEntries(ents ?? [])
    setCheckins(chk ?? [])
    setCheckinLoading(false)
  }

  // ── 조별 순위표 로딩 ──────────────────────────────────────────
  async function loadStandings() {
    if (!activeCat) return
    setStandingsLoading(true)

    const [{ data: pools }, { data: ms }, { data: ents }, { data: catRow }] = await Promise.all([
      supabase.from('tournament_pools').select('*').eq('category_id', activeCat).order('pool_index'),
      supabase.from('tournament_matches')
        .select('id, pool_id, match_phase, status, team1_entry_id, team2_entry_id, winner_entry_id, scores:match_scores(*)')
        .eq('category_id', activeCat),
      supabase.from('tournament_entries')
        .select('id, final_rank, pool_rank, player1:profiles!player1_id(name), player2:profiles!player2_id(name)')
        .eq('category_id', activeCat),
      supabase.from('tournament_categories')
        .select('tiebreaker_order')
        .eq('id', activeCat)
        .single(),
    ])
    const tiebreakers = catRow?.tiebreaker_order

    const entryList = ents ?? []
    const labelOf = eid => {
      const e = entryList.find(x => x.id === eid)
      if (!e) return '알 수 없는 팀'
      return [e.player1?.name, e.player2?.name].filter(Boolean).join(' / ') || '팀'
    }

    const allMatches = ms ?? []
    const poolMatches = allMatches.filter(m => m.match_phase === 'pool')
    const shapeMatch = m => ({
      team1_entry_id: m.team1_entry_id,
      team2_entry_id: m.team2_entry_id,
      winner_entry_id: m.winner_entry_id,
      scores: scoresToPairs(m.scores),
    })

    let groups = []
    if (pools?.length) {
      const { data: poolEntryRows } = await supabase
        .from('tournament_pool_entries')
        .select('pool_id, entry_id')
        .in('pool_id', pools.map(p => p.id))
      groups = pools.map(p => {
        const entryIds = (poolEntryRows ?? []).filter(pe => pe.pool_id === p.id).map(pe => pe.entry_id)
        const gm = poolMatches.filter(m => m.pool_id === p.id)
        return {
          name: p.pool_name,
          done: gm.length > 0 && gm.every(m => DONE_STATUSES.includes(m.status)),
          rows: calculatePoolStandings(
            entryIds.map(eid => ({ entryId: eid, label: labelOf(eid) })),
            gm.map(shapeMatch),
            tiebreakers
          ),
        }
      })
    } else if (poolMatches.length) {
      // 풀 테이블 없이 리그 경기만 저장된 경우: 전체를 한 조로
      const ids = new Set()
      poolMatches.forEach(m => {
        if (m.team1_entry_id) ids.add(m.team1_entry_id)
        if (m.team2_entry_id) ids.add(m.team2_entry_id)
      })
      groups = [{
        name: '전체 리그',
        done: poolMatches.every(m => DONE_STATUSES.includes(m.status)),
        rows: calculatePoolStandings(
          [...ids].map(eid => ({ entryId: eid, label: labelOf(eid) })),
          poolMatches.map(shapeMatch),
          tiebreakers
        ),
      }]
    }

    const rankedEntries = entryList
      .filter(e => e.final_rank != null)
      .sort((a, b) => a.final_rank - b.final_rank)
      .map(e => ({ id: e.id, rank: e.final_rank, label: labelOf(e.id) }))

    setStandings({ groups, rankedEntries })
    setStandingsLoading(false)
  }

  async function startMatch(matchId) {
    await supabase.from('tournament_matches').update({
      status: 'in_progress',
      actual_start: new Date().toISOString(),
    }).eq('id', matchId)
  }

  // ── MMR 반영은 이제 completeMatch → apply_match_mmr RPC 단일 진입점이 전담.
  //    (주최자 세션에서 남의 profiles 직접 update 는 RLS(본인만 수정)에 막혀
  //     무성공이었다 → SECURITY DEFINER RPC 로 이관. 인라인 applyMMR 은 삭제.)

  async function saveScore(matchId, sets, winningSide) {
    const match = matches.find(m => m.id === matchId)
    if (!match) return

    let g1 = 0, g2 = 0
    sets.forEach(s => {
      if (Number(s.a) > Number(s.b)) g1++
      else if (Number(s.b) > Number(s.a)) g2++
    })
    const winnerEntryId = winningSide === 1 ? match.team1_entry_id : match.team2_entry_id

    try {
      // 결과 저장 + 승자 자동 진출 + MMR 반영(RPC) + 조별리그 완료 시 본선 시딩
      const res = await completeMatch(supabase, matchId, {
        winnerEntryId,
        gamesWonT1: g1,
        gamesWonT2: g2,
        games: sets.map(s => [Number(s.a), Number(s.b)]),
      })
      if (res?.mmrError) {
        alert('경기는 저장됐지만 MMR 반영에 실패했어요.\n주최자 계정으로 로그인돼 있는지 확인한 뒤 다시 시도해주세요.')
      }
    } catch (e) {
      alert('저장 중 문제가 생겼어요: ' + e.message)
    }

    setScoring(null)
    loadMatches()
  }

  async function forfeitMatch(match, forfeitTeam) {
    // 경기 전 기권 = walkover(부전승, MMR 미반영) / 경기 중 기권 = retired(MMR 반영)
    const resultType = match.status === 'in_progress' ? 'retired' : 'walkover'
    const reason = prompt(
      resultType === 'retired'
        ? '경기 중 기권 사유를 입력해주세요 (예: 부상):'
        : '불참(기권) 사유를 입력해주세요:'
    )
    if (reason === null) return // 취소

    const winningSide = forfeitTeam === 1 ? 2 : 1
    const winnerEntryId = winningSide === 1 ? match.team1_entry_id : match.team2_entry_id

    try {
      // 계약(RPC 내부 처리): walkover → MMR 미반영, retired → 반영.
      // 호출부는 분기하지 않고 completeMatch 만 부른다.
      const res = await completeMatch(supabase, match.id, {
        winnerEntryId,
        resultType,
        forfeitTeam,
        forfeitReason: reason || (resultType === 'retired' ? '경기 중 기권' : '불참'),
      })
      if (res?.mmrError) {
        alert('처리는 됐지만 MMR 반영에 실패했어요.\n주최자 계정으로 로그인돼 있는지 확인한 뒤 다시 시도해주세요.')
      }
    } catch (e) {
      alert('기권 처리 중 문제가 생겼어요: ' + e.message)
    }
    loadMatches()
  }

  // ── 대회 종료 · 시상 확정 ─────────────────────────────────────
  async function finishTournament() {
    if (finishing) return
    const catIds = categories.map(c => c.id)
    if (!catIds.length) return

    const { data: all } = await supabase
      .from('tournament_matches')
      .select('id, status')
      .in('category_id', catIds)
    if (!all?.length) {
      alert('아직 경기가 하나도 없어요. 대진표를 먼저 만들어주세요.')
      return
    }
    const remaining = all.filter(m => !DONE_STATUSES.includes(m.status))
    if (remaining.length > 0) {
      alert(`아직 끝나지 않은 경기가 ${remaining.length}개 있어요. 모든 경기가 끝나야 시상을 확정할 수 있습니다.`)
      return
    }
    if (!confirm('대회를 종료하고 최종 순위(시상)를 확정할까요?\n확정 후에는 되돌릴 수 없어요.')) return

    setFinishing(true)
    try {
      await finalizeTournament(supabase, id, catIds)
      setTournament(t => ({ ...t, status: 'completed' }))
      alert('대회가 종료되었습니다! 🏆 순위표 탭에서 시상 결과를 확인하세요.')
      setViewMode('standings')
    } catch (e) {
      alert('시상 확정 중 문제가 생겼어요: ' + e.message)
    }
    setFinishing(false)
  }

  async function checkinPlayer(playerId, method = 'verbal') {
    const { error } = await supabase.from('tournament_checkins').upsert({
      tournament_id: id,
      player_id: playerId,
      verified_method: method,
      checked_in_at: new Date().toISOString(),
      flagged: false,
    }, { onConflict: 'tournament_id,player_id' })
    if (!error) loadCheckins()
  }

  async function flagPlayer(playerId, reason) {
    const { error } = await supabase.from('tournament_checkins').upsert({
      tournament_id: id,
      player_id: playerId,
      verified_method: 'verbal',
      checked_in_at: new Date().toISOString(),
      flagged: true,
      flag_reason: reason,
    }, { onConflict: 'tournament_id,player_id' })
    if (!error) loadCheckins()
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>

  const certLevel = tournament?.cert_level ?? 'none'
  const certInfo  = CERT_LEVELS[certLevel]
  const activeCatObj = categories.find(c => c.id === activeCat)
  const catMatches = matches.filter(m => m.category_id === activeCat)
  const done = catMatches.filter(m => DONE_STATUSES.includes(m.status)).length
  const isCompleted = tournament?.status === 'completed'

  return (
    <div className="safe-bottom">
      <TopBar title="실시간 진행" />

      {/* 공인 등급 배지 */}
      <div className="px-4 pt-3 flex items-center gap-2">
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1 ${CERT_COLOR[certLevel]}`}>
          <Shield size={11} /> {certInfo?.label}
        </span>
        <span className="text-xs text-gray-400">{certInfo?.desc}</span>
        {isCompleted && (
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 flex items-center gap-1">
            <Trophy size={11} /> 대회 종료
          </span>
        )}
      </div>

      {/* 모드 전환 탭 */}
      <div className="flex mx-4 mt-3 bg-gray-100 rounded-xl p-1 gap-1">
        <button
          onClick={() => setViewMode('matches')}
          className={`flex-1 py-2 rounded-lg text-sm font-bold transition
            ${viewMode === 'matches' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}
        >
          🏸 경기 진행
        </button>
        <button
          onClick={() => setViewMode('standings')}
          className={`flex-1 py-2 rounded-lg text-sm font-bold transition flex items-center justify-center gap-1
            ${viewMode === 'standings' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}
        >
          <ListOrdered size={14} /> 순위표
        </button>
        <button
          onClick={() => setViewMode('checkin')}
          className={`flex-1 py-2 rounded-lg text-sm font-bold transition flex items-center justify-center gap-1
            ${viewMode === 'checkin' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}
        >
          <UserCheck size={14} /> 체크인
        </button>
      </div>

      {viewMode === 'matches' && (
        <>
          {/* 진행률 */}
          <div className="px-4 py-3 bg-white border-b border-gray-100 mt-2">
            <div className="flex items-center justify-between text-sm mb-1.5">
              <span className="font-semibold">진행률</span>
              <span className="text-[#C60C30] font-bold">{done}/{catMatches.length}</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: catMatches.length ? `${(done/catMatches.length)*100}%` : '0%',
                  background: 'linear-gradient(90deg, #C60C30, #003478)',
                }}
              />
            </div>
          </div>

          {/* 종목 탭 */}
          <div className="flex gap-2 px-4 py-2 bg-white border-b border-gray-100 overflow-x-auto">
            {categories.map(cat => (
              <button key={cat.id} onClick={() => setActiveCat(cat.id)}
                className={`px-3 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap transition
                            ${activeCat === cat.id ? 'bg-[#C60C30] text-white' : 'bg-gray-100 text-gray-600'}`}
              >{cat.sport_type}</button>
            ))}
          </div>

          <div className="px-4 py-4 space-y-3">
            {catMatches.map(m => {
              const t1p = [m.team1?.player1, m.team1?.player2].filter(Boolean)
              const t2p = [m.team2?.player1, m.team2?.player2].filter(Boolean)
              const t1name = t1p.map(p => p.name).join(' / ')
              const t2name = t2p.map(p => p.name).join(' / ')
              const t1mmr  = t1p.length ? Math.round(t1p.reduce((a,p) => a+p.mmr, 0)/t1p.length) : 0
              const t2mmr  = t2p.length ? Math.round(t2p.reduce((a,p) => a+p.mmr, 0)/t2p.length) : 0
              const isScoring = scoring === m.id
              const canReferee = ['scheduled', 'in_progress'].includes(m.status)
                && m.team1_entry_id && m.team2_entry_id

              return (
                <div key={m.id} className={`bg-white rounded-2xl border p-4
                  ${m.status === 'in_progress' ? 'border-[#C60C30] shadow-md' : 'border-gray-100'}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5 text-xs text-gray-400">
                      <Clock size={11} /> {fmt(m.scheduled_time)}
                      {m.court_number && <span>· 코트 {m.court_number}</span>}
                    </div>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full
                      ${m.status === 'completed'   ? 'bg-emerald-100 text-emerald-700'
                      : m.status === 'in_progress' ? 'bg-red-100 text-red-600 animate-pulse'
                      : m.status === 'forfeited'   ? 'bg-yellow-100 text-yellow-700'
                      : m.status === 'bye'         ? 'bg-blue-100 text-blue-600'
                      : 'bg-gray-100 text-gray-500'}`}
                    >
                      {statusLabel(m)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 mb-1">
                    <div className="flex-1">
                      <p className={`text-sm font-bold ${m.winner_entry_id && m.winner_entry_id === m.team1_entry_id ? 'text-emerald-600' : ''}`}>
                        {t1name || '팀 A'}
                      </p>
                      <p className="text-xs text-gray-400">MMR {t1mmr}</p>
                    </div>
                    <span className="text-gray-300 text-xs font-bold">VS</span>
                    <div className="flex-1 text-right">
                      <p className={`text-sm font-bold ${m.winner_entry_id && m.winner_entry_id === m.team2_entry_id ? 'text-emerald-600' : ''}`}>
                        {t2name || '팀 B'}
                      </p>
                      <p className="text-xs text-gray-400">MMR {t2mmr}</p>
                    </div>
                  </div>

                  {/* 진행 중 라이브 점수 (심판 점수판 캐시) */}
                  {m.status === 'in_progress' && (m.live_score_t1 > 0 || m.live_score_t2 > 0) && (
                    <p className="text-center text-lg font-black text-gray-700 tabular-nums">
                      {m.live_score_t1} : {m.live_score_t2}
                      <span className="text-xs text-gray-400 font-semibold ml-1.5">{m.live_game_no}게임</span>
                    </p>
                  )}

                  {m.status === 'scheduled' && (
                    <div className="space-y-2 mt-3">
                      <div className="flex gap-2">
                        <button onClick={() => startMatch(m.id)}
                          className="flex-1 py-2 rounded-xl bg-[#003478] text-white text-xs font-bold active:opacity-80">
                          경기 시작
                        </button>
                        {canReferee && (
                          <button onClick={() => window.open(`/referee/${m.id}`, '_blank', 'noopener')}
                            className="flex-1 py-2 rounded-xl bg-[#C60C30] text-white text-xs font-bold active:opacity-80 flex items-center justify-center gap-1">
                            <Gavel size={12} /> 심판 점수판
                          </button>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => forfeitMatch(m, 1)}
                          className="flex-1 py-2 rounded-xl bg-amber-100 text-amber-700 text-xs font-bold active:opacity-80">
                          팀1 불참 (부전승)
                        </button>
                        <button onClick={() => forfeitMatch(m, 2)}
                          className="flex-1 py-2 rounded-xl bg-amber-100 text-amber-700 text-xs font-bold active:opacity-80">
                          팀2 불참 (부전승)
                        </button>
                      </div>
                    </div>
                  )}

                  {m.status === 'in_progress' && !isScoring && (
                    <div className="space-y-2 mt-3">
                      <div className="flex gap-2">
                        <button onClick={() => window.open(`/referee/${m.id}`, '_blank', 'noopener')}
                          className="flex-1 py-2.5 rounded-xl bg-[#C60C30] text-white text-sm font-bold active:opacity-80 flex items-center justify-center gap-1.5">
                          <Gavel size={14} /> 심판 점수판 열기
                        </button>
                        <button onClick={() => setScoring(m.id)}
                          className="py-2.5 px-3 rounded-xl bg-gray-100 text-gray-600 text-xs font-bold active:opacity-80">
                          직접 입력
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => forfeitMatch(m, 1)}
                          className="flex-1 py-1.5 rounded-xl bg-amber-50 text-amber-600 text-xs font-bold active:opacity-80">
                          팀1 경기 중 기권
                        </button>
                        <button onClick={() => forfeitMatch(m, 2)}
                          className="flex-1 py-1.5 rounded-xl bg-amber-50 text-amber-600 text-xs font-bold active:opacity-80">
                          팀2 경기 중 기권
                        </button>
                      </div>
                    </div>
                  )}

                  {isScoring && (
                    <ScoreInput
                      match={m}
                      t1name={t1name} t2name={t2name}
                      team1={t1p} team2={t2p}
                      certLevel={certLevel}
                      onSave={saveScore}
                      onCancel={() => setScoring(null)}
                    />
                  )}

                  {m.status === 'completed' && m.scores?.length > 0 && (
                    <div className="flex justify-center gap-3 text-sm text-gray-400 mt-2">
                      {[...m.scores].sort((a,b) => a.set_number - b.set_number).map((s,i) => (
                        <span key={i} className="font-mono">{s.team1_score}:{s.team2_score}</span>
                      ))}
                    </div>
                  )}

                  {m.status === 'forfeited' && (
                    <div className="mt-2 text-center space-y-0.5">
                      {m.forfeit_reason && (
                        <p className="text-xs text-gray-400">사유: {m.forfeit_reason}</p>
                      )}
                      {m.result_type === 'walkover' && (
                        <p className="text-xs font-semibold text-gray-400">경기 없이 부전승 — MMR 반영 안 함</p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {catMatches.length === 0 && (
              <div className="text-center py-12 text-gray-400 text-sm">
                대진표를 먼저 생성해주세요.
              </div>
            )}

            {/* 대회 종료 · 시상 확정 */}
            {!isCompleted && catMatches.length > 0 && (
              <button
                onClick={finishTournament}
                disabled={finishing}
                className="w-full py-4 rounded-2xl font-bold text-white text-base
                           flex items-center justify-center gap-2 active:scale-[.97] transition disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg, #003478, #C60C30)' }}
              >
                <Trophy size={18} />
                {finishing ? '시상 확정 중...' : '대회 종료 · 시상 확정'}
              </button>
            )}
            {isCompleted && (
              <div className="w-full py-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold text-center text-sm">
                🏆 대회가 종료되었습니다 — 순위표 탭에서 시상 결과를 확인하세요
              </div>
            )}
          </div>
        </>
      )}

      {/* ── 조별 순위표 패널 ─────────────────────────────────── */}
      {viewMode === 'standings' && (
        <div className="px-4 py-4">
          {/* 종목 탭 */}
          <div className="flex gap-2 mb-4 overflow-x-auto">
            {categories.map(cat => (
              <button key={cat.id} onClick={() => setActiveCat(cat.id)}
                className={`px-3 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap transition
                            ${activeCat === cat.id ? 'bg-[#003478] text-white' : 'bg-gray-100 text-gray-600'}`}
              >{cat.sport_type}</button>
            ))}
          </div>

          {standingsLoading || !standings ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : (
            <div className="space-y-4">
              {/* 시상 결과 (final_rank 확정 후) */}
              {standings.rankedEntries.length > 0 && (
                <div className="bg-white rounded-2xl border border-amber-200 p-4">
                  <h2 className="font-bold text-sm mb-3 flex items-center gap-1.5">
                    <Trophy size={15} className="text-amber-500" /> 시상 결과
                  </h2>
                  <div className="space-y-2">
                    {standings.rankedEntries
                      .filter(e => e.rank <= (activeCatObj?.prize_spots ?? 3))
                      .map(e => (
                        <div key={e.id} className="flex items-center justify-between">
                          <span className="text-sm font-bold">
                            {prizeLabel(e.rank, activeCatObj?.prize_spots ?? 3) ?? `${e.rank}위`}
                          </span>
                          <span className="text-sm font-semibold text-gray-700">{e.label}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {standings.groups.length === 0 && (
                <div className="text-center py-12 text-gray-400 text-sm">
                  조별리그 경기가 없습니다. 대진표를 먼저 생성해주세요.
                </div>
              )}

              {standings.groups.map(g => {
                const advCount = activeCatObj?.tournament_format === 'pool_knockout'
                  ? (activeCatObj?.advancement_per_pool ?? 2) : 0
                return (
                  <div key={g.name} className="bg-white rounded-2xl border border-gray-100 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="font-bold text-sm">{g.name}</h2>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full
                        ${g.done ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                        {g.done ? '조 경기 완료' : '진행 중'}
                      </span>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-400 border-b border-gray-100">
                            <th className="py-1.5 text-left font-semibold w-8">순위</th>
                            <th className="py-1.5 text-left font-semibold">팀</th>
                            <th className="py-1.5 text-center font-semibold w-10">승</th>
                            <th className="py-1.5 text-center font-semibold w-10">패</th>
                            <th className="py-1.5 text-center font-semibold w-14">게임득실</th>
                            <th className="py-1.5 text-center font-semibold w-14">점수득실</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.rows.map(row => {
                            const advancing = advCount > 0 && row.rank <= advCount
                            return (
                              <tr key={row.entryId}
                                className={`border-b border-gray-50 ${advancing ? 'bg-blue-50/60' : ''}`}>
                                <td className="py-2 font-black text-gray-700">{row.rank}</td>
                                <td className="py-2 font-semibold text-gray-800">
                                  {row.label}
                                  {advancing && (
                                    <span className="ml-1.5 text-[10px] font-bold text-white bg-[#003478] px-1.5 py-0.5 rounded-full">
                                      {g.done ? '진출 확정' : '진출권'}
                                    </span>
                                  )}
                                </td>
                                <td className="py-2 text-center font-bold text-emerald-600">{row.wins}</td>
                                <td className="py-2 text-center font-bold text-red-500">{row.losses}</td>
                                <td className={`py-2 text-center tabular-nums ${row.gameDiff > 0 ? 'text-emerald-600' : row.gameDiff < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                                  {row.gameDiff > 0 ? '+' : ''}{row.gameDiff}
                                </td>
                                <td className={`py-2 text-center tabular-nums ${row.pointDiff > 0 ? 'text-emerald-600' : row.pointDiff < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                                  {row.pointDiff > 0 ? '+' : ''}{row.pointDiff}
                                </td>
                              </tr>
                            )
                          })}
                          {g.rows.length === 0 && (
                            <tr><td colSpan={6} className="py-4 text-center text-gray-300">팀이 없습니다</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {advCount > 0 && (
                      <p className="text-[11px] text-gray-400 mt-2">
                        조별 상위 {advCount}팀이 본선에 올라갑니다
                        {(activeCatObj?.wildcard_count ?? 0) > 0 &&
                          ` (와일드카드 ${activeCatObj.wildcard_count}팀 추가 선발)`}.
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── 체크인 관리 패널 ─────────────────────────────────── */}
      {viewMode === 'checkin' && (
        <div className="px-4 py-4">
          {/* 종목 탭 */}
          <div className="flex gap-2 mb-4 overflow-x-auto">
            {categories.map(cat => (
              <button key={cat.id} onClick={() => setActiveCat(cat.id)}
                className={`px-3 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap transition
                            ${activeCat === cat.id ? 'bg-[#003478] text-white' : 'bg-gray-100 text-gray-600'}`}
              >{cat.sport_type}</button>
            ))}
          </div>

          {/* 안내 */}
          <div className="bg-blue-50 rounded-2xl p-3.5 mb-4 flex gap-2.5">
            <span className="text-lg shrink-0">💬</span>
            <p className="text-xs text-blue-700 leading-relaxed">
              선수에게 <strong>"성함과 생년월일 말씀해주세요?"</strong> 라고 물어본 후<br/>
              아래 표시된 실명·생년과 일치하면 체크인 완료를 누르세요.
            </p>
          </div>

          {checkinLoading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : (
            <div className="space-y-2">
              {entries.length === 0 && (
                <div className="text-center py-8 text-gray-400 text-sm">참가 신청자가 없습니다.</div>
              )}
              {entries.map(entry => {
                const players = [entry.player1, entry.player2].filter(Boolean)
                return players.map(player => {
                  const chk = checkins.find(c => c.player_id === player.id)
                  const isCheckedIn = !!chk && !chk.flagged
                  const isFlagged   = !!chk && chk.flagged

                  return (
                    <div key={player.id}
                      className={`bg-white rounded-2xl border p-4 transition
                        ${isFlagged ? 'border-red-300 bg-red-50'
                        : isCheckedIn ? 'border-emerald-200 bg-emerald-50'
                        : 'border-gray-100'}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          {/* 닉네임 */}
                          <p className="font-bold text-sm truncate">{player.name}</p>

                          {/* 실명 정보 (심판용) */}
                          <div className="mt-1.5 space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-400 w-12 shrink-0">실명</span>
                              {player.identity_verified ? (
                                <span className="text-sm font-bold text-gray-800">
                                  {maskName(player.verified_name)}
                                  <span className="ml-1 text-xs text-gray-400 font-normal">
                                    ({player.verified_name})
                                  </span>
                                </span>
                              ) : (
                                <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                                  미인증
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-400 w-12 shrink-0">생년</span>
                              <span className="text-sm font-mono text-gray-700">
                                {player.identity_verified
                                  ? maskBirth(player.verified_birth)
                                  : '—'}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* 상태 + 버튼 */}
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          {isFlagged ? (
                            <span className="text-xs font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                              <Flag size={10} /> 신고됨
                            </span>
                          ) : isCheckedIn ? (
                            <span className="text-xs font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                              <CheckCircle size={10} /> 완료
                            </span>
                          ) : null}

                          {!isCheckedIn && !isFlagged && (
                            <button
                              onClick={() => checkinPlayer(player.id)}
                              className="text-xs font-bold text-white bg-[#003478] px-3 py-1.5 rounded-xl active:opacity-80"
                            >
                              체크인 완료
                            </button>
                          )}

                          {!isFlagged && (
                            <button
                              onClick={() => {
                                const reason = prompt('신고 사유를 입력해주세요:') ?? '대리출전 의심'
                                flagPlayer(player.id, reason)
                              }}
                              className="text-xs font-bold text-red-500 bg-red-50 px-3 py-1.5 rounded-xl active:opacity-80 flex items-center gap-1"
                            >
                              <Flag size={11} /> 의심 신고
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ScoreInput({ match, t1name, t2name, team1, team2, certLevel, onSave, onCancel }) {
  const [sets, setSets] = useState([{ a: '', b: '' }])

  function addSet() { setSets(prev => [...prev, { a: '', b: '' }]) }
  function updateSet(i, side, v) {
    setSets(prev => prev.map((s, idx) => idx === i ? { ...s, [side]: v } : s))
  }

  function determineWinner() {
    let w1 = 0, w2 = 0
    sets.forEach(s => {
      if (Number(s.a) > Number(s.b)) w1++
      else if (Number(s.b) > Number(s.a)) w2++
    })
    return w1 > w2 ? 1 : w2 > w1 ? 2 : null
  }

  const winner = determineWinner()

  function previewMMR(winningSide) {
    if (!team1?.length || !team2?.length) return []
    const t1 = team1.map(p => ({ id: p.id, mmr: p.mmr, gamesPlayed: p.mmr_games_played }))
    const t2 = team2.map(p => ({ id: p.id, mmr: p.mmr, gamesPlayed: p.mmr_games_played }))
    try {
      return resolveMatchMMR({ team1: t1, team2: t2, winner: winningSide, certLevel })
    } catch { return [] }
  }

  const preview = winner ? previewMMR(winner) : []

  return (
    <div className="mt-3 pt-3 border-t border-gray-100 space-y-3 fade-up">
      {sets.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-xs text-gray-400 w-8">{i+1}게임</span>
          <input type="number" inputMode="numeric" value={s.a}
            onChange={e => updateSet(i,'a',e.target.value)}
            className="flex-1 border border-gray-200 rounded-lg py-2 text-center text-lg font-bold outline-none focus:border-[#C60C30]" />
          <span className="text-gray-300">:</span>
          <input type="number" inputMode="numeric" value={s.b}
            onChange={e => updateSet(i,'b',e.target.value)}
            className="flex-1 border border-gray-200 rounded-lg py-2 text-center text-lg font-bold outline-none focus:border-[#C60C30]" />
        </div>
      ))}
      <button onClick={addSet} className="text-xs text-gray-400 underline">+ 게임 추가</button>

      {winner && (
        <div className="bg-gray-50 rounded-xl p-3">
          <p className="text-xs font-bold text-gray-600 mb-2">
            {winner === 1 ? t1name : t2name} 승 — MMR 변화 미리보기
          </p>
          {preview.map((r, i) => {
            const name = [...(team1 ?? []), ...(team2 ?? [])].find(p => p.id === r.id)?.name
            return (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-gray-600">{name}</span>
                <span className={`font-bold tabular-nums ${r.delta >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {r.before} → {r.after} ({r.delta >= 0 ? '+' : ''}{r.delta})
                  {r.partnerAdj !== 0 && (
                    <span className="text-gray-400 font-normal ml-1">
                      [파트너보정 {r.partnerAdj > 0 ? '+' : ''}{r.partnerAdj}%]
                    </span>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={onCancel}
          className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-500 font-semibold">
          취소
        </button>
        <button
          onClick={() => winner && onSave(match.id, sets.map(s => ({ a: Number(s.a), b: Number(s.b) })), winner)}
          disabled={!winner}
          className="flex-1 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-bold
                     disabled:opacity-40 active:opacity-80"
        >
          저장 + MMR 반영
        </button>
      </div>
    </div>
  )
}

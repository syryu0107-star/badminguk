import { useEffect, useState, useRef, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { resolveMatchMMR, CERT_LEVELS } from '../../lib/mmr'
import { calculatePoolStandings, prizeLabel } from '../../lib/tournament'
import { completeMatch, finalizeTournament, scoresToPairs } from '../../lib/advance'
import { callMatch, callMatchSoon, callWalkoverWarn } from '../../lib/notify'
import { planAutoAdvance, planNoShow, analyzeDelay } from '../../lib/orchestrator'
import { summarizeCheckins } from '../../lib/checkin'
import TopBar from '../../components/TopBar'
import Spinner from '../../components/Spinner'
import { Clock, Shield, UserCheck, Flag, CheckCircle, Gavel, Trophy, ListOrdered, Megaphone, Zap, Timer, AlertTriangle, TrendingUp } from 'lucide-react'

// 초 → "m:ss" 카운트다운 표기
function fmtCountdown(sec) {
  const s = Math.max(0, Math.round(sec ?? 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

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
  const [calling, setCalling]       = useState(null) // 호출 처리 중인 match id
  const [calledIds, setCalledIds]   = useState({})   // { [matchId]: 마지막 호출 시각(ms) }

  // ── 무인 자동 진행 (빈 코트 자동 투입) 상태 ─────────────────────────
  const [autoRun, setAutoRun]       = useState(false) // 자동 진행 on/off (기본 꺼짐 — 안전)
  const [estimates, setEstimates]   = useState({})    // { [matchId]: { at, ahead } } 예상 호출 시각
  const [autoLog, setAutoLog]       = useState([])    // 최근 자동 조치 로그(투명성)
  const soonSentRef   = useRef({})   // { [matchId]: ts } 사전알림 중복 방지
  const orchestrating = useRef(false)

  // ── 노쇼(호출 미응답) 타이머 상태 (C7) ─────────────────────────────
  const [noShow, setNoShow]   = useState({})   // { [matchId]: { phase, secondsLeft, elapsedSec, ... } }
  const [resolving, setResolving] = useState(null) // 부전승 처리 중인 match id
  const warnedRef = useRef({})   // { [matchId]: ts } 미입장 경고 중복 방지
  const [nowTick, setNowTick] = useState(Date.now()) // 카운트다운 갱신용 틱

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

  // ── 셀프 체크인 실시간 반영 (선수가 폰으로 체크인하면 무인으로 갱신) ──
  useEffect(() => {
    if (viewMode !== 'checkin') return
    const sub = supabase
      .channel(`checkins-${id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'tournament_checkins', filter: `tournament_id=eq.${id}` },
        () => loadCheckins())
      .subscribe()
    return () => supabase.removeChannel(sub)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, id])

  // ── 예상 호출 시각은 항상 갱신(표시용). 자동 진행이 켜져 있으면 실제 호출까지. ──
  useEffect(() => {
    const mm = categories.find(c => c.id === activeCat)?.match_duration_min ?? 30
    // 관측 페이스(진행 중 경기가 계획보다 오래 걸리면 반영)로 예상 호출 시각을 보정.
    const observed = analyzeDelay(matches, { matchMinutes: mm }).observedMin
    const localBusy = new Set(
      matches.filter(m => m.status === 'in_progress' && m.court_number != null).map(m => m.court_number)
    )
    const plan = planAutoAdvance(matches, {
      busyCourts: localBusy, calledAt: calledIds, soonSentAt: soonSentRef.current, matchMinutes: observed,
    })
    setEstimates(plan.estimates)
    if (autoRun) runOrchestrator(matches)
    // calledIds 변경만으로는 재실행 안 함(무한 루프 방지) — 실시간 matches 갱신이 트리거.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, autoRun, activeCat])

  // ── 실시간 틱: 노쇼 카운트다운 + 지연 예측(진행 중 경기 경과)을 10초마다 갱신 ──
  //   호출 이력이 있거나 진행 중 경기가 있을 때만 돈다(불필요한 리렌더 방지).
  useEffect(() => {
    const hasLive = Object.keys(calledIds).length > 0 || matches.some(m => m.status === 'in_progress')
    if (!hasLive) return
    const iv = setInterval(() => setNowTick(Date.now()), 10000)
    return () => clearInterval(iv)
  }, [calledIds, matches])

  // ── 노쇼 판정: 호출 후 미응답 경기를 단계별로 분류하고, 자동 진행 시 경고 발송 ──
  //   waiting/warned/overdue 3단계. 경고(WALKOVER_WARN)는 무인 진행이 켜졌을 때만
  //   1회 자동 발송(warnedRef 중복 차단). 부전승 최종 처리는 사람이 확인(overdue 패널).
  useEffect(() => {
    const plan = planNoShow(matches, {
      calledAt: calledIds, warnedAt: warnedRef.current, now: nowTick,
    })
    setNoShow(plan.status)
    if (autoRun && plan.toWarn.length) {
      plan.toWarn.forEach(m => {
        warnedRef.current[m.id] = Date.now() // 먼저 표시해 중복 발송 차단
        const st = plan.status[m.id]
        callWalkoverWarn({
          match: m, tournamentId: id, court: m.court_number, sport: sportOf(m),
          secondsLeft: st?.secondsLeft ?? null, recipients: recipientsOf(m),
        })
          .then(() => pushAutoLog(`${m.court_number}번 코트 미입장 경고 — ${teamNamesOf(m)}`))
          .catch(() => {})
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, calledIds, autoRun, nowTick])

  // ── 진행 페이스·지연 예측 (C6) — 계획 대비 실시간 지연을 예측(nowTick 로 라이브 갱신) ──
  const delay = useMemo(
    () => analyzeDelay(matches, { matchMinutes: categories.find(c => c.id === activeCat)?.match_duration_min ?? 30, now: nowTick }),
    [matches, categories, activeCat, nowTick]
  )

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

  // 호출 대상(선수 id)·팀 이름·종목 헬퍼 (수동/자동 호출이 공유)
  function recipientsOf(m) {
    return [
      m.team1?.player1?.id, m.team1?.player2?.id,
      m.team2?.player1?.id, m.team2?.player2?.id,
    ].filter(Boolean)
  }
  function teamNamesOf(m) {
    const a = [m.team1?.player1?.name, m.team1?.player2?.name].filter(Boolean).join('/') || '팀A'
    const b = [m.team2?.player1?.name, m.team2?.player2?.name].filter(Boolean).join('/') || '팀B'
    return `${a} vs ${b}`
  }
  function sportOf(m) {
    return categories.find(c => c.id === m.category_id)?.sport_type ?? null
  }
  function pushAutoLog(msg) {
    setAutoLog(prev => [{ t: Date.now(), msg }, ...prev].slice(0, 6))
  }

  // ── 선수 호출: 코트로 입장하라는 알림을 3채널로 팬아웃 (C1) ──────────
  //   인앱 실시간 방송(즉시) + 지속 저장(감사·재알림·푸시 큐) + 외부발송 스텁.
  //   재호출(미응답 시)도 같은 버튼으로 반복 가능.
  async function handleCall(m) {
    if (calling) return
    setCalling(m.id)
    try {
      const res = await callMatch({
        match: m,
        tournamentId: id,
        court: m.court_number,
        sport: sportOf(m),
        recipients: recipientsOf(m),
      })
      setCalledIds(prev => ({ ...prev, [m.id]: Date.now() }))
      delete warnedRef.current[m.id] // 재호출 시 노쇼 경고 다시 보낼 수 있게 초기화
      if (!res.persist.persisted && res.persist.reason === 'table_missing') {
        // 인앱 호출은 나갔지만 이력 저장은 아직(013 미적용). 진행은 막지 않음.
        console.info('[호출] 실시간 방송 완료 — 이력 저장은 013 마이그레이션 적용 후 활성화')
      }
    } catch (e) {
      alert('호출 중 문제가 생겼어요: ' + e.message)
    }
    setCalling(null)
  }

  // ── 무인 자동 진행: 빈 코트 → 다음 경기 자동 호출 + 사전 알림 (C6·C1) ──
  //   실시간으로 경기 상태가 바뀔 때마다(코트가 비면) 오케스트레이터가
  //   "지금 호출할 경기 / 곧 호출 예고할 경기 / 예상 호출 시각" 을 계산한다.
  //   중복 호출은 calledIds·soonSentRef 로 막고, 실제 발송은 notify.js 가 담당.
  async function runOrchestrator(curMatches) {
    if (orchestrating.current) return
    orchestrating.current = true
    try {
      const catIds = categories.map(c => c.id)
      // 다른 종목이 진행 중인 코트 = 비어있지 않음 → 자동 투입 금지 (중복 예약 방지)
      const busy = new Set()
      if (catIds.length > 1) {
        const { data: running } = await supabase
          .from('tournament_matches')
          .select('court_number, category_id')
          .in('category_id', catIds)
          .eq('status', 'in_progress')
        ;(running ?? []).forEach(r => {
          if (r.court_number != null && r.category_id !== activeCat) busy.add(r.court_number)
        })
      }
      const mm = categories.find(c => c.id === activeCat)?.match_duration_min ?? 30
      const plan = planAutoAdvance(curMatches, {
        busyCourts: busy,
        calledAt: calledIds,
        soonSentAt: soonSentRef.current,
        matchMinutes: mm,
      })
      setEstimates(plan.estimates)

      // 지금 호출할 경기 (빈 코트 맨 앞) — 순차 발송
      for (const m of plan.toCall) {
        try {
          await callMatch({ match: m, tournamentId: id, court: m.court_number, sport: sportOf(m), recipients: recipientsOf(m) })
          setCalledIds(prev => ({ ...prev, [m.id]: Date.now() }))
          delete warnedRef.current[m.id]
          pushAutoLog(`${m.court_number}번 코트 자동 호출 — ${teamNamesOf(m)}`)
        } catch { /* 다음 틱에 재시도 */ }
      }
      // 곧 호출될 경기 — 사전 알림 1회
      for (const m of plan.toSoon) {
        try {
          const est = plan.estimates[m.id]
          await callMatchSoon({ match: m, tournamentId: id, court: m.court_number, sport: sportOf(m), aheadCount: est?.ahead ?? null, recipients: recipientsOf(m) })
          soonSentRef.current[m.id] = Date.now()
          pushAutoLog(`${m.court_number}번 코트 곧 호출 예고 — ${teamNamesOf(m)}`)
        } catch { /* 무시 */ }
      }
    } finally {
      orchestrating.current = false
    }
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

  // ── 노쇼(호출 미응답) 부전승 처리 (C7) ────────────────────────────
  //   호출 후 유예 시간이 지나도 안 온 팀을 부전승 처리. "누가 안 왔는지" 는
  //   현장 판단이 필요한 예외라 사람이 한 번 확인한다(원터치). 나머지(감지·경고·
  //   카운트다운)는 전부 자동. resultType='walkover' → MMR 미반영(계약: RPC 내부 판정).
  async function resolveNoShow(match, absentTeam) {
    if (resolving) return
    const label = absentTeam === 1 ? '팀1' : '팀2'
    if (!confirm(`${label}이 호출에 응답하지 않았어요.\n미입장(노쇼) 부전승으로 처리할까요? (되돌릴 수 없어요)`)) return
    setResolving(match.id)
    const winningSide = absentTeam === 1 ? 2 : 1
    const winnerEntryId = winningSide === 1 ? match.team1_entry_id : match.team2_entry_id
    try {
      const res = await completeMatch(supabase, match.id, {
        winnerEntryId,
        resultType: 'walkover',
        forfeitTeam: absentTeam,
        forfeitReason: '호출 미응답(노쇼)',
      })
      delete warnedRef.current[match.id]
      if (res?.mmrError) {
        alert('처리는 됐지만 MMR 반영에 실패했어요.\n주최자 계정으로 로그인돼 있는지 확인한 뒤 다시 시도해주세요.')
      }
      pushAutoLog(`${match.court_number ?? '-'}번 코트 노쇼 부전승 — ${teamNamesOf(match)}`)
    } catch (e) {
      alert('부전승 처리 중 문제가 생겼어요: ' + e.message)
    }
    setResolving(null)
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
  const overdueMatches = catMatches.filter(m => noShow[m.id]?.phase === 'overdue')
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

          {/* ── 무인 자동 진행 스위치 (빈 코트 자동 호출) ──────────────── */}
          <div className="px-4 pt-4">
            <div className={`rounded-2xl border p-4 transition
              ${autoRun ? 'border-[#C60C30] bg-red-50/60' : 'border-gray-100 bg-white'}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Zap size={18} className={autoRun ? 'text-[#C60C30]' : 'text-gray-400'} />
                  <div className="min-w-0">
                    <p className="font-bold text-sm">무인 자동 진행</p>
                    <p className="text-[11px] text-gray-500 leading-tight">
                      코트가 비면 다음 경기를 자동 호출하고, 다음 팀에게 "곧 호출" 을 미리 알려요.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setAutoRun(v => !v)}
                  role="switch"
                  aria-checked={autoRun}
                  className={`relative shrink-0 w-12 h-7 rounded-full transition-colors
                    ${autoRun ? 'bg-[#C60C30]' : 'bg-gray-300'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform
                    ${autoRun ? 'translate-x-5' : ''}`} />
                </button>
              </div>

              {autoRun && (
                <div className="mt-3 pt-3 border-t border-red-100 space-y-1.5">
                  <p className="text-[11px] font-bold text-[#C60C30] flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#C60C30] animate-pulse" />
                    자동 진행 중 — 화면을 열어두면 사람 없이 호출돼요
                  </p>
                  {autoLog.length === 0 ? (
                    <p className="text-[11px] text-gray-400">빈 코트가 생기면 여기에 자동 호출 내역이 기록됩니다.</p>
                  ) : (
                    autoLog.map((l, i) => (
                      <p key={i} className="text-[11px] text-gray-500 truncate">
                        <span className="text-gray-400 tabular-nums">{fmt(l.t)}</span> · {l.msg}
                      </p>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── 진행 페이스·지연 예측 (계획 대비 실시간 지연 재조정 안내) ──────── */}
          {delay.remaining > 0 && (delay.runningCount > 0 || delay.projectedFinish != null || delay.overdueStartCount > 0) && (
            <div className="px-4 pt-4">
              <div className={`rounded-2xl border p-4 ${delay.onTrack
                ? 'border-emerald-200 bg-emerald-50'
                : delay.delayMin >= 20 ? 'border-[#C60C30] bg-red-50' : 'border-amber-300 bg-amber-50'}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className={`font-bold text-sm flex items-center gap-1.5 ${delay.onTrack
                    ? 'text-emerald-700' : delay.delayMin >= 20 ? 'text-[#C60C30]' : 'text-amber-800'}`}>
                    <TrendingUp size={16} /> 진행 페이스 · 지연 예측
                  </p>
                  <span className="text-[11px] font-semibold text-gray-500 tabular-nums">
                    남은 경기 {delay.remaining} · 진행 중 {delay.runningCount}
                  </span>
                </div>

                {delay.onTrack ? (
                  <p className="text-sm font-bold text-emerald-800 mt-1.5">
                    현재 페이스면 계획대로 진행 중이에요 👍
                  </p>
                ) : (
                  <p className={`mt-1.5 ${delay.delayMin >= 20 ? 'text-[#C60C30]' : 'text-amber-800'}`}>
                    <span className="text-lg font-black tabular-nums">약 {delay.delayMin}분 지연</span>
                    <span className="text-sm font-bold"> 예상 (현재 페이스 기준)</span>
                  </p>
                )}

                {/* 예상 종료 vs 계획 */}
                {(delay.projectedFinish != null || delay.plannedFinish != null) && (
                  <div className="mt-2 flex items-center gap-4 text-xs">
                    {delay.projectedFinish != null && (
                      <div>
                        <span className="text-gray-400">예상 종료</span>{' '}
                        <span className="font-black text-gray-800 tabular-nums">{fmt(delay.projectedFinish)}</span>
                      </div>
                    )}
                    {delay.plannedFinish != null && (
                      <div>
                        <span className="text-gray-400">계획</span>{' '}
                        <span className="font-semibold text-gray-500 tabular-nums">{fmt(delay.plannedFinish)}</span>
                      </div>
                    )}
                    <div>
                      <span className="text-gray-400">경기당</span>{' '}
                      <span className={`font-bold tabular-nums ${delay.observedMin > (activeCatObj?.match_duration_min ?? 30) ? 'text-[#C60C30]' : 'text-gray-600'}`}>
                        {delay.observedMin}분
                      </span>
                    </div>
                  </div>
                )}

                {/* 재배치안 */}
                {delay.suggestions.length > 0 && (
                  <ul className="mt-2.5 pt-2.5 border-t border-black/5 space-y-1">
                    {delay.suggestions.map((s, i) => (
                      <li key={i} className="text-[11px] text-gray-600 flex gap-1.5">
                        <span className="text-gray-400 shrink-0">·</span>{s}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* ── 노쇼 확인 대기 (호출 후 미응답 → 부전승 처리 필요) ─────────── */}
          {overdueMatches.length > 0 && (
            <div className="px-4 pt-4">
              <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
                <p className="font-bold text-sm text-amber-800 flex items-center gap-1.5">
                  <AlertTriangle size={16} /> 노쇼 확인 대기 {overdueMatches.length}건
                </p>
                <p className="text-[11px] text-amber-700/80 mt-0.5 leading-tight">
                  호출 후 응답이 없는 경기예요. 안 온 팀을 눌러 부전승 처리하면 대진이 자동으로 이어져요.
                </p>
                <div className="mt-3 space-y-2.5">
                  {overdueMatches.map(m => {
                    const ns = noShow[m.id]
                    const elapsedMin = ns ? Math.max(1, Math.round(ns.elapsedSec / 60)) : null
                    const t1name = [m.team1?.player1?.name, m.team1?.player2?.name].filter(Boolean).join(' / ') || '팀 A'
                    const t2name = [m.team2?.player1?.name, m.team2?.player2?.name].filter(Boolean).join(' / ') || '팀 B'
                    return (
                      <div key={m.id} className="bg-white rounded-xl border border-amber-200 p-3">
                        <p className="text-xs text-gray-500 flex items-center gap-1 flex-wrap">
                          {m.court_number != null && <span className="font-bold text-gray-700">{m.court_number}번 코트</span>}
                          <span className="text-amber-700 font-semibold">· 호출 {elapsedMin}분 경과 · 미응답</span>
                        </p>
                        <p className="text-sm font-bold mt-0.5">{t1name} <span className="text-gray-300">vs</span> {t2name}</p>
                        <div className="flex gap-2 mt-2">
                          <button onClick={() => resolveNoShow(m, 1)} disabled={resolving === m.id}
                            className="flex-1 py-2 rounded-lg bg-amber-500 text-white text-xs font-bold active:opacity-80 disabled:opacity-40">
                            {t1name} 노쇼 (부전승)
                          </button>
                          <button onClick={() => resolveNoShow(m, 2)} disabled={resolving === m.id}
                            className="flex-1 py-2 rounded-lg bg-amber-500 text-white text-xs font-bold active:opacity-80 disabled:opacity-40">
                            {t2name} 노쇼 (부전승)
                          </button>
                        </div>
                        <button onClick={() => handleCall(m)} disabled={calling === m.id}
                          className="w-full mt-1.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 text-[11px] font-bold active:opacity-80 disabled:opacity-40">
                          {calling === m.id ? '재호출 중…' : '다시 호출 (한 번 더 기다리기)'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

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
                    <div className="flex items-center gap-1.5 text-xs text-gray-400 flex-wrap">
                      <Clock size={11} /> {fmt(m.scheduled_time)}
                      {m.court_number && <span>· 코트 {m.court_number}</span>}
                      {m.status === 'scheduled' && !noShow[m.id] && estimates[m.id] && (
                        <span className="flex items-center gap-0.5 text-[#003478] font-semibold">
                          <Timer size={10} /> 예상 호출 {fmt(estimates[m.id].at)}쯤
                          {estimates[m.id].ahead > 0 ? ` · 앞 ${estimates[m.id].ahead}경기` : ' · 대기 없음'}
                        </span>
                      )}
                      {m.status === 'scheduled' && (noShow[m.id]?.phase === 'waiting' || noShow[m.id]?.phase === 'warned') && (
                        <span className={`flex items-center gap-0.5 font-bold
                          ${noShow[m.id].phase === 'warned' ? 'text-[#C60C30]' : 'text-amber-600'}`}>
                          <AlertTriangle size={10} /> 미응답 부전승까지 {fmtCountdown(noShow[m.id].secondsLeft)}
                        </span>
                      )}
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
                      {/* 선수 호출 — 코트 입장 알림 (미응답 시 재호출 가능) */}
                      <button onClick={() => handleCall(m)}
                        disabled={calling === m.id || !(m.team1_entry_id && m.team2_entry_id)}
                        className={`w-full py-2.5 rounded-xl text-sm font-bold active:opacity-80
                          flex items-center justify-center gap-1.5 disabled:opacity-40
                          ${calledIds[m.id] ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                            : 'bg-[#C60C30] text-white'}`}>
                        <Megaphone size={14} />
                        {calling === m.id
                          ? '호출 중…'
                          : calledIds[m.id]
                            ? `호출됨 ${fmt(calledIds[m.id])} · 다시 호출`
                            : m.court_number != null
                              ? `${m.court_number}번 코트로 선수 호출`
                              : '선수 호출 (코트 입장 알림)'}
                      </button>
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

          {/* 체크인 요약 (셀프 체크인 무인 진행률) */}
          {(() => {
            const players = entries.flatMap(e => [e.player1, e.player2].filter(Boolean))
            const sum = summarizeCheckins(players, checkins)
            return (
              <div className="bg-white rounded-2xl border border-gray-100 p-3.5 mb-3">
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-xs text-gray-400">체크인 완료</p>
                    <p className="text-2xl font-black text-[#003478] tabular-nums">
                      {sum.done}<span className="text-base text-gray-400 font-bold"> / {sum.total}명</span>
                    </p>
                  </div>
                  <div className="flex gap-1.5 flex-wrap justify-end">
                    <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                      셀프 {sum.self}
                    </span>
                    {sum.reviewNeeded > 0 && (
                      <span className="text-[11px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                        본인확인 권장 {sum.reviewNeeded}
                      </span>
                    )}
                    {sum.flagged > 0 && (
                      <span className="text-[11px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                        신고 {sum.flagged}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })()}

          {/* 안내 */}
          <div className="bg-blue-50 rounded-2xl p-3.5 mb-4 flex gap-2.5">
            <span className="text-lg shrink-0">💬</span>
            <p className="text-xs text-blue-700 leading-relaxed">
              선수가 <strong>폰으로 셀프 체크인</strong>하면 여기에 자동으로 표시돼요.
              실명인증 선수는 그대로 확정, <strong className="text-amber-700">'본인확인 권장'</strong> 표시(셀프·미인증)만
              현장에서 한 번 확인하세요. 미도착 선수는 아래에서 직접 체크인할 수도 있어요.
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
                  const isSelf      = isCheckedIn && chk.verified_method === 'self'
                  const reviewSelf  = isSelf && !player.identity_verified // 셀프·미인증 → 본인확인 권장

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
                            <div className="flex flex-col items-end gap-1">
                              <span className="text-xs font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                                <CheckCircle size={10} /> {isSelf ? '셀프 완료' : '완료'}
                              </span>
                              {reviewSelf && (
                                <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                                  본인확인 권장
                                </span>
                              )}
                            </div>
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

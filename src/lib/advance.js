/**
 * advance.js — 경기 완료 후 진행(진출) 처리 로직
 *
 * 계약 (아키텍트 명세 §4):
 *  - completeMatch(supabase, matchId, {...})   : 결과 저장 + 승자 다음 경기 슬롯 채움 + 풀 완료 검사
 *  - checkPoolStageComplete(supabase, categoryId): 조별리그 전체 완료 시 본선 시딩
 *  - seedKnockoutFromPools(supabase, categoryId) : 조 순위 계산 → pool_rank 기록 → 본선 1라운드 배정
 *  - finalizeRanks(supabase, categoryId)         : 최종 순위(final_rank) 확정
 *  - finalizeTournament(supabase, tournamentId, categoryIds): 전 종목 시상 확정 + 대회 completed
 *
 * DB 규약: 상태값은 전부 소문자. stage 구분은 match_phase('pool'|'knockout').
 * MMR 반영은 completeMatch 안에서 apply_match_mmr(match_id) RPC(SECURITY DEFINER)를
 * 단일 진입점으로 호출한다 — 심판 점수판·주최자 인라인 어느 경로든 여기로 통합된다.
 * walkover 제외/retired 포함/none·bye·멱등 판정은 전부 RPC 내부가 전담하므로,
 * 호출부는 result_type을 분기하지 말고 그냥 completeMatch만 부르면 된다.
 */

import {
  calculatePoolStandings,
  determineAdvancements,
  generateKnockoutBracket,
} from './tournament.js'
import { scheduleMatches } from './scheduler.js'

const DONE_STATUSES = ['completed', 'forfeited', 'bye']

// ── 내부 유틸 ────────────────────────────────────────────────────

/** match_scores rows → calculatePoolStandings가 원하는 [[t1,t2],...] 모양 */
export function scoresToPairs(scoreRows) {
  return [...(scoreRows ?? [])]
    .sort((a, b) => (a.set_number ?? 0) - (b.set_number ?? 0))
    .map(s => [Number(s.team1_score) || 0, Number(s.team2_score) || 0])
}

/** 승자를 다음 경기의 빈 슬롯(team1/team2)에 채운다 */
export async function advanceWinner(supabase, match, winnerEntryId) {
  if (!match?.next_match_id || !match?.next_match_slot || !winnerEntryId) return false
  const col = match.next_match_slot === 1 ? 'team1_entry_id' : 'team2_entry_id'
  const { error } = await supabase
    .from('tournament_matches')
    .update({ [col]: winnerEntryId })
    .eq('id', match.next_match_id)
  if (error) throw new Error('다음 경기 배정 실패: ' + error.message)
  return true
}

// ── 1. completeMatch ─────────────────────────────────────────────

/**
 * 경기 결과 저장 + 승자 자동 진출 + (풀 경기라면) 조별리그 완료 검사.
 * @param {object} opts
 *  - winnerEntryId: 승자 entry id (필수)
 *  - gamesWonT1/gamesWonT2: 게임 승수
 *  - games: [[21,18],[19,21],...] 게임별 점수 (없으면 점수 저장 생략)
 *  - resultType: 'normal'|'walkover'|'retired'|'disqualified'
 *  - forfeitTeam: 기권/실격 팀 번호(1|2), forfeitReason: 사유
 * @returns {{ categoryId, advancedToMatchId, poolStageCompleted }}
 */
export async function completeMatch(supabase, matchId, {
  winnerEntryId,
  gamesWonT1 = 0,
  gamesWonT2 = 0,
  games = [],
  resultType = 'normal',
  forfeitTeam = null,
  forfeitReason = null,
} = {}) {
  const { data: match, error: loadErr } = await supabase
    .from('tournament_matches')
    .select('*')
    .eq('id', matchId)
    .single()
  if (loadErr || !match) throw new Error('경기를 찾을 수 없습니다')

  // 1) 게임별 점수 저장 (기존 행 교체 — UNIQUE(match_id,set_number) 안전)
  if (Array.isArray(games) && games.length > 0) {
    await supabase.from('match_scores').delete().eq('match_id', matchId)
    const { error: scoreErr } = await supabase.from('match_scores').insert(
      games.map((g, i) => ({
        match_id: matchId,
        set_number: i + 1,
        team1_score: Number(g?.[0]) || 0,
        team2_score: Number(g?.[1]) || 0,
      }))
    )
    if (scoreErr) throw new Error('점수 저장 실패: ' + scoreErr.message)
  }

  // 2) 경기 상태 확정 + 라이브 캐시 정리(L2: 완료 경기의 live_* 잔존값 리셋)
  const isForfeit = resultType === 'walkover' || resultType === 'retired' || resultType === 'disqualified'
  const { error: updErr } = await supabase.from('tournament_matches').update({
    status: isForfeit ? 'forfeited' : 'completed',
    winner_entry_id: winnerEntryId ?? null,
    games_won_team1: gamesWonT1,
    games_won_team2: gamesWonT2,
    result_type: resultType,
    forfeit_team: isForfeit ? forfeitTeam : null,
    forfeit_reason: isForfeit ? forfeitReason : null,
    live_score_t1: 0,
    live_score_t2: 0,
    live_server_team: null,
  }).eq('id', matchId)
  if (updErr) throw new Error('경기 결과 저장 실패: ' + updErr.message)

  // 3) 승자 다음 경기 슬롯 채움 (녹아웃)
  if (winnerEntryId && match.next_match_id) {
    await advanceWinner(supabase, match, winnerEntryId)
  }

  // 4) MMR 반영 — 단일 진입점 (C1/S3/M4/M5).
  //    walkover 제외·retired 포함·none/bye/멱등은 전부 RPC 내부가 판정한다 →
  //    호출부는 result_type 분기 없이 무조건 호출. profiles/mmr_history 직접 write 금지.
  //    실패해도 점수·진출은 이미 확정됐으므로 되돌리지 않고, 경고를 반환값에 담아 전달.
  //    (RPC는 mmr_applied 가드로 멱등 → 나중에 재확정해도 중복 반영 없음)
  let mmrError = null
  {
    const { error: rpcErr } = await supabase.rpc('apply_match_mmr', { p_match_id: matchId })
    if (rpcErr) {
      mmrError = rpcErr.message || String(rpcErr)
      console.error('[completeMatch] MMR 반영 실패:', rpcErr)
    }
  }

  // 5) 풀 경기면 조별리그 전체 완료 검사 → 본선 시딩
  let poolStageCompleted = false
  if (match.match_phase === 'pool') {
    poolStageCompleted = await checkPoolStageComplete(supabase, match.category_id)
  }

  return {
    categoryId: match.category_id,
    advancedToMatchId: match.next_match_id ?? null,
    poolStageCompleted,
    mmrError,
  }
}

// ── 2. checkPoolStageComplete ────────────────────────────────────

/**
 * 해당 종목의 풀 경기가 전부 끝났는지 검사.
 * 끝났고 포맷이 pool_knockout이면 본선 시딩까지 실행.
 * @returns {boolean} 풀 스테이지 완료 여부
 */
export async function checkPoolStageComplete(supabase, categoryId) {
  const { data: poolMatches } = await supabase
    .from('tournament_matches')
    .select('id, status')
    .eq('category_id', categoryId)
    .eq('match_phase', 'pool')
  if (!poolMatches?.length) return false

  const allDone = poolMatches.every(m => DONE_STATUSES.includes(m.status))
  if (!allDone) return false

  const { data: cat } = await supabase
    .from('tournament_categories')
    .select('id, tournament_format')
    .eq('id', categoryId)
    .single()

  if (cat?.tournament_format === 'pool_knockout') {
    await seedKnockoutFromPools(supabase, categoryId)
  }
  return true
}

// ── 3. seedKnockoutFromPools ─────────────────────────────────────

/**
 * 조별 순위 계산 → tournament_entries.pool_rank 기록 →
 * 진출팀(직행+와일드카드) 선발 → 본선(녹아웃) 1라운드 스켈레톤에 팀 배정.
 * 이미 1라운드에 팀이 배정돼 있으면 재시딩하지 않는다(멱등).
 */
export async function seedKnockoutFromPools(supabase, categoryId) {
  const [{ data: cat }, { data: pools }, { data: allMatches }] = await Promise.all([
    supabase.from('tournament_categories').select('*').eq('id', categoryId).single(),
    supabase.from('tournament_pools').select('*').eq('category_id', categoryId).order('pool_index'),
    supabase.from('tournament_matches')
      .select('*, scores:match_scores(*)')
      .eq('category_id', categoryId),
  ])
  if (!cat || !pools?.length) return null

  const matches = allMatches ?? []
  const koRound1 = matches
    .filter(m => m.match_phase === 'knockout' && m.round_number === 1)
    .sort((a, b) => (a.bracket_pos ?? 0) - (b.bracket_pos ?? 0))
  if (!koRound1.length) return null // 본선 스켈레톤 없음 (pool_only 등)

  // 멱등 가드: 이미 시딩됐으면 건드리지 않는다 (본선 진행 중 덮어쓰기 방지)
  if (koRound1.some(m => m.team1_entry_id || m.team2_entry_id)) {
    return { alreadySeeded: true }
  }

  const { data: poolEntryRows } = await supabase
    .from('tournament_pool_entries')
    .select('pool_id, entry_id')
    .in('pool_id', pools.map(p => p.id))

  // 풀별 순위 계산
  const poolMatches = matches.filter(m => m.match_phase === 'pool')
  const poolsStandings = pools.map((p, i) => {
    const entryIds = (poolEntryRows ?? []).filter(pe => pe.pool_id === p.id).map(pe => pe.entry_id)
    const shaped = poolMatches
      .filter(m => m.pool_id === p.id)
      .map(m => ({
        team1_entry_id: m.team1_entry_id,
        team2_entry_id: m.team2_entry_id,
        winner_entry_id: m.winner_entry_id,
        scores: scoresToPairs(m.scores),
      }))
    const standings = calculatePoolStandings(
      entryIds.map(id => ({ entryId: id, label: id })),
      shaped,
      cat.tiebreaker_order
    )
    return { poolIndex: p.pool_index ?? i, poolName: p.pool_name, standings }
  })

  // pool_rank 기록
  for (const { standings } of poolsStandings) {
    for (const s of standings) {
      await supabase.from('tournament_entries').update({ pool_rank: s.rank }).eq('id', s.entryId)
    }
  }

  // 진출팀 선발 (직행 + 와일드카드)
  const advancements = determineAdvancements(
    poolsStandings,
    cat.advancement_per_pool ?? 2,
    cat.wildcard_count ?? 0,
    cat.wildcard_criteria ?? 'score_diff'
  )

  // 본선 1라운드 대진 생성 → 스켈레톤에 UPDATE로 채움
  const seed = pools[0]?.draw_seed ?? categoryId
  const bracket = generateKnockoutBracket(advancements, seed)
  const round1 = bracket.filter(b => b.round === 1).sort((a, b) => a.slot - b.slot)

  // 스켈레톤별 팀 배정 계산 (아직 DB 반영 전)
  const assignments = koRound1.map((sk, i) => {
    const b = round1[i]
    if (!b) return null
    const t1 = b.team1EntryId ?? null
    const t2 = b.team2EntryId ?? null
    const isBye = (t1 === null) !== (t2 === null) // 한쪽만 비면 부전승
    return { sk, t1, t2, isBye, byeWinner: t1 ?? t2 }
  }).filter(Boolean)

  // ── M2: 본선 1라운드 코트·시간 배정 ──────────────────────────────
  // 스켈레톤은 court_number/scheduled_time = null 로 생성됐다(BracketGenerator).
  // 조별 경기에 쓰던 코트를 재사용하고, 조별 경기가 끝난 시각 뒤로 이어 배정한다.
  // 실제 대결(양팀 배정) 경기만 코트를 잡고, 부전승/미충원 경기는 코트 없음.
  const poolCourts = [...new Set(poolMatches.map(m => m.court_number).filter(Boolean))]
    .sort((a, b) => a - b)
  const courts = poolCourts.length ? poolCourts : [1, 2, 3, 4]
  const poolTimes = poolMatches
    .map(m => m.scheduled_time).filter(Boolean).map(t => new Date(t).getTime())
  const matchMinutes = cat?.match_duration_min ?? 30
  const koStart = poolTimes.length
    ? new Date(Math.max(...poolTimes) + matchMinutes * 60000)
    : new Date()

  const playable = assignments.filter(a => !a.isBye && a.t1 && a.t2)
  const scheduled = scheduleMatches({
    matches: playable.map(a => ({ entryA: { id: a.t1 }, entryB: { id: a.t2 } })),
    courts, startTime: koStart, matchMinutes, breakMinutes: 5,
  })
  const schedBySk = new Map()
  playable.forEach((a, k) => {
    schedBySk.set(a.sk.id, {
      court_number: scheduled[k]?.court ?? null,
      scheduled_time: scheduled[k]?.scheduledTime?.toISOString() ?? null,
    })
  })

  for (const a of assignments) {
    const patch = {
      team1_entry_id: a.t1,
      team2_entry_id: a.t2,
      ...(a.isBye ? { status: 'bye', winner_entry_id: a.byeWinner } : {}),
    }
    // 코트/시간이 비어 있을 때만 채운다 (이미 배정돼 있으면 존중)
    const sched = schedBySk.get(a.sk.id)
    if (sched && a.sk.court_number == null && a.sk.scheduled_time == null) {
      if (sched.court_number != null) patch.court_number = sched.court_number
      if (sched.scheduled_time != null) patch.scheduled_time = sched.scheduled_time
    }
    await supabase.from('tournament_matches').update(patch).eq('id', a.sk.id)

    // 부전승 팀은 즉시 다음 라운드로 (MMR 반영 없음)
    if (a.isBye && a.byeWinner) {
      await advanceWinner(supabase, a.sk, a.byeWinner)
    }
  }

  return { poolsStandings, advancements }
}

// ── 4. finalizeRanks ─────────────────────────────────────────────

/**
 * 종목 최종 순위 확정 → tournament_entries.final_rank 저장.
 * 녹아웃: 결승 승자=1위, 패자=2위, 준결승 패자=공동 3위 (prize_spots가 3 미만이어도
 * final_rank는 사실 그대로 기록 — 시상 노출 범위는 UI가 prize_spots로 자른다).
 * 녹아웃 없는 리그전: 조 순위 기반으로 순차 부여.
 * @returns {[{entryId, rank}]}
 */
export async function finalizeRanks(supabase, categoryId) {
  const { data: allMatches } = await supabase
    .from('tournament_matches')
    .select('*, scores:match_scores(*)')
    .eq('category_id', categoryId)
  const matches = allMatches ?? []
  if (!matches.length) return []

  const unfinished = matches.filter(m => !DONE_STATUSES.includes(m.status))
  if (unfinished.length) {
    throw new Error(`아직 끝나지 않은 경기가 ${unfinished.length}개 있습니다`)
  }

  const ranks = {} // entryId → rank
  const ko = matches.filter(m => m.match_phase === 'knockout' && m.round_number != null)

  if (ko.length > 0) {
    const maxRound = Math.max(...ko.map(m => m.round_number))
    const final = ko.find(m => m.round_number === maxRound)
    if (!final?.winner_entry_id) throw new Error('결승 결과가 없습니다')

    ranks[final.winner_entry_id] = 1
    const runnerUp = final.team1_entry_id === final.winner_entry_id
      ? final.team2_entry_id : final.team1_entry_id
    if (runnerUp) ranks[runnerUp] = 2

    // 준결승 패자 = 공동 3위
    const semis = ko.filter(m => m.round_number === maxRound - 1)
    for (const s of semis) {
      if (!s.winner_entry_id) continue
      const loser = s.team1_entry_id === s.winner_entry_id ? s.team2_entry_id : s.team1_entry_id
      if (loser && ranks[loser] == null) ranks[loser] = 3
    }
  } else {
    // 리그전만 있는 경우: 조별 순위 → 최종 순위
    const { data: rankCat } = await supabase
      .from('tournament_categories')
      .select('tiebreaker_order')
      .eq('id', categoryId)
      .single()
    const { data: pools } = await supabase
      .from('tournament_pools')
      .select('*')
      .eq('category_id', categoryId)
      .order('pool_index')

    let groups
    if (pools?.length) {
      const { data: poolEntryRows } = await supabase
        .from('tournament_pool_entries')
        .select('pool_id, entry_id')
        .in('pool_id', pools.map(p => p.id))
      groups = pools.map(p => ({
        entryIds: (poolEntryRows ?? []).filter(pe => pe.pool_id === p.id).map(pe => pe.entry_id),
        matches: matches.filter(m => m.pool_id === p.id),
      }))
    } else {
      // 풀 테이블 없이 리그전만 저장된 경우: 경기에 등장한 팀 전체를 한 조로
      const ids = new Set()
      matches.forEach(m => {
        if (m.team1_entry_id) ids.add(m.team1_entry_id)
        if (m.team2_entry_id) ids.add(m.team2_entry_id)
      })
      groups = [{ entryIds: [...ids], matches }]
    }

    const combined = []
    for (const g of groups) {
      const standings = calculatePoolStandings(
        g.entryIds.map(id => ({ entryId: id, label: id })),
        g.matches.map(m => ({
          team1_entry_id: m.team1_entry_id,
          team2_entry_id: m.team2_entry_id,
          winner_entry_id: m.winner_entry_id,
          scores: scoresToPairs(m.scores),
        })),
        rankCat?.tiebreaker_order
      )
      combined.push(...standings)
    }
    // 조 순위 → 게임득실 → 점수득실 순으로 전체 정렬 후 순차 부여
    combined.sort((a, b) =>
      a.rank !== b.rank ? a.rank - b.rank
      : b.gameDiff !== a.gameDiff ? b.gameDiff - a.gameDiff
      : b.pointDiff - a.pointDiff
    )
    combined.forEach((s, i) => { ranks[s.entryId] = i + 1 })
  }

  const result = Object.entries(ranks).map(([entryId, rank]) => ({ entryId, rank }))
  for (const { entryId, rank } of result) {
    await supabase.from('tournament_entries').update({ final_rank: rank }).eq('id', entryId)
  }
  return result.sort((a, b) => a.rank - b.rank)
}

// ── 5. finalizeTournament ────────────────────────────────────────

/**
 * 전 종목 시상 확정 + 대회 status='completed' + 급수 자동 승급 심사(D).
 * 종목별 finalizeRanks 실행 — 하나라도 미완료 경기가 있으면 에러를 던진다.
 *
 * 급수 승급(D, 감사 4-2): finalizeRanks 루프가 끝나 **모든 종목 final_rank가 확정된 뒤**
 * promote_grades_for_tournament RPC(012)를 1회 호출한다(승급 판정이 final_rank를 읽으므로
 * 순서 필수). 공인대회(cert_level≠none)만 심사한다. RPC는 멱등이라 재확정에도 중복 승급 없음.
 * 실패해도 시상은 이미 확정 → 되돌리지 않고 promoError만 담아 반환(경고).
 *
 * @returns {{ byCategory: { [categoryId]: [{entryId, rank}] },
 *             promotions: [{ player_id, mode, to_grade }],
 *             promoError: string|null }}
 *   ⚠️ 반환 형태 변경: 기존엔 byCategory 맵을 직접 반환했으나, 승급 결과를 함께 싣기 위해
 *      { byCategory, promotions, promoError } 로 감쌌다. UI(LiveDashboard)는 promotions로
 *      "🎉 승급!" 축하 배너를 띄운다.
 */
export async function finalizeTournament(supabase, tournamentId, categoryIds) {
  const byCategory = {}
  for (const catId of categoryIds ?? []) {
    byCategory[catId] = await finalizeRanks(supabase, catId)
  }
  const { error } = await supabase
    .from('tournaments')
    .update({ status: 'completed' })
    .eq('id', tournamentId)
  if (error) throw new Error('대회 상태 변경 실패: ' + error.message)

  // ── 급수 자동 승급 심사 (D) ──────────────────────────────────────
  // 모든 final_rank 확정 후 1회. 공인대회(cert_level≠none)만.
  // 승급 반영/이력 기록/권한 검증은 전부 RPC(SECURITY DEFINER) 내부가 전담 →
  // 호출부는 RPC만 부르고, 실패는 삼켜 경고로 반환(시상은 이미 확정이므로 롤백 안 함).
  let promotions = []
  let promoError = null
  try {
    const { data: t } = await supabase
      .from('tournaments')
      .select('cert_level')
      .eq('id', tournamentId)
      .single()
    if (t?.cert_level && t.cert_level !== 'none') {
      const { data, error: promoErr } = await supabase
        .rpc('promote_grades_v2', { p_tournament: tournamentId })
      if (promoErr) {
        promoError = promoErr.message || String(promoErr)
        console.error('[finalizeTournament] 급수 승급 심사 실패:', promoErr)
      } else {
        promotions = Array.isArray(data) ? data : []
      }
    }
  } catch (e) {
    promoError = e?.message || String(e)
    console.error('[finalizeTournament] 급수 승급 심사 예외:', e)
  }

  return { byCategory, promotions, promoError }
}

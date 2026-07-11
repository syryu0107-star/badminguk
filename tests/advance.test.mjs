// ── advance.js 회귀 테스트 (DB 변이 로직) ────────────────────────────────
// advance.js 는 "경기 완료→승자 진출→조별 종료→본선 시딩→최종 순위→시상 확정"
// 을 담당하는 최고위험 엔진이다. 여기서 검증하는 불변식이 깨지면 **조용히 잘못된
// 팀이 진출하거나(=엉뚱한 시상) 순위가 틀어진다**. supabase 의존이라 지금껏 커밋된
// 테스트가 순수 planTeamForfeit 하나뿐이었다 — 인메모리 스텁으로 DB 변이 경로를 고정한다.
import { test, assert } from './_harness.mjs'
import { makeSupabase } from './_supabase-stub.mjs'
import {
  advanceWinner, completeMatch, checkPoolStageComplete,
  seedKnockoutFromPools, finalizeRanks, finalizeTournament, scoresToPairs,
} from '../src/lib/advance.js'

// ══════════════════════ scoresToPairs ══════════════════════
test('advance: scoresToPairs — set_number 순 정렬 + 숫자 변환', () => {
  const pairs = scoresToPairs([
    { set_number: 2, team1_score: '19', team2_score: 21 },
    { set_number: 1, team1_score: 21, team2_score: '15' },
  ])
  assert.deepEqual(pairs, [[21, 15], [19, 21]])
})
test('advance: scoresToPairs — null/누락 안전', () => {
  assert.deepEqual(scoresToPairs(null), [])
  assert.deepEqual(scoresToPairs([{ team1_score: null, team2_score: undefined }]), [[0, 0]])
})

// ══════════════════════ advanceWinner ══════════════════════
test('advance: advanceWinner — slot 1 은 team1, slot 2 는 team2 채움', async () => {
  const sb = makeSupabase({
    tournament_matches: [
      { id: 'm1', next_match_id: 'f', next_match_slot: 1 },
      { id: 'm2', next_match_id: 'f', next_match_slot: 2 },
      { id: 'f', team1_entry_id: null, team2_entry_id: null },
    ],
  })
  assert.equal(await advanceWinner(sb, { next_match_id: 'f', next_match_slot: 1 }, 'W1'), true)
  assert.equal(await advanceWinner(sb, { next_match_id: 'f', next_match_slot: 2 }, 'W2'), true)
  const f = sb._db.tournament_matches.find(m => m.id === 'f')
  assert.equal(f.team1_entry_id, 'W1')
  assert.equal(f.team2_entry_id, 'W2')
})
test('advance: advanceWinner — next_match 없거나 승자 없으면 false(무변이)', async () => {
  const sb = makeSupabase({ tournament_matches: [{ id: 'f', team1_entry_id: null }] })
  assert.equal(await advanceWinner(sb, { next_match_id: null, next_match_slot: 1 }, 'W'), false)
  assert.equal(await advanceWinner(sb, { next_match_id: 'f', next_match_slot: 1 }, null), false)
  assert.equal(sb._db.tournament_matches[0].team1_entry_id, null)
})

// ══════════════════════ completeMatch ══════════════════════
function koSeed() {
  return {
    tournament_matches: [
      {
        id: 'sf1', category_id: 'C', match_phase: 'knockout', round_number: 1,
        team1_entry_id: 'E1', team2_entry_id: 'E2', status: 'scheduled',
        winner_entry_id: null, next_match_id: 'final', next_match_slot: 1,
        live_score_t1: 5, live_score_t2: 3, live_server_team: 1,
      },
      {
        id: 'final', category_id: 'C', match_phase: 'knockout', round_number: 2,
        team1_entry_id: null, team2_entry_id: null, status: 'scheduled',
        winner_entry_id: null, next_match_id: null, next_match_slot: null,
      },
    ],
    match_scores: [],
  }
}

test('advance: completeMatch(normal) — 상태·승수·라이브캐시 리셋 + 점수 저장 + 승자 진출 + MMR RPC', async () => {
  const sb = makeSupabase(koSeed())
  const res = await completeMatch(sb, 'sf1', {
    winnerEntryId: 'E1', gamesWonT1: 2, gamesWonT2: 1,
    games: [[21, 18], [19, 21], [21, 15]],
  })
  const sf1 = sb._db.tournament_matches.find(m => m.id === 'sf1')
  assert.equal(sf1.status, 'completed')
  assert.equal(sf1.winner_entry_id, 'E1')
  assert.equal(sf1.games_won_team1, 2)
  assert.equal(sf1.games_won_team2, 1)
  assert.equal(sf1.result_type, 'normal')
  // 라이브 캐시 리셋(완료 경기의 live_* 잔존값 정리)
  assert.equal(sf1.live_score_t1, 0)
  assert.equal(sf1.live_score_t2, 0)
  assert.equal(sf1.live_server_team, null)
  // 점수 3세트 저장
  const scores = sb._db.match_scores.filter(s => s.match_id === 'sf1').sort((a, b) => a.set_number - b.set_number)
  assert.equal(scores.length, 3)
  assert.deepEqual([scores[0].team1_score, scores[0].team2_score], [21, 18])
  // 승자 다음 경기(final) slot1 진출
  const final = sb._db.tournament_matches.find(m => m.id === 'final')
  assert.equal(final.team1_entry_id, 'E1')
  // MMR RPC 단일 진입점 호출
  assert.equal(sb._rpcCalls.length, 1)
  assert.equal(sb._rpcCalls[0].name, 'apply_match_mmr')
  assert.equal(sb._rpcCalls[0].args.p_match_id, 'sf1')
  // 반환 계약
  assert.equal(res.categoryId, 'C')
  assert.equal(res.advancedToMatchId, 'final')
  assert.equal(res.mmrError, null)
})

test('advance: completeMatch(walkover) — status=forfeited·forfeit_team 기록·승자 진출·RPC 여전히 호출', async () => {
  const sb = makeSupabase(koSeed())
  await completeMatch(sb, 'sf1', {
    winnerEntryId: 'E1', resultType: 'walkover', forfeitTeam: 2, forfeitReason: '노쇼',
  })
  const sf1 = sb._db.tournament_matches.find(m => m.id === 'sf1')
  assert.equal(sf1.status, 'forfeited')
  assert.equal(sf1.result_type, 'walkover')
  assert.equal(sf1.forfeit_team, 2)
  assert.equal(sf1.forfeit_reason, '노쇼')
  // walkover 여도 RPC 는 무조건 호출(제외 판정은 RPC 내부가 전담)
  assert.equal(sb._rpcCalls.length, 1)
  // 상대 자동 진출
  assert.equal(sb._db.tournament_matches.find(m => m.id === 'final').team1_entry_id, 'E1')
})

test('advance: completeMatch — 게임 미제공 시 점수 저장 생략(기존 점수 불변)', async () => {
  const seed = koSeed()
  seed.match_scores = [{ match_id: 'other', set_number: 1, team1_score: 21, team2_score: 10 }]
  const sb = makeSupabase(seed)
  await completeMatch(sb, 'sf1', { winnerEntryId: 'E1' })
  // sf1 점수 없음, 남의 점수는 그대로
  assert.equal(sb._db.match_scores.filter(s => s.match_id === 'sf1').length, 0)
  assert.equal(sb._db.match_scores.filter(s => s.match_id === 'other').length, 1)
})

test('advance: completeMatch — MMR RPC 실패해도 throw 하지 않고 mmrError 반환(점수·진출은 확정)', async () => {
  const sb = makeSupabase(koSeed(), {
    rpc: () => ({ data: null, error: { message: 'RPC 다운' } }),
  })
  const res = await completeMatch(sb, 'sf1', { winnerEntryId: 'E1', games: [[21, 0]] })
  assert.equal(res.mmrError, 'RPC 다운')
  // 실패해도 경기·진출은 확정된 채
  assert.equal(sb._db.tournament_matches.find(m => m.id === 'sf1').status, 'completed')
  assert.equal(sb._db.tournament_matches.find(m => m.id === 'final').team1_entry_id, 'E1')
})

test('advance: completeMatch — 없는 경기면 throw', async () => {
  const sb = makeSupabase({ tournament_matches: [] })
  await assert.rejects(() => completeMatch(sb, 'nope', { winnerEntryId: 'X' }), /찾을 수 없/)
})

// ══════════════════════ checkPoolStageComplete ══════════════════════
test('advance: checkPoolStageComplete — 미완료 경기 있으면 false', async () => {
  const sb = makeSupabase({
    tournament_matches: [
      { id: 'p1', category_id: 'C', match_phase: 'pool', status: 'completed' },
      { id: 'p2', category_id: 'C', match_phase: 'pool', status: 'scheduled' },
    ],
    tournament_categories: [{ id: 'C', tournament_format: 'pool_only' }],
  })
  assert.equal(await checkPoolStageComplete(sb, 'C'), false)
})
test('advance: checkPoolStageComplete — 풀 경기 없으면 false', async () => {
  const sb = makeSupabase({ tournament_matches: [], tournament_categories: [{ id: 'C' }] })
  assert.equal(await checkPoolStageComplete(sb, 'C'), false)
})
test('advance: checkPoolStageComplete — 전부 완료 pool_only 면 true(시딩 없음)', async () => {
  const sb = makeSupabase({
    tournament_matches: [
      { id: 'p1', category_id: 'C', match_phase: 'pool', status: 'completed' },
      { id: 'p2', category_id: 'C', match_phase: 'pool', status: 'bye' },
    ],
    tournament_categories: [{ id: 'C', tournament_format: 'pool_only' }],
  })
  assert.equal(await checkPoolStageComplete(sb, 'C'), true)
})

// ══════════════════════ seedKnockoutFromPools ══════════════════════
// 2조(각 2팀)·조당 1팀 직행 → 진출 2팀 → 본선 결승 1경기.
function poolKnockoutSeed() {
  return {
    tournament_categories: [{
      id: 'C', tournament_format: 'pool_knockout',
      advancement_per_pool: 1, wildcard_count: 0, wildcard_criteria: 'score_diff',
      tiebreaker_order: ['h2h', 'game_diff', 'point_diff', 'points_for'],
      match_duration_min: 30,
    }],
    tournament_pools: [
      { id: 'PA', category_id: 'C', pool_index: 0, pool_name: 'A조', draw_seed: 'sd' },
      { id: 'PB', category_id: 'C', pool_index: 1, pool_name: 'B조', draw_seed: 'sd' },
    ],
    tournament_pool_entries: [
      { pool_id: 'PA', entry_id: 'A1' }, { pool_id: 'PA', entry_id: 'A2' },
      { pool_id: 'PB', entry_id: 'B1' }, { pool_id: 'PB', entry_id: 'B2' },
    ],
    tournament_entries: [
      { id: 'A1', pool_rank: null, final_rank: null },
      { id: 'A2', pool_rank: null, final_rank: null },
      { id: 'B1', pool_rank: null, final_rank: null },
      { id: 'B2', pool_rank: null, final_rank: null },
    ],
    tournament_matches: [
      // 조별 경기(완료): A1>A2, B1>B2
      {
        id: 'pa', category_id: 'C', match_phase: 'pool', pool_id: 'PA', status: 'completed',
        team1_entry_id: 'A1', team2_entry_id: 'A2', winner_entry_id: 'A1',
        court_number: 1, scheduled_time: '2026-07-11T01:00:00.000Z',
      },
      {
        id: 'pb', category_id: 'C', match_phase: 'pool', pool_id: 'PB', status: 'completed',
        team1_entry_id: 'B1', team2_entry_id: 'B2', winner_entry_id: 'B1',
        court_number: 2, scheduled_time: '2026-07-11T01:00:00.000Z',
      },
      // 본선 스켈레톤(결승 1경기, 팀 미배정)
      {
        id: 'ko1', category_id: 'C', match_phase: 'knockout', round_number: 1, bracket_pos: 0,
        team1_entry_id: null, team2_entry_id: null, status: 'scheduled',
        court_number: null, scheduled_time: null, next_match_id: null, next_match_slot: null,
      },
    ],
    match_scores: [
      { match_id: 'pa', set_number: 1, team1_score: 21, team2_score: 10 },
      { match_id: 'pb', set_number: 1, team1_score: 21, team2_score: 12 },
    ],
  }
}

test('advance: seedKnockoutFromPools — 조 1위(A1·B1)를 본선에 배정 + pool_rank 기록', async () => {
  const sb = makeSupabase(poolKnockoutSeed())
  const out = await seedKnockoutFromPools(sb, 'C')
  assert.ok(out.advancements)
  // 본선 결승에 두 조 1위가 배정됨(순서는 시드 셔플이라 집합으로 검증)
  const ko = sb._db.tournament_matches.find(m => m.id === 'ko1')
  assert.deepEqual([ko.team1_entry_id, ko.team2_entry_id].sort(), ['A1', 'B1'])
  // 조 순위 기록: 1위 A1/B1, 2위 A2/B2
  const rank = id => sb._db.tournament_entries.find(e => e.id === id).pool_rank
  assert.equal(rank('A1'), 1)
  assert.equal(rank('A2'), 2)
  assert.equal(rank('B1'), 1)
  assert.equal(rank('B2'), 2)
})

test('advance: seedKnockoutFromPools — 멱등: 이미 배정돼 있으면 재시딩 안 함', async () => {
  const seed = poolKnockoutSeed()
  seed.tournament_matches.find(m => m.id === 'ko1').team1_entry_id = 'A1'
  const sb = makeSupabase(seed)
  const out = await seedKnockoutFromPools(sb, 'C')
  assert.deepEqual(out, { alreadySeeded: true })
  // pool_rank 는 건드리지 않음(재시딩 스킵)
  assert.equal(sb._db.tournament_entries.find(e => e.id === 'A2').pool_rank, null)
})

test('advance: checkPoolStageComplete(pool_knockout) — 전부 완료 시 본선 시딩까지 실행', async () => {
  const sb = makeSupabase(poolKnockoutSeed())
  assert.equal(await checkPoolStageComplete(sb, 'C'), true)
  const ko = sb._db.tournament_matches.find(m => m.id === 'ko1')
  assert.deepEqual([ko.team1_entry_id, ko.team2_entry_id].sort(), ['A1', 'B1'])
})

// ══════════════════════ finalizeRanks ══════════════════════
// 4팀 단일 토너먼트: SF1 E1>E2, SF2 E3>E4, 결승 E1>E3
function bracketSeed() {
  return {
    tournament_categories: [{ id: 'C', tiebreaker_order: null }],
    tournament_pools: [],
    tournament_entries: [
      { id: 'E1', final_rank: null }, { id: 'E2', final_rank: null },
      { id: 'E3', final_rank: null }, { id: 'E4', final_rank: null },
    ],
    tournament_matches: [
      { id: 'sf1', category_id: 'C', match_phase: 'knockout', round_number: 1, status: 'completed', team1_entry_id: 'E1', team2_entry_id: 'E2', winner_entry_id: 'E1' },
      { id: 'sf2', category_id: 'C', match_phase: 'knockout', round_number: 1, status: 'completed', team1_entry_id: 'E3', team2_entry_id: 'E4', winner_entry_id: 'E3' },
      { id: 'fin', category_id: 'C', match_phase: 'knockout', round_number: 2, status: 'completed', team1_entry_id: 'E1', team2_entry_id: 'E3', winner_entry_id: 'E1' },
    ],
    match_scores: [],
  }
}

test('advance: finalizeRanks(녹아웃) — 우승1·준우승2·준결승 패자 공동3위', async () => {
  const sb = makeSupabase(bracketSeed())
  const result = await finalizeRanks(sb, 'C')
  const rank = id => sb._db.tournament_entries.find(e => e.id === id).final_rank
  assert.equal(rank('E1'), 1)
  assert.equal(rank('E3'), 2) // 결승 패자
  assert.equal(rank('E2'), 3) // 준결승 패자
  assert.equal(rank('E4'), 3) // 준결승 패자
  // 반환은 rank 오름차순
  assert.equal(result[0].entryId, 'E1')
  assert.equal(result[0].rank, 1)
})

test('advance: finalizeRanks — 미완료 경기 있으면 throw(시상 확정 차단)', async () => {
  const seed = bracketSeed()
  seed.tournament_matches.find(m => m.id === 'fin').status = 'scheduled'
  const sb = makeSupabase(seed)
  await assert.rejects(() => finalizeRanks(sb, 'C'), /끝나지 않은/)
})

test('advance: finalizeRanks — 결승 승자 없으면 throw', async () => {
  const seed = bracketSeed()
  const fin = seed.tournament_matches.find(m => m.id === 'fin')
  fin.winner_entry_id = null // status 는 completed 로 두어 미완료 게이트는 통과
  const sb = makeSupabase(seed)
  await assert.rejects(() => finalizeRanks(sb, 'C'), /결승 결과/)
})

test('advance: finalizeRanks — 경기 없으면 빈 배열', async () => {
  const sb = makeSupabase({ tournament_matches: [], tournament_entries: [] })
  assert.deepEqual(await finalizeRanks(sb, 'C'), [])
})

test('advance: finalizeRanks(리그전·풀테이블 없음) — 조 순위 기반 순차 순위', async () => {
  // 3팀 풀리그(녹아웃 없음): E1 2승, E2 1승, E3 0승
  const sb = makeSupabase({
    tournament_categories: [{ id: 'C', tiebreaker_order: null }],
    tournament_pools: [],
    tournament_entries: [
      { id: 'E1', final_rank: null }, { id: 'E2', final_rank: null }, { id: 'E3', final_rank: null },
    ],
    tournament_matches: [
      { id: 'r1', category_id: 'C', match_phase: 'pool', round_number: null, status: 'completed', team1_entry_id: 'E1', team2_entry_id: 'E2', winner_entry_id: 'E1' },
      { id: 'r2', category_id: 'C', match_phase: 'pool', round_number: null, status: 'completed', team1_entry_id: 'E1', team2_entry_id: 'E3', winner_entry_id: 'E1' },
      { id: 'r3', category_id: 'C', match_phase: 'pool', round_number: null, status: 'completed', team1_entry_id: 'E2', team2_entry_id: 'E3', winner_entry_id: 'E2' },
    ],
    match_scores: [
      { match_id: 'r1', set_number: 1, team1_score: 21, team2_score: 10 },
      { match_id: 'r2', set_number: 1, team1_score: 21, team2_score: 15 },
      { match_id: 'r3', set_number: 1, team1_score: 21, team2_score: 18 },
    ],
  })
  await finalizeRanks(sb, 'C')
  const rank = id => sb._db.tournament_entries.find(e => e.id === id).final_rank
  assert.equal(rank('E1'), 1)
  assert.equal(rank('E2'), 2)
  assert.equal(rank('E3'), 3)
})

// ══════════════════════ finalizeTournament ══════════════════════
test('advance: finalizeTournament — 종목 final_rank 확정 + status=completed + 공인대회만 승급 RPC', async () => {
  const seed = bracketSeed()
  seed.tournaments = [{ id: 'T', status: 'in_progress', cert_level: 'a' }]
  const sb = makeSupabase(seed)
  const res = await finalizeTournament(sb, 'T', ['C'])
  // 순위 확정
  assert.equal(sb._db.tournament_entries.find(e => e.id === 'E1').final_rank, 1)
  // 대회 완료
  assert.equal(sb._db.tournaments.find(t => t.id === 'T').status, 'completed')
  // 공인대회(cert_level='a') → 승급 RPC 호출
  assert.ok(sb._rpcCalls.some(c => c.name === 'promote_grades_v2' && c.args.p_tournament === 'T'))
  assert.ok(res.byCategory.C)
})

test('advance: finalizeTournament — 비공인(cert_level=none)이면 승급 RPC 미호출', async () => {
  const seed = bracketSeed()
  seed.tournaments = [{ id: 'T', status: 'in_progress', cert_level: 'none' }]
  const sb = makeSupabase(seed)
  await finalizeTournament(sb, 'T', ['C'])
  assert.equal(sb._db.tournaments.find(t => t.id === 'T').status, 'completed')
  assert.ok(!sb._rpcCalls.some(c => c.name === 'promote_grades_v2'))
})

test('advance: finalizeTournament — 미완료 경기 있으면 throw(상태 전환 안 됨)', async () => {
  const seed = bracketSeed()
  seed.tournament_matches.find(m => m.id === 'fin').status = 'scheduled'
  seed.tournaments = [{ id: 'T', status: 'in_progress', cert_level: 'a' }]
  const sb = makeSupabase(seed)
  await assert.rejects(() => finalizeTournament(sb, 'T', ['C']), /끝나지 않은/)
  assert.equal(sb._db.tournaments.find(t => t.id === 'T').status, 'in_progress')
})

// ── autoDraw.js 회귀 테스트 (자동 대진 생성 · C2/C5) ──────────────────────
// autoDraw.js 는 "추첨(대진표 생성)"을 앱이 스스로 실행하는 엔진이다. 무인 진행이
// 켜져 있고 대회 당일 대진표가 없으면 stateMachine 의 closed→in_progress 가 막혀
// **대회가 시작조차 못 하고 멈춘다**(무인 완주 차단, 최우선 티어). 이 엔진이 그 공백을
// 메우는데 지금껏 커밋된 테스트가 0이었다 — 여기서 고정하는 불변식이 깨지면 무인 실행이
// 대진표를 잘못 만들거나(엉뚱한 진출 링크·부전승 오처리), 이미 뽑아 둔 대진을 덮어써
// (주최자 공개 추첨 파괴), 조용히 대회가 오염된다. 순수 함수는 직접, DB 변이 경로는
// 인메모리 Supabase 스텁으로 검증한다.
import { test, assert } from './_harness.mjs'
import { makeSupabase } from './_supabase-stub.mjs'
import {
  uuid, knockoutLabel, makeMatchRow, buildKnockoutRows, enrichEntries,
  buildDrawPlan, persistDrawPlan, autoGenerateBracket, autoGenerateAllBrackets,
} from '../src/lib/autoDraw.js'

// ══════════════════════ uuid ══════════════════════
test('autoDraw: uuid — uuid 꼴 문자열·호출마다 다름', () => {
  const a = uuid()
  const b = uuid()
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.notEqual(a, b)
})

// ══════════════════════ knockoutLabel ══════════════════════
test('autoDraw: knockoutLabel — 결승/4강/8강/그 외', () => {
  // totalRounds=3 (size 8): r1=8강(quarter) r2=4강(semi) r3=결승(final)
  assert.equal(knockoutLabel(1, 3), 'quarter')
  assert.equal(knockoutLabel(2, 3), 'semi')
  assert.equal(knockoutLabel(3, 3), 'final')
  // totalRounds=4 (size 16): r1 은 16강 → r16 폴백
  assert.equal(knockoutLabel(1, 4), 'r16')
  assert.equal(knockoutLabel(4, 4), 'final')
})

// ══════════════════════ makeMatchRow ══════════════════════
test('autoDraw: makeMatchRow — 기본값 채움·전달값 보존·id 자동', () => {
  const r = makeMatchRow({ category_id: 'C', match_phase: 'pool', round_type: 'group', match_number: 5 })
  assert.equal(typeof r.id, 'string')
  assert.equal(r.category_id, 'C')
  assert.equal(r.match_number, 5)
  assert.equal(r.status, 'scheduled')     // 기본값
  assert.equal(r.team1_entry_id, null)    // 기본 null
  assert.equal(r.winner_entry_id, null)
  assert.equal(r.pool_id, null)
  // 전달한 id·status 는 보존
  const r2 = makeMatchRow({ id: 'fixed', category_id: 'C', match_phase: 'knockout', round_type: 'final', match_number: 1, status: 'bye' })
  assert.equal(r2.id, 'fixed')
  assert.equal(r2.status, 'bye')
})

// ══════════════════════ buildKnockoutRows ══════════════════════
test('autoDraw: buildKnockoutRows — 4팀 진출 링크 + 부전승 선진출', () => {
  // 4강 A vs B, C 부전승(상대 없음) → 준결승2는 bye, C 가 결승 슬롯2로 선진출
  const { rows, byRound } = buildKnockoutRows({
    catId: 'C', seed: 's', size: 4,
    round1Teams: [['A', 'B'], ['C', null]], startMatchNo: 1,
  })
  assert.equal(rows.length, 3)                 // 준결승 2 + 결승 1
  assert.equal(byRound.length, 2)              // 2개 라운드
  assert.equal(byRound[0].length, 2)
  assert.equal(byRound[1].length, 1)

  const [semi1, semi2] = byRound[0]
  const final = byRound[1][0]

  // 라운드 라벨(size 4 → totalRounds 2): r1=semi, r2=final
  assert.equal(semi1.round_type, 'semi')
  assert.equal(final.round_type, 'final')

  // 실제 대결(A vs B) — 부전승 아님, 기본 status
  assert.equal(semi1.team1_entry_id, 'A')
  assert.equal(semi1.team2_entry_id, 'B')
  assert.equal(semi1.status, 'scheduled')

  // 진출 링크: semi1(pos1)→결승 슬롯1, semi2(pos2)→결승 슬롯2
  assert.equal(semi1.next_match_id, final.id)
  assert.equal(semi1.next_match_slot, 1)
  assert.equal(semi2.next_match_slot, 2)

  // 부전승(C 만 있음) → status='bye' + 승자 기록 + 결승 슬롯2 로 선진출
  assert.equal(semi2.status, 'bye')
  assert.equal(semi2.winner_entry_id, 'C')
  assert.equal(final.team2_entry_id, 'C')
  assert.equal(final.team1_entry_id, null)     // A/B 승자는 미정
})

// ══════════════════════ enrichEntries ══════════════════════
test('autoDraw: enrichEntries — 라벨 조합·MMR 평균·폴백', () => {
  const out = enrichEntries([
    { id: 'e1', player1: { name: '가', mmr: 1000 }, player2: { name: '나', mmr: 1200 } },
    { id: 'e2', team_name: '게스트팀' },                         // 선수명 없음 → team_name 폴백
    { id: 'e3', player1: { name: '다', mmr: null } },            // mmr 없음 → null
    { id: 'e4' },                                                // 아무 정보 없음
  ])
  assert.equal(out[0].label, '가 / 나')
  assert.equal(out[0].mmr, 1100)               // (1000+1200)/2
  assert.equal(out[1].label, '게스트팀')
  assert.equal(out[1].mmr, null)
  assert.equal(out[2].label, '다')
  assert.equal(out[2].mmr, null)               // 유효 mmr 0개
  assert.equal(out[3].label, '이름 없음')
})

// ══════════════════════ buildDrawPlan ══════════════════════
test('autoDraw: buildDrawPlan — single_elim 3팀(size4·부전승 1)', () => {
  const entries = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }]
  const plan = buildDrawPlan({ format: 'single_elim', entries, category: {}, seed: 'seed1' })
  assert.equal(plan.format, 'single_elim')
  assert.equal(plan.pools, null)
  assert.equal(plan.size, 4)                   // 3팀 → 다음 2의 거듭제곱
  assert.equal(plan.round1.length, 2)
  assert.equal(plan.sequence.length, 4)        // 슬롯 4개(부전승 포함)
  assert.equal(plan.sequence.filter(s => s.bye).length, 1)  // 부전승 정확히 1
  assert.equal(plan.optimization, null)
})

test('autoDraw: buildDrawPlan — round_robin 은 전원 한 조', () => {
  const entries = [1, 2, 3, 4].map(n => ({ id: `e${n}`, label: `E${n}` }))
  const plan = buildDrawPlan({ format: 'round_robin', entries, category: {}, seed: 's' })
  assert.equal(plan.format, 'round_robin')
  assert.equal(plan.pools.length, 1)           // 한 조
  assert.equal(plan.pools[0].entries.length, 4)
  assert.equal(plan.round1, null)
  assert.equal(plan.sequence.length, 4)
  assert.ok(plan.sequence.every(s => s.type === 'pool'))
})

test('autoDraw: buildDrawPlan — pool_only 6팀·조크기3 → 2조', () => {
  const entries = [1, 2, 3, 4, 5, 6].map(n => ({ id: `e${n}`, label: `E${n}` }))
  const plan = buildDrawPlan({ format: 'pool_only', entries, category: { pool_size: 3 }, seed: 's' })
  assert.equal(plan.pools.length, 2)
  assert.equal(plan.sequence.length, 6)
  // 모든 엔트리가 정확히 한 번씩 배정(누락·중복 없음)
  const ids = plan.sequence.map(s => s.entryId).sort()
  assert.deepEqual(ids, ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'])
})

// ══════════════════════ persistDrawPlan ══════════════════════
test('autoDraw: persistDrawPlan — single_elim 3팀 저장(경기 3행·조 없음)', async () => {
  const entries = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }]
  const plan = buildDrawPlan({ format: 'single_elim', entries, category: {}, seed: 'seedX' })
  const sb = makeSupabase({})
  const res = await persistDrawPlan(sb, {
    plan, categoryId: 'C',
    tournament: { date: '2026-08-01', start_time: '09:00', court_count: 4 },
    category: {}, entries,
  })
  assert.ok(res.ok)
  assert.equal(res.matchCount, 3)              // 준결승2 + 결승1
  assert.equal(sb._db.tournament_matches.length, 3)
  assert.ok(!sb._db.tournament_pools?.length)  // 녹아웃은 조 없음
  // 저장된 경기 모두 이 종목·씨드 기록
  assert.ok(sb._db.tournament_matches.every(m => m.category_id === 'C' && m.draw_seed === 'seedX'))
})

test('autoDraw: persistDrawPlan — plan/categoryId 없으면 실패 반환(throw 안 함)', async () => {
  const sb = makeSupabase({})
  const res = await persistDrawPlan(sb, { plan: null, categoryId: 'C' })
  assert.equal(res.ok, false)
  assert.equal(res.matchCount, 0)
})

// ══════════════════════ autoGenerateBracket ══════════════════════
test('autoDraw: autoGenerateBracket — 이미 대진표 있으면 exists(덮어쓰지 않음)', async () => {
  const sb = makeSupabase({
    tournament_matches: [{ id: 'm1', category_id: 'C', status: 'scheduled' }],
  })
  const res = await autoGenerateBracket(sb, {
    tournament: { id: 'T', date: '2026-08-01' },
    category: { id: 'C', tournament_format: 'round_robin' },
  })
  assert.equal(res.ok, false)
  assert.equal(res.reason, 'exists')
  assert.equal(sb._db.tournament_matches.length, 1)  // 기존 경기 그대로
})

test('autoDraw: autoGenerateBracket — 승인 2팀 미만이면 not_enough', async () => {
  const sb = makeSupabase({
    tournament_entries: [{ id: 'e1', category_id: 'C', entry_status: 'approved', team_name: '혼자' }],
  })
  const res = await autoGenerateBracket(sb, {
    tournament: { id: 'T', date: '2026-08-01' },
    category: { id: 'C', tournament_format: 'round_robin' },
  })
  assert.equal(res.ok, false)
  assert.equal(res.reason, 'not_enough')
  assert.equal(res.count, 1)
  assert.ok(!sb._db.tournament_matches?.length)      // 아무 경기도 안 만듦
})

test('autoDraw: autoGenerateBracket — round_robin 3팀 자동 생성(경기·조·조원 저장)', async () => {
  const sb = makeSupabase({
    tournament_entries: [
      { id: 'e1', category_id: 'C', entry_status: 'approved', team_name: 'A' },
      { id: 'e2', category_id: 'C', entry_status: 'approved', team_name: 'B' },
      { id: 'e3', category_id: 'C', entry_status: 'approved', team_name: 'C' },
      { id: 'x9', category_id: 'C', entry_status: 'pending', team_name: '대기' }, // 미승인은 제외
    ],
  })
  const res = await autoGenerateBracket(sb, {
    tournament: { id: 'T', date: '2026-08-01', start_time: '09:00', court_count: 2 },
    category: { id: 'C', tournament_format: 'round_robin', match_duration_min: 30 },
  })
  assert.ok(res.ok)
  assert.equal(res.reason, 'created')
  assert.equal(res.matchCount, 3)              // 3팀 리그전 = 3경기
  assert.equal(sb._db.tournament_matches.length, 3)
  assert.equal(sb._db.tournament_pools.length, 1)
  assert.equal(sb._db.tournament_pool_entries.length, 3)  // 승인 3팀만(대기 제외)
})

// ══════════════════════ autoGenerateAllBrackets ══════════════════════
test('autoDraw: autoGenerateAllBrackets — 생성/스킵 집계', async () => {
  const sb = makeSupabase({
    tournament_matches: [{ id: 'm1', category_id: 'HAS', status: 'scheduled' }],
    tournament_entries: [
      { id: 'e1', category_id: 'NEW', entry_status: 'approved', team_name: 'A' },
      { id: 'e2', category_id: 'NEW', entry_status: 'approved', team_name: 'B' },
      { id: 'e3', category_id: 'THIN', entry_status: 'approved', team_name: '혼자' },
    ],
  })
  const out = await autoGenerateAllBrackets(sb, {
    tournament: { id: 'T', date: '2026-08-01', start_time: '09:00', court_count: 2 },
    categories: [
      { id: 'NEW', tournament_format: 'round_robin', match_duration_min: 30 },
      { id: 'HAS', tournament_format: 'round_robin' },
      { id: 'THIN', tournament_format: 'round_robin' },
    ],
  })
  assert.equal(out.created, 1)     // NEW
  assert.equal(out.skipped, 1)     // HAS (exists)
  assert.equal(out.notEnough, 1)   // THIN (1팀)
  assert.equal(out.errors, 0)
})

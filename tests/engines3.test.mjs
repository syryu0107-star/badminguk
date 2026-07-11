// ── 순수 엔진 회귀 테스트 (3) — 경쟁 무결성·레이팅·입금 매칭 ──────────────
// tournament.js(조 편성·순위·타이브레이커·진출자·본선 스켈레톤·부전승 배치),
// mmr.js(Elo delta·파트너 보정), payment.js(입금 퍼지 매칭)는 "깨지면 조용히
// 잘못된 팀이 진출하거나(=엉뚱한 시상)·레이팅이 틀어지거나·엉뚱한 입금이 자동
// 확인되는" 최고위험 엔진인데 커밋된 테스트가 없었다(직전 하드닝 로그가 "다음
// 후보"로 명시). 여기서 고정하는 불변식이 깨지면 이후 무인 실행이 즉시 초록을 잃는다.
// 각 단언은 소스 실측으로 트레이스(scripts/run-tests.mjs 가 tests/*.test.mjs 자동 발견).
import { test, assert } from './_harness.mjs'

import {
  generatePools, calculatePoolStandings, determineAdvancements,
  countActualAdvancers, knockoutSkeletonSize, generateKnockoutBracket,
  prizeLabel, formatSummary,
} from '../src/lib/tournament.js'
import {
  partnerAdjustment, calcMMRDelta, teamMMR, resolveMatchMMR, CERT_LEVELS,
} from '../src/lib/mmr.js'
import {
  normalizeName, parseAmount, nameSimilarity, parseDeposits, matchDeposits,
} from '../src/lib/payment.js'

// ══════════════════════ tournament.generatePools ══════════════════════
test('tournament: generatePools 빈 입력 → []', () => {
  assert.deepEqual(generatePools([], 2, 's'), [])
})

test('tournament: generatePools poolSize<1/비정수 → RangeError', () => {
  assert.throws(() => generatePools([{ id: 1 }], 0), RangeError)
  assert.throws(() => generatePools([{ id: 1 }], 1.5), RangeError)
})

test('tournament: generatePools 조 개수·이름(ceil, A/B/C조)', () => {
  const e = [1, 2, 3, 4, 5].map(id => ({ id }))
  const pools = generatePools(e, 2, 'seed', {})
  assert.equal(pools.length, 3) // ceil(5/2)
  assert.deepEqual(pools.map(p => p.poolName), ['A조', 'B조', 'C조'])
  // 전원 배정(중복·누락 없음)
  const all = pools.flatMap(p => p.entries.map(x => x.id)).sort()
  assert.deepEqual(all, [1, 2, 3, 4, 5])
})

test('tournament: generatePools 시드(스네이크) 배정으로 조별 균형', () => {
  const e = [
    { id: 'a', mmr: 1600 }, { id: 'b', mmr: 1500 },
    { id: 'c', mmr: 1400 }, { id: 'd', mmr: 1300 },
  ]
  const pools = generatePools(e, 2, 'x', { seeding_enabled: true })
  assert.equal(pools.length, 2)
  // 스네이크: 최강+최약 한 조, 중간 둘 한 조 → 평균 균등(둘 다 1450)
  assert.deepEqual(pools[0].entries.map(x => x.id), ['a', 'd'])
  assert.deepEqual(pools[1].entries.map(x => x.id), ['b', 'c'])
})

test('tournament: generatePools 무작위 편성은 시드 고정 시 재현 가능', () => {
  const e = [1, 2, 3, 4, 5, 6].map(id => ({ id }))
  const p1 = generatePools(e, 3, 'seedA', {})
  const p2 = generatePools(e, 3, 'seedA', {})
  assert.deepEqual(
    p1.map(p => p.entries.map(x => x.id)),
    p2.map(p => p.entries.map(x => x.id)),
  )
})

// ══════════════════════ tournament.calculatePoolStandings ══════════════════════
// 4팀 a,b,c,d 조별리그. a·b가 2승 동률(승자승 a>b, 득실은 b가 우세)
const _poolEntries = [
  { entryId: 'a', label: 'A' }, { entryId: 'b', label: 'B' },
  { entryId: 'c', label: 'C' }, { entryId: 'd', label: 'D' },
]
const _poolMatches = [
  { team1_entry_id: 'a', team2_entry_id: 'b', winner_entry_id: 'a', scores: [[21, 20], [21, 20]] },
  { team1_entry_id: 'a', team2_entry_id: 'c', winner_entry_id: 'a', scores: [[21, 19], [21, 19]] },
  { team1_entry_id: 'd', team2_entry_id: 'a', winner_entry_id: 'd', scores: [[21, 5], [21, 5]] },
  { team1_entry_id: 'b', team2_entry_id: 'c', winner_entry_id: 'b', scores: [[21, 2], [21, 2]] },
  { team1_entry_id: 'b', team2_entry_id: 'd', winner_entry_id: 'b', scores: [[21, 2], [21, 2]] },
  { team1_entry_id: 'c', team2_entry_id: 'd', winner_entry_id: 'c', scores: [[21, 10], [21, 10]] },
]

test('tournament: calculatePoolStandings 승패·득실 집계 정확', () => {
  const s = calculatePoolStandings(_poolEntries, _poolMatches)
  const a = s.find(x => x.entryId === 'a')
  assert.equal(a.wins, 2)
  assert.equal(a.losses, 1)
  assert.equal(a.gameDiff, 2)   // 4승 2패
  assert.equal(a.pointDiff, -26) // for 94 - against 120
})

test('tournament: 표준 타이브레이커 — 승자승이 득실보다 우선(a>b)', () => {
  const s = calculatePoolStandings(_poolEntries, _poolMatches) // 표준: h2h 우선
  const rank = Object.fromEntries(s.map(x => [x.entryId, x.rank]))
  assert.equal(rank.a, 1) // a·b 2승 동률 → 승자승(a가 b 이김)으로 a 1위
  assert.equal(rank.b, 2)
})

test('tournament: 득실 우선 타이브레이커 — 득실이 승자승보다 우선(b>a)', () => {
  const order = ['game_diff', 'point_diff', 'h2h', 'points_for']
  const s = calculatePoolStandings(_poolEntries, _poolMatches, order)
  const rank = Object.fromEntries(s.map(x => [x.entryId, x.rank]))
  // 게임 득실 동률(+2) → 점수 득실 b(+74) > a(-26) → b 1위
  assert.equal(rank.b, 1)
  assert.equal(rank.a, 2)
})

test('tournament: 3자 동률이면 승자승 미적용(순환 방지)', () => {
  // a→b, b→c, c→a 순환 · 각 1승 → 승자승 대신 점수 득실로 판정
  const entries = [{ entryId: 'a' }, { entryId: 'b' }, { entryId: 'c' }]
  const matches = [
    { team1_entry_id: 'a', team2_entry_id: 'b', winner_entry_id: 'a', scores: [[21, 19], [21, 19]] },
    { team1_entry_id: 'c', team2_entry_id: 'a', winner_entry_id: 'c', scores: [[21, 5], [21, 5]] },
    { team1_entry_id: 'b', team2_entry_id: 'c', winner_entry_id: 'b', scores: [[21, 5], [21, 5]] },
  ]
  const s = calculatePoolStandings(entries, matches)
  const rank = Object.fromEntries(s.map(x => [x.entryId, x.rank]))
  // 게임 득실 전부 0 → 점수 득실: b(+28) > c(0) > a(-28)
  assert.equal(rank.b, 1)
  assert.equal(rank.c, 2)
  assert.equal(rank.a, 3)
})

test('tournament: calculatePoolStandings 경기 없으면 전원 0·순번 부여', () => {
  const s = calculatePoolStandings(_poolEntries, [])
  assert.equal(s.length, 4)
  assert.ok(s.every(x => x.wins === 0 && x.losses === 0))
  assert.deepEqual(s.map(x => x.rank), [1, 2, 3, 4])
})

// ══════════════════════ tournament.determineAdvancements ══════════════════════
test('tournament: determineAdvancements 직행+와일드카드(득실순)', () => {
  const poolsStandings = [
    {
      poolIndex: 0, poolName: 'A조', standings: [
        { entryId: 't1', label: 'T1', wins: 2, losses: 0, gameDiff: 4, pointDiff: 30 },
        { entryId: 't2', label: 'T2', wins: 1, losses: 1, gameDiff: 5, pointDiff: 12 },
        { entryId: 't3', label: 'T3', wins: 0, losses: 2, gameDiff: 1, pointDiff: -20 },
      ],
    },
    {
      poolIndex: 1, poolName: 'B조', standings: [
        { entryId: 't4', label: 'T4', wins: 2, losses: 0, gameDiff: 4, pointDiff: 25 },
        { entryId: 't5', label: 'T5', wins: 1, losses: 1, gameDiff: 3, pointDiff: 8 },
        { entryId: 't6', label: 'T6', wins: 0, losses: 2, gameDiff: 0, pointDiff: -15 },
      ],
    },
  ]
  const { direct, wildcards } = determineAdvancements(poolsStandings, 1, 1, 'score_diff')
  assert.equal(direct.length, 2)
  assert.deepEqual(direct.map(d => d.entryId).sort(), ['t1', 't4'])
  assert.equal(wildcards.length, 1)
  assert.equal(wildcards[0].entryId, 't2') // gameDiff 5 최고
})

test('tournament: determineAdvancements 와일드카드 0이면 직행만', () => {
  const ps = [{
    poolIndex: 0, poolName: 'A조', standings: [
      { entryId: 'x1', wins: 1, losses: 0, gameDiff: 2, pointDiff: 5 },
      { entryId: 'x2', wins: 0, losses: 1, gameDiff: -2, pointDiff: -5 },
    ],
  }]
  const { direct, wildcards } = determineAdvancements(ps, 1, 0)
  assert.equal(direct.length, 1)
  assert.equal(wildcards.length, 0)
})

// ══════════════════════ tournament.countActualAdvancers / knockoutSkeletonSize ══════════════════════
test('tournament: countActualAdvancers 균형 풀', () => {
  assert.equal(countActualAdvancers([4, 4], 2, 0), 4)      // 2+2
  assert.equal(countActualAdvancers([3, 3], 1, 1), 3)      // 1+1 직행 + 1 WC
})

test('tournament: countActualAdvancers 불균형 풀 — 작은 조는 조 팀 수까지만', () => {
  // [1,4] adv2: 직행 min(1,2)+min(4,2)=1+2=3, 후보 0+2=2, WC 0
  assert.equal(countActualAdvancers([1, 4], 2, 0), 3)
  // WC는 실제 후보 수를 못 넘음
  assert.equal(countActualAdvancers([2, 2], 2, 3), 4) // 후보 0 → WC 0
})

test('tournament: knockoutSkeletonSize nextPow2·진출<2면 0', () => {
  assert.equal(knockoutSkeletonSize([4, 4], 2, 0), 4)  // 4 → 4
  assert.equal(knockoutSkeletonSize([1, 4], 2, 0), 4)  // 3 → nextPow2 4
  assert.equal(knockoutSkeletonSize([3, 3], 1, 1), 4)  // 3 → 4
  assert.equal(knockoutSkeletonSize([1], 2, 0), 0)     // 진출 1 → 본선 없음
})

// ══════════════════════ tournament.generateKnockoutBracket ══════════════════════
test('tournament: generateKnockoutBracket 진출<2 → []', () => {
  assert.deepEqual(generateKnockoutBracket({ direct: [{ entryId: 'a' }], wildcards: [] }), [])
})

test('tournament: generateKnockoutBracket 3팀 → size4·부전승 1건·라운드 구성', () => {
  const adv = {
    direct: [
      { entryId: 'a', rank: 1, poolIndex: 0 },
      { entryId: 'b', rank: 1, poolIndex: 1 },
      { entryId: 'c', rank: 2, poolIndex: 0 },
    ],
    wildcards: [],
  }
  const m = generateKnockoutBracket(adv, 'seed')
  const round1 = m.filter(x => x.round === 1)
  assert.equal(round1.length, 2)           // size4 → 1라운드 2경기
  assert.equal(m.length, 3)                // 2 + 결승 1
  assert.equal(round1.filter(x => x.isBye).length, 1) // 3팀 → 부전승 1
  assert.ok(m.some(x => x.round === 2))
})

// ══════════════════════ tournament.prizeLabel / formatSummary ══════════════════════
test('tournament: prizeLabel 시상 범위·범위 밖 null', () => {
  assert.equal(prizeLabel(1, 3), '🏆 우승')
  assert.equal(prizeLabel(2, 3), '🥈 준우승')
  assert.equal(prizeLabel(3, 3), '🥉 3위')
  assert.equal(prizeLabel(4, 3), null) // 시상 3위까지
  assert.equal(prizeLabel(5, 8), '5위')
})

test('tournament: formatSummary format_label 우선·조별+토너먼트 합성', () => {
  assert.equal(formatSummary({ format_label: '커스텀' }), '커스텀')
  const s = formatSummary({
    pool_count: 4, pool_size: 3, advancement_per_pool: 1, wildcard_count: 0,
    sets_per_match: 3, points_per_set: 21,
  })
  assert.ok(s.includes('조별리그(3팀×4조)'))
  assert.ok(s.includes('4강 토너먼트'))
  assert.ok(s.includes('3판2선승'))
  assert.ok(s.includes('21점'))
})

// ══════════════════════ mmr.js ══════════════════════
test('mmr: CERT_LEVELS K값 계약(none0·c32·b48·a64)', () => {
  assert.equal(CERT_LEVELS.none.k, 0)
  assert.equal(CERT_LEVELS.c.k, 32)
  assert.equal(CERT_LEVELS.b.k, 48)
  assert.equal(CERT_LEVELS.a.k, 64)
})

test('mmr: partnerAdjustment 강한 파트너=감소·약한 파트너=증가·클램프', () => {
  assert.equal(partnerAdjustment(1500, 1500), 1)      // 동급
  assert.equal(partnerAdjustment(1500, 1900), 0.75)   // 파트너 +400 → 25% 감소
  assert.equal(partnerAdjustment(1500, 1100), 1.25)   // 파트너 -400 → 25% 증가
  assert.equal(partnerAdjustment(1000, 3000), 0.4)    // 하한
  assert.equal(partnerAdjustment(3000, 1000), 1.6)    // 상한
})

test('mmr: teamMMR 평균 반올림', () => {
  assert.equal(teamMMR(1500, 1500), 1500)
  assert.equal(teamMMR(1500, 1601), 1551) // (3101/2)=1550.5 → 1551
})

test('mmr: calcMMRDelta none=0·동급 승/패 ±(신규 K 1.5배)', () => {
  assert.equal(calcMMRDelta(1500, 1500, 1, 20, 'none'), 0)
  // 기존 선수(20경기): K32, 기대 0.5, 승 → 16 / 패 → -16
  assert.equal(calcMMRDelta(1500, 1500, 1, 20, 'c'), 16)
  assert.equal(calcMMRDelta(1500, 1500, 0, 20, 'c'), -16)
  // 신규 선수(<10경기): K48 → 승 24
  assert.equal(calcMMRDelta(1500, 1500, 1, 5, 'c'), 24)
})

test('mmr: resolveMatchMMR none → 전원 delta 0', () => {
  const r = resolveMatchMMR({
    team1: [{ id: 'a', mmr: 1500, gamesPlayed: 20 }, { id: 'b', mmr: 1500, gamesPlayed: 20 }],
    team2: [{ id: 'c', mmr: 1500, gamesPlayed: 20 }, { id: 'd', mmr: 1500, gamesPlayed: 20 }],
    winner: 1, certLevel: 'none',
  })
  assert.ok(r.every(p => p.delta === 0 && p.after === p.before))
})

test('mmr: resolveMatchMMR 복식 동급 — 승팀 +·패팀 −·대칭', () => {
  const r = resolveMatchMMR({
    team1: [{ id: 'a', mmr: 1500, gamesPlayed: 20 }, { id: 'b', mmr: 1500, gamesPlayed: 20 }],
    team2: [{ id: 'c', mmr: 1500, gamesPlayed: 20 }, { id: 'd', mmr: 1500, gamesPlayed: 20 }],
    winner: 1, certLevel: 'c',
  })
  const by = Object.fromEntries(r.map(p => [p.id, p]))
  assert.equal(by.a.delta, 16)
  assert.equal(by.a.after, 1516)
  assert.equal(by.c.delta, -16)
  assert.equal(by.d.after, 1484)
})

test('mmr: resolveMatchMMR after 하한 100(최저 방어)', () => {
  const r = resolveMatchMMR({
    team1: [{ id: 'a', mmr: 100, gamesPlayed: 20 }, { id: 'b', mmr: 100, gamesPlayed: 20 }],
    team2: [{ id: 'c', mmr: 100, gamesPlayed: 20 }, { id: 'd', mmr: 100, gamesPlayed: 20 }],
    winner: 2, certLevel: 'c',
  })
  const a = r.find(p => p.id === 'a')
  assert.equal(a.delta, -16)   // 패 → -16
  assert.equal(a.after, 100)   // max(100, 100-16) = 100
})

// ══════════════════════ payment.js ══════════════════════
test('payment: normalizeName 괄호·꼬리숫자·공백 제거', () => {
  assert.equal(normalizeName('(주)홍길동1'), '홍길동')
  assert.equal(normalizeName('김 민 준'), '김민준')
  assert.equal(normalizeName(null), '')
})

test('payment: parseAmount 콤마·통화기호·실패', () => {
  assert.equal(parseAmount('30,000원'), 30000)
  assert.equal(parseAmount('₩30,000'), 30000)
  assert.equal(parseAmount('abc'), null)
  assert.equal(parseAmount(null), null)
})

test('payment: nameSimilarity 동일1·포함0.9·오타 부분점수', () => {
  assert.equal(nameSimilarity('홍길동', '홍길동'), 1)
  assert.equal(nameSimilarity('김민준', '김민준부'), 0.9)
  const typo = nameSimilarity('김철수', '김철슈') // 편집거리1/3
  assert.ok(typo > 0.6 && typo < 0.85)
  assert.equal(nameSimilarity('', '홍길동'), 0)
})

test('payment: parseDeposits 공백·날짜 라인(날짜 제외·최대금액)', () => {
  const d = parseDeposits('홍길동 30000\n2026-07-09  김철수  30,000원\n  \n메모없음')
  assert.equal(d.length, 2)
  assert.deepEqual(d[0], { name: '홍길동', amount: 30000, raw: '홍길동 30000' })
  assert.equal(d[1].name, '김철수')
  assert.equal(d[1].amount, 30000) // 날짜(2026)가 아니라 실제 금액
})

test('payment: matchDeposits 정확 일치 자동 확인', () => {
  const entries = [
    { id: 'e1', category_id: 'c1', entry_status: 'applied', payment_status: 'pending', player1: { name: '홍길동' } },
    { id: 'e2', category_id: 'c1', entry_status: 'applied', payment_status: 'pending', player1: { name: '김철수' } },
  ]
  const deposits = parseDeposits('홍길동 30000\n김철수 30000')
  const r = matchDeposits(entries, deposits, { c1: { entry_fee: 30000 } })
  assert.equal(r.confirmed.length, 2)
  assert.equal(r.review.length, 0)
  assert.equal(r.unmatched.length, 0)
  assert.equal(r.unusedDeposits.length, 0)
})

test('payment: matchDeposits 부족 입금·오타명 → 확인 권장(review)', () => {
  const entries = [
    { id: 'e1', category_id: 'c1', entry_status: 'applied', payment_status: 'pending', player1: { name: '김철수' } },
  ]
  // 금액 부족
  const under = matchDeposits(entries, parseDeposits('김철수 20000'), { c1: { entry_fee: 30000 } })
  assert.equal(under.confirmed.length, 0)
  assert.equal(under.review.length, 1)
  assert.ok(under.review[0].reason.includes('입금액'))
  // 이름 오타(유사도 0.6~0.85)·금액 충분 → 오타 의심 review
  const typo = matchDeposits(entries, parseDeposits('김철슈 30000'), { c1: { entry_fee: 30000 } })
  assert.equal(typo.confirmed.length, 0)
  assert.equal(typo.review.length, 1)
})

test('payment: matchDeposits 미매칭 신청·미사용 입금 분리', () => {
  const entries = [
    { id: 'e1', category_id: 'c1', entry_status: 'applied', payment_status: 'pending', player1: { name: '박영수' } },
  ]
  const r = matchDeposits(entries, parseDeposits('전혀다른사람 30000'), { c1: { entry_fee: 30000 } })
  assert.equal(r.confirmed.length, 0)
  assert.equal(r.unmatched.length, 1)
  assert.equal(r.unmatched[0].id, 'e1')
  assert.equal(r.unusedDeposits.length, 1)
})

test('payment: matchDeposits 무료·확정·철회·환불 신청은 매칭 제외', () => {
  const entries = [
    { id: 'free', category_id: 'c0', entry_status: 'applied', payment_status: 'pending', player1: { name: '무료인' } },
    { id: 'done', category_id: 'c1', entry_status: 'applied', payment_status: 'confirmed', player1: { name: '확정인' } },
    { id: 'gone', category_id: 'c1', entry_status: 'withdrawn', payment_status: 'pending', player1: { name: '철회인' } },
    { id: 'ref', category_id: 'c1', entry_status: 'applied', payment_status: 'refunded', player1: { name: '환불인' } },
  ]
  const catById = { c0: { entry_fee: 0 }, c1: { entry_fee: 30000 } }
  const deposits = parseDeposits('무료인 30000\n확정인 30000\n철회인 30000\n환불인 30000')
  const r = matchDeposits(entries, deposits, catById)
  assert.equal(r.confirmed.length, 0)     // 결제 필요 신청 없음
  assert.equal(r.unmatched.length, 0)     // pending 대상 자체가 없음
  assert.equal(r.unusedDeposits.length, 4) // 입금은 전부 미사용으로 남음
})

test('payment: matchDeposits null 입력 안전', () => {
  const r = matchDeposits(null, null, {})
  assert.deepEqual(r.confirmed, [])
  assert.deepEqual(r.unmatched, [])
  assert.deepEqual(r.unusedDeposits, [])
})

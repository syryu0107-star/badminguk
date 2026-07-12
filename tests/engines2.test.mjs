// ── 순수 엔진 회귀 테스트 (2차 배치) ──────────────────────────────────
// engines.test.mjs 가 자동화 "판정" 엔진(점수·상태머신·노쇼·체크인·일정)을
// 고정한 데 이어, 이 파일은 그때 미커버였던 나머지 순수 엔진 —
//   정산(돈)·입금 안내·AI 대진 최적화·요강 마법사·상장·통합 전적·대회 탐색·
//   파트너 추천·하이라이트·오케스트레이터(자동투입/재배치/지연)·챗봇·급수 자격 —
// 을 커밋된 테스트로 고정한다. 이들이 깨지면 무인 진행이 조용히 오작동하거나(자동
// 투입·재배치·자격 게이트) 사람에게 잘못된 숫자를 보인다(정산·전적). 이후 실행은
// 반드시 초록을 유지해야 한다.
import { test, assert } from './_harness.mjs'

import {
  computeSettlement, presetByKey, formatWon as settleWon, WITHHOLDING_PRESETS,
} from '../src/lib/settlement.js'
import {
  formatWon as depWon, shouldShowDeposit, depositGuide,
} from '../src/lib/deposit.js'
import {
  poolMeanMmr, scoreDraw, candidateSeeds, optimizeDraw, explainDraw,
  meetRound, knockoutLeaves, scoreKnockout, optimizeKnockout, explainKnockout,
} from '../src/lib/drawOptimizer.js'
import {
  distributePools, estimateMatches, defaultMatchMinutes, recommendSetup,
  estimateSchedule, formatDuration,
} from '../src/lib/planWizard.js'
import {
  certRankInfo, koreanDate, buildCertificate, buildCertificates,
} from '../src/lib/certificate.js'
import {
  opponentPlayers, computeCareerRecord, hasCareerRecord,
} from '../src/lib/record.js'
import {
  regionTokens, preferredRegions, ddayOf, recommendTournaments,
} from '../src/lib/discover.js'
import {
  collectPastPartners, rankPartnerSuggestions, partnerReason,
} from '../src/lib/partners.js'
import {
  computePlayerStats, winRate, buildPlayerHighlight, highlightShareText,
} from '../src/lib/highlight.js'
import {
  planAutoAdvance, planRebalance, analyzeDelay,
} from '../src/lib/orchestrator.js'
import {
  normalize, matchTopic, askBot, suggestedQuestions,
} from '../src/lib/chatbot.js'
import {
  checkEligibility, awardPoints, checkPromotion, promotionProgress, getGradeIndex,
} from '../src/lib/grades.js'

// ══════════════════════ settlement.js ══════════════════════
test('settlement: computeSettlement — 확인 수입만 수입·환불/미수금 정보용·상금+경비 지출', () => {
  const categories = [{ id: 'c1', sport_type: '남복', entry_fee: 10000 }]
  const entries = [
    { category_id: 'c1', payment_status: 'confirmed', entry_status: 'approved' },
    { category_id: 'c1', payment_status: 'pending', entry_status: 'applied' },
    { category_id: 'c1', payment_status: 'refunded', entry_status: 'approved' },
    { category_id: 'c1', payment_status: 'confirmed', entry_status: 'withdrawn' }, // 제외
  ]
  const s = computeSettlement({
    categories, entries,
    costs: [{ label: '체육관', amount: 50000 }],
    prize: { total: 100000, withholdingRate: 0.22 },
  })
  assert.equal(s.revenue.confirmed, 10000)
  assert.equal(s.revenue.count, 1)
  assert.equal(s.pending.amount, 10000)   // 미수금은 손익 밖
  assert.equal(s.refund.amount, 10000)    // 환불도 손익 밖
  assert.equal(s.income, 10000)
  assert.equal(s.expense, 150000)         // 경비 50000 + 상금 100000
  assert.equal(s.net, -140000)
  assert.equal(s.isProfit, false)
  assert.equal(s.prize.withholding, 22000)
  assert.equal(s.prize.netPay, 78000)
  assert.equal(s.byCat.length, 1)
  assert.equal(s.byCat[0].confirmed, 10000)
})

test('settlement: presetByKey / formatWon', () => {
  assert.equal(presetByKey('other').rate, 0.22)
  assert.equal(presetByKey('없는키').key, WITHHOLDING_PRESETS[0].key) // 폴백 none
  assert.equal(settleWon(1234567), '₩1,234,567')
  assert.equal(settleWon(-5000), '-₩5,000')
})

// ══════════════════════ deposit.js ══════════════════════
test('deposit: shouldShowDeposit — 무료/파트너대기/철회 제외', () => {
  assert.equal(shouldShowDeposit(null, 5000), false)
  assert.equal(shouldShowDeposit({ entry_status: 'applied' }, 0), false) // 무료
  assert.equal(shouldShowDeposit({ entry_status: 'partner_pending' }, 5000), false)
  assert.equal(shouldShowDeposit({ entry_status: 'withdrawn' }, 5000), false)
  assert.equal(shouldShowDeposit({ entry_status: 'applied' }, 5000), true)
  assert.equal(shouldShowDeposit({ entry_status: 'applied', payment_amount: 5000 }, 0), true)
})

test('deposit: depositGuide — 무료/확인/환불/대기 톤과 실명 안내', () => {
  assert.equal(depositGuide(null).applicable, false)
  assert.equal(depositGuide({ payment_status: 'pending' }, { fee: 0 }).reason, 'free')

  const done = depositGuide({ payment_status: 'confirmed' }, { fee: 5000 })
  assert.equal(done.done, true); assert.equal(done.tone, 'done')

  const ref = depositGuide({ payment_status: 'refunded' }, { fee: 5000 })
  assert.equal(ref.tone, 'muted')

  const p = depositGuide({ payment_status: 'pending' }, { fee: 5000, myName: '홍길동' })
  assert.equal(p.tone, 'pending')
  assert.equal(p.payerName, '홍길동')
  assert.equal(p.steps.length, 3)
  assert.ok(p.steps[1].includes('홍길동'))

  const withPartner = depositGuide({ payment_status: 'pending' }, { fee: 5000, myName: '홍길동', partnerName: '김철수' })
  assert.ok(withPartner.note.includes('김철수'))
  assert.equal(depWon(5000), '₩5,000')
})

// ══════════════════════ drawOptimizer.js ══════════════════════
test('drawOptimizer: poolMeanMmr / scoreDraw', () => {
  assert.equal(poolMeanMmr({ entries: [{ mmr: 1000 }, { mmr: 2000 }] }), 1500)
  assert.equal(poolMeanMmr({ entries: [{}, {}] }), null)
  assert.equal(poolMeanMmr(null), null)

  const balanced = scoreDraw([
    { entries: [{ mmr: 1400 }, { mmr: 1600 }] },
    { entries: [{ mmr: 1500 }, { mmr: 1500 }] },
  ])
  assert.equal(balanced.sizeSpread, 0)
  assert.equal(balanced.spread, 0)   // 두 조 평균 모두 1500
  // 크기 편차가 있으면 점수가 크게 벌점
  const uneven = scoreDraw([{ entries: [{ mmr: 1000 }] }, { entries: [{ mmr: 1000 }, { mmr: 1000 }] }])
  assert.equal(uneven.sizeSpread, 1)
  assert.ok(uneven.score >= 100000)
})

test('drawOptimizer: candidateSeeds / optimizeDraw / explainDraw', () => {
  assert.deepEqual(candidateSeeds('abc', 3), ['abc', 'abc-v1', 'abc-v2'])

  const entries = [{ id: 'a', mmr: 1000 }, { id: 'b', mmr: 1100 }, { id: 'c', mmr: 2000 }, { id: 'd', mmr: 2100 }]
  const seeded = optimizeDraw({ entries, poolSize: 2, baseSeed: 's', seedingEnabled: true })
  assert.equal(seeded.method, 'seeded')
  assert.equal(seeded.tried, 1)
  assert.equal(seeded.numPools, 2)
  assert.equal(seeded.pools.length, 2)

  const bal = optimizeDraw({ entries, poolSize: 2, baseSeed: 's', seedingEnabled: false, candidates: 8 })
  assert.equal(bal.method, 'balanced')
  assert.equal(bal.tried, 8)
  assert.equal(bal.pools.length, 2)

  // MMR 없는 조 → 무작위 공정 설명
  const noMmr = explainDraw({ method: 'balanced' }, [{ poolName: 'A조', entries: [{}] }, { poolName: 'B조', entries: [{}] }])
  assert.equal(noMmr.hasMmr, false)
  // MMR 있는 조 → 균형 설명 + 조별 평균
  const withMmr = explainDraw({ method: 'seeded' }, [
    { poolName: 'A조', entries: [{ mmr: 1000 }, { mmr: 2000 }] },
    { poolName: 'B조', entries: [{ mmr: 1400 }, { mmr: 1500 }] },
  ])
  assert.equal(withMmr.hasMmr, true)
  assert.equal(withMmr.poolLines.length, 2)
})

test('drawOptimizer: meetRound — 리프가 만나는 라운드', () => {
  assert.equal(meetRound(0, 1), 1)   // 같은 1라운드 경기
  assert.equal(meetRound(0, 2), 2)   // 2라운드에서 만남
  assert.equal(meetRound(0, 3), 2)
  assert.equal(meetRound(0, 4), 3)   // 8강 트리에서 3라운드(결승)
  assert.equal(meetRound(5, 5), 0)   // 같은 리프
})

test('drawOptimizer: scoreKnockout — 강팀 조기 대결/절반 균형', () => {
  // 강팀(2000)이 1라운드에 서로 만나는 나쁜 대진 vs 반대편으로 갈린 좋은 대진
  const bad = scoreKnockout([
    { mmr: 2000 }, { mmr: 1990 },  // 1라운드 강강 대결
    { mmr: 1000 }, { mmr: 1010 },
  ])
  const good = scoreKnockout([
    { mmr: 2000 }, { mmr: 1000 },  // 강팀이 서로 다른 리프
    { mmr: 1010 }, { mmr: 1990 },
  ])
  assert.ok(good.clashPenalty < bad.clashPenalty)   // 좋은 대진이 벌점 낮음
  assert.ok(good.halfSpread < bad.halfSpread)        // 위/아래 절반도 더 고름
  // MMR 없으면 벌점 0
  const none = scoreKnockout([{}, {}, {}, {}])
  assert.equal(none.clashPenalty, 0)
  assert.equal(none.score, 0)
})

test('drawOptimizer: optimizeKnockout / knockoutLeaves / explainKnockout', () => {
  const entries = [
    { id: 'a', label: 'A', mmr: 2000 }, { id: 'b', label: 'B', mmr: 1950 },
    { id: 'c', label: 'C', mmr: 1200 }, { id: 'd', label: 'D', mmr: 1150 },
    { id: 'e', label: 'E', mmr: 1900 }, { id: 'f', label: 'F', mmr: 1100 },
    { id: 'g', label: 'G', mmr: 1300 }, { id: 'h', label: 'H', mmr: 1250 },
  ]
  // 시드 켜짐 → 결정적, 후보 1개, method 'seeded'
  const seeded = optimizeKnockout({ entries, baseSeed: 's', seedingEnabled: true })
  assert.equal(seeded.method, 'seeded')
  assert.equal(seeded.tried, 1)
  assert.equal(seeded.leafCount, 8)

  // 무작위 → 후보 여럿 비교, 가장 균형(=벌점 최소)을 고른다
  const bal = optimizeKnockout({ entries, baseSeed: 's', seedingEnabled: false, candidates: 16 })
  assert.equal(bal.method, 'balanced')
  assert.equal(bal.tried, 16)
  assert.equal(bal.clashPenalties.length, 16)
  // 고른 대진의 벌점은 후보 중 최소
  assert.ok(bal.metrics.clashPenalty <= Math.min(...bal.clashPenalties) + 1e-9)
  // 고른 씨드를 다시 넣으면 같은 리프(재현성)
  const l1 = knockoutLeaves(entries, bal.seed, false)
  const l2 = knockoutLeaves(entries, bal.seed, false)
  assert.deepEqual(l1.map(x => x.entryId), l2.map(x => x.entryId))
  assert.equal(l1.length, 8)

  // 4팀 미만 → method 'random'(최적화 의미 없음)
  const tiny = optimizeKnockout({ entries: entries.slice(0, 2), baseSeed: 's' })
  assert.equal(tiny.method, 'random')
  assert.equal(tiny.tried, 1)

  // 설명: balanced → 강팀 분산 헤드라인 + 위/아래 대진 2줄
  const exp = explainKnockout(bal)
  assert.equal(exp.hasMmr, true)
  assert.equal(exp.poolLines.length, 2)
  assert.ok(exp.headline.includes('강팀'))
  // 설명: seeded → 시드 헤드라인
  const expSeed = explainKnockout(seeded)
  assert.ok(expSeed.headline.includes('시드'))
  // 설명: random(MMR 부족) → 무작위 공정
  const expRandom = explainKnockout(tiny)
  assert.equal(expRandom.hasMmr, false)
})

// ══════════════════════ planWizard.js ══════════════════════
test('planWizard: distributePools — 최대한 고르게', () => {
  assert.deepEqual(distributePools(10, 4), [4, 3, 3])
  assert.deepEqual(distributePools(8, 4), [4, 4])
  assert.deepEqual(distributePools(1, 4), [])
})

test('planWizard: estimateMatches — 포맷별 실경기 수', () => {
  assert.equal(estimateMatches({ tournament_format: 'round_robin' }, 4).total, 6)     // 4C2
  assert.equal(estimateMatches({ tournament_format: 'single_elim', prize_spots: 3 }, 5).total, 5) // 4강 진출 4 + 3·4위전
  const pk = estimateMatches({ tournament_format: 'pool_knockout', pool_size: 4, advancement_per_pool: 2, prize_spots: 3 }, 8)
  assert.deepEqual(pk.pools, [4, 4])
  assert.equal(pk.pool, 12)      // 조별 6+6
  assert.equal(pk.advancers, 4)
  assert.equal(pk.total, 16)     // 12 + (4-1) + 3·4위전
})

test('planWizard: defaultMatchMinutes / recommendSetup / formatDuration', () => {
  assert.equal(defaultMatchMinutes({ points_per_game: 21 }), 35)          // 13*2.4 반올림 +4
  assert.equal(defaultMatchMinutes({ points_per_game: 21, games_per_match: 1 }), 17)
  assert.equal(recommendSetup(4).tournament_format, 'round_robin')
  assert.equal(recommendSetup(8).tournament_format, 'pool_knockout')
  assert.equal(recommendSetup(8).pool_size, 4)
  assert.equal(recommendSetup(1), null)
  assert.equal(recommendSetup(12).pool_size, 4)   // 12팀 → 4팀조 3개(고르게)
  assert.equal(formatDuration(90), '약 1시간 30분')
  assert.equal(formatDuration(60), '약 1시간')
  assert.equal(formatDuration(30), '약 30분')
})

test('planWizard: estimateSchedule — 예상 종료 시각 계산', () => {
  const est = estimateSchedule({
    cat: { tournament_format: 'round_robin', points_per_game: 21 },
    teams: 4, courtCount: 1, startTime: new Date('2026-07-11T09:00:00Z'),
  })
  assert.equal(est.total, 6)
  assert.ok(est.endTime instanceof Date)
  assert.ok(est.endTime.getTime() > new Date('2026-07-11T09:00:00Z').getTime())
})

// ══════════════════════ certificate.js ══════════════════════
test('certificate: certRankInfo — 시상 범위 안/밖', () => {
  assert.equal(certRankInfo(1).label, '우승')
  assert.equal(certRankInfo(2).label, '준우승')
  assert.equal(certRankInfo(4, 3), null)         // 3위까지 시상 → 4위 없음
  assert.equal(certRankInfo(4, 4).label, '4위')  // 4위까지 시상
  assert.equal(certRankInfo(0), null)
})

test('certificate: koreanDate / buildCertificate / buildCertificates', () => {
  assert.equal(koreanDate('2026-07-10'), '2026년 7월 10일')
  assert.equal(koreanDate('없음'), '없음')

  const c = buildCertificate({
    tournament: { title: 'T', date: '2026-01-01' }, category: { sport_type: '남복' },
    recipient: '홍길동', rank: 1,
  })
  assert.equal(c.issueNo, '2026-남복-1')
  assert.equal(c.rankLabel, '우승')
  assert.equal(buildCertificate({ rank: 5, prizeSpots: 3 }), null)

  const certs = buildCertificates({
    tournament: { title: 'T', date: '2026-01-01' }, category: { sport_type: '남복' },
    winners: [{ recipient: 'B', rank: 2 }, { recipient: 'A', rank: 1 }, { recipient: 'Z', rank: 9 }],
  })
  assert.equal(certs.length, 2)         // 9위 제외
  assert.equal(certs[0].rankLabel, '우승') // 순위 오름차순 정렬
})

// ══════════════════════ record.js ══════════════════════
test('record: opponentPlayers — 나 제외·게스트 폴백', () => {
  assert.deepEqual(
    opponentPlayers({ player1: { id: 'me' }, player2: { id: 'p2', name: 'B' } }, 'me'),
    [{ id: 'p2', name: 'B' }],
  )
  assert.deepEqual(opponentPlayers({ team_name: '게스트' }, 'me'), [{ id: 'team:게스트', name: '게스트' }])
  assert.deepEqual(opponentPlayers(null, 'me'), [])
})

test('record: computeCareerRecord — 승패·부전·세트·상대전적·대회수', () => {
  const matches = [
    { id: 1, status: 'completed', team1_entry_id: 'E1', team2_entry_id: 'EX', winner_entry_id: 'E1',
      team2: { player1: { id: 'op1', name: '상대1' } },
      scores: [{ set_number: 1, team1_score: 21, team2_score: 15 }, { set_number: 2, team1_score: 21, team2_score: 10 }],
      category: { tournament: { id: 't1' } } },
    { id: 2, status: 'forfeited', team1_entry_id: 'E1', team2_entry_id: 'EY', winner_entry_id: 'EY',
      team2: { player1: { id: 'op2', name: '상대2' } }, category: { tournament: { id: 't1' } } },
    { id: 3, status: 'bye', team1_entry_id: 'E1', team2_entry_id: null, winner_entry_id: 'E1' },
    { id: 4, status: 'completed', team1_entry_id: 'ZZ', team2_entry_id: 'YY', winner_entry_id: 'ZZ' }, // 내가 안 낌
  ]
  const r = computeCareerRecord({ matches, myEntryIds: ['E1'], myPlayerId: 'me' })
  assert.equal(r.totals.wins, 2)          // 실경기 승 + bye
  assert.equal(r.totals.losses, 1)        // forfeited 패
  assert.equal(r.totals.walkoverWins, 1)  // bye
  assert.equal(r.totals.walkoverLosses, 1)// forfeited
  assert.equal(r.totals.played, 1)        // 실제 점수 겨룬 경기
  assert.equal(r.totals.setsWon, 2)
  assert.equal(r.totals.setsLost, 0)
  assert.equal(r.totals.pointsFor, 42)
  assert.equal(r.totals.pointsAgainst, 25)
  assert.equal(r.tournaments, 1)
  assert.equal(r.winRate, 67)             // 2/3
  const opps = Object.fromEntries(r.byOpponent.map(o => [o.id, o]))
  assert.equal(opps.op1.wins, 1)
  assert.equal(opps.op2.losses, 1)        // 부전패 상대도 head-to-head 포함
  assert.equal(hasCareerRecord(r), true)
  assert.equal(hasCareerRecord(null), false)
})

// ══════════════════════ discover.js ══════════════════════
test('discover: regionTokens / preferredRegions / ddayOf', () => {
  assert.deepEqual(regionTokens('서울 강남구 체육관'), ['서울', '강남구'])
  assert.deepEqual(regionTokens('서울특별시'), ['서울'])   // 특별시는 세밀 토큰에서 제외
  assert.deepEqual(regionTokens(''), [])

  const pref = preferredRegions([{ venue: '서울 강남구' }, { venue: '서울 서초구' }, { venue: '부산' }])
  assert.equal(pref[0], '서울')  // 가장 빈번

  const now = new Date(2026, 6, 11).getTime()
  assert.equal(ddayOf('2026-07-13', now), 2)
  assert.equal(ddayOf('2026-07-11', now), 0)
  assert.equal(ddayOf('없음', now), null)
})

test('discover: recommendTournaments — 접수중·미신청·자격 있는 미래 대회만', () => {
  const now = new Date(2026, 6, 11).getTime()
  const tournaments = [
    { id: 't1', status: 'open', date: '2026-07-20', registration_end: '2026-07-15', venue: '서울 강남구' },
    { id: 't2', status: 'open', date: '2026-07-20', venue: '부산' },   // 이미 신청
    { id: 't3', status: 'closed', date: '2026-07-20' },                // 접수 마감
    { id: 't4', status: 'open', date: '2026-07-20', venue: '대구' },    // 자격 없음
    { id: 't5', status: 'open', date: '2026-01-01', venue: '서울' },    // 지난 대회
  ]
  const fitOf = (t) => ({ eligibleCount: t.id === 't4' ? 0 : 2 })
  const rec = recommendTournaments({ tournaments, appliedIds: ['t2'], fitOf, myRegions: ['서울'], now, limit: 5 })
  assert.equal(rec.length, 1)
  assert.equal(rec[0].tournament.id, 't1')
  assert.equal(rec[0].regionMatch, '서울')
  assert.ok(rec[0].reasons.some(r => r.kind === 'region'))
  assert.ok(rec[0].reasons.some(r => r.kind === 'deadline'))
})

// ══════════════════════ partners.js ══════════════════════
test('partners: collectPastPartners — 복식 상대 집계·정렬', () => {
  const entries = [
    { player1_id: 'me', player2_id: 'p2', created_at: '2026-01-01' },
    { player1_id: 'p2', player2_id: 'me', created_at: '2026-02-01' },
    { player1_id: 'me', player2_id: 'p3', created_at: '2026-03-01' },
    { player1_id: 'me', player2_id: null, created_at: '2026-04-01' }, // 단식 제외
  ]
  const out = collectPastPartners(entries, 'me')
  assert.equal(out[0].partnerId, 'p2')  // 함께 2회 → 최상위
  assert.equal(out[0].count, 2)
  assert.equal(out[0].lastAt, '2026-02-01')
  assert.equal(out[1].partnerId, 'p3')
  assert.deepEqual(collectPastPartners(null, 'me'), [])
})

test('partners: rankPartnerSuggestions / partnerReason — 자격 통과 먼저', () => {
  const ranked = rankPartnerSuggestions(
    [{ profile: { id: 'a' }, count: 5, lastAt: 'x' }, { profile: { id: 'b' }, count: 1, lastAt: 'y' }],
    (p) => ({ ok: p.id !== 'a' }),   // a 자격 미달
  )
  assert.equal(ranked[0].profile.id, 'b')  // 자격 통과가 우선(횟수 무관)
  assert.equal(ranked[0].eligible, true)
  assert.equal(ranked[1].eligible, false)
  assert.deepEqual(rankPartnerSuggestions([{ profile: null }]), [])
  assert.equal(partnerReason(3), '함께 3번 출전한 단골 파트너')
  assert.equal(partnerReason(1), '지난 대회 파트너')
})

// ══════════════════════ highlight.js ══════════════════════
test('highlight: computePlayerStats / winRate — 풀세트·명장면·완승', () => {
  const matches = [{
    status: 'completed', team1_entry_id: 'E1', team2_entry_id: 'E2', winner_entry_id: 'E1',
    scores: [
      { set_number: 1, team1_score: 21, team2_score: 19 },
      { set_number: 2, team1_score: 15, team2_score: 21 },
      { set_number: 3, team1_score: 21, team2_score: 18 },
    ],
  }]
  const st = computePlayerStats(matches, 'E1', { E2: { team_name: '상대팀' } })
  assert.equal(st.played, 1)
  assert.equal(st.wins, 1)
  assert.equal(st.fullSetCount, 1)
  assert.equal(st.setsWon, 2)
  assert.equal(st.setsLost, 1)
  assert.equal(st.closest.margin, 2)   // 21-19 가장 접전
  assert.equal(st.bestWin.myScore, 21) // 21-18 완승(3점차)
  assert.equal(winRate(st), 100)
  assert.equal(computePlayerStats(null, 'E1').played, 0)
})

test('highlight: buildPlayerHighlight / shareText — 순위 헤드라인·빈 입력', () => {
  assert.equal(buildPlayerHighlight({ myEntry: null }), null)
  // 경기·순위 모두 없음 → null
  assert.equal(buildPlayerHighlight({ myEntry: { id: 'E9' }, matches: [], entryById: {} }), null)

  const h = buildPlayerHighlight({
    tournament: { title: 'T' }, category: { sport_type: '남복', prize_spots: 3 },
    myEntry: { id: 'E1', final_rank: 1 }, matches: [], entryById: {}, mmrDelta: 25,
  })
  assert.ok(h.headline.includes('우승'))
  assert.equal(h.medal, '🥇')
  assert.equal(h.prize, '우승')
  assert.equal(h.mmrDelta, 25)

  const txt = highlightShareText(h, { tournament: { title: 'T' }, category: { sport_type: '남복' } })
  assert.ok(txt.includes('T · 남복'))
  assert.ok(txt.includes('배드민국'))
})

// ══════════════════════ orchestrator: planAutoAdvance / planRebalance / analyzeDelay ══════════
test('planAutoAdvance: 빈 코트 맨 앞 자동 호출·두 번째 사전알림', () => {
  const matches = [
    { id: 'm1', status: 'scheduled', team1_entry_id: 'a', team2_entry_id: 'b', court_number: 1, scheduled_time: '2026-07-11T09:00:00Z' },
    { id: 'm2', status: 'scheduled', team1_entry_id: 'c', team2_entry_id: 'd', court_number: 1, scheduled_time: '2026-07-11T09:35:00Z' },
  ]
  const r = planAutoAdvance(matches, { calledAt: {}, now: Date.parse('2026-07-11T09:00:00Z') })
  assert.equal(r.toCall.length, 1)
  assert.equal(r.toCall[0].id, 'm1')
  assert.equal(r.toSoon.length, 1)
  assert.equal(r.toSoon[0].id, 'm2')
  // 이미 호출한 경기는 다시 안 부름
  assert.equal(planAutoAdvance(matches, { calledAt: { m1: 1 }, now: Date.now() }).toCall.length, 0)
})

test('planRebalance: 유휴 코트로 과부하 코트 대기 경기 이동·중복출전 방지', () => {
  const matches = [
    { id: 'r', status: 'in_progress', court_number: 1, team1_entry_id: 'a', team2_entry_id: 'b' },
    { id: 'q1', status: 'scheduled', court_number: 1, team1_entry_id: 'c', team2_entry_id: 'd' },
    { id: 'q2', status: 'scheduled', court_number: 1, team1_entry_id: 'e', team2_entry_id: 'f' },
  ]
  const plan = planRebalance(matches, { courtCount: 2 })
  assert.ok(plan.idleCourts.includes(2))
  assert.equal(plan.moves.length, 1)
  assert.equal(plan.moves[0].fromCourt, 1)
  assert.equal(plan.moves[0].toCourt, 2)
  assert.equal(plan.moves[0].match.id, 'q1')
})

test('analyzeDelay: 관측 페이스·onTrack 판정', () => {
  const now = Date.parse('2026-07-11T10:00:00Z')
  const r = analyzeDelay(
    [{ id: 'x', status: 'in_progress', actual_start: new Date(now - 40 * 60000).toISOString(), court_number: 1 }],
    { matchMinutes: 30, now },
  )
  assert.equal(r.observedMin, 40)   // 계획 30분보다 오래
  assert.equal(r.runningCount, 1)
  assert.equal(r.remaining, 1)
  assert.ok(Array.isArray(r.suggestions))
})

// ══════════════════════ chatbot.js ══════════════════════
test('chatbot: normalize / matchTopic / askBot', () => {
  assert.equal(normalize('안녕 하세요!'), '안녕하세요')
  assert.equal(matchTopic('참가비 얼마예요?').topic.id, 'fee')
  assert.equal(matchTopic('asdfqwer'), null)

  const fee = askBot('참가비 얼마예요?', { categories: [{ sport_type: '남복', entry_fee: 10000 }] })
  assert.equal(fee.kind, 'personal')
  assert.equal(fee.topic, 'fee')
  assert.ok(fee.answer.includes('10,000'))

  const sc = askBot('점수 규칙 알려줘')
  assert.equal(sc.kind, 'faq')
  assert.equal(sc.topic, 'scoring')

  assert.equal(askBot('블라블라xyz').kind, 'fallback')
})

test('chatbot: suggestedQuestions — 있는 정보만·최대 6개', () => {
  const qs = suggestedQuestions({
    tournament: { date: '2026-07-11', venue: '서울체육관', status: 'open' },
    categories: [{ entry_fee: 5000 }],
  })
  assert.ok(qs.length <= 6)
  assert.ok(qs.includes('참가비 얼마예요?'))
})

// ══════════════════════ grades.checkEligibility / 승급 ══════════════════════
test('grades: checkEligibility — 화이트리스트/레거시/MMR 게이트', () => {
  assert.equal(checkEligibility(null, {}, {}).ok, false)  // 로그인 필요

  // 화이트리스트 통과
  assert.equal(
    checkEligibility({ grade_gu_dbl: 'C조', mmr: 1250 }, { sport_type: '남복', allowed_grades: ['C조', 'D조'] }, { unit: 'gu' }).ok,
    true,
  )
  // 화이트리스트 탈락
  assert.equal(
    checkEligibility({ grade_gu_dbl: 'A조', mmr: 1600 }, { sport_type: '남복', allowed_grades: ['C조', 'D조'] }, { unit: 'gu' }).ok,
    false,
  )
  // 레거시 grade_min (C조 idx3 < B조 idx4 → 탈락)
  assert.equal(
    checkEligibility({ grade_gu_dbl: 'C조', mmr: 1250 }, { sport_type: '남복', grade_min: 'B조' }, { unit: 'gu' }).ok,
    false,
  )
  // MMR 하한 미달
  assert.equal(
    checkEligibility({ grade_gu_dbl: 'A조', mmr: 1000 }, { sport_type: '남복', min_mmr: 1500 }, { unit: 'gu' }).ok,
    false,
  )
})

test('grades: awardPoints / checkPromotion / promotionProgress', () => {
  assert.equal(awardPoints(1, 'c'), 3)   // 우승 3 × 구(c) 1.0
  assert.equal(awardPoints(2, 'a'), 4)   // 준우승 2 × 전국(a) 2.0
  assert.equal(awardPoints(4, 'c'), 0)   // 시상 밖

  // 초심(idx1) + 전국 우승(6점) → D조(idx2)로 승급
  assert.equal(checkPromotion('초심', [{ finalRank: 1, certLevel: 'a' }]), 'D조')
  assert.equal(checkPromotion('초심', []), null)   // 승급 없음(강등 안 함)
  assert.equal(getGradeIndex('D조'), 2)

  const prog = promotionProgress('초심', [{ finalRank: 1, certLevel: 'c' }])
  assert.equal(prog.nextGrade, 'D조')
  assert.equal(prog.points, 3)
  assert.equal(prog.pointsNeeded, 4.5)
  assert.equal(prog.remaining, 1.5)
})

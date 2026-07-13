// ── 순수 엔진 회귀 테스트 ───────────────────────────────────────────
// 자동화의 핵심 판정 엔진(점수·상태머신·노쇼·체크인·일정·부전·예측)을 커밋된
// 테스트로 고정한다. 여기서 검증하는 불변식이 깨지면 무인 진행이 조용히 오작동하므로
// (예: 게임 종료 오판, 자동 승인 오분류) 이후 실행이 반드시 초록을 유지해야 한다.
import { test, assert } from './_harness.mjs'

import {
  initMatchState, isGameOver, isIntervalPoint, applyPoint, applyForfeit,
  serviceCourt, foldEvents, matchCall, scoreSummary,
} from '../src/lib/bwf.js'
import {
  buildSingleElimination, buildRoundRobin, scheduleMatches, rescheduleAfterForfeit,
} from '../src/lib/scheduler.js'
import {
  planTournamentState, planAutoFinalize, planAutoApprovals,
} from '../src/lib/stateMachine.js'
import { planNoShow } from '../src/lib/orchestrator.js'
import { planTeamForfeit } from '../src/lib/advance.js'
import {
  predictNoShow, buildNoShowIndex, entryNoShowRisk, recommendWaitlist, worseNoShow,
} from '../src/lib/noshowPredict.js'
import {
  getCheckinWindow, assessSelfCheckin, assessNoShowResolution, summarizeCheckins,
} from '../src/lib/checkin.js'
import { assessSandbag, worseLevel, getGradeFromMMR } from '../src/lib/sandbag.js'
import { calcReliability, reliabilityTier, isRanked } from '../src/lib/reliability.js'

// 헬퍼: 팀 t 에 n점 연속 득점시켜 최종 state 반환
function scoreN(state, team, n) {
  let s = state
  for (let i = 0; i < n; i++) s = applyPoint(s, team)
  return s
}

// ══════════════════════ bwf.js ══════════════════════
test('bwf: initMatchState 기본값(21점·3게임·cap 30)', () => {
  const s = initMatchState()
  assert.equal(s.config.pointsPerGame, 21)
  assert.equal(s.config.gamesPerMatch, 3)
  assert.equal(s.config.cap, 30)
  assert.deepEqual(s.score, [0, 0])
  assert.equal(s.finished, false)
})

test('bwf: isGameOver — 2점차·듀스·골든포인트', () => {
  const cfg = { pointsPerGame: 21, cap: 30 }
  assert.equal(isGameOver([21, 19], cfg), 1)
  assert.equal(isGameOver([21, 20], cfg), null) // 1점차 → 미종료
  assert.equal(isGameOver([22, 20], cfg), 1)
  assert.equal(isGameOver([20, 21], cfg), null)
  assert.equal(isGameOver([29, 30], cfg), 2)
  assert.equal(isGameOver([30, 29], cfg), 1) // 골든포인트 cap
  assert.equal(isGameOver([15, 10], cfg), null)
})

test('bwf: isIntervalPoint — 중간점 최초 도달', () => {
  assert.equal(isIntervalPoint([11, 5], 21), true)
  assert.equal(isIntervalPoint([5, 11], 21), true)
  assert.equal(isIntervalPoint([11, 11], 21), false)
  assert.equal(isIntervalPoint([10, 5], 21), false)
})

test('bwf: applyPoint — 랠리포인트 서브권은 득점팀', () => {
  const s = applyPoint(initMatchState(), 2)
  assert.deepEqual(s.score, [0, 1])
  assert.equal(s.serverTeam, 2)
})

test('bwf: applyPoint — 게임 종료 시 게임수 증가·점수 리셋·인터벌 플래그', () => {
  const g = scoreN(initMatchState(), 1, 21) // 팀1이 21-0
  assert.deepEqual(g.gamesWon, [1, 0])
  assert.equal(g.gameNo, 2)             // 다음 게임으로
  assert.deepEqual(g.score, [0, 0])     // 리셋
  assert.equal(g.serverTeam, 1)         // 직전 게임 승자 서브
  assert.equal(g.flags.gameJustEnded, true)
  assert.equal(g.flags.matchJustEnded, false)
  assert.equal(g.completedGames.length, 1)
  assert.deepEqual(g.completedGames[0].score, [21, 0])
})

test('bwf: applyPoint — 매치 종료(2게임 선취)', () => {
  const m = scoreN(scoreN(initMatchState(), 1, 21), 1, 21)
  assert.equal(m.finished, true)
  assert.equal(m.winnerTeam, 1)
  assert.equal(m.flags.matchJustEnded, true)
  // finished 상태에 득점 시 그대로 반환
  assert.equal(applyPoint(m, 2), m)
})

test('bwf: applyForfeit — 포기팀 상대가 승자', () => {
  const s = applyForfeit(initMatchState(), 1, 'walkover')
  assert.equal(s.finished, true)
  assert.equal(s.winnerTeam, 2)
  assert.equal(s.resultType, 'walkover')
})

test('bwf: serviceCourt — 짝수 오른쪽·홀수 왼쪽', () => {
  const s0 = initMatchState()
  assert.deepEqual(serviceCourt(s0), { team: 1, side: 'right' })
  const s1 = applyPoint(s0, 1) // 팀1 1점 → 홀수
  assert.deepEqual(serviceCourt(s1), { team: 1, side: 'left' })
})

test('bwf: foldEvents — 언두 반영 재구성', () => {
  const cfg = { gamesPerMatch: 3, pointsPerGame: 21 }
  const events = [
    { event_type: 'point', team_no: 1 },
    { event_type: 'point', team_no: 1 },
    { event_type: 'point', team_no: 2 },
    { event_type: 'undo' },
  ]
  const s = foldEvents(events, cfg, 1)
  assert.deepEqual(s.score, [2, 0]) // 팀2 1점이 언두됨
})

test('bwf: matchCall — 게임/매치 포인트·듀스·골든·무콜', () => {
  const base = initMatchState()
  const gp = { ...base, score: [20, 19] }
  assert.deepEqual(matchCall(gp), { key: 'gamePoint', team: 1, label: '게임 포인트' })

  const deuce = { ...base, score: [20, 20] }
  assert.equal(matchCall(deuce).key, 'deuce')

  const golden = { ...base, score: [29, 29] }
  assert.equal(matchCall(golden).key, 'golden')

  const mp = { ...base, score: [20, 15], gamesWon: [1, 0] } // 이 게임 이기면 매치 종료
  assert.equal(matchCall(mp).key, 'matchPoint')

  assert.equal(matchCall({ ...base, score: [5, 3] }), null)
  assert.equal(matchCall({ ...base, finished: true }), null)
  assert.equal(matchCall(null), null)
})

test('bwf: scoreSummary — 끝난 게임 문자열', () => {
  const s = { completedGames: [
    { gameNo: 1, score: [21, 18], winnerTeam: 1 },
    { gameNo: 2, score: [19, 21], winnerTeam: 2 },
  ] }
  assert.equal(scoreSummary(s), '21-18, 19-21')
})

// ══════════════════════ scheduler.js ══════════════════════
test('scheduler: buildSingleElimination — 5팀→size8, 부전승 슬롯', () => {
  const entries = [1, 2, 3, 4, 5].map(id => ({ id }))
  const ms = buildSingleElimination(entries)
  const r1 = ms.filter(m => m.round === 1)
  assert.equal(r1.length, 4)             // 8강 4경기
  assert.ok(r1.some(m => m.bye))         // 부전승 존재
  assert.equal(ms.length, 4 + 2 + 1)     // 8강+4강+결승
})

test('scheduler: buildRoundRobin — 4팀 6경기', () => {
  const ms = buildRoundRobin([1, 2, 3, 4].map(id => ({ id })))
  const real = ms.filter(m => !m.bye)
  assert.equal(real.length, 6)
})

test('scheduler: buildRoundRobin — 홀수는 부전승 채움', () => {
  const ms = buildRoundRobin([1, 2, 3].map(id => ({ id })))
  assert.ok(ms.some(m => m.bye))
})

test('scheduler: scheduleMatches — 한 코트면 순차 배정', () => {
  const matches = [
    { id: 'a', entryA: { id: 'p1' }, entryB: { id: 'p2' } },
    { id: 'b', entryA: { id: 'p3' }, entryB: { id: 'p4' } },
  ]
  const res = scheduleMatches({
    matches, courts: [1], startTime: new Date('2026-07-11T09:00:00Z'),
    matchMinutes: 30, breakMinutes: 5, restMinutes: 20,
  })
  assert.equal(res[0].court, 1)
  assert.equal(res[1].court, 1)
  assert.ok(new Date(res[1].scheduledTime) > new Date(res[0].scheduledTime))
})

test('scheduler: rescheduleAfterForfeit — 같은 코트 이후 경기 당김', () => {
  const t0 = new Date('2026-07-11T09:00:00Z')
  const t1 = new Date('2026-07-11T09:35:00Z')
  const sched = [
    { id: 'a', court: 1, scheduledTime: t0 },
    { id: 'b', court: 1, scheduledTime: t1 },
    { id: 'c', court: 2, scheduledTime: t1 },
  ]
  const out = rescheduleAfterForfeit(sched, 'a', 30, 5)
  const b = out.find(m => m.id === 'b')
  assert.equal(new Date(b.scheduledTime).getTime(), t1.getTime() - 30 * 60000)
  // 다른 코트(c)는 불변
  assert.equal(new Date(out.find(m => m.id === 'c').scheduledTime).getTime(), t1.getTime())
  // 없는 id는 원본 그대로
  assert.equal(rescheduleAfterForfeit(sched, 'zzz'), sched)
})

// ══════════════════════ stateMachine.js ══════════════════════
const NOW = new Date('2026-07-11T10:00:00Z').getTime()

test('stateMachine: open→closed (마감 시각 경과)', () => {
  const r = planTournamentState({
    tournament: { status: 'open', registration_end: '2026-07-10T00:00:00Z', date: '2026-07-12' },
    categories: [{ id: 'c1' }], counts: {}, matches: [], now: NOW,
  })
  assert.equal(r.recommended, 'closed')
  assert.equal(r.auto, true)
  assert.equal(r.trigger, 'deadline')
})

test('stateMachine: open→closed (정원 충족)', () => {
  const r = planTournamentState({
    tournament: { status: 'open', registration_end: '2026-08-01T00:00:00Z', date: '2026-07-12' },
    categories: [{ id: 'c1', max_teams: 4 }], counts: { c1: 4 }, matches: [], now: NOW,
  })
  assert.equal(r.recommended, 'closed')
  assert.equal(r.trigger, 'capacity')
})

test('stateMachine: closed → 대진표 없으면 blockReason', () => {
  const r = planTournamentState({
    tournament: { status: 'closed', date: '2026-07-11' }, categories: [], counts: {}, matches: [], now: NOW,
  })
  assert.equal(r.changed, false)
  assert.ok(r.blockReason)
})

test('stateMachine: closed→in_progress (당일+대진표)', () => {
  const r = planTournamentState({
    tournament: { status: 'closed', date: '2026-07-11' }, categories: [], counts: {},
    matches: [{ status: 'scheduled' }], now: NOW,
  })
  assert.equal(r.recommended, 'in_progress')
  assert.equal(r.auto, true)
})

test('stateMachine: in_progress→completed 추천은 무인 아님(auto:false)', () => {
  const r = planTournamentState({
    tournament: { status: 'in_progress', date: '2026-07-11' }, categories: [], counts: {},
    matches: [{ status: 'completed' }, { status: 'bye' }], now: NOW,
  })
  assert.equal(r.recommended, 'completed')
  assert.equal(r.auto, false)
  assert.equal(r.trigger, 'finish')
})

test('stateMachine: planAutoFinalize — 유예 판정', () => {
  const done = [{ status: 'completed' }, { status: 'forfeited' }, { status: 'bye' }]
  const a = planAutoFinalize({ matches: done, allDoneSince: null, now: NOW, graceSec: 180 })
  assert.deepEqual(a, { allDone: true, ready: false, remainingSec: 180 })

  const b = planAutoFinalize({ matches: done, allDoneSince: NOW - 200000, now: NOW, graceSec: 180 })
  assert.equal(b.ready, true)
  assert.equal(b.remainingSec, 0)

  const c = planAutoFinalize({ matches: [{ status: 'scheduled' }], now: NOW })
  assert.equal(c.allDone, false)
})

test('stateMachine: planAutoApprovals — auto/payment/review/capacity 분류', () => {
  // 깨끗한 선수: official_grade = MMR 추정 급수 → 샌드배깅 gap 0 → none
  const cleanMmr = 1200
  const clean = () => ({ mmr: cleanMmr, mmr_games_played: 10, official_grade: getGradeFromMMR(cleanMmr) })
  const mk = (over) => ({ entry_status: 'applied', category_id: 'c1', player1: clean(), player2: null, ...over })

  // 1) 정상 → auto
  let r = planAutoApprovals([mk({ id: 'e1' })], { c1: {} }, { counts: {} })
  assert.equal(r.auto.length, 1)

  // 2) 참가비 미입금 → payment
  r = planAutoApprovals([mk({ id: 'e2', payment_status: 'pending' })], { c1: { entry_fee: 5000 } }, { counts: {} })
  assert.equal(r.payment.length, 1)
  assert.equal(r.auto.length, 0)

  // 3) 샌드배깅(고MMR·저신고급수) → review
  const ringer = mk({ id: 'e3', player1: { mmr: 3200, mmr_games_played: 10, official_grade: getGradeFromMMR(1000) } })
  r = planAutoApprovals([ringer], { c1: {} }, { counts: {} })
  assert.equal(r.review.length, 1)

  // 4) 정원 초과 → capacity
  r = planAutoApprovals([mk({ id: 'e4' })], { c1: { max_teams: 1 } }, { counts: { c1: 1 } })
  assert.equal(r.capacity.length, 1)
})

// ══════════════════════ orchestrator.planNoShow ══════════════════════
test('planNoShow: waiting→recall→warned→overdue 단계', () => {
  const m = [{ id: 'm1', status: 'scheduled' }]
  const opts = { warnAfterSec: 120, forfeitAfterSec: 300, recallAfterSec: 45, recallEverySec: 45, recallMaxCount: 2 }

  // 10초 경과: 아직 재알림 없음
  let r = planNoShow(m, { ...opts, calledAt: { m1: NOW - 10000 }, now: NOW })
  assert.equal(r.toRecall.length, 0)
  assert.equal(r.status.m1.phase, 'waiting')

  // 50초 경과(>45): 재알림
  r = planNoShow(m, { ...opts, calledAt: { m1: NOW - 50000 }, now: NOW })
  assert.equal(r.toRecall.length, 1)

  // 재알림 2회 소진 → 더 이상 재알림 안 함
  r = planNoShow(m, { ...opts, calledAt: { m1: NOW - 50000 }, recalledAt: { m1: { at: NOW - 50000, count: 2 } }, now: NOW })
  assert.equal(r.toRecall.length, 0)

  // 130초(>120): warned
  r = planNoShow(m, { ...opts, calledAt: { m1: NOW - 130000 }, now: NOW })
  assert.equal(r.toWarn.length, 1)
  assert.equal(r.status.m1.phase, 'warned')

  // 310초(>300): overdue
  r = planNoShow(m, { ...opts, calledAt: { m1: NOW - 310000 }, now: NOW })
  assert.equal(r.overdue.length, 1)

  // 호출 안 된 경기 / 진행 중 경기는 제외
  assert.equal(planNoShow(m, { ...opts, calledAt: {}, now: NOW }).status.m1, undefined)
  assert.equal(planNoShow([{ id: 'm1', status: 'in_progress' }], { ...opts, calledAt: { m1: NOW - 400000 }, now: NOW }).overdue.length, 0)
})

test('planNoShow: 선수 확인(ack) → 재알림 중단 + 부전승 유예 연장 (C1)', () => {
  const m = [{ id: 'm1', status: 'scheduled' }]
  const opts = { warnAfterSec: 120, forfeitAfterSec: 300, ackGraceSec: 120, recallAfterSec: 45, recallEverySec: 45, recallMaxCount: 2 }
  const called = NOW - 50000 // 50초 경과(>45): 확인 없으면 재알림 대상

  // 확인 없음 → 재알림 발송 대상
  let r = planNoShow(m, { ...opts, calledAt: { m1: called }, now: NOW })
  assert.equal(r.toRecall.length, 1)
  assert.equal(r.status.m1.acked, false)

  // 확인함(호출 이후) → 재알림 안 함 + acked 표시
  r = planNoShow(m, { ...opts, calledAt: { m1: called }, ackedAt: { m1: NOW - 5000 }, now: NOW })
  assert.equal(r.toRecall.length, 0)
  assert.equal(r.status.m1.acked, true)

  // 130초(>120): 확인 없으면 warned, 확인하면 유예로 아직 waiting
  const called130 = NOW - 130000
  assert.equal(planNoShow(m, { ...opts, calledAt: { m1: called130 }, now: NOW }).status.m1.phase, 'warned')
  const acked130 = planNoShow(m, { ...opts, calledAt: { m1: called130 }, ackedAt: { m1: NOW - 1000 }, now: NOW })
  assert.equal(acked130.status.m1.phase, 'waiting') // 120초 유예로 임계가 뒤로 밀림
  assert.equal(acked130.toWarn.length, 0)

  // 310초(>300): 확인 없으면 overdue, 확인하면 유예(420초)로 아직 warned
  const called310 = NOW - 310000
  assert.equal(planNoShow(m, { ...opts, calledAt: { m1: called310 }, now: NOW }).overdue.length, 1)
  const acked310 = planNoShow(m, { ...opts, calledAt: { m1: called310 }, ackedAt: { m1: NOW - 1000 }, now: NOW })
  assert.equal(acked310.overdue.length, 0) // 부전승 유예 (오는 중)
  assert.equal(acked310.status.m1.phase, 'warned')

  // 유예는 무한이 아님 — 확인해도 (forfeit+grace) 지나면 overdue 재개
  const called500 = NOW - 500000 // 500초 > 300+120=420
  assert.equal(planNoShow(m, { ...opts, calledAt: { m1: called500 }, ackedAt: { m1: NOW - 1000 }, now: NOW }).overdue.length, 1)

  // 재호출 전의 낡은 확인(호출 이전)은 무시 — ackTs < calledAt 이면 acked=false
  const stale = planNoShow(m, { ...opts, calledAt: { m1: called130 }, ackedAt: { m1: called130 - 10000 }, now: NOW })
  assert.equal(stale.status.m1.acked, false)
  assert.equal(stale.status.m1.phase, 'warned')
})

// ══════════════════════ advance.planTeamForfeit ══════════════════════
test('advance: planTeamForfeit — 상대 정해진 경기 부전·미정 슬롯 비우기', () => {
  const matches = [
    { id: 'a', status: 'scheduled', team1_entry_id: 'X', team2_entry_id: 'Y' },
    { id: 'b', status: 'scheduled', team1_entry_id: 'X', team2_entry_id: null },
    { id: 'c', status: 'completed', team1_entry_id: 'X', team2_entry_id: 'Z' },
    { id: 'd', status: 'scheduled', team1_entry_id: 'P', team2_entry_id: 'Q' },
  ]
  const plan = planTeamForfeit(matches, 'X')
  assert.deepEqual(plan.toForfeit, [{ matchId: 'a', winnerEntryId: 'Y', forfeitTeam: 1 }])
  assert.deepEqual(plan.toVacate, [{ matchId: 'b', slot: 1 }])
  // entryId 없으면 빈 계획
  assert.deepEqual(planTeamForfeit(matches, null), { toForfeit: [], toVacate: [] })
})

// ══════════════════════ noshowPredict.js ══════════════════════
test('noshowPredict: predictNoShow — 표본/비율 티어', () => {
  assert.equal(predictNoShow({ appearances: 1, noShows: 0 }).level, 'none') // 표본 부족
  assert.equal(predictNoShow({ appearances: 2, noShows: 2 }).level, 'high')  // 2회+비율 1.0
  assert.equal(predictNoShow({ appearances: 5, noShows: 1 }).level, 'medium') // 0.2
  assert.equal(predictNoShow({ appearances: 10, noShows: 1 }).level, 'low')   // 0.1
})

test('noshowPredict: buildNoShowIndex — 대회 단위 집계·중복 방지', () => {
  const historyEntries = [
    { id: 'e1', player1_id: 'p1' },
    { id: 'e2', player1_id: 'p2' },
  ]
  const matches = [
    // 같은 대회에서 p1이 2경기 부전 → 1회로 집계돼야 함
    { team1_entry_id: 'e1', team2_entry_id: 'e2', result_type: 'walkover', forfeit_team: 1, status: 'forfeited', tournament_id: 't1' },
    { team1_entry_id: 'e1', team2_entry_id: 'e2', result_type: 'walkover', forfeit_team: 1, status: 'forfeited', tournament_id: 't1' },
  ]
  const idx = buildNoShowIndex({ historyEntries, matches })
  assert.deepEqual(idx.get('p1'), { appearances: 1, noShows: 1 })
  assert.deepEqual(idx.get('p2'), { appearances: 1, noShows: 0 })
})

test('noshowPredict: entryNoShowRisk / recommendWaitlist / worseNoShow', () => {
  const idx = new Map([['p1', { appearances: 3, noShows: 3 }]])
  const risk = entryNoShowRisk({ player1: { id: 'p1', name: 'A' } }, idx)
  assert.equal(risk.level, 'high')

  const rec = recommendWaitlist([{ id: 'e1', entry_status: 'applied', player1: { id: 'p1' } }], idx)
  assert.ok(rec.waitlist >= 1)
  assert.ok(rec.headline)

  assert.equal(worseNoShow('low', 'high'), 'high')
  assert.equal(worseNoShow('medium', 'none'), 'medium')
})

// ══════════════════════ checkin.js ══════════════════════
test('checkin: getCheckinWindow — 상태·날짜 기반 창', () => {
  assert.equal(getCheckinWindow(null).canCheckin, false)
  assert.equal(getCheckinWindow({ status: 'in_progress' }).canCheckin, true)
  assert.equal(getCheckinWindow({ status: 'completed' }).phase, 'ended')
  assert.equal(getCheckinWindow({ status: 'open', date: '2026-07-11' }, NOW).canCheckin, true)  // 당일
  assert.equal(getCheckinWindow({ status: 'open', date: '2026-07-20' }, NOW).phase, 'before')    // 미래
  assert.equal(getCheckinWindow({ status: 'open', date: '2026-07-01' }, NOW).phase, 'ended')     // 경과
})

test('checkin: assessSelfCheckin — 실명인증 여부', () => {
  assert.equal(assessSelfCheckin({ identity_verified: true }).needsReview, false)
  assert.equal(assessSelfCheckin({ identity_verified: false }).needsReview, true)
  assert.equal(assessSelfCheckin(null).needsReview, true)
})

test('checkin: assessNoShowResolution — 한쪽만 미체크인이면 확정 가능', () => {
  const match = { team1: { player1: { id: 'a' } }, team2: { player1: { id: 'b' } } }
  const r1 = assessNoShowResolution(match, ['b']) // 팀1 미체크인, 팀2 체크인
  assert.equal(r1.resolvable, true)
  assert.equal(r1.absentTeam, 1)
  assert.equal(r1.winnerTeam, 2)

  assert.equal(assessNoShowResolution(match, ['a', 'b']).resolvable, false) // 둘 다 체크인
  assert.equal(assessNoShowResolution(match, []).resolvable, false)          // 더블 노쇼
  assert.equal(assessNoShowResolution(null, []).resolvable, false)
})

test('checkin: summarizeCheckins — done/self/reviewNeeded', () => {
  const players = [{ id: 'a', identity_verified: false }, { id: 'b', identity_verified: true }, { id: 'c' }]
  const checkins = [
    { player_id: 'a', verified_method: 'self' },
    { player_id: 'b', verified_method: 'auto' },
  ]
  const s = summarizeCheckins(players, checkins)
  assert.equal(s.total, 3)
  assert.equal(s.done, 2)
  assert.equal(s.self, 1)
  assert.equal(s.reviewNeeded, 1) // a: self + 미인증
})

// ══════════════════════ sandbag.js ══════════════════════
test('sandbag: assessSandbag — gap 0 정상 / 고MMR 의심', () => {
  assert.equal(assessSandbag(null).level, 'none')
  const clean = { mmr: 1200, mmr_games_played: 10, official_grade: getGradeFromMMR(1200) }
  assert.equal(assessSandbag(clean).level, 'none')
  const ringer = { mmr: 3200, mmr_games_played: 10, official_grade: getGradeFromMMR(1000) }
  assert.equal(assessSandbag(ringer).level, 'high')
  assert.equal(worseLevel('none', 'high'), 'high')
  assert.equal(worseLevel('watch', 'none'), 'watch')
})

test('sandbag: 표본 부족 시 high→watch 완화', () => {
  const ringerFewGames = { mmr: 3200, mmr_games_played: 2, official_grade: getGradeFromMMR(1000) }
  assert.equal(assessSandbag(ringerFewGames).level, 'watch')
})

// ══════════════════════ reliability.js ══════════════════════
test('reliability: 티어 경계와 isRanked', () => {
  assert.equal(reliabilityTier(80).key, 'high')
  assert.equal(reliabilityTier(50).key, 'medium')
  assert.equal(reliabilityTier(10).key, 'low')
  assert.equal(isRanked(5, 30), true)
  assert.equal(isRanked(3, 90), false) // 경기 수 부족
  assert.equal(isRanked(5, 10), false) // 신뢰도 부족
})

test('reliability: calcReliability — 빈 데이터 0 / 만점 케이스', () => {
  assert.equal(calcReliability({ gamesPlayed: 0 }).score, 0)
  const history = Array.from({ length: 10 }, (_, i) => ({
    created_at: new Date(NOW - i * 86400000).toISOString(),
    cert_level: 'A',
    tournament_id: `t${i % 5}`, // 5개 대회 → diversity 만점
  }))
  const r = calcReliability({ gamesPlayed: 10, history, now: NOW })
  assert.equal(r.score, 100)
  assert.equal(r.tier.key, 'high')
})

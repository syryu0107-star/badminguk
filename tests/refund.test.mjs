// ── C3 환불 규정 엔진 회귀 테스트 (refund.js) ──────────────────────────
// 취소 시점 → 환불액 계산이 무인 정산·선수 안내·챗봇 개인화의 단일 소스라,
// 여기 불변식이 깨지면 주최자가 잘못된 금액을 환불하거나 선수가 잘못 안내받는다.
import { test, assert } from './_harness.mjs'
import {
  DEFAULT_REFUND_POLICY, computeRefund, pickTier, isBeforeDeadline,
  daysUntil, refundLineText, policyLines,
} from '../src/lib/refund.js'

// 기준 시각 고정(로컬 자정 밀림 회피 위해 정오)
const NOW = new Date(2026, 6, 12, 12, 0, 0) // 2026-07-12 (로컬)
function dPlus(n) { // 대회일을 오늘+n 일로
  const d = new Date(2026, 6, 12 + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

test('refund: daysUntil — 미래/오늘/과거·파싱불가', () => {
  assert.equal(daysUntil(dPlus(1), NOW), 1)
  assert.equal(daysUntil(dPlus(0), NOW), 0)
  assert.equal(daysUntil(dPlus(-3), NOW), -3)
  assert.equal(daysUntil('2026-07-20T09:00:00', NOW), 8) // 앞 10자만
  assert.equal(daysUntil(null, NOW), null)
  assert.equal(daysUntil('언젠가', NOW), null)
})

test('refund: isBeforeDeadline — 마감 전/후·정보없음', () => {
  assert.equal(isBeforeDeadline('2026-07-20T09:00:00', NOW), true)
  assert.equal(isBeforeDeadline('2026-07-01T09:00:00', NOW), false)
  assert.equal(isBeforeDeadline(null, NOW), false)
  assert.equal(isBeforeDeadline('망가진값', NOW), false)
})

test('refund: pickTier — 남은 일수별 tier', () => {
  assert.equal(pickTier(10).key, 'd7')
  assert.equal(pickTier(7).key, 'd7')
  assert.equal(pickTier(6).key, 'd3')
  assert.equal(pickTier(3).key, 'd3')
  assert.equal(pickTier(2).key, 'd1')
  assert.equal(pickTier(1).key, 'd1')
  assert.equal(pickTier(0).key, 'dday')
  assert.equal(pickTier(-5).key, 'dday')
})

test('refund: 미적용 — 미입금·무료·이미환불', () => {
  const noPay = computeRefund({ fee: 30000, tournamentDate: dPlus(10), paymentStatus: 'pending', now: NOW })
  assert.equal(noPay.applicable, false)
  assert.equal(noPay.amount, 0)

  const free = computeRefund({ fee: 0, tournamentDate: dPlus(10), paymentStatus: 'confirmed', now: NOW })
  assert.equal(free.applicable, false)
  assert.equal(free.deducted, 0)

  const done = computeRefund({ fee: 30000, tournamentDate: dPlus(10), paymentStatus: 'refunded', now: NOW })
  assert.equal(done.applicable, false)
  assert.match(done.reason, /이미 환불/)
})

test('refund: 접수 마감 전 → 전액(시점 무관)', () => {
  // 대회는 당일(0일 전)이지만 접수 마감이 아직 미래 → 전액
  const r = computeRefund({
    fee: 30000, tournamentDate: dPlus(0), registrationEnd: '2026-07-20T09:00:00',
    paymentStatus: 'confirmed', now: NOW,
  })
  assert.equal(r.applicable, true)
  assert.equal(r.beforeDeadline, true)
  assert.equal(r.rate, 1)
  assert.equal(r.amount, 30000)
  assert.equal(r.deducted, 0)
  assert.equal(r.requiresReview, false)
})

test('refund: 마감 후 시점별 환불율·위약금', () => {
  const cfg = { fee: 30000, paymentStatus: 'confirmed', now: NOW } // 마감 정보 없음 → 마감 후 규정
  const d10 = computeRefund({ ...cfg, tournamentDate: dPlus(10) })
  assert.equal(d10.rate, 1); assert.equal(d10.amount, 30000); assert.equal(d10.tier, 'd7')

  const d5 = computeRefund({ ...cfg, tournamentDate: dPlus(5) })
  assert.equal(d5.rate, 0.5); assert.equal(d5.amount, 15000); assert.equal(d5.deducted, 15000)

  const d2 = computeRefund({ ...cfg, tournamentDate: dPlus(2) })
  assert.equal(d2.rate, 0.3); assert.equal(d2.amount, 9000); assert.equal(d2.deducted, 21000)
})

test('refund: 대회 당일·이후 → 0%·사람 확인', () => {
  const dday = computeRefund({ fee: 30000, tournamentDate: dPlus(0), paymentStatus: 'confirmed', now: NOW })
  assert.equal(dday.rate, 0)
  assert.equal(dday.amount, 0)
  assert.equal(dday.requiresReview, true) // 노쇼/지각/응급 경계
  assert.equal(dday.tier, 'dday')

  const past = computeRefund({ fee: 30000, tournamentDate: dPlus(-2), paymentStatus: 'confirmed', now: NOW })
  assert.equal(past.amount, 0)
  assert.equal(past.requiresReview, true)
})

test('refund: 대회 날짜 미정 → 사람 확인', () => {
  const r = computeRefund({ fee: 30000, paymentStatus: 'confirmed', now: NOW })
  assert.equal(r.applicable, true)
  assert.equal(r.amount, null)
  assert.equal(r.requiresReview, true)
  assert.equal(r.tier, 'unknown')
})

test('refund: 홀수 참가비 floor(과다 환불 방지)', () => {
  const r = computeRefund({ fee: 15000, tournamentDate: dPlus(5), paymentStatus: 'confirmed', now: NOW })
  assert.equal(r.rate, 0.5)
  assert.equal(r.amount, 7500)  // 15000*0.5

  const odd = computeRefund({ fee: 10001, tournamentDate: dPlus(2), paymentStatus: 'confirmed', now: NOW })
  assert.equal(odd.amount, Math.floor(10001 * 0.3)) // 3000 (floor)
  assert.ok(odd.amount + odd.deducted === 10001)     // 합은 원금 보존
})

test('refund: refundLineText·policyLines 표기', () => {
  const r = computeRefund({ fee: 30000, tournamentDate: dPlus(5), paymentStatus: 'confirmed', now: NOW })
  const line = refundLineText(r)
  assert.match(line, /₩15,000/)
  assert.match(line, /50%/)

  const lines = policyLines()
  assert.equal(lines.length, DEFAULT_REFUND_POLICY.tiers.length + 1) // 마감전 + tiers
  assert.match(lines[0], /접수 마감 전/)
  assert.ok(lines.some(l => /100%/.test(l)))
  assert.ok(lines.some(l => /50%/.test(l)))
})

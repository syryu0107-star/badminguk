// refund.js — C3 환불 규정 코드화 (순수 함수, DB/외부 키 의존 없음)
// ──────────────────────────────────────────────────────────────────────
// 목적: 지금껏 "환불 경계 판단은 사람이 확인하는 예외"로 통째로 사람 손에 있던
//   참가비 환불을, 취소 시점(대회일까지 남은 일수·접수 마감 전후)에 따른 규정으로
//   코드화한다. 앱이 "지금 취소하면 ₩얼마 환불(대회 N일 전·N% 규정)"을 스스로
//   계산해 주최자는 금액을 직접 판단하지 않고 송금·확정만 하면 되고, 선수는
//   취소 전에 환불액을 미리 안다.
//
// 자동화 범위: 표준 시점 기반 환불액 "계산"은 규칙 기반으로 완결(무인). 실제 송금은
//   무통장 계좌이체라 본질적으로 사람이 보내며(human-gated), 대회 당일·이후 취소
//   (노쇼·지각·응급 경계)만 requiresReview 로 사람 확인을 남긴다(북극성의 예외 큐).
//
// 스키마·외부 키 불필요 — 기존 tournaments(date·registration_end)·category(entry_fee)·
//   entry(payment_status) 만 읽는다. PG 카드 결제/자동 역결제는 human-gated 로 남는다.

import { formatWon } from './deposit'

// 기본 환불 규정(주최자가 요강으로 조정 가능하도록 정책을 데이터로 분리).
// beforeDeadlineRate: 접수 마감 전 취소는 대회 준비 손실이 없어 전액.
// tiers: 접수 마감 후 — 대회일까지 남은 일수(daysBefore)별 환불율(minDaysBefore 내림차순).
export const DEFAULT_REFUND_POLICY = Object.freeze({
  beforeDeadlineRate: 1.0,
  tiers: Object.freeze([
    { key: 'd7',   minDaysBefore: 7,         rate: 1.0, label: '대회 7일 전까지' },
    { key: 'd3',   minDaysBefore: 3,         rate: 0.5, label: '대회 3~6일 전' },
    { key: 'd1',   minDaysBefore: 1,         rate: 0.3, label: '대회 1~2일 전' },
    { key: 'dday', minDaysBefore: -Infinity, rate: 0.0, label: '대회 당일·이후' },
  ]),
})

// 대회일 - 오늘(둘 다 로컬 자정 기준)의 일수 차. 1=내일(=대회 1일 전), 0=당일, -1=어제.
// 파싱 불가하면 null. (campaign.dayDiff 와 동일 규약 — notify 체인 임포트를 피하려 자체 구현)
export function daysUntil(dateStr, now = new Date()) {
  if (!dateStr) return null
  const m = String(dateStr).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((target - today) / 86400000)
}

// 접수 마감 전인가(마감 datetime 기준). 마감 정보 없으면 false(마감 후 규정 적용).
export function isBeforeDeadline(registrationEnd, now = new Date()) {
  if (!registrationEnd) return false
  const t = new Date(registrationEnd)
  if (isNaN(t.getTime())) return false
  return now.getTime() < t.getTime()
}

// daysBefore 에 맞는 tier 선택(minDaysBefore 이상 첫 항목). 마지막 tier 는 -Infinity 라 항상 매칭.
export function pickTier(daysBefore, policy = DEFAULT_REFUND_POLICY) {
  const tiers = policy?.tiers ?? DEFAULT_REFUND_POLICY.tiers
  for (const t of tiers) {
    if (daysBefore >= t.minDaysBefore) return t
  }
  return tiers[tiers.length - 1]
}

/**
 * 취소 시점 기반 환불액 계산.
 * @param {{fee?:number, tournamentDate?:string, registrationEnd?:string,
 *          paymentStatus?:string, now?:Date}} input
 * @returns {{applicable:boolean, fee:number, rate:number|null, amount:number|null,
 *            deducted:number|null, tier:string|null, tierLabel:string,
 *            daysBefore:number|null, beforeDeadline:boolean, requiresReview:boolean,
 *            reason:string}}
 */
export function computeRefund(input = {}, policy = DEFAULT_REFUND_POLICY) {
  const {
    fee = 0,
    tournamentDate = null,
    registrationEnd = null,
    paymentStatus = 'pending',
    now = new Date(),
  } = input || {}

  const feeNum = Math.max(0, Math.round(Number(fee) || 0))
  const base = {
    applicable: false, fee: feeNum, rate: 0, amount: 0, deducted: feeNum,
    tier: null, tierLabel: '', daysBefore: null, beforeDeadline: false,
    requiresReview: false, reason: '',
  }

  if (paymentStatus === 'refunded') return { ...base, deducted: 0, reason: '이미 환불 처리됐어요.' }
  if (feeNum <= 0) return { ...base, deducted: 0, reason: '참가비가 없는 신청이에요.' }
  if (paymentStatus !== 'confirmed') return { ...base, reason: '입금이 확인되지 않아 환불할 참가비가 없어요.' }

  const beforeDeadline = isBeforeDeadline(registrationEnd, now)
  const daysBefore = daysUntil(tournamentDate, now)

  // 접수 마감 전이면 시점 무관 전액.
  if (beforeDeadline) {
    const rate = clamp01(policy?.beforeDeadlineRate ?? 1.0)
    const amount = Math.floor(feeNum * rate)
    return {
      applicable: true, fee: feeNum, rate, amount, deducted: feeNum - amount,
      tier: 'before_deadline', tierLabel: '접수 마감 전', daysBefore,
      beforeDeadline: true, requiresReview: false,
      reason: rate >= 1 ? '접수 마감 전이라 전액 환불돼요.' : `접수 마감 전 규정 ${pct(rate)} 환불이에요.`,
    }
  }

  // 대회 날짜가 없으면 규정 자동 계산이 불가 → 사람 확인.
  if (daysBefore == null) {
    return {
      applicable: true, fee: feeNum, rate: null, amount: null, deducted: null,
      tier: 'unknown', tierLabel: '대회 날짜 미정', daysBefore: null,
      beforeDeadline: false, requiresReview: true,
      reason: '대회 날짜가 정해지지 않아 환불 규정 자동 계산이 어려워요 — 직접 확인해 주세요.',
    }
  }

  const tier = pickTier(daysBefore, policy)
  const rate = clamp01(tier.rate)
  const amount = Math.floor(feeNum * rate)
  // 대회 당일·이후 취소는 노쇼/지각/응급 경계라 사람 확인(북극성 예외 큐).
  const requiresReview = daysBefore <= 0

  return {
    applicable: true, fee: feeNum, rate, amount, deducted: feeNum - amount,
    tier: tier.key, tierLabel: tier.label, daysBefore, beforeDeadline: false,
    requiresReview,
    reason: buildReason(tier, rate, daysBefore),
  }
}

function clamp01(x) {
  const v = Number(x)
  if (!Number.isFinite(v)) return 0
  return Math.min(1, Math.max(0, v))
}

function pct(rate) {
  return `${Math.round(rate * 100)}%`
}

function buildReason(tier, rate, daysBefore) {
  if (rate <= 0) return '대회 당일·이후 취소라 규정상 환불이 없어요 (노쇼·지각·응급은 주최자가 확인).'
  const when = daysBefore >= 7 ? '대회 7일 이상 전' : tier.label
  if (rate >= 1) return `${when} 취소라 전액 환불돼요.`
  return `${when} 취소라 규정상 ${pct(rate)}(위약금 ${pct(1 - rate)}) 환불이에요.`
}

// 선수·챗봇용 한 줄 요약("₩15,000 환불 예정 · 대회 3~6일 전 · 50%").
export function refundLineText(r) {
  if (!r || !r.applicable) return r?.reason || ''
  if (r.amount == null) return r.reason
  const rateStr = r.rate != null ? ` · ${pct(r.rate)}` : ''
  return `${formatWon(r.amount)} 환불 예정 · ${r.tierLabel}${rateStr}`
}

// 규정 자체를 사람이 읽을 수 있는 목록으로(안내·챗봇 공용).
export function policyLines(policy = DEFAULT_REFUND_POLICY) {
  const lines = [`• 접수 마감 전 취소: ${pct(clamp01(policy?.beforeDeadlineRate ?? 1))} 환불`]
  const tiers = policy?.tiers ?? DEFAULT_REFUND_POLICY.tiers
  for (const t of tiers) {
    lines.push(`• ${t.label}: ${pct(clamp01(t.rate))} 환불`)
  }
  return lines
}

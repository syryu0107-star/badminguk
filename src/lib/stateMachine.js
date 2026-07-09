// 대회 상태 오케스트레이션 (C2) — 자동 마감·시작·승인 판정
// ──────────────────────────────────────────────────────────────────────
// 목적: 주최자가 손으로 눌러야 했던 "접수 마감 / 대회 시작 / 참가 승인"을
//       조건이 충족되면 앱이 스스로 판정하게 한다. 사람은 예외(샌드배깅 의심·
//       입금 미확인)만 확인한다.
//
// 이 파일은 순수 함수만 담는다 — DB 읽기/쓰기·실제 상태 변경은 호출부
// (TournamentManage·EntryManagement)가 한다. orchestrator.js(코트 진행)와
// 역할이 다르다: orchestrator 는 경기장 안(코트/호출)을, stateMachine 은
// 대회 전체의 라이프사이클(접수→마감→진행→종료)을 다룬다.

import { assessSandbag, worseLevel } from './sandbag.js'

export const STATUS_FLOW = ['draft', 'open', 'closed', 'in_progress', 'completed']

const DONE = ['completed', 'forfeited', 'bye']

// 안전하게 시각(ms)으로 — 파싱 실패 시 null
function ts(v) {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * 지금 대회 상태가 어떻게 바뀌어야 하는지 판정한다.
 *
 * @param {object}   tournament   { status, registration_end, date }
 * @param {object[]} categories   [{ id, max_teams }]
 * @param {object}   counts       { [categoryId]: 승인팀수 }
 * @param {object[]} matches      [{ status }] (대진표 존재/완료 판정용, 없으면 [])
 * @param {number}   now          기준 시각(ms)
 * @returns {{
 *   current: string, recommended: string, changed: boolean,
 *   auto: boolean,            // 무인 자동 전환 안전 여부
 *   trigger: string|null,     // 'deadline'|'capacity'|'start'|'finish'
 *   reason: string|null,      // 사람이 읽는 설명
 *   blockReason: string|null, // 전환이 막힌 이유(있으면)
 * }}
 */
export function planTournamentState({
  tournament,
  categories = [],
  counts = {},
  matches = [],
  now = Date.now(),
} = {}) {
  const current = tournament?.status ?? null
  const out = {
    current,
    recommended: current,
    changed: false,
    auto: false,
    trigger: null,
    reason: null,
    blockReason: null,
  }
  if (!current) return out

  const set = (recommended, { auto = false, trigger = null, reason = null }) => {
    out.recommended = recommended
    out.changed = recommended !== current
    out.auto = auto
    out.trigger = trigger
    out.reason = reason
  }

  if (current === 'open') {
    // 접수 마감 조건 ① 마감 시각 경과 ② 전 종목 정원 충족
    const deadline = ts(tournament?.registration_end)
    const deadlinePassed = deadline != null && now >= deadline

    const withCap = categories.filter(c => (Number(c.max_teams) || 0) > 0)
    const allFull =
      withCap.length > 0 &&
      withCap.length === categories.length &&
      withCap.every(c => (counts[c.id] || 0) >= (Number(c.max_teams) || 0))

    if (deadlinePassed) {
      set('closed', { auto: true, trigger: 'deadline', reason: '접수 마감 시각이 지났어요' })
    } else if (allFull) {
      set('closed', { auto: true, trigger: 'capacity', reason: '모든 종목 정원이 찼어요' })
    }
  } else if (current === 'closed') {
    // 대회 시작 조건: 대회 당일 도래 + 대진표 존재
    const start = tournament?.date ? ts(`${tournament.date}T00:00:00`) : null
    const dayArrived = start != null && now >= start
    const hasBracket = (matches?.length ?? 0) > 0

    if (dayArrived && hasBracket) {
      set('in_progress', { auto: true, trigger: 'start', reason: '대회 당일이고 대진표가 준비됐어요' })
    } else if (dayArrived && !hasBracket) {
      out.blockReason = '대회 당일이지만 대진표가 아직 없어요 — 대진표를 먼저 생성하세요'
    }
  } else if (current === 'in_progress') {
    // 종료 조건: 부전승/부전 제외한 실경기가 모두 완료
    const real = (matches ?? []).filter(m => m.status !== 'bye')
    const allDone = real.length > 0 && real.every(m => DONE.includes(m.status))
    if (allDone) {
      // 종료(시상 확정)는 MMR·급수 반영이 걸려 있어 무인 자동 전환은 하지 않고
      // "한 번의 확인" 대상으로만 추천한다.
      set('completed', { auto: false, trigger: 'finish', reason: '모든 경기가 끝났어요 — 시상을 확정하세요' })
    }
  }

  return out
}

/**
 * 참가 신청을 자동 승인 가능 / 검토 필요 / 입금 대기 / 파트너 대기로 분류.
 *
 * "사람은 예외만" 원칙: 의심 없는 정상 신청은 앱이 자동 승인하고, 샌드배깅
 * 의심·입금 미확인·팀 미확정만 사람에게 남긴다.
 *
 * @param {object[]} entries    tournament_entries + player1/player2 join
 * @param {object}   catById    { [categoryId]: category } (grade_max·max_mmr·entry_fee·max_teams)
 * @param {object}   opts.counts { [categoryId]: 현재 승인팀수 } (정원 초과 방지)
 * @returns {{ auto, review, payment, capacity }} 각각 entry 배열
 */
export function planAutoApprovals(entries, catById = {}, { counts = {} } = {}) {
  const auto = []
  const review = []
  const payment = []
  const capacity = []

  // 정원 잔여를 로컬로 소진하며 판정 (한 번에 여러 건 승인 시 초과 방지)
  const room = {}
  for (const [cid, cat] of Object.entries(catById)) {
    const max = Number(cat?.max_teams) || 0
    room[cid] = max > 0 ? Math.max(0, max - (counts[cid] || 0)) : Infinity
  }

  for (const e of entries ?? []) {
    // partner_pending/partner_rejected 등은 'applied' 가 아니라 자연히 제외된다
    if (e.entry_status !== 'applied') continue

    const cat = catById[e.category_id] ?? null

    // 샌드배깅 의심 → 사람 검토
    const a1 = assessSandbag(e.player1, cat)
    const a2 = e.player2 ? assessSandbag(e.player2, cat) : { level: 'none' }
    if (worseLevel(a1.level, a2.level) !== 'none') { review.push(e); continue }

    // 참가비 있는데 입금 미확인 → 입금 대기
    const fee = Number(cat?.entry_fee) || 0
    if (fee > 0 && e.payment_status !== 'confirmed') { payment.push(e); continue }

    // 정원 초과 → 대기
    if ((room[e.category_id] ?? Infinity) <= 0) { capacity.push(e); continue }
    if (room[e.category_id] !== Infinity) room[e.category_id] -= 1

    auto.push(e)
  }

  return { auto, review, payment, capacity }
}

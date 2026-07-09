// 무인 진행 오케스트레이터 (C6 · C1) — 빈 코트 자동 투입 + 예상 호출 시각
// ──────────────────────────────────────────────────────────────────────
// 목적: 사람이 매 경기 "호출" 버튼을 누르지 않아도, 코트가 비면 다음 경기가
//       자동으로 호출되고, 그 다음 팀에게는 "곧 호출" 사전 알림이 나가게 한다.
//
// 이 파일은 순수 함수만 담는다 — 실제 발송(notify.js)·DB 접근·상태 변경은
// 호출부(LiveDashboard)가 담당한다. 그래야 테스트·재사용이 쉽고 엔진이 겹치지 않는다.
// scheduler.js(코트·시간 배정)와 역할이 다르다: scheduler 는 "언제/어디서" 를 미리
// 계산하고, orchestrator 는 실시간 코트 상태를 보고 "지금 누구를 부를지" 를 정한다.

export const DONE_STATUSES = ['completed', 'forfeited', 'bye']

// 자동 호출 가능한 경기인가 — 예정 상태 + 양팀 확정 + 코트 배정됨.
export function isCallable(m) {
  return m.status === 'scheduled'
    && !!m.team1_entry_id && !!m.team2_entry_id
    && m.court_number != null
}

// 예정 경기 정렬: 예정시각 → 라운드 → 경기번호 (null 은 맨 뒤)
function cmp(a, b) {
  const ta = a.scheduled_time ? new Date(a.scheduled_time).getTime() : Infinity
  const tb = b.scheduled_time ? new Date(b.scheduled_time).getTime() : Infinity
  if (ta !== tb) return ta - tb
  const ra = a.round_number ?? Infinity, rb = b.round_number ?? Infinity
  if (ra !== rb) return ra - rb
  return (a.match_number ?? Infinity) - (b.match_number ?? Infinity)
}

// 코트별 큐: { [court]: { court, running, queue: [예정 경기...] } }
export function buildCourtQueues(matches) {
  const byCourt = {}
  for (const m of matches ?? []) {
    const c = m.court_number
    if (c == null) continue
    if (!byCourt[c]) byCourt[c] = { court: c, running: null, queue: [] }
    if (m.status === 'in_progress') byCourt[c].running = m
    else if (isCallable(m)) byCourt[c].queue.push(m)
  }
  Object.values(byCourt).forEach(q => q.queue.sort(cmp))
  return byCourt
}

// 자동 진행 계획 — "지금 호출할 경기 / 곧 호출 예고할 경기 / 예상 호출 시각".
//   busyCourts : 다른 종목이 쓰는 중이라 비어있지 않은 코트 번호 Set (중복 투입 방지)
//   calledAt   : { [matchId]: ts } 이미 호출한 경기 (중복 호출 방지)
//   soonSentAt : { [matchId]: ts } 이미 사전알림 보낸 경기 (중복 예고 방지)
//   matchMinutes : 경기당 평균 소요(분) — 코트 회전 예측용
//   now        : 기준 시각(ms)
export function planAutoAdvance(matches, {
  busyCourts = new Set(),
  calledAt = {},
  soonSentAt = {},
  matchMinutes = 30,
  now = Date.now(),
} = {}) {
  const queues = buildCourtQueues(matches)
  const toCall = []      // 지금 자동 호출 (빈 코트의 맨 앞)
  const toSoon = []      // 사전 알림 (진행중 코트의 맨 앞 / 빈 코트의 두 번째)
  const estimates = {}   // matchId → { at(ms), ahead }
  const step = Math.max(1, matchMinutes) * 60000

  for (const q of Object.values(queues)) {
    const courtBusy = q.running != null || busyCourts.has(q.court)

    // 이 코트가 다시 비는 예상 시각 (진행 중이면 시작+평균, 아니면 지금)
    let freeAt = now
    if (q.running) {
      const start = q.running.actual_start ? new Date(q.running.actual_start).getTime() : now
      freeAt = Math.max(now, start + step)
    }

    q.queue.forEach((m, idx) => {
      // 예상 시작 = 코트가 비는 시각 + 앞선 대기 경기 수 × 평균
      const base = courtBusy ? freeAt : now
      const ahead = idx + (courtBusy ? 1 : 0)  // 진행 중 경기도 앞선 것으로 셈
      estimates[m.id] = { at: base + idx * step, ahead }

      if (!courtBusy && idx === 0) {
        // 빈 코트 맨 앞 → 지금 호출 (아직 안 불렀으면)
        if (!calledAt[m.id]) toCall.push(m)
      } else {
        // 곧 호출될 팀(진행중 코트의 맨 앞 or 빈 코트 두 번째) → 사전 알림 1회
        const isNextUp = (courtBusy && idx === 0) || (!courtBusy && idx === 1)
        if (isNextUp && !soonSentAt[m.id] && !calledAt[m.id]) toSoon.push(m)
      }
    })
  }
  return { toCall, toSoon, estimates, queues }
}

// 노쇼(호출 미응답) 타이머 (C7) — 호출됐지만 시작 안 된 경기의 경과 시간으로 단계 산출.
// ──────────────────────────────────────────────────────────────────────
// 호출(callMatch) 이후에도 선수가 코트로 오지 않으면 대회가 멈춘다. 이 함수가
// "호출 후 얼마나 지났는지"만 순수하게 계산해 3단계로 나눈다:
//   waiting  — 아직 유예 시간 안 (기다리는 중)
//   warned   — warnAfterSec 경과 → 선수에게 "곧 부전승" 경고 1회 발송 대상(toWarn)
//   overdue  — forfeitAfterSec 경과 → 부전승 처리 대상(overdue), 사람이 최종 확인
// 실제 발송·부전승 처리·DB 변경은 호출부(LiveDashboard)가 담당한다(순수 함수 유지).
//   calledAt   : { [matchId]: ts } 호출 시각 (재호출 시 갱신됨)
//   warnedAt   : { [matchId]: ts } 이미 경고 보낸 경기 (중복 경고 방지)
//   warnAfterSec / forfeitAfterSec : 유예 임계 (기본 2분 / 5분)
//   now        : 기준 시각(ms)
export function planNoShow(matches, {
  calledAt = {},
  warnedAt = {},
  warnAfterSec = 120,
  forfeitAfterSec = 300,
  now = Date.now(),
} = {}) {
  const toWarn = []      // 지금 "곧 부전승" 경고 보낼 경기
  const overdue = []     // 부전승 처리 대상 (사람 최종 확인)
  const status = {}      // matchId → { phase, calledAt, warnAt, deadlineAt, secondsLeft, elapsedSec }
  for (const m of matches ?? []) {
    if (m.status !== 'scheduled') continue     // 시작·완료된 경기는 노쇼 대상 아님
    const c = calledAt[m.id]
    if (!c) continue                            // 호출 안 된 경기는 노쇼 판정 없음
    const warnAt = c + warnAfterSec * 1000
    const deadlineAt = c + forfeitAfterSec * 1000
    let phase = 'waiting'
    if (now >= deadlineAt) phase = 'overdue'
    else if (now >= warnAt) phase = 'warned'
    status[m.id] = {
      phase,
      calledAt: c,
      warnAt,
      deadlineAt,
      secondsLeft: Math.max(0, Math.round((deadlineAt - now) / 1000)),
      elapsedSec: Math.max(0, Math.round((now - c) / 1000)),
    }
    if (phase === 'overdue') overdue.push(m)
    else if (phase === 'warned' && !warnedAt[m.id]) toWarn.push(m)
  }
  return { toWarn, overdue, status }
}

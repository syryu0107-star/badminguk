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

// 노쇼(호출 미응답) 타이머 (C7·C1) — 호출됐지만 시작 안 된 경기의 경과 시간으로 단계 산출.
// ──────────────────────────────────────────────────────────────────────
// 호출(callMatch) 이후에도 선수가 코트로 오지 않으면 대회가 멈춘다. 이 함수가
// "호출 후 얼마나 지났는지"만 순수하게 계산해 3단계로 나눈다:
//   waiting  — 아직 유예 시간 안 (기다리는 중) → 이 구간에서 무응답이면 부드러운 재알림(toRecall)
//   warned   — warnAfterSec 경과 → 선수에게 "곧 부전승" 경고 1회 발송 대상(toWarn)
//   overdue  — forfeitAfterSec 경과 → 부전승 처리 대상(overdue), 사람이 최종 확인
// 실제 발송·부전승 처리·DB 변경은 호출부(LiveDashboard)가 담당한다(순수 함수 유지).
//   calledAt   : { [matchId]: ts } 호출 시각 (재호출 시 갱신됨)
//   warnedAt   : { [matchId]: ts } 이미 경고 보낸 경기 (중복 경고 방지)
//   recalledAt : { [matchId]: { at, count } } 이미 보낸 재알림 (중복·스팸 방지)
//   ackedAt    : { [matchId]: ts } 선수가 호출을 확인한("가고 있어요") 시각 (C1)
//   warnAfterSec / forfeitAfterSec : 유예 임계 (기본 2분 / 5분)
//   ackGraceSec     : 선수가 호출을 확인하면 더 주는 유예(기본 2분) — 오는 중인데 부전승 방지
//   recallAfterSec  : 첫 재알림까지의 무응답 대기 (기본 45초)
//   recallEverySec  : 이후 재알림 간격 (기본 45초)
//   recallMaxCount  : 경고 전까지 최대 재알림 횟수 (기본 2회 — 스팸 방지)
//   now        : 기준 시각(ms)
//
// C1 재알림: 호출은 인앱 실시간 방송이라 그 순간 앱을 안 보고 있던 선수는 놓친다.
// warned(곧 부전승)로 넘어가기 전 waiting 구간에서 몇 번 더 부드럽게 호출을 반복해,
// 화면을 잠깐 껐다 켠 선수도 "지금 몇 번 코트" 를 다시 받게 한다(무인 진행 시 자동).
//
// C1 호출 확인(ack): 호출은 지금껏 한 방향(주최자→선수)이라, "오는 중인 선수" 와
// "정말 안 오는 선수" 를 구분할 수 없어 이동 중인 선수도 노쇼 타이머가 부전승으로
// 밀어붙였다. 선수가 "가고 있어요" 를 누르면(ackedAt) 이 경기는 (1)재알림을 멈추고
// (2)경고·부전승 임계를 ackGraceSec 만큼 뒤로 미뤄, 오는 중인 선수의 오탐 부전승을
// 막는다. 유예는 확인 1회당 고정량이라 무한 연장은 없다(그 뒤엔 정상 escalation 재개).
export function planNoShow(matches, {
  calledAt = {},
  warnedAt = {},
  recalledAt = {},
  ackedAt = {},
  warnAfterSec = 120,
  forfeitAfterSec = 300,
  ackGraceSec = 120,
  recallAfterSec = 45,
  recallEverySec = 45,
  recallMaxCount = 2,
  now = Date.now(),
} = {}) {
  const toWarn = []      // 지금 "곧 부전승" 경고 보낼 경기
  const toRecall = []    // 지금 부드러운 재알림(호출 반복) 보낼 경기
  const overdue = []     // 부전승 처리 대상 (사람 최종 확인)
  const status = {}      // matchId → { phase, calledAt, warnAt, deadlineAt, secondsLeft, elapsedSec, recallCount, acked }
  for (const m of matches ?? []) {
    if (m.status !== 'scheduled') continue     // 시작·완료된 경기는 노쇼 대상 아님
    const c = calledAt[m.id]
    if (!c) continue                            // 호출 안 된 경기는 노쇼 판정 없음
    // 이번 호출 이후에 들어온 확인만 인정(재호출 전의 낡은 확인은 무시).
    const ackTs = ackedAt[m.id]
    const acked = ackTs != null && ackTs >= c
    const graceMs = acked ? Math.max(0, ackGraceSec) * 1000 : 0
    const warnAt = c + warnAfterSec * 1000 + graceMs
    const deadlineAt = c + forfeitAfterSec * 1000 + graceMs
    let phase = 'waiting'
    if (now >= deadlineAt) phase = 'overdue'
    else if (now >= warnAt) phase = 'warned'
    const rc = recalledAt[m.id]
    const recallCount = rc?.count ?? 0
    status[m.id] = {
      phase,
      calledAt: c,
      warnAt,
      deadlineAt,
      secondsLeft: Math.max(0, Math.round((deadlineAt - now) / 1000)),
      elapsedSec: Math.max(0, Math.round((now - c) / 1000)),
      recallCount,
      acked,
    }
    if (phase === 'overdue') overdue.push(m)
    else if (phase === 'warned' && !warnedAt[m.id]) toWarn.push(m)
    // 선수가 확인했으면(오는 중) 재알림으로 더 조르지 않는다.
    else if (phase === 'waiting' && !acked && recallCount < recallMaxCount) {
      // 마지막 접점(원 호출 or 직전 재알림) 이후 충분히 지났으면 재알림.
      const lastAt = rc?.at ?? c
      const gap = (recallCount === 0 ? recallAfterSec : recallEverySec) * 1000
      if (now - lastAt >= gap) toRecall.push(m)
    }
  }
  return { toWarn, toRecall, overdue, status }
}

// 빈 코트 실제 재배치 (C6) — 유휴 코트로 과부하 코트의 대기 경기를 옮긴다.
// ──────────────────────────────────────────────────────────────────────
// planAutoAdvance 는 "각 코트가 자기 큐의 다음 경기를 호출"까지만 한다. 그래서
// 한 코트에 경기가 몰려 밀리는데 옆 코트가 텅 비어 있어도 대기 경기가 그 빈 코트로
// 넘어가지 못했다(analyzeDelay 는 그 상황을 '제안'만 하고 실행하지 않았다). 이 함수가
// 그 마지막 한 칸 — "비어 있는 코트로 대기 경기를 실제로 옮길 계획"을 순수하게 만든다.
// 실제 court_number UPDATE·발송·재조회는 호출부(LiveDashboard)가 담당한다(순수 함수 유지).
//
//   courtCount  : 대회 총 코트 수(1..N). null 이면 배정된 코트 번호만 사용.
//   busyCourts  : 다른 종목이 진행 중이라 비어있지 않은 코트 번호 Set (재배치 금지).
//   maxMoves    : 한 번에 옮길 최대 경기 수(과도한 흔들림 방지). null=제한 없음.
//
// 반환 { moves:[{ match, fromCourt, toCourt }], idleCourts, overloadedCourts }.
//   - 유휴 코트 = 진행 중 경기 없음 + 대기 경기 없음 + 다른 종목 미사용.
//   - 과부하 코트 = (진행 중 + 대기≥1) 또는 (대기≥2). 진행 중이면 큐 맨 앞부터,
//     아니면 두 번째부터 옮긴다(빈 코트가 아니라 '과부하'라 맨 앞은 곧 이 코트에서 시작).
//   - 옮길 경기의 팀이 지금 다른 코트에서 경기 중이면(중복 출전) 건너뛴다.
//   - court_number 만 바꾸면 planAutoAdvance 가 그 코트의 맨 앞으로 인식해 자동 호출한다.
export function planRebalance(matches, {
  courtCount = null,
  busyCourts = new Set(),
  maxMoves = null,
} = {}) {
  const list = matches ?? []
  const queues = buildCourtQueues(list)

  // 지금 경기 중인 팀(엔트리) — 이 팀 경기를 옮기면 같은 시간 두 코트 = 중복 출전.
  const playingEntries = new Set()
  list.filter(m => m.status === 'in_progress').forEach(m => {
    if (m.team1_entry_id) playingEntries.add(m.team1_entry_id)
    if (m.team2_entry_id) playingEntries.add(m.team2_entry_id)
  })

  // 대상 코트 번호 집합 = court_count 범위(있으면) ∪ 실제 배정된 코트.
  const courtSet = new Set()
  if (courtCount) for (let c = 1; c <= courtCount; c++) courtSet.add(c)
  list.forEach(m => { if (m.court_number != null) courtSet.add(m.court_number) })
  const courts = [...courtSet].sort((a, b) => a - b)

  // 유휴 코트: 진행 중 없음 + 대기 없음 + 다른 종목 미사용.
  const idleCourts = courts.filter(c => {
    if (busyCourts.has(c)) return false
    const q = queues[c]
    if (!q) return true // 아무 경기도 배정 안 된 코트 = 완전 유휴
    return !q.running && q.queue.length === 0
  })

  // 과부하 코트: 대기가 쌓인 코트 (부하 큰 순).
  const overloaded = Object.values(queues)
    .filter(q => (q.running && q.queue.length >= 1) || (!q.running && q.queue.length >= 2))
    .sort((a, b) => (b.queue.length + (b.running ? 1 : 0)) - (a.queue.length + (a.running ? 1 : 0)))

  const moves = []
  const usedIdle = new Set()
  for (const q of overloaded) {
    const freeCourt = idleCourts.find(c => !usedIdle.has(c))
    if (freeCourt == null) break // 남은 유휴 코트 없음
    // 진행 중이면 큐 맨 앞(지금 옮기면 바로 시작), 아니면 두 번째부터(맨 앞은 이 코트에서 곧 시작).
    const movable = q.running ? q.queue : q.queue.slice(1)
    const pick = movable.find(m =>
      !playingEntries.has(m.team1_entry_id) && !playingEntries.has(m.team2_entry_id))
    if (!pick) continue
    usedIdle.add(freeCourt)
    moves.push({ match: pick, fromCourt: q.court, toCourt: freeCourt })
    if (maxMoves && moves.length >= maxMoves) break
  }

  return { moves, idleCourts, overloadedCourts: overloaded.map(q => q.court) }
}

// 진행 페이스·지연 재조정 분석 (C6) — 계획 대비 실시간 지연을 예측하고 재배치안을 제시.
// ──────────────────────────────────────────────────────────────────────
// scheduler 가 미리 깔아둔 scheduled_time(계획)과 실시간 상태(진행 중 경과·시작 대기
// 밀림)를 비교해 "현재 페이스면 몇 분 지연될지" 를 예측한다. 순수 함수 — DB·발송 없음.
//   - observedMin      : 관측 경기 소요(분). 진행 중 경기가 계획보다 오래 걸리면 페이스를
//                        보수적으로 늦춰 예상 호출/종료 시각에 반영(estimates 정확도 향상).
//   - scheduleDriftMin : 시작했어야 하는데 아직 예정인 경기의 최대 지연(계획 밀림).
//   - plannedFinish    : 계획상 마지막 경기 종료(가장 늦은 scheduled_time + 1경기).
//   - projectedFinish  : 관측 페이스로 코트 큐를 굴린 실제 예상 종료.
//   - delayMin         : projectedFinish − plannedFinish (0 이상). 대회 종료 지연 예측.
//   - suggestions      : 재배치안(빈 코트 활용·페이스 안내) 한국어 문구.
export function analyzeDelay(matches, { matchMinutes = 30, now = Date.now() } = {}) {
  const list = matches ?? []
  const notDone = list.filter(m => !DONE_STATUSES.includes(m.status))
  const running = list.filter(m => m.status === 'in_progress' && m.actual_start)
  const step = Math.max(1, matchMinutes) * 60000

  // 1) 관측 페이스 — 진행 중 경기의 경과 시간(최소한 이만큼은 걸렸음)을 계획과 blend.
  let observedMin = matchMinutes
  if (running.length) {
    const elapsed = running.map(m => Math.max(0, (now - new Date(m.actual_start).getTime()) / 60000))
    const avg = elapsed.reduce((a, b) => a + b, 0) / elapsed.length
    observedMin = Math.max(matchMinutes, Math.round(avg))
  }
  const obsStep = Math.max(1, observedMin) * 60000

  // 2) 시작 대기 밀림 — 예정 시각이 지났는데 아직 시작 안 한 경기.
  let scheduleDriftMin = 0
  const overdueStarts = notDone.filter(m =>
    m.status === 'scheduled' && m.scheduled_time && new Date(m.scheduled_time).getTime() < now)
  overdueStarts.forEach(m => {
    const d = (now - new Date(m.scheduled_time).getTime()) / 60000
    if (d > scheduleDriftMin) scheduleDriftMin = d
  })
  scheduleDriftMin = Math.round(scheduleDriftMin)

  // 3) 계획된 종료 — 남은 경기 중 가장 늦은 예정 시각 + 1경기.
  let plannedFinish = null
  notDone.forEach(m => {
    if (!m.scheduled_time) return
    const end = new Date(m.scheduled_time).getTime() + step
    if (plannedFinish == null || end > plannedFinish) plannedFinish = end
  })

  // 4) 예상 종료 — 코트별 큐를 관측 페이스로 순차 진행시켜 마지막 경기 종료를 추정.
  const queues = buildCourtQueues(list)
  let projectedFinish = null
  const bump = end => { if (projectedFinish == null || end > projectedFinish) projectedFinish = end }
  for (const q of Object.values(queues)) {
    let cursor = now
    if (q.running) {
      const start = q.running.actual_start ? new Date(q.running.actual_start).getTime() : now
      cursor = Math.max(now, start + obsStep)  // 진행 중 경기 종료 예상
    }
    q.queue.forEach(() => { cursor += obsStep; bump(cursor) })
    if (q.running && !q.queue.length) bump(cursor)
  }

  const delayMin = (plannedFinish != null && projectedFinish != null)
    ? Math.max(0, Math.round((projectedFinish - plannedFinish) / 60000))
    : 0

  // 5) 코트 부하 + 재배치안.
  const courtLoad = Object.values(queues)
    .map(q => ({ court: q.court, running: !!q.running, queueLen: q.queue.length }))
    .sort((a, b) => a.court - b.court)
  const idleCourts = courtLoad.filter(c => !c.running && c.queueLen === 0).map(c => c.court)
  const busiestQueue = courtLoad.reduce((mx, c) => Math.max(mx, c.queueLen), 0)

  const suggestions = []
  if (observedMin > matchMinutes + 2) {
    suggestions.push(`경기당 평균 ${observedMin}분 — 계획(${matchMinutes}분)보다 ${observedMin - matchMinutes}분씩 길어요`)
  }
  if (idleCourts.length && busiestQueue >= 2) {
    suggestions.push(`${idleCourts.join('·')}번 코트가 비어 있어요 — 대기 경기를 나눠 배정하면 지연을 줄일 수 있어요`)
  }
  if (scheduleDriftMin >= 10 && !running.length && notDone.length) {
    suggestions.push(`시작 대기 경기가 ${scheduleDriftMin}분 밀렸어요 — 다음 경기를 호출해 진행을 이어가세요`)
  }

  return {
    observedMin, scheduleDriftMin, plannedFinish, projectedFinish, delayMin,
    remaining: notDone.length, runningCount: running.length,
    overdueStartCount: overdueStarts.length,
    courtLoad, idleCourts, busiestQueue, suggestions,
    onTrack: delayMin < 5 && scheduleDriftMin < 10,
  }
}

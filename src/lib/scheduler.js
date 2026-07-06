// AI 대진/일정 생성 엔진

// 리그 방식 (라운드 로빈)
export function buildRoundRobin(entries) {
  const list = [...entries]
  if (list.length % 2 !== 0) list.push(null) // 부전승
  const n = list.length
  const rounds = n - 1
  const matches = []

  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < n / 2; i++) {
      const a = list[i]
      const b = list[n - 1 - i]
      if (a && b) matches.push({ round: r + 1, entryA: a, entryB: b })
      else if (a) matches.push({ round: r + 1, entryA: a, entryB: null, bye: true })
    }
    // 회전 (첫 번째 고정)
    const last = list.splice(n - 1, 1)[0]
    list.splice(1, 0, last)
  }
  return matches
}

// 토너먼트 방식 (단판 제거)
export function buildSingleElimination(entries) {
  let bracket = [...entries]
  const size = nextPow2(bracket.length)
  while (bracket.length < size) bracket.push(null) // 부전승 슬롯

  const allMatches = []
  let round = 1
  while (bracket.length > 1) {
    const next = []
    for (let i = 0; i < bracket.length; i += 2) {
      const a = bracket[i]
      const b = bracket[i + 1]
      allMatches.push({ round, slot: i / 2, entryA: a, entryB: b, bye: !a || !b })
      next.push(null) // winner TBD
    }
    bracket = next
    round++
  }
  return allMatches
}

// 일정 배정: matches 에 court + scheduledTime 추가
export function scheduleMatches({
  matches,
  courts,         // [1,2,3,4] (코트 번호 배열)
  startTime,      // Date
  matchMinutes = 30,
  breakMinutes  = 5,
  restMinutes   = 20, // 선수 최소 휴식
}) {
  const courtFree = {}
  courts.forEach(c => { courtFree[c] = new Date(startTime) })
  const playerFree = {} // entryId → Date

  const result = []
  for (const m of matches) {
    if (m.bye) {
      result.push({ ...m, court: null, scheduledTime: null })
      continue
    }

    // 관련 선수들이 쉬어야 하는 최소 시작 시각
    const minStart = playerMinStart([m.entryA?.id, m.entryB?.id], playerFree, restMinutes)

    // 가장 빨리 비는 코트 찾기 (선수 제약 고려)
    const sorted = Object.entries(courtFree).sort((a, b) => a[1] - b[1])
    let chosen = null
    let chosenStart = null
    for (const [court, freeAt] of sorted) {
      const start = new Date(Math.max(freeAt, minStart))
      chosen = Number(court)
      chosenStart = start
      break
    }

    const end = new Date(chosenStart.getTime() + matchMinutes * 60000)
    courtFree[chosen] = new Date(end.getTime() + breakMinutes * 60000)

    // 선수 휴식 시각 업데이트
    ;[m.entryA?.id, m.entryB?.id].filter(Boolean).forEach(id => {
      if (!playerFree[id] || end > playerFree[id]) playerFree[id] = end
    })

    result.push({ ...m, court: chosen, scheduledTime: chosenStart, estimatedEnd: end })
  }
  return result
}

function playerMinStart(ids, playerFree, restMin) {
  let t = 0
  ids.filter(Boolean).forEach(id => {
    const free = playerFree[id]
    if (free) t = Math.max(t, free.getTime() + restMin * 60000)
  })
  return t ? new Date(t) : new Date(0)
}

function nextPow2(n) {
  let p = 1
  while (p < n) p *= 2
  return p
}

// 기권 후 일정 재계산 (해당 코트 이후 경기만 당김)
export function rescheduleAfterForfeit(schedule, forfeitMatchId, matchMinutes = 30, breakMinutes = 5) {
  const idx = schedule.findIndex(m => m.id === forfeitMatchId)
  if (idx === -1) return schedule

  const forfeited = schedule[idx]
  const updated = [...schedule]

  // 같은 코트의 이후 경기들을 30분 앞당김
  updated
    .filter(m => m.court === forfeited.court && m.scheduledTime > forfeited.scheduledTime)
    .sort((a, b) => new Date(a.scheduledTime) - new Date(b.scheduledTime))
    .forEach(m => {
      const i = updated.findIndex(s => s.id === m.id)
      const newTime = new Date(new Date(m.scheduledTime).getTime() - matchMinutes * 60000)
      updated[i] = { ...m, scheduledTime: newTime }
    })

  return updated
}

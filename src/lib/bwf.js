// ============================================================
// bwf.js — BWF 랠리포인트 규칙 엔진 (순수 함수, DB/React 의존 없음)
//
// 상태 모양 (계약 명세 §3):
// state = {
//   config: { gamesPerMatch, pointsPerGame, cap },   // cap = pointsPerGame + 9
//   gameNo: 1,                        // 현재 게임 번호 (1부터)
//   score: [0, 0],                    // 현재 게임 점수 [팀1, 팀2]
//   gamesWon: [0, 0],                 // 게임 승수 [팀1, 팀2]
//   completedGames: [],               // [{ gameNo, score: [21,18], winnerTeam: 1 }]
//   serverTeam: 1 | 2,                // 서브권 팀
//   finished: false,
//   winnerTeam: null,                 // 1 | 2
//   resultType: 'normal',             // 'normal' | 'walkover' | 'retired' | 'disqualified'
//   flags: { intervalNow, gameJustEnded, matchJustEnded, goldenPoint }
// }
//
// 규칙 요약:
// - 랠리포인트: 득점한 팀이 다음 서브권을 가진다.
// - 게임 종료: pointsPerGame 선취 + 2점차. 듀스 지속,
//   cap(= pointsPerGame + 9)점 도달 시 무조건 종료(골든포인트). 21→30, 15→24, 11→20.
// - 인터벌: 한 게임에서 선두 팀이 ceil(pointsPerGame/2)점 도달한 순간 1회 (21점제=11점).
// - 매치 종료: ceil(gamesPerMatch/2) 게임 선취.
// - 다음 게임 첫 서브: 직전 게임 승자.
// - 서비스 코트: 서브팀 점수 짝수=오른쪽, 홀수=왼쪽 (BWF 단·복식 공통).
// ============================================================

const EMPTY_FLAGS = Object.freeze({
  intervalNow: false,
  gameJustEnded: false,
  matchJustEnded: false,
  goldenPoint: false,
})

/** 새 매치 상태. gamesPerMatch/pointsPerGame은 category의 games_per_match/points_per_game. */
export function initMatchState({ gamesPerMatch = 3, pointsPerGame = 21, firstServerTeam = 1 } = {}) {
  return {
    config: {
      gamesPerMatch,
      pointsPerGame,
      cap: pointsPerGame + 9,
    },
    gameNo: 1,
    score: [0, 0],
    gamesWon: [0, 0],
    completedGames: [],
    serverTeam: firstServerTeam,
    finished: false,
    winnerTeam: null,
    resultType: 'normal',
    flags: { ...EMPTY_FLAGS },
  }
}

/**
 * 게임 종료 판정.
 * pointsPerGame 도달 + 2점차 승리. 듀스면 cap 도달 시 1점차라도 승리(골든포인트).
 * @returns {1|2|null} 승자 팀 번호 (게임이 안 끝났으면 null)
 */
export function isGameOver(score, { pointsPerGame, cap }) {
  const [a, b] = score
  // 골든포인트: cap 도달 시 무조건 종료 (예: 30-29)
  if (a >= cap && a > b) return 1
  if (b >= cap && b > a) return 2
  // 일반 종료: pointsPerGame 이상 + 2점차
  if (a >= pointsPerGame && a - b >= 2) return 1
  if (b >= pointsPerGame && b - a >= 2) return 2
  return null
}

/**
 * 인터벌 여부: 어느 한 팀이 ceil(pointsPerGame/2)점에 "방금 도달"한 순간 1회.
 * (점수는 1점씩만 오르므로, 한 팀이 정확히 중간점이고 상대가 그 미만이면 최초 도달)
 */
export function isIntervalPoint(score, pointsPerGame) {
  const mid = Math.ceil(pointsPerGame / 2)
  return (
    (score[0] === mid && score[1] < mid) ||
    (score[1] === mid && score[0] < mid)
  )
}

/**
 * 득점 1점 적용 → 새 state 반환 (불변).
 * 게임/매치 종료·인터벌·서브권 전환 판정 포함.
 * finished=true 상태에 호출하면 그대로 반환.
 */
export function applyPoint(state, teamNo /* 1|2 */) {
  if (state.finished) return state
  if (teamNo !== 1 && teamNo !== 2) return state

  const idx = teamNo - 1
  const score = [...state.score]
  score[idx] += 1

  const flags = { ...EMPTY_FLAGS }
  const gameWinner = isGameOver(score, state.config)

  // ── 게임 계속 진행 ──────────────────────────────
  if (!gameWinner) {
    flags.intervalNow = isIntervalPoint(score, state.config.pointsPerGame)
    // 골든포인트 임박: cap-1 대 cap-1 (예: 29-29 → 다음 1점이 승부)
    flags.goldenPoint =
      score[0] === state.config.cap - 1 && score[1] === state.config.cap - 1
    return {
      ...state,
      score,
      serverTeam: teamNo, // 랠리포인트: 득점팀이 서브권
      flags,
    }
  }

  // ── 게임 종료 ──────────────────────────────────
  const gamesWon = [...state.gamesWon]
  gamesWon[gameWinner - 1] += 1
  const completedGames = [
    ...state.completedGames,
    { gameNo: state.gameNo, score, winnerTeam: gameWinner },
  ]
  const gamesToWin = Math.ceil(state.config.gamesPerMatch / 2)

  // 매치 종료
  if (gamesWon[gameWinner - 1] >= gamesToWin) {
    flags.gameJustEnded = true
    flags.matchJustEnded = true
    return {
      ...state,
      score, // 마지막 게임 점수 유지 (표시용)
      gamesWon,
      completedGames,
      serverTeam: teamNo,
      finished: true,
      winnerTeam: gameWinner,
      flags,
    }
  }

  // 다음 게임으로: 점수 리셋, 첫 서브는 직전 게임 승자
  flags.gameJustEnded = true
  return {
    ...state,
    gameNo: state.gameNo + 1,
    score: [0, 0],
    gamesWon,
    completedGames,
    serverTeam: gameWinner,
    flags,
  }
}

/**
 * 경기 강제 종료 (retired=경기중 기권 / walkover=불참 부전승 / disqualified=실격).
 * reasonTeam이 포기한 팀 → 상대가 승자.
 */
export function applyForfeit(state, reasonTeam, resultType) {
  if (state.finished) return state
  const winnerTeam = reasonTeam === 1 ? 2 : 1
  return {
    ...state,
    finished: true,
    winnerTeam,
    resultType,
    flags: { ...EMPTY_FLAGS, matchJustEnded: true },
  }
}

/**
 * 서비스 코트 계산: 서브팀 점수가 짝수=오른쪽, 홀수=왼쪽.
 * @returns {{ team: 1|2, side: 'right'|'left' }}
 */
export function serviceCourt(state) {
  const team = state.serverTeam
  const side = state.score[team - 1] % 2 === 0 ? 'right' : 'left'
  return { team, side }
}

/**
 * match_events 배열 → 최종 state 재구성 (새로고침 복원·검증용).
 * point 이벤트를 스택으로 유지, undo를 만나면 직전 point 1개를 접은(pop) 뒤
 * 전체 리플레이 — 게임 경계를 넘는 언두(0-0에서 이전 게임 복원)도 자동 지원.
 * point/undo 외 이벤트는 무시한다 (계약).
 * @param {Array<{event_type:string, team_no:number}>} events created_at 오름차순
 * @param {{gamesPerMatch:number, pointsPerGame:number}} config
 */
export function foldEvents(events, config, firstServerTeam = 1) {
  const stack = []
  for (const ev of events ?? []) {
    if (ev.event_type === 'point') {
      if (ev.team_no === 1 || ev.team_no === 2) stack.push(ev.team_no)
    } else if (ev.event_type === 'undo') {
      stack.pop()
    }
  }

  let state = initMatchState({
    gamesPerMatch: config?.gamesPerMatch ?? 3,
    pointsPerGame: config?.pointsPerGame ?? 21,
    firstServerTeam,
  })
  for (const teamNo of stack) {
    state = applyPoint(state, teamNo)
  }
  return state
}

/** UI 라벨: 끝난 게임 스코어 문자열 — "21-18, 19-21, 21-15" */
export function scoreSummary(state) {
  return (state.completedGames ?? [])
    .map(g => `${g.score[0]}-${g.score[1]}`)
    .join(', ')
}

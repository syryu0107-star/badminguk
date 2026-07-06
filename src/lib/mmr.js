// Elo 기반 MMR 계산 엔진

const K_NEW    = 64  // 10경기 미만
const K_NORMAL = 32  // 이후

function kFactor(gamesPlayed) {
  return gamesPlayed < 10 ? K_NEW : K_NORMAL
}

function expected(playerMMR, opponentMMR) {
  return 1 / (1 + Math.pow(10, (opponentMMR - playerMMR) / 400))
}

export function calcMMRDelta(playerMMR, opponentTeamMMR, result, gamesPlayed) {
  // result: 1=승, 0=패, 0.5=무
  const k = kFactor(gamesPlayed)
  const e = expected(playerMMR, opponentTeamMMR)
  return Math.round(k * (result - e))
}

export function teamMMR(p1mmr, p2mmr) {
  return Math.round((p1mmr + p2mmr) / 2)
}

// 경기 결과로 4명 모두 MMR 변화량 계산
export function resolveMatchMMR({ team1, team2, winner }) {
  // team1/team2: [{ id, mmr, gamesPlayed }]
  // winner: 1 | 2
  const t1avg = teamMMR(team1[0].mmr, team1[1].mmr)
  const t2avg = teamMMR(team2[0].mmr, team2[1].mmr)

  const r1 = winner === 1 ? 1 : 0
  const r2 = winner === 2 ? 1 : 0

  return [
    ...team1.map(p => ({
      id: p.id,
      before: p.mmr,
      delta: calcMMRDelta(p.mmr, t2avg, r1, p.gamesPlayed),
    })),
    ...team2.map(p => ({
      id: p.id,
      before: p.mmr,
      delta: calcMMRDelta(p.mmr, t1avg, r2, p.gamesPlayed),
    })),
  ].map(r => ({ ...r, after: Math.max(100, r.before + r.delta) }))
}

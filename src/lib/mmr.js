// ── 공인 등급별 K 팩터 ──────────────────────────────────────────
// none: 비공인(친선전) → MMR 변동 없음
// c: 공인C 일반 동호회 대회
// b: 공인B 배드민국 인증 주최자
// a: 공인A 협회 연계 대회
export const CERT_LEVELS = {
  none: { label: '비공인',  k: 0,  color: 'gray',  desc: 'MMR 변동 없음 (친선전)' },
  c:    { label: '공인 C',  k: 32, color: 'blue',  desc: 'K=32 · 일반 동호회 대회' },
  b:    { label: '공인 B',  k: 48, color: 'purple', desc: 'K=48 · 배드민국 인증 주최자' },
  a:    { label: '공인 A',  k: 64, color: 'red',   desc: 'K=64 · 협회 연계 공인 대회' },
}

// 신규 플레이어(10경기 미만) K 보정: 1.5배
function kFactor(baseK, gamesPlayed) {
  if (baseK === 0) return 0
  return gamesPlayed < 10 ? Math.round(baseK * 1.5) : baseK
}

// Elo 기대 승률
function expected(playerMMR, opponentMMR) {
  return 1 / (1 + Math.pow(10, (opponentMMR - playerMMR) / 400))
}

// ── 파트너 보정 계수 ────────────────────────────────────────────
// 파트너가 나보다 강하면 → 내 gain 감소 (업혀서 이기면 적게 올라감)
// 파트너가 나보다 약하면  → 내 gain 증가 (내가 캐리하면 더 올라감)
export function partnerAdjustment(myMMR, partnerMMR) {
  const diff = partnerMMR - myMMR          // 양수 = 파트너가 강함
  const factor = 1 - (diff / 400) * 0.25  // 400 차이당 ±25%
  return Math.max(0.4, Math.min(1.6, factor))
}

// ── 개인 MMR 변화량 계산 ────────────────────────────────────────
export function calcMMRDelta(playerMMR, opponentTeamMMR, result, gamesPlayed, certLevel = 'c') {
  const baseK = CERT_LEVELS[certLevel]?.k ?? 32
  const k = kFactor(baseK, gamesPlayed)
  if (k === 0) return 0
  const e = expected(playerMMR, opponentTeamMMR)
  return Math.round(k * (result - e))
}

export function teamMMR(p1mmr, p2mmr) {
  return Math.round((p1mmr + p2mmr) / 2)
}

// ── 경기 결과 → 4명 MMR 변화량 (파트너 보정 포함) ────────────────
export function resolveMatchMMR({ team1, team2, winner, certLevel = 'c' }) {
  // team1/team2: [{ id, mmr, gamesPlayed }]
  // winner: 1 | 2

  if (certLevel === 'none') {
    return [...team1, ...team2].map(p => ({
      id: p.id, before: p.mmr, delta: 0, after: p.mmr,
    }))
  }

  const t1avg = teamMMR(team1[0].mmr, team1[1]?.mmr ?? team1[0].mmr)
  const t2avg = teamMMR(team2[0].mmr, team2[1]?.mmr ?? team2[0].mmr)

  const r1 = winner === 1 ? 1 : 0
  const r2 = winner === 2 ? 1 : 0

  function calcPlayer(p, partner, opponentAvg, result) {
    const baseDelta = calcMMRDelta(p.mmr, opponentAvg, result, p.gamesPlayed, certLevel)
    const adj = partner ? partnerAdjustment(p.mmr, partner.mmr) : 1
    const delta = Math.round(baseDelta * adj)
    return {
      id: p.id,
      before: p.mmr,
      delta,
      after: Math.max(100, p.mmr + delta),
      partnerAdj: Math.round((adj - 1) * 100), // 보정률 % (UI 표시용)
    }
  }

  return [
    calcPlayer(team1[0], team1[1], t2avg, r1),
    calcPlayer(team1[1], team1[0], t2avg, r1),
    calcPlayer(team2[0], team2[1], t1avg, r2),
    calcPlayer(team2[1], team2[0], t1avg, r2),
  ]
}

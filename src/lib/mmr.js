// RD(불확실성) 인지 K 배수·감쇠는 rating.js가 단일 소스(016 SQL과 파리티).
// mmr.js는 프론트 리허설/프리뷰이므로 여기서 재정의하지 않고 재사용한다.
//   ⚠️ 의존 방향: mmr → rating → {grades, reliability}. rating은 mmr을 import하지
//      않으므로 순환 없음.
import { provisionalK, decayRD } from './rating'

// ── 대회 단위별 K 팩터 ──────────────────────────────────────────
// 대회 단위(구/시/전국)가 MMR 반영 강도 K를 결정한다. 전부 반영(비반영 없음).
//   c: 구 대회   (K=32)   ← tournaments.unit 'gu'
//   b: 시 대회   (K=48)   ← tournaments.unit 'si'
//   a: 전국 대회 (K=64)   ← tournaments.unit 'nat'
// ⚠️ 키(none/c/b/a)와 K 값은 010 apply_match_mmr RPC와의 계약이므로 유지.
//    UI에 보이는 label/desc 문자열만 단위 표현으로 교체(로직 불변).
//    none은 레거시 호환용(MMR 변동 없음 행 표시). 신규 대회는 항상 c/b/a.
export const CERT_LEVELS = {
  none: { label: '미반영',   k: 0,  color: 'gray',   desc: 'MMR 변동 없음' },
  c:    { label: '구 대회',  k: 32, color: 'blue',   desc: '구 단위 대회 · 순위 변동 보통' },
  b:    { label: '시 대회',  k: 48, color: 'purple', desc: '시 단위 대회 · 순위 변동 큼' },
  a:    { label: '전국 대회', k: 64, color: 'red',    desc: '전국 단위 대회 · 순위 변동 매우 큼' },
}

// K 보정 배수. RD(불확실성)를 알면 연속값 provisional 큰-K(rating.js·016 SQL과 동일),
// 모르면 레거시 휴리스틱(10경기 미만 1.5배)으로 폴백 → 하위호환 유지.
//   rd == null  → 기존 동작 그대로(gamesPlayed<10 ? 1.5 : 1.0)
//   rd 제공     → provisionalK(rd, games) [1.0~3.0], RD 높을수록 크게
function kFactor(baseK, gamesPlayed, rd = null) {
  if (baseK === 0) return 0
  const mult = rd != null
    ? provisionalK(rd, gamesPlayed)
    : (gamesPlayed < 10 ? 1.5 : 1.0)
  return Math.round(baseK * mult)
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
// rd(옵셔널): 있으면 RD 인지 큰-K, 없으면 레거시 K(하위호환). 마지막 인자라 기존 호출 무영향.
export function calcMMRDelta(playerMMR, opponentTeamMMR, result, gamesPlayed, certLevel = 'c', rd = null) {
  const baseK = CERT_LEVELS[certLevel]?.k ?? 32
  const k = kFactor(baseK, gamesPlayed, rd)
  if (k === 0) return 0
  const e = expected(playerMMR, opponentTeamMMR)
  return Math.round(k * (result - e))
}

export function teamMMR(p1mmr, p2mmr) {
  return Math.round((p1mmr + p2mmr) / 2)
}

// ── 경기 결과 → 4명 MMR 변화량 (파트너 보정 포함) ────────────────
export function resolveMatchMMR({ team1, team2, winner, certLevel = 'c' }) {
  // team1/team2: [{ id, mmr, gamesPlayed, rd? }]
  //   rd 옵셔널 — 주면 RD 인지 큰-K + rdBefore/rdAfter(경기 후 감쇠) 동봉(016 v2 리허설),
  //   안 주면 레거시 동작(rd 필드 미포함). winner: 1 | 2

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
    if (!p) return null   // 단식: team[1]이 없으면 건너뜀 (반환 배열에서 filter)
    const rd = p.rd ?? null
    const baseDelta = calcMMRDelta(p.mmr, opponentAvg, result, p.gamesPlayed, certLevel, rd)
    const adj = partner ? partnerAdjustment(p.mmr, partner.mmr) : 1
    const delta = Math.round(baseDelta * adj)
    const out = {
      id: p.id,
      before: p.mmr,
      delta,
      after: Math.max(100, p.mmr + delta),
      partnerAdj: Math.round((adj - 1) * 100), // 보정률 % (UI 표시용)
    }
    // RD를 준 호출만 경기 후 RD(감쇠) 동봉 — 레거시 반환 형태 불변.
    if (rd != null) { out.rdBefore = rd; out.rdAfter = decayRD(rd) }
    return out
  }

  return [
    calcPlayer(team1[0], team1[1], t2avg, r1),
    calcPlayer(team1[1], team1[0], t2avg, r1),
    calcPlayer(team2[0], team2[1], t1avg, r2),
    calcPlayer(team2[1], team2[0], t1avg, r2),
  ].filter(Boolean)   // 단식은 각 팀 1명이라 null(빈 파트너)을 걸러 2명만 반환
}

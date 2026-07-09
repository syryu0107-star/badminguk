// ── 레이팅 신뢰도(Reliability) 엔진 ─────────────────────────────
// DUPR Reliability(2024 도입) 방식: "이 MMR이 실제 실력을 얼마나 반영하는가"를
// 0~100%로 환산. RD(레이팅 편차)를 일반 사용자가 이해하는 UX로 번역한 것.
//
// 스키마 변경 없이 기존 데이터(mmr_history)만으로 계산:
//   - 경기량:   최근 90일 경기 수 (표본이 많을수록 신뢰↑)
//   - 최근성:   마지막 경기 이후 경과일 (오래될수록 신뢰↓)
//   - 다양성:   서로 다른 대회 수 (한 대회만 나오면 편향)
//   - 검증도:   공인 대회(cert_level≠none) 경기 비중 (자율입력은 신뢰↓)

const DAY = 86400000

// 리더보드 정식 등재 최소 경기 수 (4-13). 미만이면 '잠정' 처리해
// 3경기 전승 유저가 전국 1위로 왜곡되는 것을 방지.
export const MIN_RANKED_GAMES = 5
// 정식 등재 최소 신뢰도 (%). 경기 수는 채웠지만 신뢰도가 바닥이면 잠정.
export const MIN_RANKED_RELIABILITY = 25

export const RELIABILITY_TIERS = [
  { min: 75, key: 'high',   label: '높음', color: 'emerald', desc: '실력을 잘 반영합니다' },
  { min: 45, key: 'medium', label: '보통', color: 'amber',   desc: '표본을 더 쌓는 중' },
  { min: 0,  key: 'low',    label: '낮음', color: 'gray',    desc: '경기 수가 부족합니다' },
]

export function reliabilityTier(score) {
  return RELIABILITY_TIERS.find(t => score >= t.min) ?? RELIABILITY_TIERS[RELIABILITY_TIERS.length - 1]
}

// history 항목: { created_at, cert_level, tournament_id } (순서 무관)
// gamesPlayed: 해당 종목 총 경기 수(profiles.mmr_games_played 등)
export function calcReliability({ gamesPlayed = 0, history = [], now = Date.now() } = {}) {
  const empty = {
    score: 0, tier: reliabilityTier(0),
    volume: 0, recency: 0, diversity: 0, verified: 0,
    daysSinceLast: null, recentCount: 0,
  }
  if (!gamesPlayed || gamesPlayed <= 0) return empty

  const times = history
    .map(h => new Date(h.created_at).getTime())
    .filter(t => !Number.isNaN(t))
  const last = times.length ? Math.max(...times) : null
  const daysSinceLast = last != null ? Math.floor((now - last) / DAY) : null

  // 1) 경기량 — 최근 90일 경기 수 (기록이 없으면 전체 경기 수로 근사)
  const recentCount = times.filter(t => now - t <= 90 * DAY).length
  const volumeBase = recentCount || Math.min(gamesPlayed, history.length || gamesPlayed)
  const volume = Math.min(1, volumeBase / 10)

  // 2) 최근성 — 30일 이내 만점, 180일 이상 0점 선형 감쇠
  let recency
  if (daysSinceLast == null) recency = 0.4          // 기록 없음(레거시) → 중립
  else if (daysSinceLast <= 30) recency = 1
  else if (daysSinceLast >= 180) recency = 0
  else recency = 1 - (daysSinceLast - 30) / 150

  // 3) 다양성 — 서로 다른 대회 4개면 만점
  const distinctTourneys = new Set(
    history.map(h => h.tournament_id).filter(Boolean)
  ).size
  const diversity = distinctTourneys ? Math.min(1, distinctTourneys / 4) : 0

  // 4) 검증도 — 공인 대회 경기 비중
  const verifiedCount = history.filter(h => h.cert_level && h.cert_level !== 'none').length
  const verified = history.length ? verifiedCount / history.length : 0

  const score = Math.round(
    100 * (volume * 0.4 + recency * 0.25 + diversity * 0.2 + verified * 0.15)
  )

  return {
    score,
    tier: reliabilityTier(score),
    volume, recency, diversity, verified,
    daysSinceLast, recentCount,
  }
}

// 리더보드 정식 등재 여부 (4-13)
export function isRanked(gamesPlayed, reliabilityScore) {
  return (gamesPlayed ?? 0) >= MIN_RANKED_GAMES &&
         (reliabilityScore ?? 0) >= MIN_RANKED_RELIABILITY
}

// 신뢰도 티어 색상 → Tailwind 클래스 (동적 클래스는 빌드에서 누락되므로 정적 매핑)
export const TIER_CLASSES = {
  emerald: { text: 'text-emerald-600', bg: 'bg-emerald-50',  ring: 'text-emerald-500' },
  amber:   { text: 'text-amber-600',   bg: 'bg-amber-50',    ring: 'text-amber-500' },
  gray:    { text: 'text-gray-500',    bg: 'bg-gray-100',    ring: 'text-gray-400' },
}

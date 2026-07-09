// 대한민국 배드민턴 동호인 공인 급수 체계 (약→강)
export const GRADES = [
  { key: '왕초심', label: '왕초심', short: 'F', initialMMR: 800,  flair: '🐣' },
  { key: '초심',   label: '초심',   short: 'E', initialMMR: 1000, flair: '🌱' },
  { key: 'D조',    label: 'D조',    short: 'D', initialMMR: 1100, flair: '🥉' },
  { key: 'C조',    label: 'C조',    short: 'C', initialMMR: 1250, flair: '🥈' },
  { key: 'B조',    label: 'B조',    short: 'B', initialMMR: 1400, flair: '🥇' },
  { key: 'A조',    label: 'A조',    short: 'A', initialMMR: 1600, flair: '🏆' },
  { key: '준자강',  label: '준자강',  short: '준', initialMMR: 1800, flair: '💎' },
  { key: '자강조',  label: '자강조',  short: '자강', initialMMR: 2000, flair: '👑' },
]

export const GRADE_KEYS = GRADES.map(g => g.key)

export function getGradeInfo(key) {
  return GRADES.find(g => g.key === key) ?? GRADES[0]
}

export function getInitialMMR(grade) {
  return getGradeInfo(grade)?.initialMMR ?? 1000
}

export function getGradeIndex(key) {
  return GRADES.findIndex(g => g.key === key)
}

// 전국 상위 %  (MMR 기반 추정치)
export function getMMRPercentile(mmr) {
  if (mmr >= 2000) return '상위 1%'
  if (mmr >= 1800) return '상위 5%'
  if (mmr >= 1600) return '상위 12%'
  if (mmr >= 1400) return '상위 28%'
  if (mmr >= 1250) return '상위 48%'
  if (mmr >= 1100) return '상위 65%'
  if (mmr >= 1000) return '상위 80%'
  return '상위 92%'
}

export const SPORT_TYPES = ['남복', '여복', '혼복']

// 급수 조건 문자열 (예: "D조 이하", "B조~A조")
export function gradeRangeLabel(min, max) {
  if (!min && !max) return '급수 제한 없음'
  if (!min) return `${max} 이하`
  if (!max) return `${min} 이상`
  if (min === max) return min
  return `${min} ~ ${max}`
}

// 참가 가능 조 화이트리스트(allowed_grades) 라벨. 빈 배열/NULL = 제한 없음.
export function allowedGradesLabel(arr) {
  return arr?.length ? arr.join('·') : '급수 제한 없음'
}

// ══════════════════════════════════════════════════════════════════
// 급수 3축 체계 (단위 × 종목 × 조)   — DB 정본: 014_grade_system.sql
//
// 실제 배드민턴 급수는 "어느 단위 대회에서 인정받았는가"로 갈린다.
// 같은 사람이 구 대회에선 C조, 시 대회에선 D조, 전국에선 초심일 수 있다.
//   · 단위(unit) : gu(구)/si(시)/nat(전국)         ← 대회가 소속 단위를 가진다.
//   · 종목(mode) : doubles(복식)/singles(단식)     ← sport_type에서 파생.
//   · 조(grade)  : 왕초심~자강조 8단계 (위 GRADES).
// 한 선수는 최대 6개 급수 트랙(단위 3 × 종목 2)을 가진다. 각 트랙 값은 조 또는 NULL(미보유).
//
// MMR 반영 강도 K는 단위로 결정: 구→32 / 시→48 / 전국→64.
// unit→cert_level(gu→c/si→b/nat→a) 매핑으로 010 MMR RPC·mmr.js CERT_LEVELS와 연결.
// ══════════════════════════════════════════════════════════════════

export const UNITS = [
  { key: 'gu',  label: '구',   cert: 'c', k: 32 },
  { key: 'si',  label: '시',   cert: 'b', k: 48 },
  { key: 'nat', label: '전국', cert: 'a', k: 64 },
]
export const UNIT_KEYS = UNITS.map(u => u.key)

export const MODES = [
  { key: 'doubles', label: '복식' },
  { key: 'singles', label: '단식' },
]

// 6트랙 컬럼명 매핑 (DB bmg_grade_column과 1:1)
const GRADE_COLS = {
  'gu:doubles': 'grade_gu_dbl', 'si:doubles': 'grade_si_dbl', 'nat:doubles': 'grade_nat_dbl',
  'gu:singles': 'grade_gu_sgl', 'si:singles': 'grade_si_sgl', 'nat:singles': 'grade_nat_sgl',
}
// (unit, mode) → profiles 급수 트랙 컬럼명. 알 수 없으면 null.
export function gradeColumn(unit, mode) {
  return GRADE_COLS[`${unit}:${mode}`] ?? null
}

// sport_type → 'singles'|'doubles' (남단/여단=단식, 그 외=복식)
export function modeForSport(sportType) {
  return SINGLES_SPORT_TYPES.includes(sportType) ? 'singles' : 'doubles'
}

export function unitInfo(unit) { return UNITS.find(u => u.key === unit) ?? UNITS[0] }
export function unitToCert(unit) { return unitInfo(unit).cert }   // gu→c, si→b, nat→a
export function unitToK(unit)    { return unitInfo(unit).k }      // gu→32, si→48, nat→64
export function unitLabel(unit)  { return unitInfo(unit).label }  // gu→구, si→시, nat→전국

// mode('doubles'|'singles') → 표시 라벨('복식'|'단식')
export function modeLabel(mode) {
  return MODES.find(m => m.key === mode)?.label ?? (mode === 'singles' ? '단식' : '복식')
}

// 선수의 (unit, mode) 트랙 급수. NULL(미보유)이면 null 반환(표시는 호출측이 '미보유'로).
export function trackGrade(profile, unit, mode) {
  return profile?.[gradeColumn(unit, mode)] ?? null
}
// 승급/자격 계산용 baseline (미보유→왕초심 idx0).
export function trackGradeOrBase(profile, unit, mode) {
  return trackGrade(profile, unit, mode) ?? GRADES[0].key
}

// ══════════════════════════════════════════════════════════════════
// 급수 자동 승급 심사 (D · 감사 4-2)
//
// DB 정본: supabase/migrations/012_grade_promotion.sql
//   · promote_grades_for_tournament(p_tournament) — 대회 종료 시 일괄 심사(권위 계산)
//   · grade_promotion_progress(p_player, p_mode)   — "승급까지 X점" 프리뷰
// 아래 순수 함수는 그 규칙을 프론트에서 1:1 재현한다(프리뷰·표시·테스트용).
// ⚠️ 수치를 바꾸면 012 grade_promotion_config 기본값도 함께 조정할 것(어긋나면 표시≠실제).
//
// 도메인 원칙: 공인 급수는 원칙적으로 "안 떨어진다" → 강등 없음.
//   판정은 언제나 target > current 일 때만 상향, 아니면 no-op(절대 하향 안 함).
// ══════════════════════════════════════════════════════════════════

// 승급 규칙 수치(012 grade_promotion_config 기본값과 동일)
export const PROMOTION_CONFIG = {
  winPoints: 3,        // 우승(final_rank=1)
  runnerupPoints: 2,   // 준우승(2)
  semiPoints: 1,       // 3위(3)
  // 공인등급 가중치. 비공인(none)은 0 → 승급 불인정.
  certMult: { a: 2.0, b: 1.5, c: 1.0, none: 0 },
  // 한 단계 승급 필요점수 = base + step × (현재 급수 index) → 높을수록 어려워짐
  thresholdBase: 3.0,
  thresholdStep: 1.5,
  // 자동 승급 상한 index. 5=A조. 준자강(6)·자강조(7)은 수동 심사 전용.
  maxAutoGradeIdx: 5,
  // 승급 유예(일). 승급 후 이 기간은 축하배지/이전 급수 출전 허용 기준.
  graceDays: 30,
}

// 단식 종목 → singles(singles_grade), 그 외(복식) → doubles(official_grade)
export const SINGLES_SPORT_TYPES = ['남단', '여단']
export function gameModeForSport(sportType) {
  return SINGLES_SPORT_TYPES.includes(sportType) ? 'singles' : 'doubles'
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

// 입상 1건 점수 = 순위점 × 공인배수. (prize_spots 밖/비공인은 호출측이 걸러 넣거나 0점)
export function awardPoints(finalRank, certLevel, config = PROMOTION_CONFIG) {
  const base =
    finalRank === 1 ? config.winPoints
    : finalRank === 2 ? config.runnerupPoints
    : finalRank === 3 ? config.semiPoints
    : 0
  const mult = config.certMult[certLevel] ?? 0
  return base * mult
}

// awards: [{ finalRank, certLevel }] — 이미 입상(1~3)·공인·prize_spots 필터된 목록
export function earnedPromoPoints(awards = [], config = PROMOTION_CONFIG) {
  return (awards ?? []).reduce(
    (sum, a) => sum + awardPoints(a.finalRank, a.certLevel, config), 0)
}

// 급수 idx에서 한 단계 승급에 필요한 누적 점수
export function promotionThreshold(gradeIdx, config = PROMOTION_CONFIG) {
  return config.thresholdBase + config.thresholdStep * gradeIdx
}

/**
 * 승급 심사(012 bmg_eval_promotion 순수 재현). DB RPC와 동일 결과(멱등).
 * @param {string} currentGrade 현재 급수 key
 * @param {Array}  awards       [{ finalRank, certLevel, gameMode? }] 입상 목록
 * @param {string} gameMode     'singles'|'doubles' — awards에 gameMode가 있으면 이 값으로 필터
 * @param {object} [opts]       { autoPromotions=0 (멱등 anchor 보정), config }
 * @returns {string|null}       승급 대상 급수 key, 없으면 null (절대 강등 안 함)
 */
export function checkPromotion(currentGrade, awards, gameMode, opts = {}) {
  const config = opts.config ?? PROMOTION_CONFIG
  const autoPromotions = opts.autoPromotions ?? 0
  const curIdx = getGradeIndex(currentGrade)
  if (curIdx < 0) return null

  // awards가 모드 태그를 가지면 해당 모드만 사용(안 가지면 호출측이 이미 필터한 것으로 간주)
  const list = gameMode
    ? (awards ?? []).filter(a => a.gameMode == null || a.gameMode === gameMode)
    : (awards ?? [])

  // anchor_idx = 현재급수 index − 이미 반영된 자동승급 수 (재실행해도 불변 → 멱등)
  const anchor = Math.max(0, curIdx - autoPromotions)
  let pts = earnedPromoPoints(list, config)

  // anchor에서 그리디 상승 (자동 상한 maxAutoGradeIdx 까지만)
  let idx = anchor
  while (idx < config.maxAutoGradeIdx) {
    const thresh = promotionThreshold(idx, config)
    if (pts < thresh) break
    pts -= thresh
    idx += 1
  }

  if (idx <= curIdx) return null              // 승급 없음(그리고 절대 강등 안 함)
  return GRADES[idx]?.key ?? null
}

/**
 * 승급 진행 프리뷰(012 grade_promotion_progress 순수 재현).
 * @returns {{ currentGrade, atAutoCap, nextGrade, points, pointsNeeded, remaining }|null}
 */
export function promotionProgress(currentGrade, awards, opts = {}) {
  const config = opts.config ?? PROMOTION_CONFIG
  const autoPromotions = opts.autoPromotions ?? 0
  const curIdx = getGradeIndex(currentGrade)
  if (curIdx < 0) return null

  const anchor = Math.max(0, curIdx - autoPromotions)
  let pts = earnedPromoPoints(awards, config)
  // 현재 급수까지 이미 소진된 임계값을 제거 → 현재 급수 이후 잔여 점수
  for (let i = anchor; i < curIdx; i++) pts -= promotionThreshold(i, config)
  pts = Math.max(0, pts)

  const atAutoCap = curIdx >= config.maxAutoGradeIdx
  if (atAutoCap) {
    return { currentGrade, atAutoCap: true, nextGrade: null,
      points: round2(pts), pointsNeeded: null, remaining: null }
  }
  const needed = promotionThreshold(curIdx, config)
  return {
    currentGrade,
    atAutoCap: false,
    nextGrade: GRADES[curIdx + 1]?.key ?? null,
    points: round2(pts),
    pointsNeeded: round2(needed),
    remaining: round2(Math.max(0, needed - pts)),
  }
}

// "우승 N회 정도면 승급" 같은 쉬운 안내(구 대회 우승=winPoints 기준 근사)
export function promotionHint(remaining, config = PROMOTION_CONFIG) {
  const r = Number(remaining)
  if (!Number.isFinite(r) || r <= 0) return '승급 조건 충족! 다음 대회 종료 시 반영돼요'
  const perWin = config.winPoints * (config.certMult.c ?? 1) // 구 대회(cert c) 우승 1회 점수
  const wins = Math.max(1, Math.ceil(r / perWin))
  return `대회 우승 ${wins}회 정도면 승급`
}

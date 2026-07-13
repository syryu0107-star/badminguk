// ── 콜드스타트 레이팅 밴드 엔진 (rating.js) ────────────────────────
// 급수·온보딩 설문 → 초기 MMR+RD(불확실성) 밴드의 "단일 소스".
// docs/COLDSTART_STRATEGY.md 3장(부트스트랩)·7장(TOP5 #2·#3·#5) 구현.
//
// 역할 분담(중복 방지):
//   · grades.js       : 급수→중앙 MMR 앵커(getInitialMMR). 여기서 재사용(재정의 금지).
//   · reliability.js  : mmr_history 기반 "사후" 신뢰도 0~100%. 성숙 구간 표시 소유.
//   · rating.js(여기) : 경기 전 "선험" RD 밴드 + provisional 큰-K + 초기 뱃지 브리지.
//   · sandbag.js      : MMR↔신고급수 괴리(경기 후). 여기 crossCheckSandbag은 급수↔급수(온보딩).
//
// ⚠️ 아래 상수는 016_coldstart.sql의 bmg_provisional_k_mult / bmg_decay_rd /
//    bmg_apply_player_v2(floor 700) 와 1:1 파리티. 한쪽만 바꾸면 표시≠실제.

import { GRADES, getGradeIndex, getInitialMMR } from './grades'
import { MIN_RANKED_GAMES, MIN_RANKED_RELIABILITY, reliabilityTier } from './reliability'

// ── 상수 (SQL 정본과 파리티) ──────────────────────────────────────
export const RD_NEW          = 350   // 신규 최대 불확실성 (Glicko-2 관례)
export const RD_MAX          = 350   // 상한(무활동 증가 클리핑)
export const RD_ACTIVE_FLOOR = 60    // 활동 선수 수렴 바닥
export const RD_PROVISIONAL  = 110   // 이 RD 이하 + 경기 충족이면 provisional 해제
export const K_MULT_MAX      = 3.0   // 큰-K 배수 상한(전략 "2~4배")
export const FLOOR_MMR       = 700   // 초보 무한패배 방지 바닥값(전략 3-3 규칙①)
export const RD_DECAY        = 0.92  // 경기 1건당 RD 축소율
export const INACTIVITY_C    = 34    // 무활동 월당 RD 증가 상수(√(RD²+c²·months))

// 급수별 초기 RD(조 index 0=왕초심 … 7=자강조).
// 전략 3-3: 자강=좁게(검증된 라벨), 초심/왕초심=최대(누구나일 수 있음).
const GRADE_RD = [350, 340, 320, 300, 280, 255, 230, 205]

// 단위(unit) 보정: 급수 기준이 지역마다 다름(전략 3-3 규칙③).
//   같은 조라도 전국>시>구 순으로 실력이 높고(=MMR↑), 구는 기준이 느슨해 RD↑.
const UNIT_ADJ = {
  gu:  { mmr: -60, rd: +25 },
  si:  { mmr:   0, rd:   0 },
  nat: { mmr: +80, rd: -20 },
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

// ── 1. 급수 → MMR+RD 밴드 앵커 ────────────────────────────────────
// gradeToMMR(grade, unit) → { mmr, rd, floorMMR, ceilMMR }
//   중앙 MMR은 grades.js getInitialMMR 재사용(단일 소스). unit으로 보정.
//   floor/ceil = mmr ± rd (밴드 폭 = 불확실성) — 조편성 밴드/역산 참고용.
export function gradeToMMR(grade, unit = 'si') {
  const idx    = Math.max(0, getGradeIndex(grade))
  const center = getInitialMMR(GRADES[idx]?.key ?? grade)
  const adj    = UNIT_ADJ[unit] ?? UNIT_ADJ.si
  const mmr    = Math.max(FLOOR_MMR, Math.round(center + adj.mmr))
  const rd     = clamp((GRADE_RD[idx] ?? RD_NEW) + adj.rd, RD_ACTIVE_FLOOR, RD_MAX)
  return { mmr, rd, floorMMR: Math.max(FLOOR_MMR, mmr - rd), ceilMMR: mmr + rd }
}

// ── 2. 온보딩 설문 → 초기 레이팅 범위 ─────────────────────────────
// surveyToRating(survey) → { mmr, rd, mode, source, provisional, inferredGrade, flags }
//   survey: {
//     selfReportedGrade?, unit='si', mode='doubles',
//     isElite?:bool, careerMonths?:int, clubName?, weeklySessions?:int,
//     hasEvidence?:bool   // grade_proof_url 업로드 여부(증빙 → RD 축소)
//   }
// 본인 급수 "감"이 아니라 검증가능 사실을 범위(mmr,rd)로 변환(전략 3-2).
export function surveyToRating(survey = {}) {
  const {
    selfReportedGrade, unit = 'si', mode = 'doubles',
    isElite = false, careerMonths = null, weeklySessions = null,
    hasEvidence = false,
  } = survey

  // 기준점: 신고급수 있으면 그 밴드, 없으면 구력으로 조 추정.
  let baseGrade = selfReportedGrade || inferGradeFromCareer(careerMonths)
  const inferredGrade = baseGrade
  let { mmr, rd } = gradeToMMR(baseGrade, unit)

  // 선수부 출신 → 최소 A조 중앙 이상으로 끌어올림 + 소폭 가산(자강권 신호).
  if (isElite) {
    const aFloor = gradeToMMR('A조', unit).mmr
    mmr = Math.max(mmr, aFloor) + 40
  }

  // 구력: 매우 짧으면(<6개월) 바닥으로 당기고 RD 확대, 길면(>=36개월) 소폭 가산.
  if (careerMonths != null) {
    if (careerMonths < 6)      { mmr = Math.min(mmr, gradeToMMR('초심', unit).mmr); rd = clamp(rd + 20, RD_ACTIVE_FLOOR, RD_MAX) }
    else if (careerMonths >= 36) mmr += 30
  }

  // 주 운동 횟수(보조): 4회+ 소폭 가산.
  if (weeklySessions != null && weeklySessions >= 4) mmr += 20

  // 증빙 유무 → RD 차등(전략 4·6-4: 무증빙<캡처). 증빙 있으면 좁게, 없으면 넓게.
  rd = clamp(rd + (hasEvidence ? -25 : +20), RD_ACTIVE_FLOOR, RD_MAX)

  mmr = Math.max(FLOOR_MMR, Math.round(mmr))
  return {
    mmr, rd, mode,
    source: 'self_report',
    provisional: true,          // 온보딩 시점은 항상 잠정
    inferredGrade,
    flags: { isElite, hasEvidence, careerMonths },
  }
}

// 구력(개월) → 조 추정(신고급수 없을 때 폴백). 보수적으로.
function inferGradeFromCareer(months) {
  const m = Number(months)
  if (!Number.isFinite(m)) return '왕초심'
  if (m < 3)   return '왕초심'
  if (m < 9)   return '초심'
  if (m < 24)  return 'D조'
  if (m < 48)  return 'C조'
  return 'B조'
}

// ── 3. provisional 큰-K 배수 ──────────────────────────────────────
// provisionalK(rd, gamesPlayed) → 배수 [1.0, 3.0]. RD 높거나 경기<5면 크게.
// SQL bmg_provisional_k_mult와 동일. 실제 MMR 이동은 apply_match_mmr_v2가 SQL에서
// 이 배수를 적용 — 여기 함수는 프리뷰/조편성/시뮬레이션 표시용.
export function provisionalK(rd, gamesPlayed = 0) {
  const rdPart = 1 + (clamp(rd ?? RD_NEW, RD_ACTIVE_FLOOR, RD_MAX) - RD_ACTIVE_FLOOR)
                     / (RD_MAX - RD_ACTIVE_FLOOR) * (K_MULT_MAX - 1)
  const gamesFloor = (gamesPlayed ?? 0) < 5 ? 1.5 : 1.0
  return Math.round(Math.max(gamesFloor, rdPart) * 100) / 100
}

// 경기 1건 후 RD 축소(프리뷰용). SQL bmg_decay_rd와 동일.
export function decayRD(rd) {
  return Math.max(RD_ACTIVE_FLOOR, Math.round((rd ?? RD_NEW) * RD_DECAY * 10) / 10)
}

// 무활동 RD 증가(복귀 샌드배깅 자동 흡수, 전략 3-5). 주기 배치용.
export function inflateRD(rd, monthsInactive = 0) {
  const grown = Math.sqrt((rd ?? RD_ACTIVE_FLOOR) ** 2 + (INACTIVITY_C ** 2) * Math.max(0, monthsInactive))
  return Math.min(RD_MAX, Math.round(grown * 10) / 10)
}

// provisional(잠정) 여부: RD가 임계 초과 또는 경기 부족.
export function isProvisional(rd, gamesPlayed = 0) {
  return (rd ?? RD_NEW) > RD_PROVISIONAL || (gamesPlayed ?? 0) < MIN_RANKED_GAMES
}

// ── 4. 초보자 신뢰도 뱃지 (숫자 대신 상태) ────────────────────────
// reliabilityLabel(rd, games, relScore?) → { text, pct, tone }
//   초기(경기<5): RD 기반 '측정 중'. 성숙(경기>=5): reliability.js score를 우선.
//   → rating.js가 "선험 RD"와 "사후 reliability"를 잇는 브리지. UI는 이 함수만 부르면 됨.
export function reliabilityLabel(rd, games = 0, relScore = null) {
  const rdPct = Math.round(
    clamp((RD_MAX - (rd ?? RD_NEW)) / (RD_MAX - RD_ACTIVE_FLOOR), 0, 1) * 100
  )
  // 성숙 구간: reliability.js 점수가 있으면 그것을 신뢰(단일 소스 위임).
  if ((games ?? 0) >= MIN_RANKED_GAMES && relScore != null) {
    const verified = relScore >= MIN_RANKED_RELIABILITY && !isProvisional(rd, games)
    return {
      text: verified ? '검증완료' : '측정 중',
      pct: relScore,
      tone: reliabilityTier(relScore).color,   // emerald|amber|gray
    }
  }
  // 초기 구간: RD 기반.
  return {
    text: isProvisional(rd, games) ? '측정 중' : '검증완료',
    pct: rdPct,
    tone: rdPct >= 75 ? 'emerald' : rdPct >= 45 ? 'amber' : 'gray',
  }
}

// ── 5. 온보딩 교차검증 샌드배깅 플래그 (급수↔급수) ────────────────
// crossCheckSandbag(selfGrade, inferredGrade) → { flagged, gap, level, reason }
//   신고 급수가 (임포트/이력) 역추정 급수보다 2급 이상 낮으면 검증 큐 회부(전략 4 넣는다①).
//   sandbag.js(MMR 기반, 경기 후)와 상보: 이건 경기 0건 온보딩 시점 규칙 기반.
export function crossCheckSandbag(selfGrade, inferredGrade) {
  const selfIdx     = Math.max(0, getGradeIndex(selfGrade))
  const inferredIdx = Math.max(0, getGradeIndex(inferredGrade))
  const gap = inferredIdx - selfIdx   // 양수 = 신고가 실제보다 낮음(언더디클레어)
  let level = 'none'
  if (gap >= 2) level = 'high'
  else if (gap >= 1) level = 'watch'
  return {
    flagged: gap >= 2,
    gap,
    level,
    reason: gap >= 1
      ? `역추정 ${inferredGrade} vs 신고 ${selfGrade} — ${gap}급 낮게 신고`
      : null,
  }
}

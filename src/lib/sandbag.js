// ── 샌드배깅(급수 사기) 방지 엔진 (4-3) ──────────────────────────
// 신고 급수(official_grade)와 실제 실력 지표(MMR) 사이의 괴리를 탐지한다.
// 서버 스키마 변경 없이 이미 쌓이는 데이터(mmr, mmr_games_played,
// official_grade, tournament_entries.final_rank)만으로 판정한다.
import { GRADES, getGradeIndex } from './grades'

// MMR 신뢰에 필요한 최소 경기 수 — 이보다 적으면 MMR을 확정 근거로 쓰지 않는다.
const RELIABLE_GAMES = 5

// MMR이 실제로 어느 급수 수준인지 역추정 (초기 MMR 밴드 기준)
export function getGradeFromMMR(mmr) {
  const m = mmr ?? 1000
  for (let i = GRADES.length - 1; i >= 0; i--) {
    if (m >= GRADES[i].initialMMR) return GRADES[i].key
  }
  return GRADES[0].key
}

// 신청자 1명에 대한 샌드배깅 위험 평가
//   level: 'none' | 'watch'(주의) | 'high'(강한 의심)
//   gap:   MMR 추정 급수가 신고 급수보다 몇 단계 높은가
export function assessSandbag(profile, category = null) {
  const out = { level: 'none', impliedGrade: null, gap: 0, reliable: true, reasons: [] }
  if (!profile) return out

  const mmr = profile.mmr ?? 1000
  const games = profile.mmr_games_played ?? 0
  const claimedIdx = Math.max(0, getGradeIndex(profile.official_grade))
  const impliedGrade = getGradeFromMMR(mmr)
  const impliedIdx = getGradeIndex(impliedGrade)
  const gap = impliedIdx - claimedIdx

  out.impliedGrade = impliedGrade
  out.gap = gap
  out.reliable = games >= RELIABLE_GAMES

  // (1) 신고 급수보다 MMR이 높음 = 언더-디클레어(샌드배깅) 의심
  if (gap >= 1) {
    out.reasons.push(
      `실제 MMR ${mmr}는 ${impliedGrade} 수준 — 신고 급수 ${profile.official_grade}보다 ${gap}단계 높음`
    )
  }

  // (2) 종목 상한 초과 수준
  let overCap = false
  if (category?.grade_max) {
    const capIdx = getGradeIndex(category.grade_max)
    if (capIdx >= 0 && impliedIdx > capIdx) {
      overCap = true
      out.reasons.push(`이 종목 상한(${category.grade_max} 이하)보다 실력(MMR)이 높음`)
    }
  }
  if (category?.max_mmr && mmr > category.max_mmr) {
    overCap = true
    out.reasons.push(`종목 MMR 상한 ${category.max_mmr} 초과 (현재 ${mmr})`)
  }

  // 레벨 산정
  let level = 'none'
  if (gap >= 2 || overCap) level = 'high'
  else if (gap >= 1) level = 'watch'

  // 표본 부족 시 완화 — 소수 경기의 MMR은 확정 근거로 쓸 수 없다
  if (!out.reliable && level === 'high') level = 'watch'
  if (!out.reliable && out.reasons.length) {
    out.reasons.push(`경기 표본 부족(${games}경기) — MMR 신뢰도 낮음`)
  }

  out.level = level
  return out
}

// 팀(복식 2명 등) 중 가장 높은 위험 레벨을 대표값으로
export function worseLevel(a, b) {
  const order = { none: 0, watch: 1, high: 2 }
  return order[a] >= order[b] ? a : b
}

// UI 스타일 매핑
export const SANDBAG_STYLE = {
  none:  null,
  watch: { label: '주의',        badge: 'bg-amber-100 text-amber-700', box: 'bg-amber-50 text-amber-800' },
  high:  { label: '샌드배깅 의심', badge: 'bg-red-100 text-red-700',     box: 'bg-red-50 text-red-700' },
}

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

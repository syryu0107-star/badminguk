// ══════════════════════════════════════════════════════════════════
// 대회 탐색 추천 (C12) — 로그인 선수에게 "급수·지역 맞춤" 대회를 개인화 추천.
//
// 지금껏 대회 찾기 화면은 상태 필터 + 대회명/장소 텍스트 검색만 있어, 선수가
// "내가 참가할 수 있는·자주 가던 지역의·마감 임박한" 대회를 직접 눈으로 훑어야 했다.
// 이 엔진은 대진DB(내 참가 이력)와 내 급수를 종합해 "나에게 맞는 대회"를 골라 준다.
//
// 순수 엔진: Supabase·React 의존 없음. 자격 판정은 호출부가 fitOf 로 주입해
// lib/grades.js checkEligibility(신청 화면과 동일 로직)를 그대로 재사용한다(중복 0).
// ══════════════════════════════════════════════════════════════════

// 17 시·도 (alias 로 venue/주소 문자열에서 관대 매칭)
export const SIDO = [
  { token: '서울', aliases: ['서울'] },
  { token: '부산', aliases: ['부산'] },
  { token: '대구', aliases: ['대구'] },
  { token: '인천', aliases: ['인천'] },
  { token: '광주', aliases: ['광주'] },
  { token: '대전', aliases: ['대전'] },
  { token: '울산', aliases: ['울산'] },
  { token: '세종', aliases: ['세종'] },
  { token: '경기', aliases: ['경기'] },
  { token: '강원', aliases: ['강원'] },
  { token: '충북', aliases: ['충북', '충청북도'] },
  { token: '충남', aliases: ['충남', '충청남도'] },
  { token: '전북', aliases: ['전북', '전라북도'] },
  { token: '전남', aliases: ['전남', '전라남도'] },
  { token: '경북', aliases: ['경북', '경상북도'] },
  { token: '경남', aliases: ['경남', '경상남도'] },
  { token: '제주', aliases: ['제주'] },
]

// 시·도 이미 커버되는 광역 접미어 — 세밀 토큰에서 제외(중복 방지)
const FINE_BLOCK = /(특별시|광역시|자치시|자치도)$/

// venue·주소 문자열에서 지역 토큰 추출: [시·도] + [시/군/구 세밀 단위] (중복 제거).
export function regionTokens(...parts) {
  const text = parts.filter(Boolean).map(String).join(' ')
  if (!text.trim()) return []
  const out = []
  for (const r of SIDO) {
    if (r.aliases.some(a => text.includes(a))) { out.push(r.token); break }
  }
  for (const m of text.matchAll(/([가-힣]{2,4}(?:시|군|구))/g)) {
    if (!FINE_BLOCK.test(m[1])) { out.push(m[1]); break }
  }
  return [...new Set(out)]
}

// 내 참가 이력 대회들의 지역을 집계해 자주 가던 지역을 빈도순으로 반환.
export function preferredRegions(pastTournaments = []) {
  const tally = new Map()
  for (const t of pastTournaments ?? []) {
    if (!t) continue
    for (const tok of regionTokens(t.venue, t.venue_address)) {
      tally.set(tok, (tally.get(tok) ?? 0) + 1)
    }
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([tok]) => tok)
}

// 'YYYY-MM-DD'|'YYYY-MM-DDThh:mm'|ms → 로컬 자정 ms (타임존 밀림 방지). 파싱 실패 시 null.
function dayStart(v) {
  if (v == null) return null
  let d
  if (typeof v === 'number') {
    d = new Date(v)
  } else {
    const [y, mo, da] = String(v).slice(0, 10).split('-').map(Number)
    if (!y || !mo || !da) return null
    d = new Date(y, mo - 1, da)
  }
  if (Number.isNaN(d.getTime())) return null
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

// 오늘 대비 D-day (음수=지남). 파싱 실패 시 null.
export function ddayOf(dateStr, now = Date.now()) {
  const target = dayStart(dateStr)
  const today = dayStart(now)
  if (target == null || today == null) return null
  return Math.round((target - today) / 86400000)
}

// ── 핵심: 나에게 맞는 대회 추천 ─────────────────────────────────────
// tournaments : select('*, categories:tournament_categories(*)') 형태 배열
// appliedIds  : 내가 이미 신청한 대회 id (Set|배열) — 추천에서 제외
// fitOf       : (t) => { eligibleCount, totalCats } — 내 급수로 참가 가능한 종목 수
// myRegions   : preferredRegions() 결과 (자주 가던 지역 토큰, 빈도순)
// 반환: [{ tournament, score, reasons[], eligibleCount, regionMatch, dday }] score 내림차순
export function recommendTournaments({
  tournaments = [],
  appliedIds,
  fitOf,
  myRegions = [],
  now = Date.now(),
  limit = 5,
} = {}) {
  const applied = appliedIds instanceof Set ? appliedIds : new Set(appliedIds ?? [])
  const regionSet = new Set(myRegions ?? [])
  const today = dayStart(now)
  const out = []

  for (const t of tournaments ?? []) {
    if (!t || t.status !== 'open') continue          // 접수중 대회만 추천
    if (applied.has(t.id)) continue                  // 이미 신청한 대회 제외

    const day = dayStart(t.date)
    if (day != null && today != null && day < today) continue   // 지난 대회 제외

    // 급수 자격: 참가 가능한 종목이 하나도 없으면 추천하지 않는다(신청 못 하는 대회 노출 방지)
    const fit = (fitOf ? fitOf(t) : null) ?? {}
    const eligibleCount = fit.eligibleCount ?? 0
    if (eligibleCount <= 0) continue

    const tRegions = regionTokens(t.venue, t.venue_address)
    const regionMatch = tRegions.find(r => regionSet.has(r)) ?? null
    const dday = ddayOf(t.registration_end ?? t.date, now)

    let score = 100 + Math.min(eligibleCount, 3) * 5
    const reasons = [{ kind: 'grade', text: `내 급수로 참가할 수 있는 종목 ${eligibleCount}개` }]

    if (regionMatch) {
      score += 40
      reasons.push({ kind: 'region', text: `내가 자주 가던 지역 · ${regionMatch}` })
    }
    if (dday != null && dday >= 0 && dday <= 7) {
      score += (8 - dday) * 4
      reasons.push({
        kind: 'deadline',
        text: dday === 0 ? '접수 마감 오늘' : `접수 마감 D-${dday}`,
        urgent: dday <= 2,
      })
    }
    // 대회일이 가까울수록 소폭 가산(임박 대회 우선)
    if (day != null && today != null) {
      const dToEvent = Math.round((day - today) / 86400000)
      if (dToEvent >= 0 && dToEvent <= 30) score += Math.max(0, 8 - Math.floor(dToEvent / 4))
    }

    out.push({ tournament: t, score, reasons, eligibleCount, regionMatch, dday })
  }

  out.sort((a, b) => b.score - a.score || (a.dday ?? 999) - (b.dday ?? 999))
  return out.slice(0, limit)
}

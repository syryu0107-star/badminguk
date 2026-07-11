// C12 파트너 매칭 — 지난 대회에 함께 출전한 파트너를 이번 대회 종목에 맞춰 추천.
// 순수 함수(스키마·외부 키·LLM 불필요). 자격 검사는 호출부의 checkEligibility를
// 주입받아 종목별 급수·MMR 게이트를 그대로 재사용한다(중복 로직 0).
//
// 복식 종목에서 "파트너를 전화번호/이름으로 검색"만 있던 신청 단계에, 대진DB에서
// 개인화한 "예전 함께 나간 파트너 다시 초대" 추천을 얹어 선수 완주의 마찰을 줄인다.

// 파트너 프로필 조회에 필요한 컬럼(자격 검사 + 표시 + 신청 삽입용).
// TournamentDetail.searchPartner 의 cols 와 동일 집합을 재사용한다.
export const PARTNER_COLS =
  'id,name,phone,official_grade,grade_verified,mmr,singles_mmr,mmr_games_played,' +
  'grade_gu_dbl,grade_si_dbl,grade_nat_dbl,grade_gu_sgl,grade_si_sgl,grade_nat_sgl'

// entries: [{ player1_id, player2_id, created_at }] — 내가 낀 복식 신청 이력(전 대회)
// myId  : 내 프로필 id
// → [{ partnerId, count, lastAt }]  함께 출전 횟수 내림차순·최근 출전순
export function collectPastPartners(entries, myId) {
  if (!Array.isArray(entries) || !myId) return []
  const map = new Map()
  for (const e of entries) {
    if (!e) continue
    const p1 = e.player1_id
    const p2 = e.player2_id
    if (!p2) continue                                  // 단식·파트너 미지정 제외
    const other = p1 === myId ? p2 : (p2 === myId ? p1 : null)
    if (!other || other === myId) continue             // 내가 안 낀 행·자기자신 방어
    const at = e.created_at || ''
    const cur = map.get(other)
    if (cur) {
      cur.count += 1
      if (at > cur.lastAt) cur.lastAt = at
    } else {
      map.set(other, { partnerId: other, count: 1, lastAt: at })
    }
  }
  return [...map.values()].sort(
    (a, b) => (b.count - a.count) || (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0)
  )
}

// candidates: [{ profile, count, lastAt }] — profile 은 PARTNER_COLS 컬럼 포함
// isEligible : (profile) => { ok, reason }  (호출부 checkEligibility(_, cat, t) 바인딩)
// → [{ profile, count, lastAt, eligible, reason }]  자격 통과 먼저·횟수·최근순
export function rankPartnerSuggestions(candidates, isEligible) {
  if (!Array.isArray(candidates)) return []
  const check = typeof isEligible === 'function' ? isEligible : () => ({ ok: true })
  return candidates
    .filter(c => c && c.profile)
    .map(c => {
      const r = check(c.profile) || { ok: true }
      return {
        profile:  c.profile,
        count:    c.count || 0,
        lastAt:   c.lastAt || '',
        eligible: !!r.ok,
        reason:   r.ok ? '' : (r.reason || ''),
      }
    })
    .sort((a, b) =>
      (Number(b.eligible) - Number(a.eligible)) ||
      (b.count - a.count) ||
      (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0)
    )
}

// 추천 사유 한 줄(초보용)
export function partnerReason(count) {
  const n = Number(count) || 0
  if (n >= 3) return `함께 ${n}번 출전한 단골 파트너`
  if (n === 2) return '함께 2번 출전한 파트너'
  return '지난 대회 파트너'
}

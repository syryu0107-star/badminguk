// ── 노쇼(불참) 예측 엔진 ─────────────────────────────────────────
// 북극성 AI 차별화 #5: "과거 패턴 기반 오버부킹/예비명단".
// 스키마 변경·외부 키·LLM 불필요. 기존 데이터(tournament_matches의 부전승 기록)만으로
// "이 신청자가 대회 당일 안 나올 확률"을 규칙 기반으로 추정해, 주최자가 접수·승인 단계에서
// 예비팀(대기명단)을 얼마나 확보할지 판단을 돕는다. 판정은 순수 함수라 자체 검증이 쉽다.
//
// 신호: 과거 대회에서 그 선수의 팀이 result_type='walkover'(불참·부전승)로 처리된 이력.
//   - "불참"은 '경기 중 기권(retired)'·'실격(disqualified)'과 구분한다(walkover만 노쇼로 본다).
//   - 대회 단위로 집계한다(한 대회에서 여러 경기를 walkover 처리해도 1회로). 한 번의 불참이
//     조별리그 여러 경기를 부전패시켜 rate가 과장되는 것을 방지.

// 위험 티어 스타일(정적 매핑 — 동적 Tailwind 클래스는 빌드에서 누락되므로)
export const NOSHOW_STYLE = {
  high:   { label: '불참 위험 높음', badge: 'bg-red-100 text-red-700',    dot: 'bg-red-500' },
  medium: { label: '불참 이력',      badge: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  low:    { label: '',               badge: 'bg-gray-100 text-gray-500',   dot: 'bg-gray-400' },
  none:   { label: '',               badge: '',                            dot: '' },
}

// 신뢰할 만한 예측을 위한 최소 참가 대회 수(표본). 미만이면 'none'(판단 보류).
export const MIN_HISTORY = 3

// 대기명단 추천 계산에서 빼는 상태(결제·팀 확정 전이라 아직 확정 신청 아님)
export const DEFAULT_EXCLUDE = [
  'withdrawn', 'cancelled', 'rejected', 'partner_pending', 'partner_rejected',
]

/**
 * 선수 한 명의 집계({appearances, noShows})로 불참 위험을 판정.
 *  - appearances: 참가한(경기를 치른) 서로 다른 과거 대회 수
 *  - noShows: 그 중 불참(walkover)으로 기록된 대회 수
 * @returns {{ level:'high'|'medium'|'low'|'none', rate:number, appearances:number, noShows:number, label:string|null }}
 */
export function predictNoShow(stat) {
  const appearances = Math.max(0, Math.floor(stat?.appearances ?? 0))
  const noShows = Math.max(0, Math.floor(stat?.noShows ?? 0))
  // 표본 부족: 판단 보류. 단, 이미 2회 이상 불참이면 표본이 적어도 경고(강한 신호).
  if (appearances < MIN_HISTORY && noShows < 2) {
    return { level: 'none', rate: 0, appearances, noShows, label: null }
  }
  const denom = Math.max(appearances, noShows, 1)
  const rate = noShows / denom
  let level = 'low'
  if (noShows >= 2 && rate >= 0.4) level = 'high'
  else if (noShows >= 1 && rate >= 0.2) level = 'medium'
  const label = level === 'high'
    ? `최근 ${appearances}개 대회 중 ${noShows}회 불참`
    : level === 'medium'
      ? `과거 ${noShows}회 불참 이력`
      : null
  return { level, rate, appearances, noShows, label }
}

/**
 * 과거 신청 이력(entry→선수)과 과거 경기(부전승 기록)로 선수별 불참 통계 Map을 만든다.
 *  - historyEntries: [{ id, player1_id, player2_id }] — 신청자들의 과거 전 신청
 *  - matches: [{ team1_entry_id, team2_entry_id, result_type, forfeit_team, status,
 *               category:{tournament_id} | tournament_id }]
 * @returns {Map<string,{appearances:number, noShows:number}>}
 */
export function buildNoShowIndex({ historyEntries = [], matches = [] } = {}) {
  const entryPlayers = new Map()  // entryId → [playerId,...]
  for (const e of historyEntries) {
    if (!e?.id) continue
    entryPlayers.set(e.id, [e.player1_id, e.player2_id].filter(Boolean))
  }
  // playerId → { tourneys:Set, noShowTourneys:Set }
  const acc = new Map()
  const get = pid => {
    let r = acc.get(pid)
    if (!r) { r = { tourneys: new Set(), noShowTourneys: new Set() }; acc.set(pid, r) }
    return r
  }
  for (const m of matches ?? []) {
    if (!m) continue
    // bye·미완료는 참가 기회로 세지 않는다
    if (m.status && !['completed', 'forfeited'].includes(m.status)) continue
    const tid = m.tournament_id ?? m.category?.tournament_id
    if (!tid) continue
    const t1 = entryPlayers.get(m.team1_entry_id) ?? []
    const t2 = entryPlayers.get(m.team2_entry_id) ?? []
    for (const pid of [...t1, ...t2]) get(pid).tourneys.add(tid)
    if (m.result_type === 'walkover' && (m.forfeit_team === 1 || m.forfeit_team === 2)) {
      const absent = m.forfeit_team === 1 ? t1 : t2
      for (const pid of absent) get(pid).noShowTourneys.add(tid)
    }
  }
  const out = new Map()
  for (const [pid, r] of acc) {
    out.set(pid, { appearances: r.tourneys.size, noShows: r.noShowTourneys.size })
  }
  return out
}

// 위험 레벨 강도 비교(worse 우선)
const RANK = { none: 0, low: 1, medium: 2, high: 3 }
export function worseNoShow(a, b) {
  return (RANK[a] ?? 0) >= (RANK[b] ?? 0) ? a : b
}

/**
 * 신청(entry)의 불참 위험 — 소속 선수 중 가장 높은 위험을 대표로.
 * idx: playerId → {appearances,noShows} (Map 또는 plain object 모두 허용)
 */
export function entryNoShowRisk(entry, idx) {
  const lookup = pid => {
    if (!pid || !idx) return null
    return typeof idx.get === 'function' ? idx.get(pid) : idx[pid]
  }
  const players = [entry?.player1, entry?.player2].filter(Boolean)
  let best = { level: 'none', rate: 0, appearances: 0, noShows: 0, label: null }
  for (const p of players) {
    const pred = predictNoShow(lookup(p.id))
    if (RANK[pred.level] > RANK[best.level]) best = { ...pred, playerName: p.name }
  }
  return best
}

/**
 * 활성 종목 신청들에 대한 예비명단(오버부킹) 추천.
 *  - 유효 신청(철회·거절·미확정 제외)의 기대 불참 팀 수 = Σ per-entry rate 를 올림.
 *  - 위험 신청 목록과 초보용 헤드라인 반환.
 * @returns {{ expectedNoShows:number, waitlist:number, highCount:number, mediumCount:number,
 *             flagged:Array, headline:string|null }}
 */
export function recommendWaitlist(entries = [], idx = null, { excludeStatuses = DEFAULT_EXCLUDE } = {}) {
  const exclude = new Set(excludeStatuses)
  let expected = 0, highCount = 0, mediumCount = 0
  const flagged = []
  for (const e of entries ?? []) {
    if (exclude.has(e?.entry_status)) continue
    const risk = entryNoShowRisk(e, idx)
    if (risk.level === 'none' || risk.level === 'low') continue
    // 팀 단위 기대 불참 — 팀 대표 선수의 rate(과대추정 방지 위해 0.9로 클램프)
    expected += Math.min(risk.rate, 0.9)
    if (risk.level === 'high') highCount += 1
    else mediumCount += 1
    flagged.push({ entryId: e.id, risk })
  }
  // 위험도 높은 순 정렬
  flagged.sort((a, b) => (RANK[b.risk.level] - RANK[a.risk.level]) || (b.risk.rate - a.risk.rate))
  const waitlist = Math.ceil(expected - 1e-9)
  const headline = waitlist > 0
    ? `불참 위험 신청 ${highCount + mediumCount}팀 — 예비팀 ${waitlist}팀 확보를 권장해요`
    : (highCount + mediumCount > 0
        ? `불참 이력이 있는 신청 ${highCount + mediumCount}팀 — 참고하세요`
        : null)
  return { expectedNoShows: expected, waitlist, highCount, mediumCount, flagged, headline }
}

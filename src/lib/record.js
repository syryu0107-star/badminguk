// 통합 전적 (C12 대회 탐색·파트너 매칭·통합 전적 — 통합 전적 뷰)
// ──────────────────────────────────────────────────────────────────────
// 목적: 한 선수가 지금까지 나간 "모든 대회"의 실제 경기 기록을 한 곳에 모아
//       전체 승패·승률·세트/점수 득실과 "상대 전적"(자주 만난 상대별 W/L)을
//       보여준다. 지금껏 프로필의 "대회 커리어" 탭은 대회 목록·신청 상태만
//       나열했고(경기 결과 없음), 헤더의 승/패는 mmr_history delta 근사치라
//       "내가 저 사람한테 몇 승 몇 패인지" 같은 실제 전적을 볼 수 없었다.
//       이 엔진이 tournament_matches(+match_scores)만으로 그 통합 전적을 만든다.
//
// 순수 함수만 담는다(스키마 변경·외부 키·LLM 없음). 기존 데이터
// (내가 낀 엔트리들의 완료 경기 + 세트 점수 + 상대 팀 선수 프로필)로 계산한다.
// highlight.js computePlayerStats는 "한 대회·한 엔트리" 집계라, 여러 대회를
// 가로지르고 "상대 선수별"로 쪼개는 이 집계와는 목적이 달라 별도로 둔다.

const FINISHED = new Set(['completed', 'forfeited', 'bye'])

/** 팀(엔트리)에서 "나"를 뺀 상대 선수 목록 [{id,name}] (단식 1명·복식 2명, 방어적 중복/누락 제거) */
export function opponentPlayers(entry, myPlayerId) {
  if (!entry) return []
  const raw = [entry.player1, entry.player2].filter(Boolean)
  const seen = new Set()
  const out = []
  for (const p of raw) {
    if (!p?.id || p.id === myPlayerId || seen.has(p.id)) continue
    seen.add(p.id)
    out.push({ id: p.id, name: p.name || '상대' })
  }
  // 팀명만 있고 선수 프로필이 없는 경우(예: 게스트 팀) — 이름 기반 단일 상대로 폴백
  if (!out.length && entry.team_name) out.push({ id: `team:${entry.team_name}`, name: entry.team_name })
  return out
}

/**
 * 내가 낀 모든 경기에서 통합 전적을 집계한다(순수).
 * @param {object} p
 *  - matches: tournament_matches 배열. 각 항목은
 *      { id, status, team1_entry_id, team2_entry_id, winner_entry_id,
 *        team1:{id,team_name,player1,player2}, team2:{...},
 *        scores:[{set_number,team1_score,team2_score}],
 *        category:{ sport_type, tournament:{ id, title, date } } }
 *  - myEntryIds: 내 엔트리 id 집합(Set 또는 배열)
 *  - myPlayerId: 내 프로필 id(상대 목록에서 나를 빼는 용도)
 * @returns {{
 *   totals: {...}, winRate: number|null, tournaments: number,
 *   byOpponent: [{ id, name, wins, losses, games }]  // 자주 만난 순
 * }}
 */
export function computeCareerRecord({ matches, myEntryIds, myPlayerId = null } = {}) {
  const mine = myEntryIds instanceof Set
    ? myEntryIds
    : new Set(Array.isArray(myEntryIds) ? myEntryIds : [])

  const totals = {
    played: 0,            // 실제로 점수를 겨룬 경기 수(부전·부전승 제외)
    wins: 0, losses: 0,   // 부전승/부전패 포함 전체 승패
    walkoverWins: 0, walkoverLosses: 0,
    setsWon: 0, setsLost: 0,
    pointsFor: 0, pointsAgainst: 0,
    fullSets: 0,          // 3세트까지 간 접전 경기 수
  }
  const oppMap = new Map()  // playerId → { id, name, wins, losses }
  const tourSet = new Set()

  const bumpOpp = (players, won) => {
    for (const pl of players) {
      let rec = oppMap.get(pl.id)
      if (!rec) { rec = { id: pl.id, name: pl.name, wins: 0, losses: 0 }; oppMap.set(pl.id, rec) }
      if (won) rec.wins++; else rec.losses++
      // 이름이 나중 경기에 더 최신일 수 있으니 비어있지 않으면 갱신
      if (pl.name && pl.name !== '상대') rec.name = pl.name
    }
  }

  for (const m of matches ?? []) {
    if (!m || !FINISHED.has(m.status)) continue
    const isT1 = mine.has(m.team1_entry_id)
    const isT2 = mine.has(m.team2_entry_id)
    if (!isT1 && !isT2) continue        // 내가 안 낀 경기
    if (isT1 && isT2) continue          // 이론상 불가(자기 자신) — 방어

    const myEntryId = isT1 ? m.team1_entry_id : m.team2_entry_id
    const oppEntry = isT1 ? m.team2 : m.team1
    const won = m.winner_entry_id === myEntryId
    const lost = m.winner_entry_id && m.winner_entry_id !== myEntryId
    if (!won && !lost) continue         // 승자 미정 완료(방어)

    const tId = m.category?.tournament?.id
    if (tId) tourSet.add(tId)

    // 부전승/부전패 — 승패 카운트만, 세트/점수·(상대 없는 bye는) 상대전적 제외
    if (m.status === 'bye' || m.status === 'forfeited') {
      if (won) { totals.wins++; totals.walkoverWins++ }
      else { totals.losses++; totals.walkoverLosses++ }
      const opps = opponentPlayers(oppEntry, myPlayerId)
      if (m.status === 'forfeited' && opps.length) bumpOpp(opps, won)  // 부전은 실제 상대가 있는 결과
      continue
    }

    // completed — 실제 경기
    if (won) totals.wins++; else totals.losses++
    bumpOpp(opponentPlayers(oppEntry, myPlayerId), won)

    const sets = [...(m.scores ?? [])].sort((a, b) => (a.set_number ?? 0) - (b.set_number ?? 0))
    if (sets.length === 0) continue     // 점수 미입력 완료: 승패만
    totals.played++
    if (sets.length >= 3) totals.fullSets++
    for (const s of sets) {
      const my = isT1 ? (s.team1_score ?? 0) : (s.team2_score ?? 0)
      const opp = isT1 ? (s.team2_score ?? 0) : (s.team1_score ?? 0)
      totals.pointsFor += my
      totals.pointsAgainst += opp
      if (my > opp) totals.setsWon++
      else if (opp > my) totals.setsLost++
    }
  }

  const totalDecided = totals.wins + totals.losses
  const byOpponent = [...oppMap.values()]
    .map(o => ({ ...o, games: o.wins + o.losses }))
    .sort((a, b) => b.games - a.games || b.wins - a.wins || a.name.localeCompare(b.name, 'ko'))

  return {
    totals,
    winRate: totalDecided === 0 ? null : Math.round((totals.wins / totalDecided) * 100),
    tournaments: tourSet.size,
    byOpponent,
  }
}

/** 카드 노출 여부 — 집계된 경기가 하나라도 있어야 의미가 있다 */
export function hasCareerRecord(record) {
  if (!record) return false
  return (record.totals.wins + record.totals.losses) > 0
}

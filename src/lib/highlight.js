// 개인 대회 하이라이트 요약 (C11 사후 커뮤니케이션 — 하이라이트 요약)
// ──────────────────────────────────────────────────────────────────────
// 목적: 대회가 끝나면 선수 한 명 한 명에게 "내 대회는 어땠나"를 앱이 스스로
//       정리해 준다 — 총 경기·승패, 세트/점수 득실, 가장 접전이었던 명장면,
//       MMR 변동, 그리고 초보자도 기분 좋게 읽을 격려 문구와 다음 목표.
//       선수 완주(신청→…→결과·급수·상장)의 마지막에 "회고" 한 장을 더해
//       선수 플로우가 화면 하나로 감정적으로도 완결되게 한다.
//
// 순수 함수만 담는다(스키마 변경·외부 키·LLM 없음). 기존 데이터
// (tournament_matches + match_scores, mmr_history 합산 delta)만으로 계산.
// 내러티브는 규칙 기반이라 키 없이 완결 동작한다(실LLM 다듬기는 future·human-gated).

import { certRankInfo } from './certificate'

// 팀 표기 (Results.jsx teamLabel과 동일 규칙)
function entryLabel(entry) {
  if (!entry) return '상대'
  if (entry.team_name) return entry.team_name
  const names = [entry.player1?.name, entry.player2?.name].filter(Boolean)
  return names.length ? names.join(' / ') : '상대'
}

const FINISHED = new Set(['completed', 'forfeited', 'bye'])

/**
 * 한 팀(entryId)의 대회 성적을 경기 기록에서 집계한다(순수).
 * @param {Array}  matches    이 종목의 tournament_matches(+scores) 배열
 * @param {string} entryId    내 팀 entry id
 * @param {object} entryById  entry id → entry (상대 이름 조회용)
 */
export function computePlayerStats(matches, entryId, entryById = {}) {
  const stats = {
    played: 0,          // 실제로 점수를 겨룬 경기 수(부전/부전승 제외)
    wins: 0, losses: 0, // 부전승/부전패 포함 전체 승패
    walkoverWins: 0, walkoverLosses: 0,
    setsWon: 0, setsLost: 0,
    pointsFor: 0, pointsAgainst: 0,
    fullSetCount: 0,    // 3세트까지 간 접전 경기 수
    closest: null,      // { opponent, myScore, oppScore, margin, won }
    bestWin: null,      // { opponent, myScore, oppScore } 가장 큰 점수차 승
  }
  if (!entryId || !Array.isArray(matches)) return stats

  for (const m of matches) {
    if (!m || !FINISHED.has(m.status)) continue
    const isT1 = m.team1_entry_id === entryId
    const isT2 = m.team2_entry_id === entryId
    if (!isT1 && !isT2) continue

    const oppId = isT1 ? m.team2_entry_id : m.team1_entry_id
    const oppLabel = entryLabel(entryById[oppId])
    const won = m.winner_entry_id === entryId
    const lost = m.winner_entry_id && m.winner_entry_id !== entryId

    // 부전승/부전패(bye·forfeited)는 승패에만 반영, 세트·점수는 세지 않음
    if (m.status === 'bye' || m.status === 'forfeited') {
      if (won) { stats.wins++; stats.walkoverWins++ }
      else if (lost) { stats.losses++; stats.walkoverLosses++ }
      continue
    }

    // completed — 실제 경기
    const sets = [...(m.scores ?? [])].sort((a, b) => (a.set_number ?? 0) - (b.set_number ?? 0))
    if (sets.length === 0) {
      // 점수 미입력 완료 경기: 승패만 반영
      if (won) stats.wins++
      else if (lost) stats.losses++
      continue
    }

    stats.played++
    if (won) stats.wins++
    else if (lost) stats.losses++
    if (sets.length >= 3) stats.fullSetCount++

    for (const s of sets) {
      const my = isT1 ? (s.team1_score ?? 0) : (s.team2_score ?? 0)
      const opp = isT1 ? (s.team2_score ?? 0) : (s.team1_score ?? 0)
      stats.pointsFor += my
      stats.pointsAgainst += opp
      if (my > opp) stats.setsWon++
      else if (opp > my) stats.setsLost++

      const margin = Math.abs(my - opp)
      const setWon = my > opp
      // 가장 접전이었던 세트(동점차가 가장 작은 결판 세트)
      if (margin > 0 && (!stats.closest || margin < stats.closest.margin)) {
        stats.closest = { opponent: oppLabel, myScore: my, oppScore: opp, margin, won: setWon }
      }
      // 가장 통쾌한 승리(내가 이긴 세트 중 점수차 최대)
      if (setWon && (!stats.bestWin || margin > (stats.bestWin.myScore - stats.bestWin.oppScore))) {
        stats.bestWin = { opponent: oppLabel, myScore: my, oppScore: opp }
      }
    }
  }
  return stats
}

/** 승률 0~100 정수(승패 합 0이면 null) */
export function winRate(stats) {
  const total = stats.wins + stats.losses
  if (total === 0) return null
  return Math.round((stats.wins / total) * 100)
}

/**
 * 개인 하이라이트 카드 데이터를 만든다(순수).
 * @param {object} tournament  { title, date, venue }
 * @param {object} category    { sport_type, prize_spots }
 * @param {object} myEntry     내 entry(final_rank·pool_rank 포함)
 * @param {Array}  matches     이 종목 경기(+scores)
 * @param {object} entryById   entry id → entry
 * @param {number|null} mmrDelta  이 대회 MMR 총 변동(합산 delta, 없으면 null)
 * @returns {object|null}  집계할 게 없으면 null
 */
export function buildPlayerHighlight({ tournament, category, myEntry, matches, entryById = {}, mmrDelta = null }) {
  if (!myEntry) return null
  const stats = computePlayerStats(matches, myEntry.id, entryById)

  const prizeSpots = Number(category?.prize_spots) || 3
  const rank = Number(myEntry.final_rank) || null
  const cert = rank ? certRankInfo(rank, prizeSpots) : null
  const rate = winRate(stats)

  // 집계할 내용이 아무것도 없으면(경기·순위 모두 없음) 카드 숨김
  if (stats.wins + stats.losses === 0 && !rank) return null

  const medal = cert?.medal ?? (rank ? '🏅' : '🏸')

  // ── 헤드라인(감정 톤) ────────────────────────────────────────
  let headline
  if (cert && rank === 1) headline = '우승을 축하합니다! 🎉'
  else if (cert && rank === 2) headline = '준우승, 정말 멋진 대회였어요!'
  else if (cert && rank === 3) headline = '3위 입상, 값진 결과예요!'
  else if (cert) headline = `${rank}위 입상을 축하합니다!`
  else if (rate !== null && rate >= 100) headline = '전승! 완벽한 하루였어요 🔥'
  else if (rate !== null && rate >= 50) headline = '수고했어요, 좋은 경기였어요!'
  else if (stats.wins > 0) headline = '값진 승리도 있었던 대회였어요.'
  else headline = '끝까지 최선을 다한 대회였어요.'

  // ── 본문 줄(있는 정보만) ─────────────────────────────────────
  const lines = []
  const totalGames = stats.wins + stats.losses
  if (totalGames > 0) {
    lines.push(`총 ${totalGames}경기에서 ${stats.wins}승 ${stats.losses}패를 기록했어요.`)
  }
  if (stats.walkoverWins > 0 || stats.walkoverLosses > 0) {
    const parts = []
    if (stats.walkoverWins > 0) parts.push(`부전승 ${stats.walkoverWins}회`)
    if (stats.walkoverLosses > 0) parts.push(`부전패 ${stats.walkoverLosses}회`)
    lines.push(`(${parts.join(' · ')} 포함)`)
  }
  if (stats.setsWon + stats.setsLost > 0) {
    lines.push(`세트 득실 ${stats.setsWon}-${stats.setsLost}, 점수 합계 ${stats.pointsFor}점 득 · ${stats.pointsAgainst}점 실.`)
  }
  if (stats.fullSetCount > 0) {
    lines.push(`풀세트까지 간 접전이 ${stats.fullSetCount}경기 있었어요. 끝까지 포기하지 않았네요.`)
  }
  if (stats.closest && stats.closest.margin <= 3) {
    const cw = stats.closest.won ? '지켜낸' : '아쉽게 놓친'
    lines.push(`오늘의 명장면 — ${stats.closest.opponent}와 ${stats.closest.myScore}:${stats.closest.oppScore}, ${stats.closest.margin}점 차로 ${cw} 한 세트.`)
  } else if (stats.bestWin) {
    lines.push(`가장 통쾌한 승부 — ${stats.bestWin.opponent} 상대 ${stats.bestWin.myScore}:${stats.bestWin.oppScore} 완승.`)
  }
  if (typeof mmrDelta === 'number' && mmrDelta !== 0) {
    const sign = mmrDelta > 0 ? '+' : ''
    const dir = mmrDelta > 0 ? '올랐어요' : '조정됐어요'
    lines.push(`이번 대회로 MMR이 ${sign}${mmrDelta} ${dir}.`)
  }

  // ── 다음 목표(격려) ──────────────────────────────────────────
  let nextGoal
  if (cert && rank === 1) nextGoal = '다음 대회에서도 이 기세를 이어가 보세요!'
  else if (cert) nextGoal = '조금만 더 하면 정상도 노려볼 만해요. 다음 대회에서 만나요!'
  else if (rate !== null && rate >= 50) nextGoal = '다음엔 입상까지! 꾸준함이 실력이 됩니다.'
  else nextGoal = '오늘의 경험이 실력이 돼요. 다음 대회에서 더 강해진 모습으로!'

  return {
    medal,
    headline,
    lines,
    nextGoal,
    rank,
    prize: cert?.label ?? null,
    rankColor: cert?.color ?? '#003478',
    stats,
    winRate: rate,
    mmrDelta: typeof mmrDelta === 'number' ? mmrDelta : null,
  }
}

/** 공유·복사용 한 줄 요약 텍스트(순수). navigator.share / 클립보드에 사용. */
export function highlightShareText(highlight, { tournament, category } = {}) {
  if (!highlight) return ''
  const head = `[${tournament?.title ?? '배드민턴 대회'}${category?.sport_type ? ` · ${category.sport_type}` : ''}]`
  const result = highlight.prize ? `${highlight.medal} ${highlight.prize}` : (highlight.rank ? `${highlight.rank}위` : '')
  const s = highlight.stats
  const rec = (s.wins + s.losses > 0) ? `${s.wins}승 ${s.losses}패` : ''
  const mmr = highlight.mmrDelta ? `MMR ${highlight.mmrDelta > 0 ? '+' : ''}${highlight.mmrDelta}` : ''
  return [head, [result, rec, mmr].filter(Boolean).join(' · '), '— 배드민국'].filter(Boolean).join('\n')
}

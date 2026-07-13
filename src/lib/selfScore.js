// 무심판 코트 셀프 스코어 (C7 · 심판) — 선수 자가 점수 제출·합의 판정 엔진
// ──────────────────────────────────────────────────────────────────────
// 목적(북극성: 무인 진행 near-zero touch): 동호인 대회는 코트마다 심판을 둘
//   인원이 없어, 대부분 선수들이 스스로 점수를 부르고 결과만 운영진에게 알린다.
//   지금껏 배드민국은 "심판(또는 주최자)이 코트마다 기기로 매 득점을 입력"해야만
//   경기가 completed 로 넘어가 승자 진출·급수 반영이 되었다 → 무심판 코트에서는
//   자동화 체인이 멈췄다(심판 플로우 최대 잔여 공백). 이 엔진은 그 마지막 한 칸을
//   메운다: 경기에 뛴 선수가 자기 폰에서 최종 게임 점수를 제출(match_events append)
//   → 양 팀이 같은 결과를 내면(agreed) 무인 진행 시 자동 확정, 한쪽만 냈거나
//   어긋나면(pending/disputed) 주최자 예외 큐로.
//
// 이 파일은 순수 함수만 담는다 — DB 접근·발송·완료 처리는 호출부(MyMatches·
//   LiveDashboard)가 담당하고 실제 확정은 기존 advance.completeMatch 를 재사용한다
//   (점수 저장·승자 진출·MMR 반영 로직을 절대 복제하지 않는다). 점수 규정 판정은
//   bwf.isGameOver 를 재사용해 심판 점수판과 완전히 같은 규칙으로 검증한다.
//
// 스키마: match_events 에 event_type='self_score' 로 append (insert RLS 는 이미
//   "인증 사용자 삽입" 이라 선수가 넣을 수 있음). 단 008 의 chk_event_type CHECK
//   제약이 기존 타입만 허용하므로, 마이그레이션 015 로 'self_score' 를 허용값에
//   추가해야 실제 저장된다(그 전에는 insert 가 CHECK 위반으로 실패 → 호출부가
//   graceful 하게 "아직 활성화 안 됨" 안내). 판정·UI 는 지금도 데모·테스트 가능.

import { isGameOver } from './bwf'

export const SELF_SCORE_EVENT = 'self_score'

// ── 참가자 판정 ────────────────────────────────────────────────────────
// 이 경기에 뛴 선수인가 + 몇 번 팀(1|2)인가. match 는 team1/team2 에 엔트리의
// player1/player2(profiles) 를 조인해 온 형태(MyMatches·CourtReferee 와 동일).
export function participantTeam(match, userId) {
  if (!match || !userId) return null
  const inTeam = (t) =>
    !!t && (t.player1?.id === userId || t.player2?.id === userId ||
            t.player1_id === userId || t.player2_id === userId)
  if (inTeam(match.team1)) return 1
  if (inTeam(match.team2)) return 2
  return null
}

export function isMatchParticipant(match, userId) {
  return participantTeam(match, userId) != null
}

// ── 최종 게임 점수 검증·평가 ────────────────────────────────────────────
// games: [[t1,t2], ...] 선수가 입력한 게임별 최종 점수.
// bwf 규칙(21점 2점차·듀스 캡)으로 각 게임 종료 여부를 검증하고, 결승 게임까지만
// 인정해 gamesWon·winnerTeam 을 계산한다. 규정 위반·미결승이면 valid:false + 사유.
export function evaluateGames(games, { pointsPerGame = 21, gamesPerMatch = 3 } = {}) {
  const cap = pointsPerGame + 9
  const gamesToWin = Math.floor(gamesPerMatch / 2) + 1 // 1→1, 3→2, 5→3
  const rows = Array.isArray(games) ? games : []
  const clean = []
  const gamesWon = [0, 0]
  for (const g of rows) {
    if (gamesWon[0] >= gamesToWin || gamesWon[1] >= gamesToWin) break // 이미 결판
    const a = Number(g?.[0]), b = Number(g?.[1])
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) {
      return { valid: false, error: '점수는 0 이상의 숫자로 입력해주세요.' }
    }
    const w = isGameOver([a, b], { pointsPerGame, cap })
    if (!w) {
      return { valid: false, error: `각 게임은 규정대로 끝나야 해요 (예: ${pointsPerGame}-${pointsPerGame - 6}, 듀스 ${cap - 1}-${cap - 3}).` }
    }
    clean.push([a, b])
    gamesWon[w - 1] += 1
  }
  if (!clean.length) return { valid: false, error: '게임 점수를 입력해주세요.' }
  const winnerTeam = gamesWon[0] > gamesWon[1] ? 1 : gamesWon[1] > gamesWon[0] ? 2 : null
  if (!winnerTeam || Math.max(gamesWon[0], gamesWon[1]) < gamesToWin) {
    return { valid: false, error: `${gamesToWin}게임을 먼저 이긴 팀이 있어야 해요.` }
  }
  return { valid: true, games: clean, gamesWon, winnerTeam }
}

// ── match_events 페이로드 구성 (append-only) ────────────────────────────
// 검증 통과한 결과를 self_score 이벤트 행으로. match_id·created_by 는 호출부가 채운다.
export function buildSelfScoreEvent(evalResult, team) {
  if (!evalResult?.valid) return null
  const games = evalResult.games
  const last = games[games.length - 1] || [0, 0]
  return {
    event_type: SELF_SCORE_EVENT,
    team_no: team === 1 || team === 2 ? team : null,
    game_no: games.length,
    score_t1: last[0],
    score_t2: last[1],
    meta: {
      by_team: team,
      games,
      games_won: evalResult.gamesWon,
      winner_team: evalResult.winnerTeam,
    },
  }
}

// ── 제출 파싱 — 팀별 "가장 최근" 제출만 유효 ─────────────────────────────
export function parseSelfScores(events) {
  const byTeam = {}
  for (const e of events ?? []) {
    if (e?.event_type !== SELF_SCORE_EVENT) continue
    const t = e.meta?.by_team ?? e.team_no
    if (t !== 1 && t !== 2) continue
    const at = e.created_at ? new Date(e.created_at).getTime() : 0
    const cur = byTeam[t]
    if (!cur || at >= cur.at) {
      byTeam[t] = {
        team: t,
        at,
        by: e.created_by ?? null,
        games: e.meta?.games ?? [],
        gamesWon: e.meta?.games_won ?? null,
        winnerTeam: e.meta?.winner_team ?? null,
      }
    }
  }
  return { team1: byTeam[1] ?? null, team2: byTeam[2] ?? null }
}

function sameResult(a, b) {
  if (!a || !b) return false
  if (a.winnerTeam !== b.winnerTeam) return false
  const ga = a.games ?? [], gb = b.games ?? []
  if (ga.length !== gb.length) return false
  return ga.every((g, i) =>
    Number(g?.[0]) === Number(gb[i]?.[0]) && Number(g?.[1]) === Number(gb[i]?.[1]))
}

// ── 합의 판정 ──────────────────────────────────────────────────────────
//   none     — 아무도 제출 안 함
//   pending  — 한 팀만 제출 (상대 확인 대기). submission 은 그 제출.
//   agreed   — 양 팀이 같은 결과 제출 → 무인 자동 확정 가능. submission 은 합의 결과.
//   disputed — 양 팀이 서로 다른 결과 제출 → 사람(주최자) 확인 필요.
export function reconcileSelfScores(subs) {
  const { team1, team2 } = subs || {}
  const submittedTeams = [team1 && 1, team2 && 2].filter(Boolean)
  if (submittedTeams.length === 0) return { status: 'none', submittedTeams }
  if (submittedTeams.length === 1) {
    return { status: 'pending', submittedTeams, submission: team1 || team2 }
  }
  if (sameResult(team1, team2)) {
    return { status: 'agreed', submittedTeams, submission: team1 }
  }
  return { status: 'disputed', submittedTeams, team1, team2 }
}

// ── completeMatch 인자 매핑 ─────────────────────────────────────────────
// 합의(또는 주최자가 채택한) 제출 결과 → advance.completeMatch(supabase, id, args).
// 승자 엔트리 id 를 매치의 team1/team2_entry_id 에서 뽑아 넘긴다.
export function selfScoreToCompleteArgs(match, submission) {
  if (!match || !submission) return null
  const winnerTeam = submission.winnerTeam
  const winnerEntryId = winnerTeam === 1 ? match.team1_entry_id
    : winnerTeam === 2 ? match.team2_entry_id : null
  if (!winnerEntryId) return null
  const gw = submission.gamesWon ?? [0, 0]
  return {
    winnerEntryId,
    gamesWonT1: gw[0] ?? 0,
    gamesWonT2: gw[1] ?? 0,
    games: submission.games ?? [],
    resultType: 'normal',
  }
}

// 표기 유틸: "21-15, 19-21, 21-18"
export function gamesText(games) {
  return (games ?? []).map(g => `${g?.[0] ?? 0}-${g?.[1] ?? 0}`).join(', ')
}

// ── 무심판 셀프 스코어 엔진 회귀 테스트 (selfScore.js) ──────────────────
// 선수 자가 점수 제출→합의 판정이 무인 경기 확정(승자 진출·급수 반영)의 입력이라,
// 여기 불변식이 깨지면 잘못된 승자가 확정되거나(오염) 합의된 경기가 안 넘어간다.
import { test, assert } from './_harness.mjs'
import {
  participantTeam, isMatchParticipant, evaluateGames, buildSelfScoreEvent,
  parseSelfScores, reconcileSelfScores, selfScoreToCompleteArgs, gamesText,
  SELF_SCORE_EVENT,
} from '../src/lib/selfScore.js'

const MATCH = {
  team1_entry_id: 'e1', team2_entry_id: 'e2',
  team1: { id: 'e1', player1: { id: 'u1' }, player2: { id: 'u2' } },
  team2: { id: 'e2', player1: { id: 'u3' }, player2: { id: 'u4' } },
}

// ── 참가자 판정 ──
test('participantTeam: team1/team2 선수·비참가·null', () => {
  assert.equal(participantTeam(MATCH, 'u1'), 1)
  assert.equal(participantTeam(MATCH, 'u2'), 1)
  assert.equal(participantTeam(MATCH, 'u3'), 2)
  assert.equal(participantTeam(MATCH, 'u4'), 2)
  assert.equal(participantTeam(MATCH, 'stranger'), null)
  assert.equal(participantTeam(null, 'u1'), null)
  assert.equal(participantTeam(MATCH, null), null)
  assert.equal(isMatchParticipant(MATCH, 'u1'), true)
  assert.equal(isMatchParticipant(MATCH, 'x'), false)
})

test('participantTeam: player1_id/player2_id 형태(조인 없이)도 인식', () => {
  const m = { team1: { player1_id: 'a' }, team2: { player2_id: 'b' } }
  assert.equal(participantTeam(m, 'a'), 1)
  assert.equal(participantTeam(m, 'b'), 2)
})

// ── 게임 평가·검증 ──
test('evaluateGames: 정상 2-0 (21점제 best of 3)', () => {
  const r = evaluateGames([[21, 15], [21, 18]])
  assert.equal(r.valid, true)
  assert.deepEqual(r.gamesWon, [2, 0])
  assert.equal(r.winnerTeam, 1)
  assert.equal(r.games.length, 2)
})

test('evaluateGames: 풀세트 2-1 승자=team2', () => {
  const r = evaluateGames([[21, 15], [18, 21], [19, 21]])
  assert.equal(r.valid, true)
  assert.deepEqual(r.gamesWon, [1, 2])
  assert.equal(r.winnerTeam, 2)
})

test('evaluateGames: 결판 후 여분 게임은 무시(2-0 이면 3게임째 안 셈)', () => {
  const r = evaluateGames([[21, 10], [21, 12], [21, 5]])
  assert.equal(r.valid, true)
  assert.deepEqual(r.gamesWon, [2, 0])
  assert.equal(r.games.length, 2)
})

test('evaluateGames: 듀스 골든포인트 30-29 유효', () => {
  const r = evaluateGames([[30, 29], [21, 10]])
  assert.equal(r.valid, true)
  assert.equal(r.winnerTeam, 1)
})

test('evaluateGames: 미결승(2점차 안 남) 거부', () => {
  const r = evaluateGames([[21, 20], [21, 18]])
  assert.equal(r.valid, false)
  assert.ok(r.error)
})

test('evaluateGames: 1-1 미결승(승부 안 남) 거부', () => {
  const r = evaluateGames([[21, 15], [15, 21]])
  assert.equal(r.valid, false)
})

test('evaluateGames: 음수·비정수 거부, 빈 입력 거부', () => {
  assert.equal(evaluateGames([[-1, 21]]).valid, false)
  assert.equal(evaluateGames([[21, 1.5]]).valid, false)
  assert.equal(evaluateGames([]).valid, false)
  assert.equal(evaluateGames(null).valid, false)
})

test('evaluateGames: 15점제 1게임(best of 1) 지원', () => {
  const r = evaluateGames([[15, 12]], { pointsPerGame: 15, gamesPerMatch: 1 })
  assert.equal(r.valid, true)
  assert.deepEqual(r.gamesWon, [1, 0])
  assert.equal(r.winnerTeam, 1)
})

// ── 이벤트 페이로드 ──
test('buildSelfScoreEvent: self_score 타입·팀·마지막 게임 스냅샷·meta', () => {
  const ev = buildSelfScoreEvent(evaluateGames([[21, 15], [18, 21], [21, 19]]), 2)
  assert.equal(ev.event_type, SELF_SCORE_EVENT)
  assert.equal(ev.team_no, 2)
  assert.equal(ev.game_no, 3)
  assert.equal(ev.score_t1, 21)
  assert.equal(ev.score_t2, 19)
  assert.equal(ev.meta.by_team, 2)
  assert.equal(ev.meta.winner_team, 1)
  assert.deepEqual(ev.meta.games_won, [2, 1])
  assert.equal(buildSelfScoreEvent({ valid: false }, 1), null)
})

// ── 파싱·합의 ──
function evOf(team, games, at) {
  const e = evaluateGames(games)
  return { ...buildSelfScoreEvent(e, team), created_at: at, created_by: `by${team}` }
}

test('parseSelfScores: 팀별 최신 제출만 유효', () => {
  const events = [
    evOf(1, [[21, 10], [21, 12]], '2026-07-12T10:00:00Z'),
    evOf(1, [[21, 15], [21, 18]], '2026-07-12T10:05:00Z'), // 더 최신
    evOf(2, [[21, 15], [21, 18]], '2026-07-12T10:06:00Z'),
  ]
  const subs = parseSelfScores(events)
  assert.deepEqual(subs.team1.games, [[21, 15], [21, 18]]) // 최신
  assert.equal(subs.team1.by, 'by1')
  assert.equal(subs.team2.winnerTeam, 1)
})

test('reconcileSelfScores: none/pending/agreed/disputed', () => {
  assert.equal(reconcileSelfScores({}).status, 'none')

  const oneOnly = parseSelfScores([evOf(1, [[21, 15], [21, 18]], 't1')])
  const pending = reconcileSelfScores(oneOnly)
  assert.equal(pending.status, 'pending')
  assert.equal(pending.submission.winnerTeam, 1)

  const same = parseSelfScores([
    evOf(1, [[21, 15], [21, 18]], 't1'),
    evOf(2, [[21, 15], [21, 18]], 't2'),
  ])
  assert.equal(reconcileSelfScores(same).status, 'agreed')
  assert.equal(reconcileSelfScores(same).submission.winnerTeam, 1)

  const diff = parseSelfScores([
    evOf(1, [[21, 15], [21, 18]], 't1'),
    evOf(2, [[15, 21], [18, 21]], 't2'), // 서로 다른 승자
  ])
  assert.equal(reconcileSelfScores(diff).status, 'disputed')
})

// ── completeMatch 매핑 ──
test('selfScoreToCompleteArgs: 승자 엔트리·게임 승수·점수 매핑', () => {
  const subs = parseSelfScores([
    evOf(1, [[21, 15], [18, 21], [21, 19]], 't1'),
    evOf(2, [[21, 15], [18, 21], [21, 19]], 't2'),
  ])
  const rec = reconcileSelfScores(subs)
  const args = selfScoreToCompleteArgs(MATCH, rec.submission)
  assert.equal(args.winnerEntryId, 'e1') // winnerTeam 1 → team1_entry_id
  assert.deepEqual([args.gamesWonT1, args.gamesWonT2], [2, 1])
  assert.equal(args.games.length, 3)
  assert.equal(args.resultType, 'normal')
})

// 주최자 disputed 1탭 해소: 불일치 시 rec.team1/rec.team2 각각을 그대로
// selfScoreToCompleteArgs 에 넘겨 확정할 수 있어야 한다(각기 다른 승자로 매핑).
test('disputed: 양 팀 제출을 각각 확정 인자로 매핑(주최자 1탭 채택)', () => {
  const rec = reconcileSelfScores(parseSelfScores([
    evOf(1, [[21, 15], [21, 18]], 't1'), // 팀1 주장: 팀1 승
    evOf(2, [[15, 21], [18, 21]], 't2'), // 팀2 주장: 팀2 승
  ]))
  assert.equal(rec.status, 'disputed')
  const a1 = selfScoreToCompleteArgs(MATCH, rec.team1)
  const a2 = selfScoreToCompleteArgs(MATCH, rec.team2)
  assert.equal(a1.winnerEntryId, 'e1')
  assert.equal(a2.winnerEntryId, 'e2') // 다른 팀 채택 시 다른 승자
  assert.deepEqual([a1.gamesWonT1, a1.gamesWonT2], [2, 0])
  assert.deepEqual([a2.gamesWonT1, a2.gamesWonT2], [0, 2])
})

test('selfScoreToCompleteArgs: 승자 팀 엔트리 없으면 null (안전)', () => {
  const sub = { winnerTeam: 2, gamesWon: [0, 2], games: [[10, 21], [12, 21]] }
  assert.equal(selfScoreToCompleteArgs({ team1_entry_id: 'e1', team2_entry_id: null }, sub), null)
  assert.equal(selfScoreToCompleteArgs(null, sub), null)
  assert.equal(selfScoreToCompleteArgs(MATCH, null), null)
})

test('gamesText: 표기', () => {
  assert.equal(gamesText([[21, 15], [19, 21]]), '21-15, 19-21')
  assert.equal(gamesText([]), '')
})

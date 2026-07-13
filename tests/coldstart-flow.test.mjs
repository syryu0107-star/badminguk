// ── 콜드스타트 대회 완주 관통 테스트 ───────────────────────────────
// 급수→초기 MMR·RD 시드부터 조편성·경기·MMR 반영·급수 승급·랭킹까지
// 엔진들이 서로 맞물려 대회 하나를 끝까지 굴리는지 고정한다.
// (봇 시뮬에서 발견한 단식 resolveMatchMMR 크래시 회귀 포함)
import { test, assert } from './_harness.mjs'
import { gradeToMMR, decayRD, reliabilityLabel, isProvisional } from '../src/lib/rating.js'
import { getGradeIndex, checkPromotion } from '../src/lib/grades.js'
import {
  generatePools, calculatePoolStandings, determineAdvancements, generateKnockoutBracket, prizeLabel,
} from '../src/lib/tournament.js'
import { initMatchState, applyPoint } from '../src/lib/bwf.js'
import { resolveMatchMMR } from '../src/lib/mmr.js'

const GRADE_POOL = ['자강조','준자강','A조','A조','B조','B조','B조','C조','C조','C조','C조','D조','D조','초심','초심','왕초심']
function seed16() {
  return GRADE_POOL.map((g, i) => {
    const { mmr, rd } = gradeToMMR(g, 'si')
    return { id: 'P' + i, name: '봇' + i, grade: g, mmr, rd, gradeIdx: getGradeIndex(g) }
  })
}

test('콜드스타트: 급수 높을수록 초기 MMR 높고 바닥 700·전원 provisional', () => {
  const players = seed16()
  const byGrade = [...players].sort((a, b) => b.gradeIdx - a.gradeIdx)
  assert(byGrade.every((p, i) => i === 0 || byGrade[i-1].mmr >= p.mmr), '급수순 MMR 단조')
  assert(players.every(p => p.mmr >= 700), 'MMR 바닥 700')
  assert(players.every(p => isProvisional(p.rd, 0)), '초기 전원 provisional')
})

test('콜드스타트: MMR 시드 조편성 — 4조·상위 분산', () => {
  const players = seed16()
  const entries = players.map(p => ({ entryId: p.id, label: p.name, mmr: p.mmr }))
  const pools = generatePools(entries, 4, '봇시드', { seeding_enabled: true })
  assert(pools.length === 4, '4개 조')
  assert(pools.every(p => p.entries.length === 4), '각 조 4명')
  const top = [...players].sort((a, b) => b.mmr - a.mmr)
  const pa = pools.findIndex(p => p.entries.some(e => e.entryId === top[0].id))
  const pb = pools.findIndex(p => p.entries.some(e => e.entryId === top[1].id))
  assert(pa !== pb, '상위 2명 다른 조')
})

test('콜드스타트: 조별리그→본선 진출·브래킷(같은 조 재대결 없음)', () => {
  const players = seed16()
  const mmrOf = Object.fromEntries(players.map(p => [p.id, p.mmr]))
  const entries = players.map(p => ({ entryId: p.id, label: p.name, mmr: p.mmr }))
  const pools = generatePools(entries, 4, '봇시드', { seeding_enabled: true })
  const playMatch = (a, b) => {
    const favA = mmrOf[a] >= mmrOf[b], w = favA ? a : b
    const lp = Math.max(5, Math.min(19, 19 - Math.floor(Math.abs(mmrOf[a] - mmrOf[b]) / 40)))
    return { team1_entry_id: a, team2_entry_id: b, winner_entry_id: w, scores: [[21, lp]] }
  }
  const standings = pools.map(pool => {
    const ms = []
    for (let i = 0; i < pool.entries.length; i++)
      for (let j = i + 1; j < pool.entries.length; j++)
        ms.push(playMatch(pool.entries[i].entryId, pool.entries[j].entryId))
    return { poolIndex: pool.poolIndex, poolName: pool.poolName,
      standings: calculatePoolStandings(pool.entries.map(e => ({ entryId: e.entryId, label: e.label })), ms) }
  })
  assert(standings.every(ps => ps.standings.map(s => s.rank).join() === '1,2,3,4'), '조 순위 1..4')
  const adv = determineAdvancements(standings, 2, 0, 'score_diff')
  assert(adv.direct.length === 8, '직행 8명')
  const r1 = generateKnockoutBracket(adv, '봇시드').filter(m => m.round === 1)
  assert(r1.length === 4, '8강 4경기')
  const sameEarly = r1.filter(m => {
    const pa = adv.direct.find(d => d.entryId === m.team1EntryId)?.poolIndex
    const pb = adv.direct.find(d => d.entryId === m.team2EntryId)?.poolIndex
    return pa != null && pa === pb
  }).length
  assert(sameEarly === 0, '8강 같은 조 재대결 없음')
})

test('콜드스타트: 단식 MMR 반영 — provisional 큰-K 이변 상승 + RD 감쇠 (회귀: 단식 크래시)', () => {
  // 초심(1000, rd340)이 자강조(2000)를 이기는 이변 — 단식(팀당 1명)
  const res = resolveMatchMMR({
    team1: [{ id: 'under', mmr: 1000, gamesPlayed: 0, rd: 340 }],
    team2: [{ id: 'top', mmr: 2000, gamesPlayed: 0, rd: 205 }],
    winner: 1, certLevel: 'b',
  })
  assert(res.length === 2, '단식은 2명 반환 (크래시 없이 filter)')
  const under = res.find(r => r.id === 'under')
  assert(under.delta > 0, '이변 승 MMR 상승')
  assert(under.delta >= 40, 'provisional 큰-K 대폭 상승')
  assert(under.rdAfter != null && under.rdAfter < 340, '경기 후 RD 감쇠')
})

test('콜드스타트: 복식 MMR은 4명 반환 (레거시 불변)', () => {
  const res = resolveMatchMMR({
    team1: [{ id: 'a', mmr: 1200, gamesPlayed: 20 }, { id: 'b', mmr: 1300, gamesPlayed: 20 }],
    team2: [{ id: 'c', mmr: 1150, gamesPlayed: 20 }, { id: 'd', mmr: 900, gamesPlayed: 20 }],
    winner: 1, certLevel: 'c',
  })
  assert(res.length === 4, '복식 4명 반환')
})

test('콜드스타트: 급수 승급 — 임계·다회·하향불가', () => {
  assert(checkPromotion('C조', [{ finalRank: 1, certLevel: 'b' }], 'doubles') === null, 'C조 시우승 1회 미달')
  assert(checkPromotion('C조', [{ finalRank: 1, certLevel: 'b' }, { finalRank: 1, certLevel: 'b' }], 'doubles') === 'B조', 'C조 시우승 2회 승급')
  assert(checkPromotion('B조', [], 'doubles') === null, '입상 없으면 하향 없음')
})

test('콜드스타트: 시상 라벨 + 신뢰도 뱃지', () => {
  assert(prizeLabel(1, 3) === '🏆 우승' && prizeLabel(3, 3) === '🥉 3위', '시상 라벨')
  const lbl = reliabilityLabel(340, 0)
  assert(lbl && (lbl.text || lbl.label), '신뢰도 라벨 존재')
})

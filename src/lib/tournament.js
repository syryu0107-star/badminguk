/**
 * tournament.js
 * 배드민턴 대회 토너먼트 포맷 관리 라이브러리
 *
 * 기능: 조 편성, 순위 계산, 진출자 결정, 토너먼트 대진 생성, 시상 레이블, 포맷 요약
 */

import { seededShuffle as _schedulerShuffle } from './scheduler.js'

// ─── Internal Utilities ───────────────────────────────────────────────────────

function _toNumericSeed(seed) {
  if (typeof seed === 'number') return (seed >>> 0) || 1
  const s = String(seed ?? '')
  if (!s) return 42
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  }
  return (Math.abs(h) >>> 0) || 1
}

function _makeRng(seed) {
  let s = _toNumericSeed(seed)
  return function () {
    s += 0x6d2b79f5
    let t = Math.imul(s ^ (s >>> 15), s | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000
  }
}

export function seededShuffle(array, seed) {
  const strSeed = typeof seed === 'number' ? String(seed) : (seed ?? '0')
  try {
    return _schedulerShuffle(array, strSeed)
  } catch {
    const rng = _makeRng(seed)
    const arr = [...array]
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
  }
}

function _nextPow2(n) {
  let p = 1
  while (p < n) p <<= 1
  return p
}

function _bracketSlots(size) {
  let slots = [1]
  while (slots.length < size) {
    const n = slots.length
    const next = []
    for (const s of slots) {
      next.push(s, 2 * n + 1 - s)
    }
    slots = next
  }
  return slots
}

const _POOL_ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

// ─── 1. generatePools ─────────────────────────────────────────────────────────

export function generatePools(entries, poolSize, seed, options = {}) {
  if (!Array.isArray(entries) || entries.length === 0) return []
  if (!Number.isInteger(poolSize) || poolSize < 1) {
    throw new RangeError('poolSize 는 1 이상의 정수여야 합니다')
  }

  const { seeding_enabled = false } = options
  const numPools = Math.ceil(entries.length / poolSize)

  const pools = Array.from({ length: numPools }, (_, i) => ({
    poolIndex: i,
    poolName: (_POOL_ALPHA[i] ?? String(i + 1)) + '조',
    entries: [],
  }))

  const hasMmr = seeding_enabled && entries.some(e => e.mmr != null)

  if (hasMmr) {
    const sorted = [...entries].sort(
      (a, b) => (b.mmr ?? -Infinity) - (a.mmr ?? -Infinity)
    )
    sorted.forEach((entry, i) => {
      const round = Math.floor(i / numPools)
      const posInRound = i % numPools
      const poolIdx = round % 2 === 0 ? posInRound : numPools - 1 - posInRound
      pools[poolIdx].entries.push(entry)
    })
  } else {
    const shuffled = seededShuffle(entries, seed)
    shuffled.forEach((entry, i) => {
      pools[i % numPools].entries.push(entry)
    })
  }

  return pools
}

// ─── 2. calculatePoolStandings ────────────────────────────────────────────────

// 조별 동률 처리 기준 (대회마다 커스터마이징 — tournament_categories.tiebreaker_order)
export const DEFAULT_TIEBREAKERS = ['h2h', 'game_diff', 'point_diff', 'points_for']

export const TIEBREAKER_PRESETS = [
  {
    key: 'standard',
    label: '표준 (승자승 우선)',
    sub: '승자승 → 게임 득실 → 점수 득실 → 다득점',
    order: ['h2h', 'game_diff', 'point_diff', 'points_for'],
  },
  {
    key: 'score_first',
    label: '득실 우선',
    sub: '게임 득실 → 점수 득실 → 승자승 → 다득점',
    order: ['game_diff', 'point_diff', 'h2h', 'points_for'],
  },
  {
    key: 'points_first',
    label: '다득점 우선',
    sub: '다득점 → 점수 득실 → 게임 득실 → 승자승',
    order: ['points_for', 'point_diff', 'game_diff', 'h2h'],
  },
]

export function calculatePoolStandings(poolEntries, matches, tiebreakers = DEFAULT_TIEBREAKERS) {
  const stats = {}
  for (const { entryId, label } of poolEntries) {
    stats[entryId] = {
      entryId,
      label: label ?? entryId,
      wins: 0, losses: 0,
      gamesWon: 0, gamesLost: 0,
      pointsFor: 0, pointsAgainst: 0,
    }
  }

  const poolIds = new Set(Object.keys(stats))

  const relevant = (matches ?? []).filter(
    m =>
      m.winner_entry_id != null &&
      poolIds.has(m.team1_entry_id) &&
      poolIds.has(m.team2_entry_id)
  )

  for (const match of relevant) {
    const { team1_entry_id: t1, team2_entry_id: t2, winner_entry_id: winner, scores } = match

    let g1 = 0, g2 = 0, p1 = 0, p2 = 0
    for (const game of Array.isArray(scores) ? scores : []) {
      const s1 = Number(game?.[0]) || 0
      const s2 = Number(game?.[1]) || 0
      p1 += s1; p2 += s2
      if (s1 > s2) g1++; else if (s2 > s1) g2++
    }

    if (winner === t1) { stats[t1].wins++; stats[t2].losses++ }
    else if (winner === t2) { stats[t2].wins++; stats[t1].losses++ }

    stats[t1].gamesWon  += g1; stats[t1].gamesLost += g2
    stats[t2].gamesWon  += g2; stats[t2].gamesLost += g1
    stats[t1].pointsFor += p1; stats[t1].pointsAgainst += p2
    stats[t2].pointsFor += p2; stats[t2].pointsAgainst += p1
  }

  const list = Object.values(stats).map(s => ({
    ...s,
    gameDiff:  s.gamesWon  - s.gamesLost,
    pointDiff: s.pointsFor - s.pointsAgainst,
  }))

  // 승자승은 정확히 2팀 동률일 때만 적용 (3자 이상 물림은 순환이라 다음 기준으로 — 대회 관행)
  const winCounts = {}
  for (const s of list) winCounts[s.wins] = (winCounts[s.wins] ?? 0) + 1

  const order = Array.isArray(tiebreakers) && tiebreakers.length ? tiebreakers : DEFAULT_TIEBREAKERS

  list.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins
    for (const tb of order) {
      if (tb === 'h2h') {
        if (winCounts[a.wins] === 2) {
          const h2h = _h2hResult(a.entryId, b.entryId, relevant)
          if (h2h !== 0) return h2h
        }
      } else if (tb === 'game_diff') {
        if (b.gameDiff !== a.gameDiff) return b.gameDiff - a.gameDiff
      } else if (tb === 'point_diff') {
        if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff
      } else if (tb === 'points_for') {
        if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor
      }
    }
    return 0
  })

  return list.map((entry, i) => ({ ...entry, rank: i + 1 }))
}

function _h2hResult(aId, bId, matches) {
  const m = matches.find(
    m =>
      (m.team1_entry_id === aId && m.team2_entry_id === bId) ||
      (m.team1_entry_id === bId && m.team2_entry_id === aId)
  )
  if (!m?.winner_entry_id) return 0
  return m.winner_entry_id === aId ? -1 : m.winner_entry_id === bId ? 1 : 0
}

// ─── 3. determineAdvancements ─────────────────────────────────────────────────

export function determineAdvancements(
  poolsStandings,
  advancementPerPool,
  wildcardCount = 0,
  wildcardCriteria = 'score_diff'
) {
  const direct = []
  const candidates = []

  for (const { poolIndex, poolName, standings } of poolsStandings) {
    standings.forEach((entry, idx) => {
      if (idx < advancementPerPool) {
        direct.push({
          entryId: entry.entryId, label: entry.label,
          fromPool: poolName, poolIndex, rank: idx + 1,
        })
      } else {
        candidates.push({ ...entry, fromPool: poolName, poolIndex, poolRank: idx + 1 })
      }
    })
  }

  candidates.sort(_wildcardComparator(wildcardCriteria))

  const wildcards = candidates.slice(0, wildcardCount).map((entry, i) => ({
    entryId: entry.entryId, label: entry.label,
    fromPool: entry.fromPool, poolIndex: entry.poolIndex,
    poolRank: entry.poolRank, wildcardRank: i + 1,
    criteria: wildcardCriteria,
  }))

  return { direct, wildcards }
}

function _wildcardComparator(criteria) {
  const byGameAndPoint = (a, b) =>
    b.gameDiff !== a.gameDiff ? b.gameDiff - a.gameDiff : b.pointDiff - a.pointDiff

  switch (criteria) {
    case 'win_rate':
      return (a, b) => {
        const rateA = a.wins / Math.max(a.wins + a.losses, 1)
        const rateB = b.wins / Math.max(b.wins + b.losses, 1)
        return rateB !== rateA ? rateB - rateA : byGameAndPoint(a, b)
      }
    case 'head_to_head':
      return byGameAndPoint
    case 'score_diff':
    default:
      return byGameAndPoint
  }
}

// ─── 4. generateKnockoutBracket ───────────────────────────────────────────────

export function generateKnockoutBracket(advancements, seed) {
  const direct    = advancements?.direct    ?? []
  const wildcards = advancements?.wildcards ?? []
  const all       = [...direct, ...wildcards]
  if (all.length < 2) return []

  const size   = _nextPow2(all.length)
  const slots  = _bracketSlots(size)
  const seeded = _interleaveByPool(direct, wildcards, seed)

  const matches = []

  for (let i = 0; i < size / 2; i++) {
    const s1 = slots[i * 2]     - 1
    const s2 = slots[i * 2 + 1] - 1
    const t1 = seeded[s1] ?? null
    const t2 = seeded[s2] ?? null
    matches.push({
      round: 1, slot: i + 1,
      team1EntryId: t1?.entryId ?? null,
      team2EntryId: t2?.entryId ?? null,
      isBye: t1 === null || t2 === null,
    })
  }

  const totalRounds = Math.log2(size)
  for (let round = 2; round <= totalRounds; round++) {
    const count = size / Math.pow(2, round)
    for (let slot = 1; slot <= count; slot++) {
      matches.push({ round, slot, team1EntryId: null, team2EntryId: null, isBye: false })
    }
  }

  return matches
}

function _interleaveByPool(direct, wildcards, seed) {
  // rank가 빠진 항목이 조용히 누락되지 않게 기본값 1
  const sorted = [...direct].sort((a, b) =>
    (a.rank ?? 1) !== (b.rank ?? 1)
      ? (a.rank ?? 1) - (b.rank ?? 1)
      : (a.poolIndex ?? 0) - (b.poolIndex ?? 0)
  )
  const maxRank = sorted.length ? (sorted[sorted.length - 1].rank ?? 1) : 0
  const seeded = []
  for (let rank = 1; rank <= maxRank; rank++) {
    const group = sorted.filter(t => (t.rank ?? 1) === rank)
    seeded.push(...seededShuffle(group, `${seed ?? 'bdm'}-r${rank}`))
  }
  seeded.push(...wildcards)
  return seeded
}

// ─── 5. prizeLabel ────────────────────────────────────────────────────────────

export function prizeLabel(rank, prizeSpots) {
  if (rank > prizeSpots) return null
  const LABELS = { 1: '🏆 우승', 2: '🥈 준우승', 3: '🥉 3위', 4: '4강' }
  return LABELS[rank] ?? `${rank}위`
}

// ─── 6. formatSummary ─────────────────────────────────────────────────────────

export function formatSummary(category = {}) {
  if (category.format_label) return category.format_label

  const phases = []

  if (category.pool_count) {
    const inner = category.pool_size
      ? `${category.pool_size}팀×${category.pool_count}조`
      : `${category.pool_count}조`
    phases.push(`조별리그(${inner})`)
  }

  const hasKnockout = category.has_knockout ?? true
  if (hasKnockout) {
    let label = '토너먼트'
    if (category.advancement_per_pool && category.pool_count) {
      const total =
        category.advancement_per_pool * category.pool_count +
        (category.wildcard_count ?? 0)
      label = `${total}강 토너먼트`
    }
    phases.push(label)
  }

  const phaseStr = phases.length > 0 ? phases.join(' + ') : '토너먼트'

  const matchParts = []
  if (category.sets_per_match) {
    const needed = Math.ceil(category.sets_per_match / 2)
    matchParts.push(`${category.sets_per_match}판${needed}선승`)
  }
  if (category.points_per_set) {
    matchParts.push(`${category.points_per_set}점`)
  }

  return matchParts.length > 0
    ? `${phaseStr} / ${matchParts.join(' / ')}`
    : phaseStr
}

// AI 대진 최적화 (C5) — 여러 후보 조 편성을 시뮬레이션해 가장 균형 잡힌 대진을 고른다.
// ──────────────────────────────────────────────────────────────────────
// 목적: 지금까지 조 편성은 "무작위 씨드 1개를 뽑아 그대로 확정"이라, 운이 나쁘면
//       한 조에 강팀이 몰리고 옆 조는 약팀만 모여 대진이 기울었다(주최자·선수 모두
//       "왜 이렇게 됐냐"를 알 수 없었다). 이 엔진은 후보 대진 여러 개를 만들어 조별
//       실력(MMR) 편차로 점수를 매기고, 가장 고른 대진을 골라 "왜 균형적인지"를 설명한다.
//
// 순수 함수만 담는다 — DB·발송·상태 변경은 호출부(BracketGenerator)가 맡는다.
// 기존 엔진 generatePools(scheduler 씨드 셔플)를 재사용한다(대진 로직 중복 없음).
// 고른 씨드를 그대로 저장하므로 공개 추첨의 재현성(같은 씨드=같은 대진)은 유지된다.

import { generatePools, generateKnockoutBracket, seededShuffle } from './tournament.js'

const mmrOf = e => (e && e.mmr != null && Number.isFinite(e.mmr)) ? e.mmr : null

// 한 조의 평균 MMR (MMR 있는 팀만). 없으면 null.
export function poolMeanMmr(pool) {
  const vals = (pool?.entries ?? []).map(mmrOf).filter(v => v != null)
  if (!vals.length) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

// 대진 균형 점수 — 낮을수록 균형. 조별 평균 MMR 편차(스프레드)가 핵심 지표.
//   spread     : 가장 센 조 평균 − 가장 약한 조 평균 (0에 가까울수록 균형)
//   stdev      : 조별 평균의 표준편차
//   means      : 조별 평균 MMR 배열(pools 순서, MMR 없으면 null)
//   sizeSpread : 조 크기 최대−최소 (generatePools 가 이미 최소화하지만 안전장치)
//   score      : 정렬용 종합 점수 (크기 편차를 크게 벌해 우선 맞춤)
export function scoreDraw(pools) {
  const means = (pools ?? []).map(poolMeanMmr)
  const known = means.filter(v => v != null)
  const sizes = (pools ?? []).map(p => p.entries.length)
  const sizeSpread = sizes.length ? Math.max(...sizes) - Math.min(...sizes) : 0
  if (known.length < 2) {
    return { spread: 0, stdev: 0, means, sizeSpread, score: sizeSpread * 100000 }
  }
  const max = Math.max(...known), min = Math.min(...known)
  const spread = max - min
  const avg = known.reduce((a, b) => a + b, 0) / known.length
  const variance = known.reduce((a, b) => a + (b - avg) ** 2, 0) / known.length
  const stdev = Math.sqrt(variance)
  // 크기 편차(부전승·불공정 직결)를 최우선으로 벌하고, 그 안에서 스프레드를 최소화.
  const score = sizeSpread * 100000 + spread
  return { spread, stdev, means, sizeSpread, score }
}

// 후보 씨드 목록 — baseSeed 에서 파생한 결정적 후보들(재현성 유지: 고른 씨드를 저장하면 재현).
export function candidateSeeds(baseSeed, n) {
  const base = String(baseSeed ?? '0')
  const seeds = []
  for (let i = 0; i < n; i++) seeds.push(i === 0 ? base : `${base}-v${i}`)
  return seeds
}

// 조 편성 최적화 — 후보 대진을 시뮬레이션해 가장 균형 잡힌 것을 반환.
//   entries        : [{ id, label, mmr }]
//   poolSize       : 조당 팀 수
//   baseSeed       : 시작 씨드(makeSeed 결과) — 후보 파생·재현 기준
//   seedingEnabled : true 면 MMR 스네이크 시드(결정적)라 후보 1개, false 면 무작위 후보 여럿
//   candidates     : 무작위일 때 비교할 후보 수(기본 16)
// 반환 { seed, pools, method, tried, metrics, candidateSpreads, bestSpread, worstSpread, avgSpread }.
export function optimizeDraw({ entries, poolSize, baseSeed, seedingEnabled = false, candidates = 16 } = {}) {
  const list = Array.isArray(entries) ? entries : []
  const numPools = poolSize > 0 ? Math.ceil(list.length / poolSize) : 1

  // 시드 배정(스네이크)은 결정적이라 후보를 여럿 만들 이유가 없다 → 1개만 평가.
  if (seedingEnabled) {
    const pools = generatePools(list, poolSize, baseSeed, { seeding_enabled: true })
    const metrics = scoreDraw(pools)
    return {
      seed: baseSeed, pools, method: 'seeded', tried: 1, metrics,
      candidateSpreads: [metrics.spread], bestSpread: metrics.spread,
      worstSpread: metrics.spread, avgSpread: metrics.spread, numPools,
    }
  }

  // 무작위 편성: 후보 여러 개를 만들어 조별 MMR 편차가 가장 작은 것을 고른다.
  const n = numPools >= 2 ? Math.max(1, candidates) : 1
  const seeds = candidateSeeds(baseSeed, n)
  let best = null
  const spreads = []
  for (const s of seeds) {
    const pools = generatePools(list, poolSize, s, { seeding_enabled: false })
    const metrics = scoreDraw(pools)
    spreads.push(metrics.spread)
    if (!best || metrics.score < best.metrics.score) best = { seed: s, pools, metrics }
  }
  const known = spreads.filter(v => Number.isFinite(v))
  const avgSpread = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0
  return {
    seed: best.seed, pools: best.pools, method: 'balanced', tried: n,
    metrics: best.metrics, candidateSpreads: spreads,
    bestSpread: best.metrics.spread,
    worstSpread: known.length ? Math.max(...known) : 0,
    avgSpread, numPools,
  }
}

// "왜 이 대진이 균형적인지" — 초보 주최자도 이해할 한국어 설명 데이터를 만든다.
// 반환 { headline, detail, poolLines:[{name, mean}], hasMmr }.
export function explainDraw(result, pools) {
  const usePools = pools ?? result?.pools ?? []
  const means = usePools.map(p => ({ name: p.poolName, mean: poolMeanMmr(p) }))
  const known = means.filter(m => m.mean != null)
  const hasMmr = known.length >= 2
  const poolLines = means.map(m => ({ name: m.name, mean: m.mean != null ? Math.round(m.mean) : null }))

  if (!hasMmr) {
    return {
      headline: '무작위로 공정하게 편성했어요',
      detail: '실력(MMR) 정보가 충분하지 않아 조별 실력 균형은 계산하지 않았어요. 조 크기는 최대한 고르게 나눴어요.',
      poolLines, hasMmr: false,
    }
  }

  const vals = known.map(m => m.mean)
  const max = Math.max(...vals), min = Math.min(...vals)
  const spread = Math.round(max - min)
  const strongest = known.reduce((a, b) => (b.mean > a.mean ? b : a))
  const weakest = known.reduce((a, b) => (b.mean < a.mean ? b : a))

  if (result?.method === 'seeded') {
    return {
      headline: 'MMR 시드로 조별 실력을 고르게 나눴어요',
      detail: `실력 순으로 지그재그(스네이크) 배정해 각 조에 강팀과 약팀이 섞였어요. `
        + `가장 센 조(${strongest.name} 평균 ${Math.round(strongest.mean)})와 가장 약한 조`
        + `(${weakest.name} 평균 ${Math.round(weakest.mean)})의 평균 차이는 ${spread}뿐이에요.`,
      poolLines, hasMmr: true,
    }
  }

  const avg = Math.round(result?.avgSpread ?? spread)
  const tried = result?.tried ?? 1
  const beat = avg > spread ? ` 무작위로 그냥 뽑았다면 평균 ${avg} 차이가 났을 텐데, 그보다 고른 대진을 골랐어요.` : ''
  return {
    headline: `후보 대진 ${tried}개 중 실력이 가장 고른 대진을 골랐어요`,
    detail: `조별 평균 실력(MMR) 차이가 가장 작은 대진이에요. `
      + `가장 센 조(${strongest.name} 평균 ${Math.round(strongest.mean)})와 가장 약한 조`
      + `(${weakest.name} 평균 ${Math.round(weakest.mean)})의 차이가 ${spread}이에요.${beat}`,
    poolLines, hasMmr: true,
  }
}

// ══════════════════════════════════════════════════════════════════════
// 녹아웃(토너먼트·single_elim) 대진 최적화 (C5)
// ──────────────────────────────────────────────────────────────────────
// 조별 편성과 달리 토너먼트는 "누가 어느 자리에 들어가느냐"가 대진의 공정성을 좌우한다.
// 무작위로 한 번 뽑으면(seeding OFF) 운에 따라 강팀 둘이 1라운드에서 만나 한 명이
// 곧바로 탈락하고, 반대쪽은 약팀만 남아 결승이 싱거워진다. 이 엔진은 후보 대진 여럿을
// 시뮬레이션해 (1)강팀이 낮은 라운드에서 서로 만나는 정도(clashPenalty)와
// (2)대진 위/아래 절반의 평균 실력 차이(halfSpread)로 채점해, 강팀이 가장 고르게
// 퍼진 대진을 고르고 "왜 균형적인지"를 설명한다. 고른 씨드를 그대로 저장하므로 재현 가능.

// 두 리프(1라운드 슬롯) i, j 가 처음 맞붙는 라운드 = XOR 비트 길이.
//   (0,1)=1라운드 / (0,2)=2라운드 / (0,4)=3라운드 … 표준 싱글엘림 트리 구조.
export function meetRound(i, j) {
  let x = (i ^ j) >>> 0
  let r = 0
  while (x > 0) { x >>= 1; r++ }
  return r
}

// buildDrawPlan(single_elim) 과 동일한 배치 로직으로 1라운드 리프 순서를 만든다.
//   seedingEnabled=true : MMR 내림차순(스네이크 시드) / false : 씨드 셔플(무작위)
// 반환 [{ entryId, mmr }] — 1라운드 슬롯 순서(왼→오), 부전승 자리는 mmr=null.
export function knockoutLeaves(entries, seed, seedingEnabled = false) {
  const list = Array.isArray(entries) ? entries : []
  const ordered = seedingEnabled
    ? [...list].sort((a, b) => (b.mmr ?? -Infinity) - (a.mmr ?? -Infinity))
    : seededShuffle(list, seed)
  const direct = ordered.map((e, i) => ({ entryId: e.id, label: e.label, rank: i + 1, poolIndex: 0 }))
  const bracket = generateKnockoutBracket({ direct, wildcards: [] }, seed)
  const round1 = bracket.filter(m => m.round === 1).sort((a, b) => a.slot - b.slot)
  const mmrById = new Map(list.map(e => [e.id, mmrOf(e)]))
  const leaves = []
  for (const m of round1) {
    leaves.push({ entryId: m.team1EntryId, mmr: m.team1EntryId != null ? (mmrById.get(m.team1EntryId) ?? null) : null })
    leaves.push({ entryId: m.team2EntryId, mmr: m.team2EntryId != null ? (mmrById.get(m.team2EntryId) ?? null) : null })
  }
  return leaves
}

// 녹아웃 대진 균형 점수 — 낮을수록 균형.
//   clashPenalty : Σ (강도i·강도j / 만나는라운드). 강팀 쌍이 일찍 만날수록 커짐(핵심 지표).
//   halfSpread   : 대진 위쪽 절반 vs 아래쪽 절반 평균 MMR 차이.
//   means        : [위쪽 평균, 아래쪽 평균] (MMR 없으면 null).
//   score        : 정렬용(=clashPenalty). 강팀을 최대한 늦게 만나게 퍼뜨림.
export function scoreKnockout(leaves) {
  const arr = Array.isArray(leaves) ? leaves : []
  const n = arr.length
  const mmrs = arr.map(l => (l && l.mmr != null && Number.isFinite(l.mmr)) ? l.mmr : null)
  const known = mmrs.filter(v => v != null)
  const half = Math.floor(n / 2)
  const meanOf = (a, b) => {
    const v = mmrs.slice(a, b).filter(x => x != null)
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null
  }
  const meanA = meanOf(0, half)
  const meanB = meanOf(half, n)
  const halfSpread = (meanA != null && meanB != null) ? Math.abs(meanA - meanB) : 0
  if (n < 2 || known.length < 2) {
    return { clashPenalty: 0, halfSpread: 0, means: [meanA, meanB], score: 0 }
  }
  const max = Math.max(...known), min = Math.min(...known)
  const range = max - min
  const w = i => mmrs[i] == null ? 0 : (range > 0 ? (mmrs[i] - min) / range : 1)
  let clashPenalty = 0
  for (let i = 0; i < n; i++) {
    const wi = w(i)
    if (wi === 0) continue
    for (let j = i + 1; j < n; j++) {
      const wj = w(j)
      if (wj === 0) continue
      clashPenalty += (wi * wj) / meetRound(i, j)
    }
  }
  return { clashPenalty, halfSpread, means: [meanA, meanB], score: clashPenalty }
}

// 녹아웃 대진 최적화 — 후보 대진을 비교해 강팀이 가장 고르게 퍼진 것을 반환.
//   seedingEnabled : true 면 MMR 스네이크(결정적)라 후보 1개, false 면 무작위 후보 여럿.
//   4팀 미만이거나 MMR 있는 팀 2 미만이면 최적화 의미가 없어 단일 후보(method 'random').
// 반환 { seed, method, tried, metrics, leafCount, clashPenalties, halfSpreads, best/worst/avgSpread }.
export function optimizeKnockout({ entries, baseSeed, seedingEnabled = false, candidates = 16 } = {}) {
  const list = Array.isArray(entries) ? entries : []
  const withMmr = list.filter(e => mmrOf(e) != null)
  const base = String(baseSeed ?? '0')

  if (seedingEnabled || list.length < 4 || withMmr.length < 2) {
    const leaves = knockoutLeaves(list, base, seedingEnabled)
    const metrics = scoreKnockout(leaves)
    const method = seedingEnabled
      ? 'seeded'
      : (withMmr.length >= 2 && list.length >= 4 ? 'balanced' : 'random')
    return {
      seed: base, method, tried: 1, metrics, leafCount: leaves.length,
      clashPenalties: [metrics.clashPenalty], halfSpreads: [metrics.halfSpread],
      bestSpread: metrics.halfSpread, worstSpread: metrics.halfSpread, avgSpread: metrics.halfSpread,
    }
  }

  const seeds = candidateSeeds(base, Math.max(1, candidates))
  let best = null
  const clashPenalties = [], halfSpreads = []
  for (const s of seeds) {
    const leaves = knockoutLeaves(list, s, false)
    const metrics = scoreKnockout(leaves)
    clashPenalties.push(metrics.clashPenalty)
    halfSpreads.push(metrics.halfSpread)
    if (!best || metrics.score < best.metrics.score) best = { seed: s, metrics, leafCount: leaves.length }
  }
  const avgSpread = halfSpreads.length ? halfSpreads.reduce((a, b) => a + b, 0) / halfSpreads.length : 0
  return {
    seed: best.seed, method: 'balanced', tried: seeds.length, metrics: best.metrics, leafCount: best.leafCount,
    clashPenalties, halfSpreads,
    bestSpread: best.metrics.halfSpread,
    worstSpread: halfSpreads.length ? Math.max(...halfSpreads) : 0,
    avgSpread,
  }
}

// "왜 이 토너먼트 대진이 공정한지" — 초보 주최자용 한국어 설명.
// 반환 { headline, detail, poolLines:[{name, mean}], hasMmr } (조 설명과 같은 모양 → UI 재사용).
export function explainKnockout(result) {
  const means = result?.metrics?.means ?? [null, null]
  const meanA = means[0], meanB = means[1]
  const hasMmr = meanA != null && meanB != null && result?.method !== 'random'
  const poolLines = [
    { name: '위쪽 대진', mean: meanA != null ? Math.round(meanA) : null },
    { name: '아래쪽 대진', mean: meanB != null ? Math.round(meanB) : null },
  ]
  if (!hasMmr) {
    return {
      headline: '무작위로 공정하게 대진을 뽑았어요',
      detail: '실력(MMR) 정보가 충분하지 않아 강팀 분산은 계산하지 않았어요. 순서는 무작위 씨드로 공정하게 배정했어요.',
      poolLines, hasMmr: false,
    }
  }
  const spread = Math.round(Math.abs(meanA - meanB))
  if (result?.method === 'seeded') {
    return {
      headline: 'MMR 시드로 강팀을 대진 양쪽에 갈라놨어요',
      detail: `실력 상위 팀일수록 대진 반대편에 배치돼 결승 전에는 서로 만나지 않아요. `
        + `위쪽 대진 평균 ${Math.round(meanA)} · 아래쪽 대진 평균 ${Math.round(meanB)}로 양쪽 실력 차이는 ${spread}뿐이에요.`,
      poolLines, hasMmr: true,
    }
  }
  const tried = result?.tried ?? 1
  const worst = Math.round(result?.worstSpread ?? spread)
  const beat = worst > spread
    ? ` 무작위로 그냥 뽑았다면 양쪽 실력 차이가 ${worst}까지 벌어질 수 있었는데, 그보다 고른 대진을 골랐어요.`
    : ''
  return {
    headline: `후보 대진 ${tried}개 중 강팀이 가장 고르게 퍼진 대진을 골랐어요`,
    detail: `강한 팀들이 1~2라운드에 몰려 서로 일찍 탈락하지 않도록 대진 양쪽에 고르게 배치했어요. `
      + `위쪽 대진 평균 ${Math.round(meanA)} · 아래쪽 대진 평균 ${Math.round(meanB)}로 차이는 ${spread}이에요.${beat}`,
    poolLines, hasMmr: true,
  }
}

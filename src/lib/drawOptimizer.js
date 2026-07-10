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

import { generatePools } from './tournament.js'

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

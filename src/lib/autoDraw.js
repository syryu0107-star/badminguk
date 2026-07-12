// 자동 대진 생성 (C2/C5) — 추첨(대진표 생성)을 앱이 스스로 실행하는 엔진.
// ──────────────────────────────────────────────────────────────────────
// 왜 필요한가: 지금껏 접수 마감·승인·입금·상태 전환·시상 확정은 무인 자동인데,
//   그 한가운데 "추첨(대진표 생성)"만 주최자가 BracketGenerator 화면에서 손으로
//   눌러야 했다. stateMachine 의 closed→in_progress 는 "대진표 존재"를 조건으로 걸어,
//   대회 당일이 와도 대진표가 없으면 대회가 시작되지 못하고 멈춘다(무인 완주 차단).
//   이 엔진이 그 공백을 메운다 — 무인 진행이 켜져 있고 대회 당일 대진표가 없으면
//   앱이 공개 추첨과 동일한 로직(재현 가능한 씨드 저장·AI 균형 편성)으로 대진표를
//   자동 생성한다. 주최자가 라이브 공개 추첨을 원하면 그 전에 직접 뽑으면 되고,
//   그러지 않아 방치된 대회만 앱이 자동으로 시작 가능 상태로 만든다.
//
// 이 파일은 대진 "오케스트레이션 글루"(포맷별 어떤 경기 행을 만들지)를 담고,
// 핵심 알고리즘은 기존 순수 엔진을 그대로 재사용한다(중복 0):
//   - 조 편성:      tournament.generatePools / drawOptimizer.optimizeDraw
//   - 녹아웃 대진:  tournament.generateKnockoutBracket / knockoutSkeletonSize
//   - 리그전:       scheduler.buildRoundRobin
//   - 코트/시간:    scheduler.scheduleMatches
//   - 씨드/셔플:    scheduler.makeSeed / seededShuffle
// BracketGenerator(공개 추첨 UI)도 이 엔진을 import 해 같은 대진을 만든다.

import { makeSeed, seededShuffle, scheduleMatches, buildRoundRobin } from './scheduler.js'
import { generatePools, generateKnockoutBracket, knockoutSkeletonSize } from './tournament.js'
import { optimizeDraw, explainDraw, optimizeKnockout, explainKnockout } from './drawOptimizer.js'

// ── UUID (crypto 우선, 폴백) ──────────────────────────────────────────
export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

// 라운드 라벨: 1=1라운드 … 마지막=결승 (round_number 기준, DB round_type용)
export function knockoutLabel(round, totalRounds) {
  const teams = Math.pow(2, totalRounds - round + 1)
  if (teams === 2) return 'final'
  if (teams === 4) return 'semi'
  if (teams === 8) return 'quarter'
  return `r${teams}`
}

// tournament_matches 한 줄 (모든 행이 같은 키를 갖도록 통일 — 일괄 저장용)
export function makeMatchRow(base) {
  return {
    id: base.id ?? uuid(),
    category_id: base.category_id,
    pool_id: base.pool_id ?? null,
    match_phase: base.match_phase,
    round_type: base.round_type,
    round_number: base.round_number ?? null,
    bracket_pos: base.bracket_pos ?? null,
    match_number: base.match_number,
    team1_entry_id: base.team1_entry_id ?? null,
    team2_entry_id: base.team2_entry_id ?? null,
    winner_entry_id: base.winner_entry_id ?? null,
    court_number: base.court_number ?? null,
    scheduled_time: base.scheduled_time ?? null,
    status: base.status ?? 'scheduled',
    draw_seed: base.draw_seed ?? null,
    next_match_id: base.next_match_id ?? null,
    next_match_slot: base.next_match_slot ?? null,
  }
}

/**
 * 녹아웃 전 라운드 스켈레톤 생성 + 승자 진출 링크 연결.
 * round1Teams: [[entryId|null, entryId|null], ...] (null이면 자리만 예약)
 * 부전승(한 팀만 있는 1라운드 경기)은 status='bye' + winner 기록 + 다음 라운드 슬롯 선진출.
 */
export function buildKnockoutRows({ catId, seed, size, round1Teams, startMatchNo }) {
  const totalRounds = Math.round(Math.log2(size))
  const byRound = []
  let matchNo = startMatchNo

  for (let r = 1; r <= totalRounds; r++) {
    const count = size / Math.pow(2, r)
    const arr = []
    for (let pos = 1; pos <= count; pos++) {
      arr.push(makeMatchRow({
        category_id: catId,
        match_phase: 'knockout',
        round_type: knockoutLabel(r, totalRounds),
        round_number: r,
        bracket_pos: pos,
        match_number: matchNo++,
        draw_seed: seed,
      }))
    }
    byRound.push(arr)
  }

  // 승자 진출 링크: round r의 pos p → round r+1의 ceil(p/2), 홀수p=슬롯1 / 짝수p=슬롯2
  for (let r = 0; r < byRound.length - 1; r++) {
    byRound[r].forEach((m, idx) => {
      const pos = idx + 1
      m.next_match_id = byRound[r + 1][Math.ceil(pos / 2) - 1].id
      m.next_match_slot = pos % 2 === 1 ? 1 : 2
    })
  }

  // 1라운드 팀 배치 + 부전승 선진출 처리
  if (round1Teams) {
    byRound[0].forEach((m, idx) => {
      const [t1, t2] = round1Teams[idx] ?? [null, null]
      m.team1_entry_id = t1
      m.team2_entry_id = t2
      const only = t1 && !t2 ? t1 : !t1 && t2 ? t2 : null
      if (only) {
        m.status = 'bye'
        m.winner_entry_id = only
        if (m.next_match_id && byRound[1]) {
          const next = byRound[1][Math.ceil((idx + 1) / 2) - 1]
          if (m.next_match_slot === 1) next.team1_entry_id = only
          else next.team2_entry_id = only
        }
      }
    })
  }

  return { rows: byRound.flat(), byRound }
}

// 신청 행(player1/player2 join)을 대진용 엔트리 { id, label, mmr }로 정규화.
export function enrichEntries(rawEntries) {
  return (rawEntries ?? []).map(e => {
    const mmrs = [e.player1?.mmr, e.player2?.mmr].filter(v => v != null)
    return {
      ...e,
      label: [e.player1?.name, e.player2?.name].filter(Boolean).join(' / ') || e.team_name || '이름 없음',
      mmr: mmrs.length ? mmrs.reduce((a, b) => a + b, 0) / mmrs.length : null,
    }
  })
}

/**
 * 추첨 계획 수립 — 순수 함수(DB 접근 없음). BracketGenerator(수동)·autoGenerateBracket(자동)
 * 공용. 씨드를 고정해 반환하므로 저장 시 그대로 쓰면 공개 검증(재현) 가능.
 *
 * @param {string} format         'single_elim'|'round_robin'|'pool_only'|'pool_knockout'
 * @param {object[]} entries      정규화된 엔트리 [{ id, label, mmr }]
 * @param {object} category       { pool_size, tournament_format ... }
 * @param {string} seed           makeSeed() 결과
 * @param {boolean} useOptimizer  AI 균형 편성 사용 여부
 * @param {boolean} seedingOn     MMR 시드 배정 여부
 * @returns { format, seed, pools, round1, size, sequence, optimization }
 */
export function buildDrawPlan({ format, entries, category, seed, useOptimizer = false, seedingOn = false }) {
  const allEntries = Array.isArray(entries) ? entries : []
  const s = seed
  const hasMmr = seedingOn && allEntries.some(e => e.mmr != null)

  if (format === 'single_elim') {
    // 시드 켜짐: MMR 상위 = 낮은 시드 번호 → 대진 반대편 배치 / 꺼짐: 씨드 셔플 순서
    const entryMap = Object.fromEntries(allEntries.map(e => [e.id, e]))
    const someMmr = allEntries.some(e => e.mmr != null)
    // AI 균형(무작위 편성일 때 후보 대진 비교) 또는 시드(MMR 스네이크) 설명을 붙일지 판정.
    // 무작위 최적화는 4팀 이상·MMR 있음일 때만 의미가 있다.
    const runKnockoutOpt = someMmr && (
      (seedingOn) || (useOptimizer && !seedingOn && allEntries.length >= 4)
    )
    let effSeed = s, optimization = null
    if (runKnockoutOpt) {
      const res = optimizeKnockout({ entries: allEntries, baseSeed: s, seedingEnabled: hasMmr, candidates: 16 })
      effSeed = res.seed
      optimization = {
        method: res.method, tried: res.tried,
        bestSpread: res.bestSpread, worstSpread: res.worstSpread, avgSpread: res.avgSpread,
        spreadLabel: '양쪽 대진 평균 실력 차이',
        explanation: explainKnockout(res),
      }
    }
    const ordered = hasMmr
      ? [...allEntries].sort((a, b) => (b.mmr ?? -Infinity) - (a.mmr ?? -Infinity))
      : seededShuffle(allEntries, effSeed)
    const direct = ordered.map((e, i) => ({ entryId: e.id, label: e.label, rank: i + 1, poolIndex: 0 }))
    const bracket = generateKnockoutBracket({ direct, wildcards: [] }, effSeed)
    const round1 = bracket.filter(m => m.round === 1).sort((a, b) => a.slot - b.slot)
    const size = round1.length * 2
    const sequence = []
    round1.forEach(m => {
      for (const eid of [m.team1EntryId, m.team2EntryId]) {
        sequence.push(eid
          ? { type: 'slot', entryId: eid, label: entryMap[eid]?.label ?? '', bye: false }
          : { type: 'slot', entryId: null, label: '부전승', bye: true })
      }
    })
    return { format, seed: effSeed, pools: null, round1, size, sequence, optimization }
  }

  // round_robin = 전원 한 조 / pool_only·pool_knockout = pool_size씩 조 편성
  const poolSize = format === 'round_robin'
    ? Math.max(allEntries.length, 1)
    : Math.max(category?.pool_size ?? 4, 1)

  // AI 균형 추첨: 후보 대진을 비교해 조별 실력이 가장 고른 대진을 고른다(재현성 유지).
  let pools, effSeed = s, optimization = null
  if (useOptimizer) {
    const res = optimizeDraw({ entries: allEntries, poolSize, baseSeed: s, seedingEnabled: seedingOn, candidates: 16 })
    pools = res.pools
    effSeed = res.seed
    optimization = {
      method: res.method, tried: res.tried,
      bestSpread: res.bestSpread, worstSpread: res.worstSpread, avgSpread: res.avgSpread,
      explanation: explainDraw(res, res.pools),
    }
  } else {
    pools = generatePools(allEntries, poolSize, s, { seeding_enabled: seedingOn })
  }

  // 배정 순서대로 공개 (시드 배정 시 스네이크 순서 그대로 재현)
  const sequence = []
  const maxLen = pools.length ? Math.max(...pools.map(p => p.entries.length)) : 0
  for (let k = 0; k < maxLen; k++) {
    const order = hasMmr && k % 2 === 1 ? [...pools].reverse() : pools
    for (const p of order) {
      const e = p.entries[k]
      if (e) sequence.push({ type: 'pool', entryId: e.id, label: e.label, poolIndex: p.poolIndex, poolName: p.poolName })
    }
  }
  return { format, seed: effSeed, pools, round1: null, size: null, sequence, optimization }
}

/**
 * 추첨 계획을 DB에 저장 — 조 + 조별 경기 + 녹아웃 전 라운드(진출 링크 포함).
 * BracketGenerator.saveSchedule 과 동일 로직(단일 소스). 기존 대진은 먼저 삭제한다.
 *
 * @returns {Promise<{ ok:boolean, matchCount:number, error?:any }>}
 */
export async function persistDrawPlan(supabase, { plan, categoryId, tournament, category, entries }) {
  if (!plan || !categoryId) return { ok: false, matchCount: 0, error: new Error('plan/categoryId 없음') }
  const allEntries = Array.isArray(entries) ? entries : []
  const seedingOn = !!category?.seeding_enabled
  try {
    const courts = Array.from({ length: tournament?.court_count ?? 4 }, (_, i) => i + 1)
    const startDate = new Date(`${tournament?.date}T${tournament?.start_time ?? '09:00'}`)
    const matchMinutes = category?.match_duration_min ?? 30

    // 기존 대진 삭제 (경기 → 조 순서: FK 때문)
    const delM = await supabase.from('tournament_matches').delete().eq('category_id', categoryId)
    if (delM.error) throw delM.error
    const delP = await supabase.from('tournament_pools').delete().eq('category_id', categoryId)
    if (delP.error) throw delP.error

    const matchRows = []
    let matchNo = 1

    if (plan.pools) {
      // 1) 조 저장
      const poolRows = plan.pools.map(p => ({
        id: uuid(),
        category_id: categoryId,
        pool_name: p.poolName,
        pool_index: p.poolIndex,
        draw_seed: plan.seed,
      }))
      const poolIdByIndex = {}
      poolRows.forEach(r => { poolIdByIndex[r.pool_index] = r.id })
      const insPools = await supabase.from('tournament_pools').insert(poolRows)
      if (insPools.error) throw insPools.error

      // 2) 조별 참가팀 (시드 켜짐이면 MMR 순위 기록)
      const mmrRank = {}
      ;[...allEntries]
        .sort((a, b) => (b.mmr ?? -Infinity) - (a.mmr ?? -Infinity))
        .forEach((e, i) => { mmrRank[e.id] = i + 1 })
      const peRows = []
      plan.pools.forEach(p => p.entries.forEach(e => {
        peRows.push({
          pool_id: poolIdByIndex[p.poolIndex],
          entry_id: e.id,
          seeding_rank: seedingOn ? mmrRank[e.id] ?? null : null,
        })
      }))
      const insPe = await supabase.from('tournament_pool_entries').insert(peRows)
      if (insPe.error) throw insPe.error

      // 3) 조별 리그전 경기 (홀수 조의 부전승 슬롯 = 그 라운드 휴식이라 경기 없음)
      const raw = []
      plan.pools.forEach(p => {
        buildRoundRobin(p.entries)
          .filter(m => m.entryA && m.entryB)
          .forEach(m => raw.push({ ...m, poolIndex: p.poolIndex }))
      })
      raw.sort((a, b) => a.round - b.round || a.poolIndex - b.poolIndex)
      const scheduledPool = scheduleMatches({
        matches: raw, courts, startTime: startDate, matchMinutes, breakMinutes: 5,
      })
      scheduledPool.forEach(m => {
        matchRows.push(makeMatchRow({
          category_id: categoryId,
          pool_id: poolIdByIndex[m.poolIndex],
          match_phase: 'pool',
          round_type: 'group',
          match_number: matchNo++,
          team1_entry_id: m.entryA.id,
          team2_entry_id: m.entryB.id,
          court_number: m.court,
          scheduled_time: m.scheduledTime?.toISOString() ?? null,
          draw_seed: plan.seed,
        }))
      })

      // 4) 본선 스켈레톤 (pool_knockout): 참가자 미정(null) 자리 예약 + 진출 링크
      if (plan.format === 'pool_knockout') {
        const poolSizes = plan.pools.map(p => p.entries.length)
        const size = knockoutSkeletonSize(
          poolSizes, category?.advancement_per_pool ?? 2, category?.wildcard_count ?? 0
        )
        if (size >= 2) {
          const { rows } = buildKnockoutRows({
            catId: categoryId, seed: plan.seed, size, round1Teams: null, startMatchNo: matchNo,
          })
          matchNo += rows.length
          matchRows.push(...rows)
        }
      }
    } else {
      // single_elim: 전 라운드 생성 + 부전승 선진출 + 1라운드 실경기만 코트/시간 배정
      const round1Teams = plan.round1.map(m => [m.team1EntryId, m.team2EntryId])
      const { rows, byRound } = buildKnockoutRows({
        catId: categoryId, seed: plan.seed, size: plan.size, round1Teams, startMatchNo: matchNo,
      })
      const real = byRound[0].filter(r => r.status !== 'bye')
      const raw = real.map(r => ({ entryA: { id: r.team1_entry_id }, entryB: { id: r.team2_entry_id }, _row: r }))
      const sched = scheduleMatches({
        matches: raw, courts, startTime: startDate, matchMinutes, breakMinutes: 5,
      })
      sched.forEach(m => {
        m._row.court_number = m.court
        m._row.scheduled_time = m.scheduledTime?.toISOString() ?? null
      })
      matchRows.push(...rows)
    }

    if (matchRows.length > 0) {
      const insM = await supabase.from('tournament_matches').insert(matchRows)
      if (insM.error) throw insM.error
    }
    return { ok: true, matchCount: matchRows.length }
  } catch (err) {
    return { ok: false, matchCount: 0, error: err }
  }
}

/**
 * 한 종목의 대진표를 자동 생성한다(추첨 자동화의 핵심 진입점).
 * 이미 대진표가 있으면 절대 덮어쓰지 않는다(주최자가 직접 뽑은 것 보호).
 * 승인 팀이 2팀 미만이면 건너뛴다.
 *
 * @returns {Promise<{ ok:boolean, reason:'created'|'exists'|'not_enough'|'error', categoryId, matchCount?, error? }>}
 */
export async function autoGenerateBracket(supabase, { tournament, category }) {
  const catId = category?.id
  if (!catId) return { ok: false, reason: 'error', categoryId: catId, error: new Error('category 없음') }

  // 이미 대진표가 있으면 덮어쓰지 않는다.
  const { count, error: cntErr } = await supabase
    .from('tournament_matches')
    .select('*', { count: 'exact', head: true })
    .eq('category_id', catId)
  if (cntErr) return { ok: false, reason: 'error', categoryId: catId, error: cntErr }
  if ((count ?? 0) > 0) return { ok: false, reason: 'exists', categoryId: catId }

  // 승인된 참가팀 로드
  const { data, error: entErr } = await supabase
    .from('tournament_entries')
    .select('id, team_name, player1:profiles!player1_id(id,name,mmr), player2:profiles!player2_id(id,name,mmr)')
    .eq('category_id', catId)
    .eq('entry_status', 'approved')
  if (entErr) return { ok: false, reason: 'error', categoryId: catId, error: entErr }

  const entries = enrichEntries(data)
  if (entries.length < 2) return { ok: false, reason: 'not_enough', categoryId: catId, count: entries.length }

  const format = category.tournament_format ?? 'round_robin'
  const seedingOn = !!category.seeding_enabled
  const isPoolFormat = format === 'pool_only' || format === 'pool_knockout'
  const poolSize = format === 'round_robin'
    ? Math.max(entries.length, 1)
    : Math.max(category.pool_size ?? 4, 1)
  const numPools = poolSize > 0 ? Math.ceil(entries.length / poolSize) : 1
  const hasMmr = entries.some(e => e.mmr != null)
  // 자동 추첨은 AI 균형 편성을 기본 적용(재현 가능한 씨드 저장). 조별은 2개↑·MMR,
  // 토너먼트(single_elim)는 무작위 편성·4팀↑·MMR 있을 때 후보 대진을 비교해 강팀을 분산.
  const useOptimizer =
    (isPoolFormat && numPools >= 2 && hasMmr) ||
    (format === 'single_elim' && !seedingOn && hasMmr && entries.length >= 4)

  const seed = makeSeed()
  const plan = buildDrawPlan({ format, entries, category, seed, useOptimizer, seedingOn })
  const res = await persistDrawPlan(supabase, { plan, categoryId: catId, tournament, category, entries })

  return res.ok
    ? { ok: true, reason: 'created', categoryId: catId, matchCount: res.matchCount, seed: plan.seed }
    : { ok: false, reason: 'error', categoryId: catId, error: res.error }
}

/**
 * 대회의 모든 종목 중 대진표가 없는 종목을 자동 생성한다.
 * @returns {Promise<{ created:number, skipped:number, notEnough:number, errors:number, results:object[] }>}
 */
export async function autoGenerateAllBrackets(supabase, { tournament, categories }) {
  const out = { created: 0, skipped: 0, notEnough: 0, errors: 0, results: [] }
  for (const category of categories ?? []) {
    const r = await autoGenerateBracket(supabase, { tournament, category })
    out.results.push(r)
    if (r.reason === 'created') out.created++
    else if (r.reason === 'exists') out.skipped++
    else if (r.reason === 'not_enough') out.notEnough++
    else out.errors++
  }
  return out
}

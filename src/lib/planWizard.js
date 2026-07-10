// C8 요강·설정 마법사 엔진 — 규모→포맷/조크기/예상종료 역산 + 요강 문서 생성
// 순수 함수만. 대회 개설 전(엔트리 확정 전) "예상 팀 수"로 대진 규모·소요 시간을 역산하고,
// 규모에 맞는 대진 방식을 추천하며, 초보 주최자용 요강 문서를 만든다. 스키마·외부 키 불필요.

// ── 조 나누기 (최대한 고르게) ─────────────────────────────────────────
export function distributePools(teams, poolSize) {
  const n = Math.max(0, Math.floor(teams || 0))
  const size = Math.max(2, Math.floor(poolSize) || 4)
  if (n < 2) return []
  const numPools = Math.max(1, Math.ceil(n / size))
  const base = Math.floor(n / numPools)
  const rem = n % numPools
  const sizes = []
  for (let i = 0; i < numPools; i++) sizes.push(base + (i < rem ? 1 : 0))
  return sizes
}

function comb2(n) { return n < 2 ? 0 : (n * (n - 1)) / 2 }
function nextPow2(n) { let p = 1; while (p < n) p *= 2; return p }

// ── 경기 수 역산 ─────────────────────────────────────────────────────
// 부전승(bye)은 제외한 "실제 치러지는 경기 수"를 반환.
export function estimateMatches(cat = {}, teams) {
  const n = Math.max(0, Math.floor(teams || 0))
  const fmt = cat.tournament_format || 'pool_knockout'
  const poolSize = cat.pool_size || 4
  const adv = cat.advancement_per_pool || 2
  const wc = cat.wildcard_count || 0
  const prizeSpots = cat.prize_spots || 3
  const thirdPlace = prizeSpots >= 3

  if (n < 2) return { pool: 0, knockout: 0, total: 0, pools: [], advancers: 0 }

  if (fmt === 'round_robin') {
    const total = comb2(n)
    return { pool: total, knockout: 0, total, pools: [n], advancers: 0 }
  }
  if (fmt === 'single_elim') {
    let ko = Math.max(0, n - 1)
    if (thirdPlace && n >= 4) ko += 1  // 3·4위전
    return { pool: 0, knockout: ko, total: ko, pools: [], advancers: n }
  }

  // pool_knockout / pool_only
  const pools = distributePools(n, poolSize)
  const poolMatches = pools.reduce((s, p) => s + comb2(p), 0)
  if (fmt === 'pool_only') {
    return { pool: poolMatches, knockout: 0, total: poolMatches, pools, advancers: 0 }
  }
  const advancers = Math.min(n, pools.length * adv + wc)
  let ko = Math.max(0, advancers - 1)
  if (thirdPlace && advancers >= 4) ko += 1
  return { pool: poolMatches, knockout: ko, total: poolMatches + ko, pools, advancers }
}

// ── 경기당 소요 시간 기본값 ──────────────────────────────────────────
export function defaultMatchMinutes(cat = {}) {
  const pts = cat.points_per_game || 21
  const perGame = pts >= 21 ? 13 : pts >= 15 ? 10 : 8   // 한 게임 순수 플레이 추정
  const games = cat.games_per_match === 1 ? 1 : 2.4     // 3판2선승 평균 약 2.4게임
  return Math.round(perGame * games) + 4                 // 코트 정리·인사 여유
}

// 녹아웃은 라운드가 순차라 코트 병렬 이득이 준다. 라운드별로 시간을 누적.
function knockoutMinutes(entrants, courts, slot, thirdPlace) {
  if (entrants < 2) return 0
  let mins = 0
  let alive = entrants
  while (alive > 1) {
    const games = Math.floor(alive / 2)
    mins += Math.ceil(games / courts) * slot
    alive = Math.ceil(alive / 2)
  }
  if (thirdPlace && entrants >= 4) mins += slot   // 준결승 뒤 3·4위전 1경기
  return mins
}

// ── 예상 소요 시간·종료 시각 역산 ────────────────────────────────────
export function estimateSchedule({ cat = {}, teams, courtCount = 4, startTime, matchMinutes, breakMinutes = 5 }) {
  const m = estimateMatches(cat, teams)
  const perMatch = matchMinutes || defaultMatchMinutes(cat)
  const slot = perMatch + breakMinutes
  const courts = Math.max(1, Math.floor(courtCount) || 1)
  const fmt = cat.tournament_format || 'pool_knockout'
  const thirdPlace = (cat.prize_spots || 3) >= 3

  const poolMinutes = m.pool > 0 ? Math.ceil(m.pool / courts) * slot : 0
  let koMinutes = 0
  if (fmt === 'single_elim') koMinutes = knockoutMinutes(m.advancers, courts, slot, thirdPlace)
  else if (fmt === 'pool_knockout') koMinutes = knockoutMinutes(m.advancers, courts, slot, thirdPlace)

  const totalMinutes = poolMinutes + koMinutes
  let endTime = null
  if (startTime) {
    const start = new Date(startTime)
    if (!isNaN(start)) endTime = new Date(start.getTime() + totalMinutes * 60000)
  }
  return { ...m, perMatch, slot, courts, poolMinutes, koMinutes, totalMinutes, endTime }
}

// 여러 종목을 한 대회의 코트로 이어서 진행한다고 볼 때의 합산 추정
export function estimateTournament({ categories = [], teamsByIndex, courtCount = 4, startTime, breakMinutes = 5 }) {
  let totalMatches = 0
  let totalMinutes = 0
  const perCat = categories.map((cat, i) => {
    const teams = teamsByIndex ? teamsByIndex[i] : (cat.max_teams || 0)
    const est = estimateSchedule({ cat, teams, courtCount, startTime, breakMinutes })
    totalMatches += est.total
    totalMinutes += est.totalMinutes
    return { ...est, teams }
  })
  let endTime = null
  if (startTime) {
    const start = new Date(startTime)
    if (!isNaN(start)) endTime = new Date(start.getTime() + totalMinutes * 60000)
  }
  return { perCat, totalMatches, totalMinutes, endTime }
}

// ── 규모 → 대진 방식 추천 ────────────────────────────────────────────
export function recommendSetup(teams) {
  const n = Math.max(0, Math.floor(teams || 0))
  if (n < 2) return null
  if (n <= 5) {
    return {
      tournament_format: 'round_robin',
      pool_size: null,
      advancement_per_pool: null,
      pools: [n],
      headline: `${n}팀 · 리그전 추천`,
      reason: `${n}팀은 리그전(모두 한 번씩)이 가장 좋아요. 경기 수가 넉넉하고 탈락 없이 전원이 여러 경기를 뛰어 순위가 공정해요.`,
    }
  }
  if (n <= 8) {
    const sizes = distributePools(n, 4)
    return {
      tournament_format: 'pool_knockout',
      pool_size: 4,
      advancement_per_pool: 2,
      pools: sizes,
      headline: `${n}팀 · 4팀조 → 토너먼트 추천`,
      reason: `${n}팀은 4팀 조로 나눈 조별리그 후 상위 2팀이 토너먼트로 올라가는 방식을 추천해요. 초반 탈락 없이 최소 여러 경기를 보장해요.`,
    }
  }
  // 9팀 이상: 조 크기 후보 중 가장 고르게 나뉘는 것 선택(4팀조 선호, 2팀조 지양)
  const candidates = [4, 5, 3, 6]
  let best = null
  for (const ps of candidates) {
    const sizes = distributePools(n, ps)
    if (!sizes.length || sizes.some(s => s < 3)) continue
    const spread = Math.max(...sizes) - Math.min(...sizes)
    const score = spread * 10 + Math.abs(ps - 4)
    if (!best || score < best.score) best = { ps, sizes, score }
  }
  if (!best) {
    const sizes = distributePools(n, 4)
    best = { ps: 4, sizes, score: 0 }
  }
  return {
    tournament_format: 'pool_knockout',
    pool_size: best.ps,
    advancement_per_pool: 2,
    pools: best.sizes,
    headline: `${n}팀 · ${best.ps}팀조 ${best.sizes.length}개 → 토너먼트 추천`,
    reason: `${n}팀은 ${best.ps}팀 조 ${best.sizes.length}개로 나눠 조별리그 후 상위 2팀이 토너먼트에 오르는 방식을 추천해요. 조가 고르게 나뉘어 경기 수가 균형적이에요.`,
  }
}

// ── 시간 포맷 ────────────────────────────────────────────────────────
export function formatKoreanTime(date) {
  if (!date) return ''
  const d = date instanceof Date ? date : new Date(date)
  if (isNaN(d)) return ''
  let h = d.getHours()
  const min = d.getMinutes()
  const ampm = h < 12 ? '오전' : '오후'
  let h12 = h % 12
  if (h12 === 0) h12 = 12
  return min === 0 ? `${ampm} ${h12}시` : `${ampm} ${h12}시 ${min}분`
}

export function formatDuration(minutes) {
  const m = Math.max(0, Math.round(minutes || 0))
  const h = Math.floor(m / 60)
  const r = m % 60
  if (h && r) return `약 ${h}시간 ${r}분`
  if (h) return `약 ${h}시간`
  return `약 ${r}분`
}

// ── 요강 문서 (인쇄=PDF 저장) ────────────────────────────────────────
const FORMAT_LABEL = {
  pool_knockout: '조별리그 + 토너먼트',
  round_robin: '리그전(라운드 로빈)',
  single_elim: '토너먼트(단판 제거)',
  pool_only: '조별리그',
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function wonText(v) {
  const n = Number(v) || 0
  return n <= 0 ? '무료' : `${n.toLocaleString('ko-KR')}원`
}

const UNIT_LABEL = { gu: '구', si: '시', national: '전국' }

// 요강 본문(구조화 텍스트) — 미리보기·복사용
export function buildGuidelines(tournament = {}, categories = [], opts = {}) {
  const t = tournament
  const sections = []

  sections.push({
    title: '대회 개요',
    lines: [
      ['대회명', t.title || '(미정)'],
      ['주최', opts.organizerName || '배드민국'],
      ['대회 단위', `${UNIT_LABEL[t.unit] || '구'} 대회`],
      t.description ? ['소개', t.description] : null,
    ].filter(Boolean),
  })

  sections.push({
    title: '일정 및 장소',
    lines: [
      ['대회 날짜', t.date || '(미정)'],
      ['시작 시간', t.start_time || '(미정)'],
      ['접수 마감', t.registration_end ? String(t.registration_end).replace('T', ' ') : '(미정)'],
      ['장소', t.venue || '(미정)'],
      t.venue_address ? ['주소', t.venue_address] : null,
      ['코트 수', `${t.court_count || 0}면`],
      opts.estimatedEnd ? ['예상 종료', opts.estimatedEnd] : null,
    ].filter(Boolean),
  })

  const catLines = categories.map((c, i) => {
    const fmt = FORMAT_LABEL[c.tournament_format] || '조별리그 + 토너먼트'
    const games = c.games_per_match === 1 ? '단판' : '3판 2선승'
    const pool = (c.tournament_format === 'pool_knockout' || c.tournament_format === 'pool_only')
      ? ` · ${c.pool_size}팀조` : ''
    return [
      `종목 ${i + 1}`,
      `${c.sport_type} · 최대 ${c.max_teams}팀 · 참가비 ${wonText(c.entry_fee)} · ${fmt}${pool} · ${c.points_per_game || 21}점 ${games}`,
    ]
  })
  sections.push({ title: '참가 종목', lines: catLines })

  sections.push({
    title: '경기 방식',
    lines: [
      ['점수', 'BWF 랠리포인트제 — 먼저 21점 선취(20-20 듀스, 29-29에서는 30점 먼저 골든포인트).'],
      ['승부', '기본 3판 2선승(종목별 상이). 단판 종목은 1게임으로 승부를 가립니다.'],
      ['부전승', '상대가 없거나 기권/노쇼(호출 후 미입장)면 부전승으로 처리되어 다음 라운드로 진출합니다.'],
      ['순위(조별)', '승수 → 승자승 → 득실차 → 득점 순으로 조 순위를 정합니다(대회 설정에 따라 다를 수 있음).'],
    ],
  })

  sections.push({
    title: '시상 및 급수 반영',
    lines: [
      ['시상', t.prize_description || `종목별 상위 ${categories[0]?.prize_spots || 3}팀 시상.`],
      ['급수/MMR', `모든 결과는 전국 랭킹(MMR)에 반영되며, ${UNIT_LABEL[t.unit] || '구'} 대회 급수 승급에 사용됩니다.`],
    ],
  })

  sections.push({
    title: '유의사항',
    lines: [
      ['체크인', '대회 당일 앱에서 셀프 체크인 후 코트 호출을 기다려 주세요.'],
      ['호출', '코트가 준비되면 앱 알림으로 호출됩니다. 호출 후 일정 시간 미입장 시 부전승 처리될 수 있습니다.'],
      ['환불', '접수 마감 전 취소는 환불되며, 마감 후에는 대회 규정에 따릅니다.'],
      ['문의', '대회 상세 화면의 "문의" 챗봇 또는 주최자에게 문의해 주세요.'],
    ],
  })

  return sections
}

export function guidelinesHtml(tournament = {}, categories = [], opts = {}) {
  const sections = buildGuidelines(tournament, categories, opts)
  const body = sections.map(s => `
    <section>
      <h2>${esc(s.title)}</h2>
      <table>
        ${s.lines.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}
      </table>
    </section>`).join('')

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>${esc(tournament.title || '대회 요강')} 요강</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; color: #1a1a1a; margin: 0; padding: 32px 28px; }
  header { text-align: center; border-bottom: 3px solid #C60C30; padding-bottom: 16px; margin-bottom: 20px; }
  header .brand { color: #C60C30; font-weight: 800; font-size: 13px; letter-spacing: 2px; }
  header h1 { font-size: 24px; margin: 6px 0 2px; }
  header .sub { color: #666; font-size: 13px; }
  section { margin-bottom: 18px; page-break-inside: avoid; }
  h2 { font-size: 15px; color: #003478; border-left: 4px solid #003478; padding-left: 8px; margin: 0 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { width: 110px; text-align: left; vertical-align: top; color: #666; font-weight: 600; padding: 5px 8px; background: #f7f7f9; border: 1px solid #eee; }
  td { padding: 5px 10px; border: 1px solid #eee; line-height: 1.55; }
  footer { text-align: center; color: #999; font-size: 11px; margin-top: 24px; border-top: 1px solid #eee; padding-top: 10px; }
  @media print { body { padding: 16px; } }
</style></head>
<body onload="window.print()">
  <header>
    <div class="brand">배드민국 BADMINGUK</div>
    <h1>${esc(tournament.title || '대회 요강')}</h1>
    <div class="sub">대회 요강 · ${esc(tournament.date || '')}</div>
  </header>
  ${body}
  <footer>본 요강은 배드민국 앱에서 자동 생성되었습니다. 세부 규정은 대회 진행 상황에 따라 변경될 수 있습니다.</footer>
</body></html>`
}

export function printGuidelines(tournament, categories, opts = {}) {
  if (typeof window === 'undefined') return false
  const html = guidelinesHtml(tournament, categories, opts)
  const w = window.open('', '_blank')
  if (!w) return false
  w.document.write(html)
  w.document.close()
  return true
}

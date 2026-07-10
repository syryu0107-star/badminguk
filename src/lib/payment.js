// 입금 매칭 (C3) — 무통장 입금 내역 ↔ 참가 신청 자동 대조
// ──────────────────────────────────────────────────────────────────────
// 목적: 주최자가 은행 앱에서 "입금자명 홍길동 30,000원"을 한 줄씩 눈으로 대조해
//       손으로 "입금 완료"를 누르던 전면 수작업을 없앤다. 계좌 입금 내역을
//       붙여넣으면 신청자명·참가비로 퍼지 매칭해 payment_status='confirmed'
//       후보를 만들고, 애매한 건만 사람에게 남긴다.
//
// 이 파일은 순수 함수만 담는다 — DB 읽기/쓰기는 호출부(EntryManagement)가 한다.
// 실결제(토스페이먼츠 PG·가상계좌 자동확인)는 human-gated 이며 여기서 다루지 않는다.
// 계좌 무통장 입금 대조는 키가 필요 없는 순수 로직이라 지금 자동화한다.

// ── 이름 정규화 ────────────────────────────────────────────────────────
// 은행 입금자명은 공백·직급·괄호·꼬리 숫자(동명이인 구분용)가 붙어 오는 경우가 많다.
// "홍길동  " / "(주)홍길동" / "홍길동1" / "김 민 준" → 핵심 한글만 남긴다.
export function normalizeName(s) {
  if (s == null) return ''
  return String(s)
    .replace(/\(.*?\)/g, '')      // 괄호 및 그 안(예: (주), (2))
    .replace(/[0-9]+$/g, '')      // 꼬리 숫자(동명이인 구분)
    .replace(/[^가-힣a-zA-Z]/g, '') // 한글·영문만 (공백·특수문자 제거)
    .toLowerCase()
    .trim()
}

// ── 금액 파싱 ──────────────────────────────────────────────────────────
// "30,000" / "30000원" / "₩30,000" → 30000. 실패 시 null.
export function parseAmount(s) {
  if (s == null) return null
  const digits = String(s).replace(/[^0-9]/g, '')
  if (!digits) return null
  const n = Number(digits)
  return Number.isFinite(n) ? n : null
}

// ── 편집 거리(Levenshtein) — 오타 허용 유사도 ───────────────────────────
function levenshtein(a, b) {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  let cur = new Array(n + 1)
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[n]
}

// 두 이름의 유사도 0~1 (1=정확히 같음). 정규화 후 비교.
export function nameSimilarity(a, b) {
  const x = normalizeName(a)
  const y = normalizeName(b)
  if (!x || !y) return 0
  if (x === y) return 1
  // 한쪽이 다른 쪽을 포함(예: "김민준" vs "김민준부") — 높은 유사도
  if (x.length >= 2 && y.length >= 2 && (x.includes(y) || y.includes(x))) return 0.9
  const dist = levenshtein(x, y)
  const maxLen = Math.max(x.length, y.length)
  return maxLen === 0 ? 0 : Math.max(0, 1 - dist / maxLen)
}

// ── 입금 내역 파싱 ──────────────────────────────────────────────────────
// 은행/토스 내역 붙여넣기를 [{ name, amount, raw }] 로 파싱한다.
// 지원 형태(관대하게):
//   "홍길동 30000"            (공백 구분)
//   "홍길동,30,000"           (CSV, 금액에 콤마)
//   "2026-07-09  홍길동  30,000원"  (날짜+이름+금액)
//   "홍길동\t30000\t..."      (탭 구분, 뒤 컬럼 무시)
// 규칙: 각 줄에서 마지막 숫자 덩어리를 금액으로, 그 앞의 한글/영문 토큰을 이름으로.
export function parseDeposits(text) {
  if (!text) return []
  const out = []
  for (const line0 of String(text).split(/\r?\n/)) {
    const line = line0.trim()
    if (!line) continue
    // 금액 후보: 콤마 포함 3자리 이상 숫자 덩어리들
    const amtMatches = line.match(/[0-9][0-9,]{2,}/g)
    if (!amtMatches) continue
    // 날짜(2026-07-09, 07/09 등)는 금액 후보에서 제외 → 콤마 있거나 4자리↑만 인정
    const amounts = amtMatches
      .filter(t => t.includes(',') || t.replace(/[^0-9]/g, '').length >= 4)
      .map(parseAmount)
      .filter(n => n != null && n >= 100)
    if (!amounts.length) continue
    const amount = Math.max(...amounts) // 잔액/금액 여러개면 큰 값(입금액)으로
    // 이름: 한글 2자 이상 또는 영문 2자 이상 토큰 중 첫 번째
    const nameTok = line.match(/[가-힣]{2,}|[a-zA-Z]{2,}/)
    const name = nameTok ? nameTok[0] : ''
    if (!name) continue
    out.push({ name, amount, raw: line })
  }
  return out
}

// ── 신청 ↔ 입금 매칭 ────────────────────────────────────────────────────
// 참가비가 있고 아직 입금 확인 안 된 신청을 입금 내역과 대조한다.
//
// @param {object[]} entries   tournament_entries + player1/player2 join
// @param {object[]} deposits  parseDeposits() 결과 [{ name, amount, raw }]
// @param {object}   catById   { [categoryId]: { entry_fee } }
// @returns {{
//   confirmed:   [{ entry, deposit, score }],  // 자동 입금 확인 대상(정확·확실)
//   review:      [{ entry, deposit, score, reason }], // 사람 확인 권장(유사·금액 애매)
//   unmatched:   entry[],                      // 대응 입금 못 찾음
//   unusedDeposits: deposit[],                 // 신청과 못 붙은 입금(오입금·중복)
// }}
//
// tier 기준:
//   confirmed — 이름 유사도 ≥0.85 AND 입금액 ≥ 참가비 AND 후보 유일(또는 최상위 명확)
//   review    — 이름 유사도 0.6~0.85 (오타 의심) 또는 입금액 부족/초과 큼 또는 후보 경합
export function matchDeposits(entries, deposits, catById = {}) {
  const confirmed = []
  const review = []
  const unmatched = []

  // 입금 확인이 필요한 신청만: 참가비>0 이고 아직 confirmed 아님, 철회/거절 제외
  const pending = (entries ?? []).filter(e => {
    if (!e) return false
    if (['withdrawn', 'rejected', 'partner_rejected'].includes(e.entry_status)) return false
    const fee = Number(catById[e.category_id]?.entry_fee) || 0
    return fee > 0 && e.payment_status !== 'confirmed' && e.payment_status !== 'refunded'
  })

  const deps = (deposits ?? []).map((d, i) => ({ ...d, _i: i, used: false }))

  // 각 신청에 대해 후보 입금들을 점수화. 그리디로 최고 점수부터 배정(입금 1건=신청 1건).
  const scored = [] // { entry, dep, score, amountOk, fee }
  for (const e of pending) {
    const fee = Number(catById[e.category_id]?.entry_fee) || 0
    const names = [e.player1?.name, e.player2?.name].filter(Boolean)
    for (const dep of deps) {
      const score = Math.max(0, ...names.map(n => nameSimilarity(n, dep.name)))
      if (score < 0.6) continue
      const amountOk = dep.amount != null && dep.amount >= fee
      scored.push({ entry: e, dep, score, amountOk, fee })
    }
  }
  // 점수·금액일치 우선 정렬(같으면 금액 정확히 일치가 우선)
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const ae = a.dep.amount === a.fee ? 1 : 0
    const be = b.dep.amount === b.fee ? 1 : 0
    return be - ae
  })

  const entryDone = new Set()
  const entryCandidates = {} // entryId → 후보 수(경합 판정)
  for (const s of scored) {
    entryCandidates[s.entry.id] = (entryCandidates[s.entry.id] || 0) + 1
  }

  for (const s of scored) {
    if (entryDone.has(s.entry.id) || s.dep.used) continue
    // 배정
    entryDone.add(s.entry.id)
    s.dep.used = true
    const contested = entryCandidates[s.entry.id] > 1

    if (s.score >= 0.85 && s.amountOk) {
      confirmed.push({ entry: s.entry, deposit: s.dep, score: s.score })
    } else {
      let reason
      if (!s.amountOk) reason = `입금액 ${fmt(s.dep.amount)} < 참가비 ${fmt(s.fee)}`
      else if (s.score < 0.85) reason = '입금자명이 신청자와 조금 달라요(오타 의심)'
      else if (contested) reason = '비슷한 입금이 여러 건이에요'
      else reason = '확인 권장'
      review.push({ entry: s.entry, deposit: s.dep, score: s.score, reason })
    }
  }

  for (const e of pending) if (!entryDone.has(e.id)) unmatched.push(e)
  const unusedDeposits = deps.filter(d => !d.used)

  return { confirmed, review, unmatched, unusedDeposits }
}

function fmt(n) {
  return n == null ? '-' : `${Number(n).toLocaleString('ko-KR')}원`
}

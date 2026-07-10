// ============================================================
// 정산·손익 엔진 (C10) — 순수 함수, 스키마·외부키 불필요
// ------------------------------------------------------------
// 북극성 체인의 "정산" 단계. 지금껏 주최자는 참가비 입금·상금·경비를
// 손으로 더해 손익과 원천징수를 계산해야 했다. 이 엔진은 기존 데이터
// (tournament_categories.entry_fee, tournament_entries.payment_*)만으로
// 수입/지출/순손익과 상금 원천징수를 계산한다.
//
// 설계 원칙:
//  - 수입 = 입금 확인(confirmed)된 참가비만 (실제 들어온 돈)
//  - 지출 = 주최자 입력 경비 + 상금 총액
//  - 환불(refunded)·미수금(pending)은 손익에 넣지 않고 정보로만 표시
//    (환불 = 들어왔다 나간 돈이라 순손익 영향 0, 미수금 = 아직 안 들어온 돈)
//  - 원천징수는 상금을 세무서 납부분/선수 실지급분으로 쪼개 보여줄 뿐
//    상금 총액 자체는 이미 지출에 반영됨 (P&L 이중계상 방지)
// ============================================================

// 상금 원천징수 세율 프리셋 (주최자가 상금에서 떼어 세무서에 대신 납부)
// 실제 적용 세목은 사안별로 다르므로 참고용 — 세무 확인 권장.
export const WITHHOLDING_PRESETS = [
  { key: 'none',     label: '원천징수 없음',   rate: 0,     desc: '상품·상품권 등 소액·비과세로 처리할 때' },
  { key: 'other',    label: '기타소득 22%',    rate: 0.22,  desc: '일시적 상금 기본 (소득세 20% + 지방세 2%)' },
  { key: 'other80',  label: '기타소득 4.4%',   rate: 0.044, desc: '필요경비 80% 인정 시 실효세율' },
  { key: 'business', label: '사업소득 3.3%',   rate: 0.033, desc: '반복 수상·프리랜서 (소득세 3% + 지방세 0.3%)' },
]

export function presetByKey(key) {
  return WITHHOLDING_PRESETS.find(p => p.key === key) ?? WITHHOLDING_PRESETS[0]
}

// 한 신청 건의 참가비 금액: 실제 입금액(payment_amount)이 있으면 그 값,
// 없으면 종목 참가비(entry_fee)로 보정.
function entryAmount(entry, feeByCat) {
  const paid = Number(entry.payment_amount) || 0
  if (paid > 0) return paid
  return Number(feeByCat[entry.category_id]) || 0
}

// 참가비·경비·상금으로 손익을 계산한다.
//  categories: [{ id, sport_type, entry_fee }]
//  entries:    [{ category_id, payment_status, payment_amount, entry_status }]
//  costs:      [{ label, amount }]  — 주최자 입력 경비
//  prize:      { total, withholdingRate }  — 상금 총액 + 원천징수율(0~1)
export function computeSettlement({ categories = [], entries = [], costs = [], prize = {} } = {}) {
  const feeByCat = {}
  const nameByCat = {}
  for (const c of categories) {
    feeByCat[c.id] = Number(c.entry_fee) || 0
    nameByCat[c.id] = c.sport_type || '종목'
  }

  // 철회·거절은 정산 대상에서 제외
  const active = entries.filter(
    e => e.entry_status !== 'withdrawn' && e.entry_status !== 'rejected',
  )

  let confirmedTotal = 0, confirmedCount = 0
  let pendingTotal = 0, pendingCount = 0
  let refundTotal = 0, refundCount = 0
  const byCat = {}

  const bucket = (id) =>
    byCat[id] || (byCat[id] = {
      categoryId: id, name: nameByCat[id] || '종목',
      confirmed: 0, confirmedCount: 0, pending: 0, pendingCount: 0,
    })

  for (const e of active) {
    const amt = entryAmount(e, feeByCat)
    const b = bucket(e.category_id)
    if (e.payment_status === 'confirmed') {
      confirmedTotal += amt; confirmedCount++
      b.confirmed += amt; b.confirmedCount++
    } else if (e.payment_status === 'refunded') {
      refundTotal += amt; refundCount++
    } else {
      pendingTotal += amt; pendingCount++
      b.pending += amt; b.pendingCount++
    }
  }

  const costList = costs
    .map(c => ({ label: (c.label || '').trim(), amount: Math.max(0, Number(c.amount) || 0) }))
    .filter(c => c.amount > 0 || c.label)
  const costTotal = costList.reduce((s, c) => s + c.amount, 0)

  const prizeTotal = Math.max(0, Number(prize.total) || 0)
  const rate = Math.min(1, Math.max(0, Number(prize.withholdingRate) || 0))
  const withholding = Math.round(prizeTotal * rate)
  const prizeNetPay = prizeTotal - withholding

  const income = confirmedTotal
  const expense = costTotal + prizeTotal
  const net = income - expense

  return {
    revenue: { confirmed: confirmedTotal, count: confirmedCount },
    pending: { amount: pendingTotal, count: pendingCount },   // 미수금(정보용)
    refund: { amount: refundTotal, count: refundCount },      // 환불(정보용)
    costs: costList,
    costTotal,
    prize: { total: prizeTotal, rate, withholding, netPay: prizeNetPay },
    income,
    expense,
    net,
    isProfit: net >= 0,
    byCat: Object.values(byCat),
  }
}

// ₩ 포맷 (천단위 콤마). 음수는 -₩ 로.
export function formatWon(n) {
  const v = Math.round(Number(n) || 0)
  const sign = v < 0 ? '-' : ''
  return `${sign}₩${Math.abs(v).toLocaleString('ko-KR')}`
}

// XSS 이스케이프 (인쇄 리포트용)
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
  ))
}

// 정산 리포트 인쇄용 HTML (새 창 → 자동 인쇄, 브라우저 "PDF로 저장" 가능)
export function settlementReportHtml({ title, date, venue, settlement, withholdingLabel }) {
  const s = settlement
  const rows = []
  const row = (label, value, opt = {}) => {
    const color = opt.color || '#111'
    const weight = opt.bold ? '800' : '500'
    const border = opt.top ? 'border-top:2px solid #111;' : 'border-bottom:1px solid #eee;'
    rows.push(
      `<tr style="${border}"><td style="padding:10px 4px;font-weight:${weight};color:${opt.muted ? '#888' : '#333'}">${esc(label)}</td>` +
      `<td style="padding:10px 4px;text-align:right;font-weight:${weight};color:${color};font-variant-numeric:tabular-nums">${esc(value)}</td></tr>`,
    )
  }
  row('참가비 수입 (입금 확인)', formatWon(s.revenue.confirmed) + ` · ${s.revenue.count}팀`, { bold: true, color: '#003478' })
  for (const c of s.costs) row(`지출 · ${c.label || '경비'}`, '-' + formatWon(c.amount), { color: '#C60C30' })
  if (s.prize.total > 0) row('상금 총액', '-' + formatWon(s.prize.total), { color: '#C60C30' })
  const netColor = s.isProfit ? '#059669' : '#C60C30'
  row(s.isProfit ? '순수익' : '순손실', formatWon(s.net), { bold: true, color: netColor, top: true })

  let prizeBlock = ''
  if (s.prize.total > 0) {
    prizeBlock = `
    <h2 style="font-size:16px;margin:28px 0 8px;color:#003478">상금 원천징수 (${esc(withholdingLabel || '')})</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr style="border-bottom:1px solid #eee"><td style="padding:8px 4px;color:#333">상금 총액</td><td style="padding:8px 4px;text-align:right">${esc(formatWon(s.prize.total))}</td></tr>
      <tr style="border-bottom:1px solid #eee"><td style="padding:8px 4px;color:#333">원천징수액 (세무서 납부)</td><td style="padding:8px 4px;text-align:right;color:#C60C30">${esc(formatWon(s.prize.withholding))}</td></tr>
      <tr style="border-top:2px solid #111"><td style="padding:8px 4px;font-weight:800;color:#333">선수 실지급액</td><td style="padding:8px 4px;text-align:right;font-weight:800">${esc(formatWon(s.prize.netPay))}</td></tr>
    </table>`
  }

  let infoBlock = ''
  const infos = []
  if (s.pending.amount > 0) infos.push(`미수금(아직 미입금): ${esc(formatWon(s.pending.amount))} · ${s.pending.count}팀`)
  if (s.refund.amount > 0) infos.push(`환불 처리: ${esc(formatWon(s.refund.amount))} · ${s.refund.count}팀 (순손익 영향 없음)`)
  if (infos.length) {
    infoBlock = `<p style="margin-top:20px;font-size:13px;color:#888;line-height:1.7">${infos.join('<br/>')}</p>`
  }

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"/>
<title>${esc(title || '대회')} — 정산 리포트</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,'Malgun Gothic',sans-serif;color:#111;padding:48px 40px;max-width:640px;margin:0 auto}
  .top{color:#003478;font-size:13px;font-weight:800;letter-spacing:2px}
  h1{font-size:26px;margin:8px 0 2px}
  .sub{color:#888;font-size:14px;margin-bottom:24px}
  table{width:100%;border-collapse:collapse;font-size:15px}
  .brand{margin-top:40px;font-size:12px;color:#bbb;text-align:center}
  .note{margin-top:8px;font-size:11px;color:#ccc;text-align:center}
</style></head>
<body>
  <p class="top">BADMINGUK · 배드민국</p>
  <h1>${esc(title || '대회')} 정산 리포트</h1>
  <p class="sub">${esc(date || '')}${venue ? ' · ' + esc(venue) : ''}</p>
  <table><tbody>${rows.join('')}</tbody></table>
  ${prizeBlock}
  ${infoBlock}
  <p class="brand">배드민국 — 한국 배드민턴 MMR 플랫폼</p>
  <p class="note">본 리포트는 참고용입니다. 원천징수 등 세무 처리는 세무 전문가와 확인하세요.</p>
  <script>window.onload=function(){window.print()}<\/script>
</body></html>`
}

// 새 창 열어 인쇄 (팝업 차단 시 false)
export function printSettlement(args) {
  const w = window.open('', '_blank')
  if (!w) return false
  w.document.write(settlementReportHtml(args))
  w.document.close()
  return true
}

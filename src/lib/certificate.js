// 디지털 상장 (C10 결과·시상·정산) — 시상 자동화의 마지막 조각
// ──────────────────────────────────────────────────────────────────────
// 목적: 대회가 종료되면(final_rank 확정) 입상 팀의 상장을 앱이 스스로 만들어
//       선수는 자기 상장을 바로 받고(선수 완주의 마지막 단계 "상장"),
//       주최자는 시상식용 상장을 종목별로 한 번에 인쇄할 수 있다.
//
// 순수 함수(상장 데이터·HTML 생성) + 브라우저 인쇄 헬퍼만 담는다.
// 스키마 변경·외부 키 없음. 기존 QR 인쇄(TournamentManage)와 같은 window.print
// 방식이라 PDF 저장도 브라우저 "PDF로 저장"으로 그대로 된다.

const RANK_INFO = {
  1: { label: '우승',   medal: '🥇', color: '#C60C30' },
  2: { label: '준우승', medal: '🥈', color: '#003478' },
  3: { label: '3위',    medal: '🥉', color: '#B8860B' },
}

/**
 * 순위 → 상장 등급 정보. 시상 범위(prizeSpots) 밖이면 null(상장 없음).
 */
export function certRankInfo(rank, prizeSpots = 3) {
  const r = Number(rank)
  const spots = Number(prizeSpots) || 3
  if (!Number.isFinite(r) || r < 1 || r > spots) return null
  return RANK_INFO[r] ?? { label: `${r}위`, medal: '🏅', color: '#003478' }
}

/** YYYY-MM-DD → "2026년 7월 10일" (파싱 실패 시 원문) */
export function koreanDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr ?? ''))
  if (!m) return String(dateStr ?? '')
  return `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일`
}

/**
 * 상장 1장의 데이터를 만든다. 시상 범위 밖이면 null.
 * @param {object}  tournament   { title, date, venue }
 * @param {object}  category     { sport_type, prize_description }
 * @param {string}  recipient    수상 팀/선수 표기 (예: "홍길동 · 김철수")
 * @param {number}  rank         최종 순위(1=우승 …)
 * @param {number}  prizeSpots   시상 인원(기본 3)
 * @param {string}  organizerName 주최 표기(기본 '배드민국')
 */
export function buildCertificate({
  tournament, category, recipient, rank, prizeSpots = 3, organizerName,
} = {}) {
  const info = certRankInfo(rank, prizeSpots)
  if (!info) return null
  const year = /^(\d{4})/.exec(String(tournament?.date ?? ''))?.[1] ?? ''
  return {
    issueNo: `${year || '____'}-${(category?.sport_type ?? '').trim()}-${rank}`,
    tournamentTitle: tournament?.title ?? '대회',
    sportType: category?.sport_type ?? '',
    recipient: (recipient && String(recipient).trim()) || '참가팀',
    rankLabel: info.label,
    medal: info.medal,
    color: info.color,
    dateText: koreanDate(tournament?.date),
    venue: tournament?.venue ?? '',
    organizerName: (organizerName && String(organizerName).trim()) || '배드민국',
    prizeDescription: category?.prize_description ?? '',
  }
}

/**
 * 입상 팀 목록 → 상장 배열(순위 오름차순). 시상 범위 밖은 자동 제외.
 * @param winners [{ recipient, rank }]
 */
export function buildCertificates({
  tournament, category, winners = [], prizeSpots = 3, organizerName,
} = {}) {
  return (winners ?? [])
    .filter(w => certRankInfo(w?.rank, prizeSpots))
    .slice()
    .sort((a, b) => (Number(a.rank) || 99) - (Number(b.rank) || 99))
    .map(w => buildCertificate({
      tournament, category, recipient: w.recipient, rank: w.rank, prizeSpots, organizerName,
    }))
    .filter(Boolean)
}

// ── 인쇄용 HTML ────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

function certPage(c) {
  return `<section class="cert"><div class="border">
    <p class="issue">제 ${esc(c.issueNo)} 호</p>
    <h1 class="title">상 장</h1>
    <p class="medal">${c.medal}</p>
    <p class="award" style="color:${esc(c.color)}">${esc(c.rankLabel)}</p>
    <p class="recipient">${esc(c.recipient)} <span>귀하</span></p>
    <p class="body">위 팀은 <b>${esc(c.tournamentTitle)}</b> <b>${esc(c.sportType)}</b> 경기에서<br/>
      <b style="color:${esc(c.color)}">${esc(c.rankLabel)}</b>의 우수한 성적을 거두었기에 이 상장을 수여합니다.</p>
    ${c.prizeDescription ? `<p class="prize">${esc(c.prizeDescription)}</p>` : ''}
    <p class="date">${esc(c.dateText)}</p>
    <p class="org">${esc(c.venue ? c.venue + ' · ' : '')}주최 · ${esc(c.organizerName)}</p>
    <p class="brand">BADMINGUK · 배드민국</p>
  </div></section>`
}

/** 상장 1장 또는 여러 장 → 인쇄용 전체 HTML 문서 문자열 */
export function certificatesHtml(certs, { docTitle = '상장' } = {}) {
  const list = (Array.isArray(certs) ? certs : [certs]).filter(Boolean)
  const pages = list.map(certPage).join('\n')
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"/>
<title>${esc(docTitle)}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:-apple-system,'Malgun Gothic','Apple SD Gothic Neo',sans-serif; color:#111; background:#f3f4f6; }
  .cert { width:100%; min-height:100vh; padding:24px; display:flex; align-items:center; justify-content:center; page-break-after:always; }
  .cert:last-child { page-break-after:auto; }
  .border { width:100%; max-width:720px; background:#fff; border:3px double #003478; border-radius:10px;
            padding:52px 44px; text-align:center; position:relative; }
  .border::before { content:''; position:absolute; inset:11px; border:1px solid #C60C30; border-radius:5px; pointer-events:none; }
  .issue { font-size:14px; color:#999; text-align:right; margin-bottom:20px; }
  .title { font-size:54px; font-weight:900; letter-spacing:18px; color:#003478; margin-bottom:8px; }
  .medal { font-size:56px; line-height:1.2; margin:6px 0; }
  .award { font-size:30px; font-weight:900; margin-bottom:22px; }
  .recipient { font-size:26px; font-weight:800; margin-bottom:26px; }
  .recipient span { font-size:17px; font-weight:600; color:#555; }
  .body { font-size:17px; line-height:2.1; margin-bottom:18px; }
  .prize { font-size:15px; color:#C60C30; font-weight:700; margin-bottom:18px; }
  .date { font-size:18px; font-weight:700; margin:26px 0 6px; }
  .org { font-size:18px; font-weight:800; color:#003478; }
  .brand { margin-top:26px; font-size:12px; color:#bbb; letter-spacing:2px; }
  @media print { body { background:#fff; } .cert { min-height:auto; height:100vh; padding:0; } }
</style></head>
<body>${pages}
<script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script>
</body></html>`
}

/**
 * 상장을 새 창에서 인쇄한다(브라우저 인쇄 → PDF 저장 가능).
 * @returns {boolean} 성공 여부(팝업 차단·상장 없음 시 false)
 */
export function printCertificates(certs, { docTitle = '상장' } = {}) {
  const list = (Array.isArray(certs) ? certs : [certs]).filter(Boolean)
  if (!list.length) return false
  const w = typeof window !== 'undefined' ? window.open('', '_blank') : null
  if (!w) return false
  w.document.write(certificatesHtml(list, { docTitle }))
  w.document.close()
  return true
}

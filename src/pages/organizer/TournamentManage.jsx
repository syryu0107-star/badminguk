import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import TopBar from '../../components/TopBar'
import Spinner from '../../components/Spinner'
import { planTournamentState } from '../../lib/stateMachine'
import { autoGenerateAllBrackets } from '../../lib/autoDraw'
import {
  planCampaigns, pendingCampaigns, loadSentCampaigns, markCampaignSent,
  fetchCampaignRecipients,
} from '../../lib/campaign'
import { sendCampaign } from '../../lib/notify'
import {
  computeSettlement, formatWon, printSettlement,
  WITHHOLDING_PRESETS, presetByKey,
} from '../../lib/settlement'
import {
  Users, GitBranch, Zap, Monitor, ChevronRight, Trophy,
  Share2, Copy, Check, Printer, ExternalLink, Sparkles, AlertTriangle,
  Megaphone, Send, Calculator, Plus, X, TrendingUp, TrendingDown, Gavel, Upload,
} from 'lucide-react'

// ═══════════════════════════════════════════════════════════════
// QR 코드 생성기 (외부 라이브러리 없음 · 순수 JS)
// 바이트 모드 · 오류정정 레벨 L · 버전 1~5 (최대 106바이트)
// 공유 URL 용도로 충분. 초과하면 null 반환 → QR 없이 URL만 표시.
// ═══════════════════════════════════════════════════════════════

// 버전별 [데이터 코드워드 수, 오류정정 코드워드 수] (레벨 L, 단일 블록)
const QR_CAPACITY = { 1: [19, 7], 2: [34, 10], 3: [55, 15], 4: [80, 20], 5: [108, 26] }

// GF(256) 곱셈 (다항식 0x11D)
function gfMul(x, y) {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ (((z >>> 7) & 1) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z
}

// 리드-솔로몬 생성 다항식 (최고차항 1은 생략된 계수 배열)
function rsDivisor(degree) {
  const result = []
  for (let i = 0; i < degree - 1; i++) result.push(0)
  result.push(1)
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root)
      if (j + 1 < result.length) result[j] ^= result[j + 1]
    }
    root = gfMul(root, 0x02)
  }
  return result
}

// 리드-솔로몬 나머지(오류정정 코드워드) 계산
function rsRemainder(data, divisor) {
  const result = divisor.map(() => 0)
  for (const b of data) {
    const factor = b ^ result.shift()
    result.push(0)
    divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor) })
  }
  return result
}

function getBit(x, i) { return ((x >>> i) & 1) !== 0 }

// 텍스트 → QR 모듈 행렬 (true=검정). 용량 초과 시 null.
function qrMatrix(text) {
  const bytes = Array.from(new TextEncoder().encode(text))
  let version = 0
  for (let v = 1; v <= 5; v++) {
    if (bytes.length <= QR_CAPACITY[v][0] - 2) { version = v; break }
  }
  if (!version) return null

  const [dataLen, ecLen] = QR_CAPACITY[version]
  const size = 17 + version * 4

  // ── 1. 데이터 코드워드 만들기 ──
  const bits = []
  const pushBits = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1) }
  pushBits(0b0100, 4)         // 바이트 모드
  pushBits(bytes.length, 8)   // 글자 수 (버전 1~9 바이트 모드 = 8비트)
  for (const b of bytes) pushBits(b, 8)
  const capBits = dataLen * 8
  for (let i = 0; i < 4 && bits.length < capBits; i++) bits.push(0) // 종단자
  while (bits.length % 8 !== 0) bits.push(0)
  const dataWords = []
  for (let i = 0; i < bits.length; i += 8) {
    let w = 0
    for (let j = 0; j < 8; j++) w = (w << 1) | bits[i + j]
    dataWords.push(w)
  }
  for (let pad = 0xec; dataWords.length < dataLen; pad ^= 0xec ^ 0x11) dataWords.push(pad)
  const codewords = dataWords.concat(rsRemainder(dataWords, rsDivisor(ecLen)))

  // ── 2. 기능 패턴 그리기 ──
  const modules = Array.from({ length: size }, () => new Array(size).fill(false))
  const isFunc  = Array.from({ length: size }, () => new Array(size).fill(false))
  const setFunc = (x, y, dark) => { modules[y][x] = dark; isFunc[y][x] = true }

  // 타이밍 패턴
  for (let i = 0; i < size; i++) { setFunc(6, i, i % 2 === 0); setFunc(i, 6, i % 2 === 0) }

  // 파인더 패턴 (모서리 3개, 분리대 포함)
  const drawFinder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy
        if (x < 0 || x >= size || y < 0 || y >= size) continue
        const dist = Math.max(Math.abs(dx), Math.abs(dy))
        setFunc(x, y, dist !== 2 && dist !== 4)
      }
    }
  }
  drawFinder(3, 3); drawFinder(size - 4, 3); drawFinder(3, size - 4)

  // 얼라인먼트 패턴 (버전 2 이상: 중앙 근처 1개)
  if (version >= 2) {
    const p = size - 7
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        setFunc(p + dx, p + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
      }
    }
  }

  // 포맷 정보 (BCH 15,5) — 마스크 확정 전에도 자리 확보용으로 그림
  const drawFormat = (mask) => {
    const data = (0b01 << 3) | mask   // 오류정정 L = 0b01
    let rem = data
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ (((rem >>> 9) & 1) * 0x537)
    const fb = ((data << 10) | rem) ^ 0x5412
    for (let i = 0; i <= 5; i++) setFunc(8, i, getBit(fb, i))
    setFunc(8, 7, getBit(fb, 6))
    setFunc(8, 8, getBit(fb, 7))
    setFunc(7, 8, getBit(fb, 8))
    for (let i = 9; i < 15; i++) setFunc(14 - i, 8, getBit(fb, i))
    for (let i = 0; i < 8; i++) setFunc(size - 1 - i, 8, getBit(fb, i))
    for (let i = 8; i < 15; i++) setFunc(8, size - 15 + i, getBit(fb, i))
    setFunc(8, size - 8, true) // 다크 모듈
  }
  drawFormat(0)

  // ── 3. 데이터 지그재그 배치 ──
  let bi = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        if (!isFunc[y][x] && bi < codewords.length * 8) {
          modules[y][x] = getBit(codewords[bi >>> 3], 7 - (bi & 7))
          bi++
        }
      }
    }
  }

  // ── 4. 마스크 선택 (패널티 최소) ──
  const maskAt = (m, x, y) => {
    switch (m) {
      case 0: return (x + y) % 2 === 0
      case 1: return y % 2 === 0
      case 2: return x % 3 === 0
      case 3: return (x + y) % 3 === 0
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0
      case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
      default: return false
    }
  }
  const applyMask = (m) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!isFunc[y][x] && maskAt(m, x, y)) modules[y][x] = !modules[y][x]
      }
    }
  }
  const penalty = () => {
    let score = 0
    // 규칙1: 같은 색 5개 이상 연속 (행·열)
    for (let axis = 0; axis < 2; axis++) {
      for (let a = 0; a < size; a++) {
        let run = 1
        for (let b = 1; b < size; b++) {
          const cur  = axis === 0 ? modules[a][b] : modules[b][a]
          const prev = axis === 0 ? modules[a][b - 1] : modules[b - 1][a]
          if (cur === prev) {
            run++
            if (run === 5) score += 3
            else if (run > 5) score++
          } else run = 1
        }
      }
    }
    // 규칙2: 2x2 같은 색 블록
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = modules[y][x]
        if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) score += 3
      }
    }
    // 규칙4: 어두운 모듈 비율 편차
    let dark = 0
    for (const row of modules) for (const cell of row) if (cell) dark++
    score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10
    return score
  }

  let bestMask = 0, bestScore = Infinity
  for (let m = 0; m < 8; m++) {
    applyMask(m)
    drawFormat(m)
    const s = penalty()
    if (s < bestScore) { bestScore = s; bestMask = m }
    applyMask(m) // 원상복구 (마스크 두 번 적용 = 원본)
  }
  applyMask(bestMask)
  drawFormat(bestMask)

  return modules
}

// 모듈 행렬 → SVG 문자열 (여백 4모듈 포함)
function qrSvgString(matrix, pixel = 240) {
  const n = matrix.length, quiet = 4, total = n + quiet * 2
  let d = ''
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (matrix[y][x]) d += `M${x + quiet} ${y + quiet}h1v1h-1z`
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${pixel}" height="${pixel}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#ffffff"/><path d="${d}" fill="#111111"/></svg>`
}

function QRCodeBox({ text, pixel = 176 }) {
  const svg = useMemo(() => {
    const m = qrMatrix(text)
    return m ? qrSvgString(m, pixel) : null
  }, [text, pixel])
  if (!svg) return null
  return (
    <div
      className="rounded-xl border border-gray-100 p-2 bg-white"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

// ═══════════════════════════════════════════════════════════════
// 대회 관리 페이지
// ═══════════════════════════════════════════════════════════════

export default function TournamentManage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [tournament, setTournament] = useState(null)
  const [categories, setCategories] = useState([])
  const [entryCounts, setEntryCounts] = useState({})
  const [entries, setEntries] = useState([])   // 정산용 (payment_status·amount)
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)  // 로드 실패(네트워크 flap) 복구
  const [retryTick, setRetryTick] = useState(0)
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(Date.now())

  // 무인 자동 진행 스위치 (기본 OFF, 안전) — 대회별로 기억
  const autoKey = `bdm.autostate.${id}`
  const [autoState, setAutoState] = useState(() => {
    try { return localStorage.getItem(autoKey) === '1' } catch { return false }
  })
  const autoAppliedRef = useRef(null)  // 같은 전환 중복 적용 방지

  // 사후 커뮤니케이션(C11) — 보낸 캠페인 기억, 발송 중 상태, 자동발송 중복차단
  const [sentCampaigns, setSentCampaigns] = useState(() => loadSentCampaigns(id))
  const [sendingCampaign, setSendingCampaign] = useState(null)
  const autoSentRef = useRef(new Set())

  // 정산·손익(C10) — 경비·상금·원천징수 입력은 대회별 localStorage 기억
  const settleKey = `bdm.settle.${id}`
  const [settleInput, setSettleInput] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(settleKey) || '{}')
      return {
        costs: Array.isArray(raw.costs) ? raw.costs : [],
        prizeTotal: Number(raw.prizeTotal) || 0,
        whKey: raw.whKey || 'none',
      }
    } catch { return { costs: [], prizeTotal: 0, whKey: 'none' } }
  })
  function saveSettleInput(next) {
    setSettleInput(next)
    try { localStorage.setItem(settleKey, JSON.stringify(next)) } catch { /* 무시 */ }
  }

  const liveUrl = `${window.location.origin}/live/${id}`

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const [{ data: t }, { data: cats }] = await Promise.all([
          supabase.from('tournaments').select('*').eq('id', id).single(),
          supabase
            .from('tournament_categories')
            .select('*')
            .eq('tournament_id', id),
        ])

        const counts = {}
        for (const cat of cats ?? []) {
          const { count } = await supabase
            .from('tournament_entries')
            .select('*', { count: 'exact', head: true })
            .eq('category_id', cat.id)
            .eq('entry_status', 'approved')
          counts[cat.id] = count ?? 0
        }

        // 대진표 존재/완료 판정용 경기 상태 + 정산용 신청 내역 (있으면)
        let ms = []
        let ents = []
        const catIds = (cats ?? []).map(c => c.id)
        if (catIds.length) {
          const [{ data: md }, { data: ed }] = await Promise.all([
            supabase.from('tournament_matches').select('id, status').in('category_id', catIds),
            supabase
              .from('tournament_entries')
              .select('id, category_id, payment_status, payment_amount, entry_status')
              .in('category_id', catIds),
          ])
          ms = md ?? []
          ents = ed ?? []
        }

        if (!alive) return
        setTournament(t)
        setCategories(cats ?? [])
        setEntryCounts(counts)
        setEntries(ents)
        setMatches(ms)
        setLoading(false)
      } catch {
        // 네트워크 flap 등으로 어느 조회든 throw 하면 무한 스피너에 갇히지 않도록 탈출
        if (alive) { setLoadError(true); setLoading(false) }
      }
    }
    load()
    return () => { alive = false }
  }, [id, retryTick])

  // 재시도: 스피너를 다시 띄우고 load 재실행
  function retryLoad() { setLoadError(false); setLoading(true); setRetryTick(t => t + 1) }

  // 마감 시각·대회 당일 경과를 감지하려면 시계가 흘러야 한다 (20초 틱)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20000)
    return () => clearInterval(t)
  }, [])

  // 상태 머신 판정 (실측 데이터 기준)
  const plan = useMemo(
    () => planTournamentState({ tournament, categories, counts: entryCounts, matches, now }),
    [tournament, categories, entryCounts, matches, now],
  )

  async function updateStatus(status) {
    await supabase.from('tournaments').update({ status }).eq('id', id)
    setTournament(prev => ({ ...prev, status }))
  }

  // 대진표 존재 판정용 경기 상태 재조회 (자동 추첨 후 갱신)
  async function reloadMatches() {
    const catIds = categories.map(c => c.id)
    if (!catIds.length) { setMatches([]); return }
    const { data } = await supabase
      .from('tournament_matches').select('id, status').in('category_id', catIds)
    setMatches(data ?? [])
  }

  // ── 자동 대진 생성 (추첨 자동화) ──────────────────────────────────
  // 대회 당일 대진표가 없어 대회가 시작되지 못하고 막혔을 때, 앱이 공개 추첨과
  // 동일한 로직(재현 가능한 씨드·AI 균형 편성)으로 대진표를 자동 생성한다.
  // 이미 대진표가 있는 종목은 절대 덮어쓰지 않는다(주최자가 직접 뽑은 것 보호).
  const autoDrawnRef = useRef(false)  // 무인 자동 추첨 1회 시도 잠금
  const [drawing, setDrawing] = useState(false)
  const [drawMsg, setDrawMsg] = useState(null)  // { ok, text }

  async function runAutoDraw() {
    if (!tournament || !categories.length || drawing) return
    setDrawing(true)
    setDrawMsg(null)
    try {
      const res = await autoGenerateAllBrackets(supabase, { tournament, categories })
      if (res.created > 0) {
        await reloadMatches()
        setDrawMsg({ ok: true, text: `대진표 ${res.created}개 종목을 자동으로 만들었어요 — 곧 대회가 시작돼요.` })
      } else if (res.notEnough > 0) {
        setDrawMsg({ ok: false, text: '승인된 팀이 2팀 미만인 종목이 있어 대진표를 만들 수 없어요. 참가 신청을 먼저 확인해 주세요.' })
      } else if (res.errors > 0) {
        setDrawMsg({ ok: false, text: '대진표 자동 생성 중 오류가 있었어요. 잠시 후 다시 시도해 주세요.' })
      } else {
        // 전부 이미 존재 — 판정 어긋남 보정
        await reloadMatches()
      }
    } finally {
      setDrawing(false)
    }
  }

  // 무인 자동 진행 ON + 대회 당일 대진표 없음(막힘) → 스스로 대진표 생성 (1회)
  useEffect(() => {
    if (!autoState) return
    if (tournament?.status !== 'closed') return
    if (!plan.blockReason) return          // "대진표 없음"으로 막힌 상태에서만
    if (autoDrawnRef.current) return
    autoDrawnRef.current = true
    runAutoDraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoState, tournament?.status, plan.blockReason])

  function toggleAuto() {
    setAutoState(v => {
      const next = !v
      try { localStorage.setItem(autoKey, next ? '1' : '0') } catch { /* 무시 */ }
      return next
    })
  }

  // 무인 자동 진행 ON + 안전한 자동 전환 조건 충족 → 스스로 상태 전환 (1회)
  useEffect(() => {
    if (!autoState || !plan.auto || !plan.changed) return
    const key = `${plan.current}->${plan.recommended}`
    if (autoAppliedRef.current === key) return
    autoAppliedRef.current = key
    updateStatus(plan.recommended)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoState, plan.auto, plan.changed, plan.current, plan.recommended])

  // 발송할 캠페인 목록(상태·날짜 기준) + 보냄 여부
  const campaigns = useMemo(
    () => planCampaigns(tournament, { now: new Date(now), sent: sentCampaigns }),
    [tournament, now, sentCampaigns],
  )

  // 캠페인 1건 발송 — 참가 확정 선수에게 3채널 팬아웃(인앱 도달 + 지속 저장).
  async function runCampaign(c) {
    if (!tournament || sendingCampaign) return false
    setSendingCampaign(c.type)
    try {
      const recipients = await fetchCampaignRecipients(
        supabase,
        categories.map(cat => cat.id),
      )
      await sendCampaign({
        type: c.type,
        tournamentId: id,
        title: c.title,
        body: c.body,
        recipients,
      })
      const next = markCampaignSent(id, c.type)
      setSentCampaigns(new Set(next))
      return true
    } catch {
      return false
    } finally {
      setSendingCampaign(null)
    }
  }

  // 무인 자동 진행 ON → 때가 된(아직 안 보낸) 캠페인을 스스로 1회 발송.
  useEffect(() => {
    if (!autoState || !tournament) return
    const due = pendingCampaigns(tournament, { now: new Date(now), sent: sentCampaigns })
    const target = due.find(c => !autoSentRef.current.has(c.type))
    if (!target) return
    autoSentRef.current.add(target.type)
    runCampaign(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoState, tournament, now, sentCampaigns])

  async function copyLiveUrl() {
    try {
      await navigator.clipboard.writeText(liveUrl)
    } catch {
      // 클립보드 API가 막힌 환경(비보안 컨텍스트 등) 대비
      const ta = document.createElement('textarea')
      ta.value = liveUrl
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch { /* 무시 */ }
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // 체육관 게시용 인쇄 화면 (새 창 → 자동 인쇄)
  function openPrintView() {
    const m = qrMatrix(liveUrl)
    const qrSvg = m ? qrSvgString(m, 420) : ''
    const w = window.open('', '_blank')
    if (!w) {
      alert('팝업이 차단되어 있어요. 팝업 허용 후 다시 눌러주세요.')
      return
    }
    w.document.write(`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>${(tournament?.title ?? '대회')} — 실시간 경기 현황</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, 'Malgun Gothic', sans-serif; display: flex; flex-direction: column;
         align-items: center; justify-content: center; min-height: 100vh; padding: 40px; text-align: center; }
  .top { color: #003478; font-size: 18px; font-weight: 700; letter-spacing: 2px; }
  h1 { font-size: 34px; margin: 12px 0 6px; color: #111; }
  .sub { font-size: 20px; color: #C60C30; font-weight: 800; margin-bottom: 28px; }
  .qr { margin-bottom: 24px; }
  .url { font-size: 16px; color: #555; word-break: break-all; border: 2px dashed #ccc;
         border-radius: 12px; padding: 12px 20px; max-width: 520px; }
  .hint { margin-top: 18px; font-size: 15px; color: #888; }
  .brand { margin-top: 36px; font-size: 13px; color: #bbb; }
</style>
</head>
<body>
  <p class="top">BADMINGUK · 배드민국</p>
  <h1>${(tournament?.title ?? '대회')}</h1>
  <p class="sub">실시간 경기 현황 보기</p>
  <div class="qr">${qrSvg}</div>
  <p class="url">${liveUrl}</p>
  <p class="hint">휴대폰 카메라로 QR을 찍으면 지금 경기 상황을 바로 볼 수 있어요.</p>
  <p class="brand">배드민국 — 한국 배드민턴 MMR 플랫폼</p>
  <script>window.onload = function () { window.print() }<\/script>
</body>
</html>`)
    w.document.close()
  }

  // 정산·손익 계산 (실측 참가비 + 주최자 입력 경비·상금)
  const preset = presetByKey(settleInput.whKey)
  const settlement = useMemo(
    () => computeSettlement({
      categories,
      entries,
      costs: settleInput.costs,
      prize: { total: settleInput.prizeTotal, withholdingRate: preset.rate },
    }),
    [categories, entries, settleInput, preset.rate],
  )

  // 참가비가 있는 대회거나(수입) 경비·상금을 입력했으면 정산 패널 노출
  const hasFee = categories.some(c => (c.entry_fee || 0) > 0)
  const showSettlement = hasFee || settleInput.costs.length > 0 || settleInput.prizeTotal > 0

  function addCost() {
    saveSettleInput({ ...settleInput, costs: [...settleInput.costs, { label: '', amount: 0 }] })
  }
  function updateCost(i, patch) {
    const costs = settleInput.costs.map((c, idx) => (idx === i ? { ...c, ...patch } : c))
    saveSettleInput({ ...settleInput, costs })
  }
  function removeCost(i) {
    saveSettleInput({ ...settleInput, costs: settleInput.costs.filter((_, idx) => idx !== i) })
  }
  function printReport() {
    const ok = printSettlement({
      title: tournament?.title,
      date: tournament?.date,
      venue: tournament?.venue,
      settlement,
      withholdingLabel: preset.label,
    })
    if (!ok) alert('팝업이 차단되어 있어요. 팝업 허용 후 다시 눌러주세요.')
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>
  if (loadError) return (
    <div className="py-20 flex flex-col items-center text-center gap-3 px-6">
      <AlertTriangle size={30} className="text-[#C60C30]" />
      <p className="text-sm font-bold text-gray-700">대회 관리 정보를 불러오지 못했어요</p>
      <p className="text-xs text-gray-500">인터넷 연결을 확인한 뒤 다시 시도해 주세요.</p>
      <button
        onClick={retryLoad}
        className="mt-1 px-5 py-2.5 rounded-xl text-sm font-bold text-white active:opacity-80"
        style={{ background: '#003478' }}
      >
        다시 시도
      </button>
    </div>
  )

  const totalEntries = Object.values(entryCounts).reduce((s, n) => s + n, 0)

  const STATUS_ACTIONS = {
    draft:       { label: '접수 시작', next: 'open',        cls: 'bg-emerald-600' },
    open:        { label: '접수 마감', next: 'closed',      cls: 'bg-orange-500' },
    closed:      { label: '대회 시작', next: 'in_progress', cls: 'bg-[#C60C30]' },
    in_progress: { label: '대회 종료', next: 'completed',   cls: 'bg-gray-500' },
  }
  const action = STATUS_ACTIONS[tournament?.status]

  const STATUS_TEXT = { draft:'준비중', open:'접수중', closed:'접수마감', in_progress:'진행중', completed:'종료' }

  return (
    <div className="safe-bottom">
      <TopBar title={tournament?.title} />

      <div
        className="px-5 py-5 text-white"
        style={{ background: 'linear-gradient(135deg, #003478, #C60C30)' }}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-white/70 text-sm">{tournament?.date} · {tournament?.venue}</p>
            <p className="text-xl font-black mt-0.5">{tournament?.title}</p>
          </div>
          <span className="bg-white/20 text-white text-xs font-bold px-3 py-1 rounded-full">
            {STATUS_TEXT[tournament?.status]}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-4">
          <div className="bg-white/15 rounded-xl p-3">
            <p className="text-white/70 text-xs">승인된 팀</p>
            <p className="text-2xl font-black">{totalEntries}</p>
          </div>
          <div className="bg-white/15 rounded-xl p-3">
            <p className="text-white/70 text-xs">코트 수</p>
            <p className="text-2xl font-black">{tournament?.court_count}</p>
          </div>
        </div>

        {action && (
          <button
            onClick={() => updateStatus(action.next)}
            className={`w-full mt-4 py-3 rounded-xl font-bold text-white text-sm
                        active:scale-[.97] transition ${action.cls}`}
          >
            {action.label}
          </button>
        )}
      </div>

      {/* 무인 자동 진행 (C2 상태 오케스트레이션) — draft/completed 제외 */}
      {action && (
        <div className="px-4 pt-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-start gap-2">
                <Sparkles size={18} className="text-[#C60C30] mt-0.5 shrink-0" />
                <div>
                  <p className="font-bold text-sm">무인 자동 진행</p>
                  <p className="text-xs text-gray-400 leading-relaxed mt-0.5">
                    켜두면 <b>접수 마감 시각</b>이 지나거나 <b>정원이 차면</b> 앱이 스스로 접수를
                    마감하고, 대회 당일이 되면 <b>대진표까지 자동으로 만들어</b> 대회를 시작해요.
                  </p>
                </div>
              </div>
              <button
                onClick={toggleAuto}
                aria-pressed={autoState}
                className={`shrink-0 w-12 h-7 rounded-full transition relative
                            ${autoState ? 'bg-emerald-500' : 'bg-gray-300'}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition
                              ${autoState ? 'translate-x-5' : ''}`}
                />
              </button>
            </div>

            {/* 다음 자동 전환 추천 */}
            {plan.changed && plan.auto && (
              <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
                <p className="font-bold flex items-center gap-1">
                  <Check size={14} /> {plan.reason}
                </p>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-xs text-emerald-700">
                    지금 <b>{STATUS_TEXT[plan.recommended]}</b>(으)로 전환할 수 있어요.
                    {autoState && ' 자동 진행이 켜져 있어 곧 자동 전환됩니다.'}
                  </span>
                  {!autoState && (
                    <button
                      onClick={() => updateStatus(plan.recommended)}
                      className="shrink-0 ml-2 text-xs font-bold text-white bg-emerald-600 px-3 py-1.5 rounded-lg active:scale-95"
                    >
                      지금 전환
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* 확인이 필요한 추천 (시상 확정 등 무인 전환 안 함) */}
            {plan.changed && !plan.auto && plan.reason && (
              <div className="mt-3 rounded-xl bg-blue-50 px-3 py-2.5 text-sm text-blue-800">
                <p className="font-bold">{plan.reason}</p>
                <p className="text-xs text-blue-600 mt-1">
                  {plan.recommended === 'completed'
                    ? '시상 확정은 MMR·급수에 반영되므로 실시간 진행 화면에서 한 번 확인해 주세요.'
                    : `${STATUS_TEXT[plan.recommended]}(으)로 전환을 검토하세요.`}
                </p>
              </div>
            )}

            {/* 전환이 막힌 이유 — 대진표 없음이면 자동 생성으로 해결 */}
            {plan.blockReason && (
              <div className="mt-3 rounded-xl bg-orange-50 px-3 py-2.5 text-sm text-orange-800">
                <div className="flex items-start gap-1.5">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>{plan.blockReason}</span>
                </div>
                <div className="flex items-center justify-between mt-2 gap-2">
                  <span className="text-xs text-orange-700">
                    {autoState
                      ? '무인 자동 진행이 켜져 있어 앱이 대진표를 자동으로 만들어요.'
                      : '지금 바로 대진표를 자동 생성할 수 있어요. (직접 공개 추첨을 원하면 아래 AI 대진표 생성 메뉴를 이용하세요)'}
                  </span>
                  <button
                    onClick={runAutoDraw}
                    disabled={drawing}
                    className="shrink-0 text-xs font-bold text-white bg-[#C60C30] px-3 py-1.5 rounded-lg active:scale-95 disabled:opacity-60"
                  >
                    {drawing ? '생성 중...' : '대진표 자동 생성'}
                  </button>
                </div>
              </div>
            )}

            {/* 자동 추첨 결과 안내 */}
            {drawMsg && (
              <div className={`mt-3 rounded-xl px-3 py-2.5 text-sm flex items-start gap-1.5
                ${drawMsg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
                {drawMsg.ok ? <Check size={14} className="mt-0.5 shrink-0" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
                <span>{drawMsg.text}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 대회 안내·공지 자동 발송 (C11 사후 커뮤니케이션) */}
      {campaigns.length > 0 && (
        <div className="px-4 pt-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-start gap-2">
              <Megaphone size={18} className="text-[#003478] mt-0.5 shrink-0" />
              <div>
                <p className="font-bold text-sm">대회 안내·공지</p>
                <p className="text-xs text-gray-400 leading-relaxed mt-0.5">
                  때가 되면 참가자에게 보낼 안내예요. <b>무인 자동 진행</b>이 켜져 있으면
                  앱이 알아서 보내고, 꺼져 있으면 아래에서 직접 보낼 수 있어요.
                </p>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {campaigns.map(c => (
                <div
                  key={c.key}
                  className={`rounded-xl border px-3 py-2.5 ${c.sent ? 'border-gray-100 bg-gray-50' : 'border-blue-100 bg-blue-50/50'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-sm truncate">{c.title}</p>
                      <span className="text-[11px] font-semibold text-gray-400">{c.label}</span>
                    </div>
                    {c.sent ? (
                      <span className="shrink-0 flex items-center gap-1 text-xs font-bold text-emerald-600">
                        <Check size={13} /> 보냄
                      </span>
                    ) : (
                      <button
                        onClick={() => runCampaign(c)}
                        disabled={!!sendingCampaign}
                        className="shrink-0 flex items-center gap-1 text-xs font-bold text-white
                                   bg-[#003478] px-3 py-1.5 rounded-lg active:scale-95 disabled:opacity-50"
                      >
                        <Send size={12} /> {sendingCampaign === c.type ? '보내는 중…' : '지금 보내기'}
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500 leading-relaxed mt-1.5">{c.body}</p>
                </div>
              ))}
            </div>

            <p className="text-[11px] text-gray-300 mt-3 leading-relaxed">
              문자·알림톡 실발송은 준비 중이라, 지금은 앱 안 공지함으로 도착해요.
            </p>
          </div>
        </div>
      )}

      {/* 정산 · 손익 리포트 (C10 결과·시상·정산) */}
      {showSettlement && (
        <div className="px-4 pt-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-start gap-2">
              <Calculator size={18} className="text-[#003478] mt-0.5 shrink-0" />
              <div>
                <p className="font-bold text-sm">정산 · 손익</p>
                <p className="text-xs text-gray-400 leading-relaxed mt-0.5">
                  입금 확인된 참가비에서 경비·상금을 빼서 손익을 자동으로 계산해요.
                  경비와 상금만 입력하면 원천징수까지 정리됩니다.
                </p>
              </div>
            </div>

            {/* 순손익 큰 숫자 */}
            <div
              className="mt-3 rounded-xl p-4 text-center"
              style={{ background: settlement.isProfit ? 'rgba(5,150,105,.08)' : 'rgba(198,12,48,.07)' }}
            >
              <p className="text-xs font-semibold text-gray-400">
                {settlement.isProfit ? '순수익' : '순손실'}
              </p>
              <p
                className="text-3xl font-black mt-0.5 flex items-center justify-center gap-1.5 tabular-nums"
                style={{ color: settlement.isProfit ? '#059669' : '#C60C30' }}
              >
                {settlement.isProfit
                  ? <TrendingUp size={22} className="shrink-0" />
                  : <TrendingDown size={22} className="shrink-0" />}
                {formatWon(settlement.net)}
              </p>
            </div>

            {/* 수입 / 지출 요약 */}
            <div className="grid grid-cols-2 gap-2 mt-3">
              <div className="rounded-xl bg-blue-50 p-3">
                <p className="text-[11px] font-semibold text-[#003478]">참가비 수입</p>
                <p className="text-lg font-black text-[#003478] tabular-nums">{formatWon(settlement.income)}</p>
                <p className="text-[11px] text-gray-400">입금 확인 {settlement.revenue.count}팀</p>
              </div>
              <div className="rounded-xl bg-red-50 p-3">
                <p className="text-[11px] font-semibold text-[#C60C30]">총지출</p>
                <p className="text-lg font-black text-[#C60C30] tabular-nums">{formatWon(settlement.expense)}</p>
                <p className="text-[11px] text-gray-400">경비 + 상금</p>
              </div>
            </div>

            {/* 미수금 · 환불 안내 */}
            {(settlement.pending.amount > 0 || settlement.refund.amount > 0) && (
              <div className="mt-2 space-y-1">
                {settlement.pending.amount > 0 && (
                  <p className="text-[11px] text-amber-600 flex items-center gap-1">
                    <AlertTriangle size={11} className="shrink-0" />
                    아직 입금 안 된 참가비 {formatWon(settlement.pending.amount)} · {settlement.pending.count}팀
                    <span className="text-gray-400">(입금되면 수입에 자동 반영)</span>
                  </p>
                )}
                {settlement.refund.amount > 0 && (
                  <p className="text-[11px] text-gray-400">
                    환불 처리 {formatWon(settlement.refund.amount)} · {settlement.refund.count}팀 (순손익 영향 없음)
                  </p>
                )}
              </div>
            )}

            {/* 종목별 수입 */}
            {settlement.byCat.length > 1 && (
              <div className="mt-3 rounded-xl border border-gray-100 divide-y divide-gray-50">
                {settlement.byCat.map(c => (
                  <div key={c.categoryId} className="flex items-center justify-between px-3 py-2 text-xs">
                    <span className="font-semibold text-gray-600">{c.name}</span>
                    <span className="tabular-nums text-gray-500">
                      <b className="text-[#003478]">{formatWon(c.confirmed)}</b>
                      <span className="text-gray-400"> · {c.confirmedCount}팀</span>
                      {c.pending > 0 && <span className="text-amber-500"> (미입금 {formatWon(c.pending)})</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* 경비 입력 */}
            <div className="mt-4">
              <p className="text-xs font-bold text-gray-500 mb-1.5">지출 경비</p>
              <div className="space-y-1.5">
                {settleInput.costs.map((c, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <input
                      value={c.label}
                      onChange={e => updateCost(i, { label: e.target.value })}
                      placeholder="예: 코트 대관료"
                      className="flex-1 min-w-0 bg-gray-50 rounded-lg px-2.5 py-2 text-sm outline-none focus:bg-white focus:ring-1 focus:ring-[#003478]/30 placeholder:text-gray-300"
                    />
                    <div className="flex items-center gap-0.5 shrink-0">
                      <input
                        type="number" inputMode="numeric" min="0"
                        value={c.amount || ''}
                        onChange={e => updateCost(i, { amount: Math.max(0, Number(e.target.value) || 0) })}
                        placeholder="0"
                        className="w-24 bg-gray-50 rounded-lg px-2.5 py-2 text-sm text-right tabular-nums outline-none focus:bg-white focus:ring-1 focus:ring-[#C60C30]/30 placeholder:text-gray-300"
                      />
                      <span className="text-xs text-gray-400">원</span>
                    </div>
                    <button onClick={() => removeCost(i)} className="p-1.5 text-gray-300 active:text-[#C60C30]" aria-label="경비 삭제">
                      <X size={15} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={addCost}
                className="mt-1.5 flex items-center gap-1 text-xs font-bold text-[#003478] px-2 py-1.5 rounded-lg active:bg-gray-50"
              >
                <Plus size={13} /> 경비 항목 추가
              </button>
            </div>

            {/* 상금 · 원천징수 */}
            <div className="mt-3 pt-3 border-t border-gray-50">
              <p className="text-xs font-bold text-gray-500 mb-1.5">상금 · 원천징수</p>
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-gray-500 shrink-0">상금 총액</span>
                <input
                  type="number" inputMode="numeric" min="0"
                  value={settleInput.prizeTotal || ''}
                  onChange={e => saveSettleInput({ ...settleInput, prizeTotal: Math.max(0, Number(e.target.value) || 0) })}
                  placeholder="0"
                  className="flex-1 min-w-0 bg-gray-50 rounded-lg px-2.5 py-2 text-sm text-right tabular-nums outline-none focus:bg-white focus:ring-1 focus:ring-[#C60C30]/30 placeholder:text-gray-300"
                />
                <span className="text-xs text-gray-400 shrink-0">원</span>
              </div>

              {settleInput.prizeTotal > 0 && (
                <>
                  <select
                    value={settleInput.whKey}
                    onChange={e => saveSettleInput({ ...settleInput, whKey: e.target.value })}
                    className="mt-2 w-full bg-gray-50 rounded-lg px-2.5 py-2 text-sm outline-none focus:bg-white"
                  >
                    {WITHHOLDING_PRESETS.map(p => (
                      <option key={p.key} value={p.key}>{p.label} — {p.desc}</option>
                    ))}
                  </select>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-center">
                    <div className="rounded-lg bg-gray-50 py-2">
                      <p className="text-[11px] text-gray-400">원천징수 (세무서 납부)</p>
                      <p className="text-sm font-black text-[#C60C30] tabular-nums">{formatWon(settlement.prize.withholding)}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 py-2">
                      <p className="text-[11px] text-gray-400">선수 실지급액</p>
                      <p className="text-sm font-black text-gray-700 tabular-nums">{formatWon(settlement.prize.netPay)}</p>
                    </div>
                  </div>
                </>
              )}
            </div>

            <button
              onClick={printReport}
              className="mt-4 w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-600 active:bg-gray-50"
            >
              <Printer size={15} /> 정산 리포트 인쇄 · PDF 저장
            </button>
            <p className="text-[11px] text-gray-300 mt-2 leading-relaxed">
              원천징수 세율은 참고용이에요 — 실제 세무 처리는 세무 전문가와 확인하세요.
              경비·상금은 이 기기에 저장돼요.
            </p>
          </div>
        </div>
      )}

      {/* 메뉴 */}
      <div className="px-4 py-4 space-y-3">
        {[
          { label: '참가 신청 관리', icon: Users,      path: `/organizer/${id}/entries`, desc: `신청자 관리 및 승인` },
          { label: 'AI 대진표 생성', icon: GitBranch,  path: `/organizer/${id}/bracket`, desc: '자동 일정 및 대진 생성' },
          { label: '코트 현황판',    icon: Monitor,     path: `/organizer/${id}/courts`,  desc: '실시간 코트별 경기 현황 (프로젝션용)' },
          { label: '코트별 심판 모드', icon: Gavel,      path: `/referee/court/${id}`,     desc: '코트별 현재 경기 점수판 · 다음 경기 자동 배포' },
          { label: '실시간 진행',    icon: Zap,         path: `/organizer/${id}/live`,    desc: '경기 스코어 입력 · MMR 반영' },
          { label: '최종 결과 · 시상', icon: Trophy,    path: `/tournaments/${id}/results`, desc: '시상대 · 최종 순위표 · 조별 결과' },
          { label: '대회결과 가져오기', icon: Upload,    path: `/organizer/${id}/import`,   desc: 'CSV·엑셀 결과표 업로드 → 참가자 초기 MMR 자동 부여' },
        ].map(({ label, icon: Icon, path, desc }) => (
          <button
            key={path}
            onClick={() => navigate(path)}
            className="w-full bg-white rounded-2xl p-4 flex items-center gap-3
                       border border-gray-100 shadow-sm active:scale-[.98] transition"
          >
            <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center">
              <Icon size={20} className="text-[#003478]" />
            </div>
            <div className="flex-1 text-left">
              <p className="font-bold">{label}</p>
              <p className="text-xs text-gray-400">{desc}</p>
            </div>
            <ChevronRight size={16} className="text-gray-300" />
          </button>
        ))}
      </div>

      {/* 공개 스코어보드 공유 */}
      <div className="px-4 pb-8">
        <h2 className="font-bold mb-2 flex items-center gap-1.5">
          <Share2 size={16} className="text-[#C60C30]" /> 공개 스코어보드 공유
        </h2>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
          <p className="text-xs text-gray-400 leading-relaxed">
            선수·관중 누구나 <strong>로그인 없이</strong> 실시간 경기 현황을 볼 수 있는 주소예요.
            단체 채팅방에 붙여넣거나, QR을 체육관 입구에 붙여두세요.
          </p>

          {/* URL + 복사 */}
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-gray-50 rounded-xl px-3 py-2.5 text-xs font-mono text-gray-600 truncate">
              {liveUrl}
            </div>
            <button
              onClick={copyLiveUrl}
              className={`shrink-0 flex items-center gap-1 text-xs font-bold px-3 py-2.5 rounded-xl
                          transition active:scale-95
                          ${copied ? 'bg-emerald-100 text-emerald-700' : 'bg-[#003478] text-white'}`}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? '복사됨!' : '복사'}
            </button>
          </div>

          {/* QR 코드 */}
          <div className="flex flex-col items-center py-1">
            <QRCodeBox text={liveUrl} />
            <p className="text-xs text-gray-400 mt-2">휴대폰 카메라로 찍으면 바로 열려요</p>
          </div>

          {/* 인쇄 */}
          <button
            onClick={openPrintView}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl
                       border border-gray-200 text-sm font-bold text-gray-600 active:bg-gray-50"
          >
            <Printer size={15} /> 체육관 게시용 인쇄
          </button>

          {/* 바로가기 */}
          <div className="flex gap-2">
            <button
              onClick={() => navigate(`/organizer/${id}/courts`)}
              className="flex-1 flex items-center justify-center gap-1 py-2.5 rounded-xl
                         bg-gray-50 text-xs font-bold text-[#003478] active:bg-gray-100"
            >
              <Monitor size={13} /> 코트 현황판 열기
            </button>
            <button
              onClick={() => navigate(`/tournaments/${id}/results`)}
              className="flex-1 flex items-center justify-center gap-1 py-2.5 rounded-xl
                         bg-gray-50 text-xs font-bold text-[#C60C30] active:bg-gray-100"
            >
              <Trophy size={13} /> 결과 페이지 열기
            </button>
          </div>

          <p className="text-[11px] text-gray-300 flex items-center gap-1">
            <ExternalLink size={11} /> 공유 주소는 대회가 끝난 뒤에도 열려요 — 결과 확인용으로도 쓸 수 있어요.
          </p>
        </div>
      </div>
    </div>
  )
}

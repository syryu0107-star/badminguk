import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import TopBar from '../../components/TopBar'
import GradeChip from '../../components/GradeChip'
import Spinner from '../../components/Spinner'
import { assessSandbag, worseLevel, SANDBAG_STYLE } from '../../lib/sandbag'
import { planAutoApprovals } from '../../lib/stateMachine'
import { parseDeposits, matchDeposits } from '../../lib/payment'
import { Check, X, ShieldAlert, Trophy, Clock, Sparkles, Banknote, ChevronDown } from 'lucide-react'

// 신청 상태별 표시(라벨·색). 011에서 partner_pending/partner_rejected 추가됨.
const ENTRY_STATUS_META = {
  approved:         { label: '승인됨',            cls: 'text-emerald-600 bg-emerald-50' },
  rejected:         { label: '거절됨',            cls: 'text-red-500 bg-red-50' },
  applied:          { label: '승인 대기중',       cls: 'text-amber-600 bg-amber-50' },
  waitlisted:       { label: '대기순번',          cls: 'text-blue-600 bg-blue-50' },
  withdrawn:        { label: '신청 철회',          cls: 'text-gray-400 bg-gray-100' },
  partner_pending:  { label: '⏳ 파트너 수락 대기', cls: 'text-orange-600 bg-orange-50' },
  partner_rejected: { label: '❌ 파트너 거절',     cls: 'text-gray-500 bg-gray-100' },
}

// 입금 상태(001: pending/confirmed/refunded)
const PAY_META = {
  pending:   { label: '입금 대기', cls: 'text-gray-500 bg-gray-100' },
  confirmed: { label: '입금 완료', cls: 'text-emerald-600 bg-emerald-50' },
  refunded:  { label: '환불됨',   cls: 'text-gray-400 bg-gray-100' },
}

// 파트너가 아직 수락 안 함/거절 → 팀 미확정 → 대진 편성 대상 제외
const isPartnerBlocked = s => s === 'partner_pending' || s === 'partner_rejected'

export default function EntryManagement() {
  const { id } = useParams()
  const [categories, setCategories] = useState([])
  const [entries, setEntries]       = useState([])
  const [activeCat, setActiveCat]   = useState(null)
  const [podium, setPodium]         = useState({}) // playerId → { champ, medal }
  const [loading, setLoading]       = useState(true)
  const [approving, setApproving]   = useState(false)

  // 입금 자동 매칭 (C3) — 무통장 입금 내역 붙여넣기 대조
  const [depositText, setDepositText] = useState('')
  const [showDeposit, setShowDeposit] = useState(false)
  const [confirming, setConfirming]   = useState(false)

  // 무인 자동 승인 스위치 (기본 OFF) — 대회별 기억
  const autoKey = `bdm.autoapprove.${id}`
  const [autoApprove, setAutoApprove] = useState(() => {
    try { return localStorage.getItem(autoKey) === '1' } catch { return false }
  })
  const autoRunRef = useRef(false)

  useEffect(() => {
    async function load() {
      const { data: cats } = await supabase
        .from('tournament_categories')
        .select('*')
        .eq('tournament_id', id)
      const catIds = cats?.map(c => c.id) ?? []
      if (catIds.length === 0) { setLoading(false); return }

      const { data: es } = await supabase
        .from('tournament_entries')
        .select(`
          *,
          player1:profiles!player1_id(id,name,official_grade,grade_verified,mmr,mmr_games_played),
          player2:profiles!player2_id(id,name,official_grade,grade_verified,mmr,mmr_games_played)
        `)
        .in('category_id', catIds)
        .order('created_at', { ascending: true })

      // 신청자들의 과거 입상 이력(final_rank≤3) 집계 — 급수↔실적 괴리 심사 근거
      const ids = new Set()
      es?.forEach(e => { if (e.player1?.id) ids.add(e.player1.id); if (e.player2?.id) ids.add(e.player2.id) })
      const map = {}
      if (ids.size) {
        const list = [...ids].join(',')
        const { data: hist } = await supabase
          .from('tournament_entries')
          .select('player1_id,player2_id,final_rank')
          .or(`player1_id.in.(${list}),player2_id.in.(${list})`)
          .not('final_rank', 'is', null)
          .lte('final_rank', 3)
        hist?.forEach(h => {
          ;[h.player1_id, h.player2_id].forEach(pid => {
            if (!pid || !ids.has(pid)) return
            const rec = map[pid] ?? (map[pid] = { champ: 0, medal: 0 })
            rec.medal += 1
            if (h.final_rank === 1) rec.champ += 1
          })
        })
      }

      setCategories(cats ?? [])
      setEntries(es ?? [])
      setPodium(map)
      setActiveCat(cats?.[0]?.id ?? null)
      setLoading(false)
    }
    load()
  }, [id])

  async function updateEntry(entryId, status) {
    await supabase.from('tournament_entries').update({ entry_status: status }).eq('id', entryId)
    setEntries(prev => prev.map(e => e.id === entryId ? { ...e, entry_status: status } : e))
  }

  // 대회 전체 자동 승인 분류 (샌드배깅 의심·입금 미확인·정원 초과·팀 미확정만 사람에게 남김)
  const catById = useMemo(
    () => Object.fromEntries(categories.map(c => [c.id, c])),
    [categories],
  )
  const approvedCounts = useMemo(() => {
    const m = {}
    for (const e of entries) {
      if (e.entry_status === 'approved') m[e.category_id] = (m[e.category_id] || 0) + 1
    }
    return m
  }, [entries])
  const buckets = useMemo(
    () => planAutoApprovals(entries, catById, { counts: approvedCounts }),
    [entries, catById, approvedCounts],
  )

  // 입금 자동 매칭 — 참가비 있는 대회에서만 노출
  const hasFee = useMemo(() => categories.some(c => (Number(c.entry_fee) || 0) > 0), [categories])
  const deposits = useMemo(() => parseDeposits(depositText), [depositText])
  const match = useMemo(() => matchDeposits(entries, deposits, catById), [entries, deposits, catById])
  const feePendingCount = useMemo(
    () => entries.filter(e => {
      const fee = Number(catById[e.category_id]?.entry_fee) || 0
      return fee > 0 && e.payment_status !== 'confirmed' && e.payment_status !== 'refunded'
        && !['withdrawn', 'rejected', 'partner_rejected'].includes(e.entry_status)
    }).length,
    [entries, catById],
  )

  // 매칭된 신청을 입금 완료 처리 (payment_status='confirmed')
  async function confirmPayments(list) {
    const ids = (list ?? match.confirmed).map(m => m.entry.id)
    if (!ids.length || confirming) return
    setConfirming(true)
    try {
      await supabase.from('tournament_entries').update({ payment_status: 'confirmed' }).in('id', ids)
      const idSet = new Set(ids)
      setEntries(prev => prev.map(e => idSet.has(e.id) ? { ...e, payment_status: 'confirmed' } : e))
    } catch { /* 무시 — 다음 로드에서 재시도 */ }
    setConfirming(false)
  }

  // 안전한 신청 일괄 자동 승인
  async function approveSafe(list) {
    const ids = (list ?? buckets.auto).map(e => e.id)
    if (!ids.length || approving) return
    setApproving(true)
    try {
      await supabase.from('tournament_entries').update({ entry_status: 'approved' }).in('id', ids)
      const idSet = new Set(ids)
      setEntries(prev => prev.map(e => idSet.has(e.id) ? { ...e, entry_status: 'approved' } : e))
    } catch { /* 무시 — 다음 로드에서 재시도 */ }
    setApproving(false)
  }

  function toggleAutoApprove() {
    setAutoApprove(v => {
      const next = !v
      try { localStorage.setItem(autoKey, next ? '1' : '0') } catch { /* 무시 */ }
      if (!next) autoRunRef.current = false
      return next
    })
  }

  // 자동 승인 ON → 안전한 신청을 한 번 자동 승인 (신규 신청 들어오면 buckets 변해 재실행)
  useEffect(() => {
    if (!autoApprove || approving) return
    if (buckets.auto.length === 0) { autoRunRef.current = false; return }
    if (autoRunRef.current) return
    autoRunRef.current = true
    approveSafe(buckets.auto)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoApprove, buckets.auto.length, approving])

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>

  const catEntries = entries.filter(e => e.category_id === activeCat)
  const approved   = catEntries.filter(e => e.entry_status === 'approved').length
  const pendingPartnerCount = catEntries.filter(e => isPartnerBlocked(e.entry_status)).length
  const activeCatInfo = categories.find(c => c.id === activeCat)

  // 종목별 신청자 샌드배깅 위험 판정
  function entryRisk(e) {
    const a1 = assessSandbag(e.player1, activeCatInfo)
    const a2 = e.player2 ? assessSandbag(e.player2, activeCatInfo) : { level: 'none', reasons: [] }
    const level = worseLevel(a1.level, a2.level)
    return { level, a1, a2 }
  }
  const flaggedCount = catEntries.filter(e => entryRisk(e).level !== 'none').length

  return (
    <div className="safe-bottom">
      <TopBar title="참가 신청 관리" />

      {/* 무인 자동 승인 (C2) — 대회 전체 기준 */}
      <div className="px-4 pt-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-start gap-2">
              <Sparkles size={18} className="text-[#C60C30] mt-0.5 shrink-0" />
              <div>
                <p className="font-bold text-sm">무인 자동 승인</p>
                <p className="text-xs text-gray-400 leading-relaxed mt-0.5">
                  의심 없는 정상 신청은 앱이 자동 승인해요. <b>급수 사기 의심·입금 미확인·정원
                  초과</b>만 아래에서 직접 확인하시면 됩니다.
                </p>
              </div>
            </div>
            <button
              onClick={toggleAutoApprove}
              aria-pressed={autoApprove}
              className={`shrink-0 w-12 h-7 rounded-full transition relative
                          ${autoApprove ? 'bg-emerald-500' : 'bg-gray-300'}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition
                            ${autoApprove ? 'translate-x-5' : ''}`}
              />
            </button>
          </div>

          {/* 분류 요약 */}
          <div className="grid grid-cols-4 gap-1.5 mt-3 text-center">
            {[
              { n: buckets.auto.length,     label: '자동승인',   cls: 'text-emerald-600' },
              { n: buckets.review.length,   label: '의심검토',   cls: 'text-red-500' },
              { n: buckets.payment.length,  label: '입금대기',   cls: 'text-amber-600' },
              { n: buckets.capacity.length, label: '정원초과',   cls: 'text-gray-500' },
            ].map(b => (
              <div key={b.label} className="bg-gray-50 rounded-xl py-2">
                <p className={`text-lg font-black ${b.cls}`}>{b.n}</p>
                <p className="text-[11px] text-gray-400">{b.label}</p>
              </div>
            ))}
          </div>

          {buckets.auto.length > 0 && !autoApprove && (
            <button
              onClick={() => approveSafe(buckets.auto)}
              disabled={approving}
              className="w-full mt-3 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold
                         active:scale-[.98] transition disabled:opacity-50"
            >
              {approving ? '승인 중…' : `안전한 ${buckets.auto.length}건 지금 자동 승인`}
            </button>
          )}
          {autoApprove && (
            <p className="mt-3 text-xs text-emerald-700 bg-emerald-50 rounded-xl px-3 py-2 flex items-center gap-1">
              <Check size={13} /> 자동 승인 켜짐 — 정상 신청은 들어오는 대로 승인됩니다.
            </p>
          )}
          {buckets.review.length > 0 && (
            <p className="mt-2 text-xs text-red-600 flex items-center gap-1">
              <ShieldAlert size={12} /> 급수 사기 의심 {buckets.review.length}건은 자동 승인에서 제외됐어요 — 아래에서 확인하세요.
            </p>
          )}
        </div>
      </div>

      {/* 입금 자동 매칭 (C3) — 무통장 입금 내역 대조 */}
      {hasFee && (
        <div className="px-4 pt-3">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <button
              onClick={() => setShowDeposit(v => !v)}
              className="w-full flex items-center justify-between gap-3 p-4 text-left"
            >
              <div className="flex items-start gap-2">
                <Banknote size={18} className="text-[#003478] mt-0.5 shrink-0" />
                <div>
                  <p className="font-bold text-sm">입금 자동 매칭</p>
                  <p className="text-xs text-gray-400 leading-relaxed mt-0.5">
                    은행 입금 내역을 붙여넣으면 신청자 이름·금액으로 자동 대조해 입금 완료 처리해요.
                    {feePendingCount > 0
                      ? <> 현재 <b className="text-amber-600">입금 대기 {feePendingCount}건</b></>
                      : <> 입금 대기가 없어요 ✓</>}
                  </p>
                </div>
              </div>
              <ChevronDown size={18} className={`text-gray-400 shrink-0 transition ${showDeposit ? 'rotate-180' : ''}`} />
            </button>

            {showDeposit && (
              <div className="px-4 pb-4 border-t border-gray-50 pt-3">
                <textarea
                  value={depositText}
                  onChange={e => setDepositText(e.target.value)}
                  rows={4}
                  placeholder={'은행/토스 입금 내역을 그대로 붙여넣으세요\n예) 2026-07-10  홍길동  30,000원\n     김민준,30000'}
                  className="w-full text-sm rounded-xl border border-gray-200 p-3 leading-relaxed
                             focus:outline-none focus:ring-2 focus:ring-[#003478]/30 resize-none"
                />

                {depositText.trim() && (
                  <>
                    {/* 매칭 결과 요약 */}
                    <div className="grid grid-cols-3 gap-1.5 mt-3 text-center">
                      {[
                        { n: match.confirmed.length, label: '자동 확인', cls: 'text-emerald-600' },
                        { n: match.review.length,    label: '확인 권장', cls: 'text-amber-600' },
                        { n: match.unmatched.length, label: '미매칭',    cls: 'text-gray-500' },
                      ].map(b => (
                        <div key={b.label} className="bg-gray-50 rounded-xl py-2">
                          <p className={`text-lg font-black ${b.cls}`}>{b.n}</p>
                          <p className="text-[11px] text-gray-400">{b.label}</p>
                        </div>
                      ))}
                    </div>

                    {match.confirmed.length > 0 && (
                      <button
                        onClick={() => confirmPayments(match.confirmed)}
                        disabled={confirming}
                        className="w-full mt-3 py-2.5 rounded-xl bg-[#003478] text-white text-sm font-bold
                                   active:scale-[.98] transition disabled:opacity-50"
                      >
                        {confirming ? '처리 중…' : `자동 확인 ${match.confirmed.length}건 입금 완료 처리`}
                      </button>
                    )}

                    {/* 확인 권장 — 이름/금액 애매, 사람이 1탭 승인 */}
                    {match.review.length > 0 && (
                      <div className="mt-3 space-y-1.5">
                        <p className="text-xs font-semibold text-amber-700">확인 권장 — 맞으면 개별 확인하세요</p>
                        {match.review.map(m => (
                          <div key={m.entry.id} className="flex items-center gap-2 bg-amber-50 rounded-xl px-3 py-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold truncate">
                                {m.entry.player1?.name}
                                {m.entry.player2 && ` · ${m.entry.player2.name}`}
                              </p>
                              <p className="text-[11px] text-amber-600 truncate">
                                입금 “{m.deposit.name} {m.deposit.amount?.toLocaleString('ko-KR')}원” · {m.reason}
                              </p>
                            </div>
                            <button
                              onClick={() => confirmPayments([m])}
                              disabled={confirming}
                              className="shrink-0 px-2.5 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-bold
                                         active:opacity-80 disabled:opacity-50"
                            >
                              입금 확인
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 신청과 못 붙은 입금 — 오입금·중복·미신청 */}
                    {match.unusedDeposits.length > 0 && (
                      <p className="mt-2 text-[11px] text-gray-400">
                        신청과 못 붙은 입금 {match.unusedDeposits.length}건:
                        {' '}{match.unusedDeposits.map(d => `${d.name}(${d.amount?.toLocaleString('ko-KR')})`).join(', ')}
                        {' '}— 오입금·미신청·이름 상이일 수 있어요.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 종목 탭 */}
      <div className="flex gap-2 px-4 py-3 bg-white border-b border-gray-100 overflow-x-auto">
        {categories.map(cat => (
          <button
            key={cat.id}
            onClick={() => setActiveCat(cat.id)}
            className={`px-3 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap transition
                        ${activeCat === cat.id ? 'bg-[#003478] text-white' : 'bg-gray-100 text-gray-600'}`}
          >
            {cat.sport_type} {cat.grade_max && `(${cat.grade_max} 이하)`}
          </button>
        ))}
      </div>

      {/* 현황 */}
      <div className="px-4 py-3 bg-blue-50 flex items-center justify-between text-sm">
        <span className="text-blue-700 font-semibold">
          승인 {approved} / 최대 {activeCatInfo?.max_teams ?? 0}팀
        </span>
        <span className="text-blue-500">{catEntries.length}건 신청</span>
      </div>

      {/* 파트너 미확정 안내 — 대진 편성 제외 대상 */}
      {pendingPartnerCount > 0 && (
        <div className="px-4 py-2.5 bg-orange-50 flex items-center gap-2 text-sm text-orange-700">
          <Clock size={15} className="shrink-0" />
          <span className="font-semibold">파트너 미확정 {pendingPartnerCount}건</span>
          <span className="text-orange-500 text-xs">— 파트너가 아직 수락하지 않아 대진 편성에서 제외됩니다.</span>
        </div>
      )}

      {/* 샌드배깅 심사 요약 */}
      {flaggedCount > 0 && (
        <div className="px-4 py-2.5 bg-red-50 flex items-center gap-2 text-sm text-red-700">
          <ShieldAlert size={15} className="shrink-0" />
          <span className="font-semibold">급수 사기 의심 {flaggedCount}건</span>
          <span className="text-red-500 text-xs">— 신고 급수보다 실제 MMR이 높은 신청자입니다. 승인 전 확인하세요.</span>
        </div>
      )}

      {/* 신청 목록 */}
      <div className="px-4 py-4 space-y-3">
        {catEntries.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-3xl mb-2">📋</p>
            <p className="text-sm">신청자가 없습니다.</p>
          </div>
        ) : catEntries.map(e => {
          const status = e.entry_status
          const risk = entryRisk(e)
          const riskStyle = SANDBAG_STYLE[risk.level]
          const blocked = isPartnerBlocked(status)          // 대진 편성 제외 대상
          const isDoubles = ['남복', '여복', '혼복'].includes(activeCatInfo?.sport_type)
          const statusMeta = ENTRY_STATUS_META[status] ?? { label: status, cls: 'text-gray-500 bg-gray-100' }
          const payMeta = PAY_META[e.payment_status]

          // 선수 한 줄: 급수·인증·입상이력 + MMR 실측 급수·샌드배깅 배지
          //   roleNote: 파트너(player2)가 아직 수락 안 한 경우 등 상태 꼬리표
          const playerRow = (p, assess, roleNote) => {
            if (!p) return null
            const pod = podium[p.id]
            const flagged = assess.level !== 'none'
            return (
              <div className="mb-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">{p.name}</span>
                  {roleNote && (
                    <span className="text-xs font-semibold text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded">
                      {roleNote}
                    </span>
                  )}
                  {p.official_grade && <GradeChip grade={p.official_grade} size="sm" />}
                  {p.grade_verified
                    ? <span className="text-xs text-emerald-600">✓ 인증</span>
                    : <span className="text-xs text-gray-400">미인증</span>}
                  {pod && (
                    <span className="text-xs text-amber-600 flex items-center gap-0.5">
                      <Trophy size={10} /> {pod.champ > 0 ? `우승 ${pod.champ}` : `입상 ${pod.medal}`}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  MMR {p.mmr ?? '-'} · 실측 {assess.impliedGrade} 수준
                  {flagged && (
                    <span className={`ml-1.5 font-bold px-1.5 py-0.5 rounded ${SANDBAG_STYLE[assess.level].badge}`}>
                      {SANDBAG_STYLE[assess.level].label}
                    </span>
                  )}
                </p>
              </div>
            )
          }

          return (
            <div
              key={e.id}
              className={`bg-white rounded-2xl border p-4 transition
                          ${blocked ? 'opacity-60 border-dashed border-gray-300' : risk.level === 'high' ? 'border-red-200' : 'border-gray-100'}`}
            >
              {/* 파트너 미확정 → 대진 편성 제외 안내 리본 */}
              {blocked && (
                <div className="-mt-1 mb-2 flex items-center gap-1 text-xs font-semibold text-orange-600">
                  <Clock size={12} className="shrink-0" />
                  대진 편성 제외 — 팀 미확정
                </div>
              )}

              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  {playerRow(e.player1, risk.a1)}
                  {playerRow(e.player2, risk.a2, status === 'partner_pending' ? '수락 대기' : null)}
                  {/* 복식인데 파트너 미지정 상태(비정상 데이터 방어) */}
                  {isDoubles && !e.player2 && (
                    <p className="text-xs text-orange-500 font-semibold">파트너 미지정</p>
                  )}
                </div>

                {/* 상태 / 입금 / 버튼 */}
                <div className="flex flex-col items-end gap-1.5">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${statusMeta.cls}`}>
                    {statusMeta.label}
                  </span>
                  {payMeta && (
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${payMeta.cls}`}>
                      {payMeta.label}
                    </span>
                  )}

                  {status === 'applied' && (
                    <div className="flex gap-1.5 mt-1">
                      <button
                        onClick={() => updateEntry(e.id, 'approved')}
                        className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center
                                   active:opacity-80"
                      >
                        <Check size={14} className="text-white" />
                      </button>
                      <button
                        onClick={() => updateEntry(e.id, 'rejected')}
                        className="w-8 h-8 rounded-lg bg-red-400 flex items-center justify-center
                                   active:opacity-80"
                      >
                        <X size={14} className="text-white" />
                      </button>
                    </div>
                  )}
                  {status === 'approved' && (
                    <button
                      onClick={() => updateEntry(e.id, 'applied')}
                      className="text-xs text-gray-400 underline mt-1"
                    >
                      취소
                    </button>
                  )}
                </div>
              </div>

              {/* 샌드배깅 심사 근거 */}
              {riskStyle && (
                <div className={`mt-2.5 rounded-xl px-3 py-2 text-xs ${riskStyle.box}`}>
                  <div className="flex items-center gap-1 font-bold mb-1">
                    <ShieldAlert size={12} /> {riskStyle.label}
                  </div>
                  <ul className="list-disc list-inside space-y-0.5">
                    {[...new Set([...risk.a1.reasons, ...risk.a2.reasons])].map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="text-xs text-gray-300 mt-2">
                신청: {new Date(e.created_at).toLocaleString('ko-KR')}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

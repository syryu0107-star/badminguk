import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import TopBar from '../../components/TopBar'
import GradeChip from '../../components/GradeChip'
import Spinner from '../../components/Spinner'
import { assessSandbag, worseLevel, SANDBAG_STYLE } from '../../lib/sandbag'
import { Check, X, ShieldAlert, Trophy, Clock } from 'lucide-react'

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

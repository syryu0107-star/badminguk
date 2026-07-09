import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import TopBar from '../../components/TopBar'
import GradeChip from '../../components/GradeChip'
import Spinner from '../../components/Spinner'
import { assessSandbag, worseLevel, SANDBAG_STYLE } from '../../lib/sandbag'
import { Check, X, ShieldAlert, Trophy } from 'lucide-react'

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

          // 선수 한 줄: 급수·인증·입상이력 + MMR 실측 급수·샌드배깅 배지
          const playerRow = (p, assess) => {
            if (!p) return null
            const pod = podium[p.id]
            const flagged = assess.level !== 'none'
            return (
              <div className="mb-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">{p.name}</span>
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
            <div key={e.id} className={`bg-white rounded-2xl border p-4 ${risk.level === 'high' ? 'border-red-200' : 'border-gray-100'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  {playerRow(e.player1, risk.a1)}
                  {playerRow(e.player2, risk.a2)}
                </div>

                {/* 상태 / 버튼 */}
                <div className="flex flex-col items-end gap-1.5">
                  {status === 'approved' ? (
                    <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                      승인됨
                    </span>
                  ) : status === 'rejected' ? (
                    <span className="text-xs font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">
                      거절됨
                    </span>
                  ) : (
                    <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                      대기중
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

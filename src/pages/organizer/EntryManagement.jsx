import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import TopBar from '../../components/TopBar'
import GradeChip from '../../components/GradeChip'
import Spinner from '../../components/Spinner'
import { Check, X, Clock } from 'lucide-react'

export default function EntryManagement() {
  const { id } = useParams()
  const [categories, setCategories] = useState([])
  const [entries, setEntries]       = useState([])
  const [activeCat, setActiveCat]   = useState(null)
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
          player1:profiles!player1_id(id,name,official_grade,grade_verified,mmr),
          player2:profiles!player2_id(id,name,official_grade,grade_verified,mmr)
        `)
        .in('category_id', catIds)
        .order('created_at', { ascending: true })

      setCategories(cats ?? [])
      setEntries(es ?? [])
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

      {/* 신청 목록 */}
      <div className="px-4 py-4 space-y-3">
        {catEntries.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-3xl mb-2">📋</p>
            <p className="text-sm">신청자가 없습니다.</p>
          </div>
        ) : catEntries.map(e => {
          const status = e.entry_status
          return (
            <div key={e.id} className="bg-white rounded-2xl border border-gray-100 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  {/* 선수1 */}
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-sm">{e.player1?.name ?? '미정'}</span>
                    {e.player1?.official_grade && (
                      <GradeChip grade={e.player1.official_grade} size="sm" />
                    )}
                    {e.player1?.grade_verified && (
                      <span className="text-xs text-emerald-600">✓ 인증</span>
                    )}
                  </div>
                  {/* 선수2 */}
                  {e.player2 && (
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{e.player2.name}</span>
                      {e.player2.official_grade && (
                        <GradeChip grade={e.player2.official_grade} size="sm" />
                      )}
                    </div>
                  )}
                  <p className="text-xs text-gray-400 mt-1">
                    MMR: {e.player1?.mmr ?? '-'} {e.player2 ? `/ ${e.player2.mmr}` : ''}
                  </p>
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

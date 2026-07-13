import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import BottomNav from '../../components/BottomNav'
import Spinner from '../../components/Spinner'
import { Plus, ChevronRight, AlertTriangle } from 'lucide-react'

const STATUS_LABEL = {
  draft:       { text: '준비중',   cls: 'bg-gray-100 text-gray-600' },
  open:        { text: '접수중',   cls: 'bg-emerald-100 text-emerald-700' },
  closed:      { text: '접수마감', cls: 'bg-orange-100 text-orange-700' },
  in_progress: { text: '진행중',   cls: 'bg-red-100 text-red-600' },
  completed:   { text: '종료',     cls: 'bg-gray-100 text-gray-500' },
}

export default function OrganizerDashboard() {
  const navigate = useNavigate()
  const [tournaments, setTournaments] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [retryTick, setRetryTick] = useState(0)

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const { data: { session } } = await supabase.auth.getSession(); const user = session?.user ?? null
        let q = supabase
          .from('tournaments')
          .select('*, categories:tournament_categories(count), entries:tournament_entries(count)')
          .order('created_at', { ascending: false })
        // 로그인 상태면 내 대회만, 비로그인(테스트 모드)이면 전체를 데모로 표시
        if (user?.id) q = q.eq('organizer_id', user.id)
        const { data, error } = await q
        if (error) throw error
        if (!alive) return
        setTournaments(data ?? [])
      } catch (e) {
        // 네트워크 flap 등으로 실패했을 때 빈 목록으로 두면 "대회 없음"으로 오표시돼
        // 주최자가 자기 대회에 못 들어간다 → 에러 상태로 구분해 재시도 노출
        console.error('[배드민국] 대회 목록 로딩 실패', e)
        if (!alive) return
        setLoadError(true)
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => { alive = false }
  }, [retryTick])

  function retryLoad() {
    setLoadError(false)
    setLoading(true)
    setRetryTick(t => t + 1)
  }

  return (
    <div className="safe-bottom">
      <header
        className="px-5 pt-14 pb-5 text-white"
        style={{ background: 'linear-gradient(135deg, #003478, #001f4d)' }}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-white/70 text-sm">주최자 대시보드</p>
            <h1 className="text-2xl font-black">내 대회</h1>
          </div>
          <button
            onClick={() => navigate('/organizer/create')}
            className="flex items-center gap-1.5 bg-white text-[#003478] font-bold
                       px-3 py-2 rounded-xl text-sm active:scale-[.97] transition"
          >
            <Plus size={16} /> 대회 만들기
          </button>
        </div>
      </header>

      <div className="px-4 py-4">
        {loading ? (
          <div className="flex justify-center py-16"><Spinner size={32} /></div>
        ) : loadError ? (
          <div className="text-center py-16 text-gray-500">
            <AlertTriangle size={40} className="mx-auto mb-3 text-amber-500" />
            <p className="text-sm font-semibold text-gray-700">대회 목록을 불러오지 못했어요</p>
            <p className="text-xs text-gray-400 mt-1">인터넷 연결을 확인한 뒤 다시 시도해 주세요.</p>
            <button
              onClick={retryLoad}
              className="mt-4 px-5 py-2.5 rounded-xl text-white text-sm font-bold active:scale-[.97]"
              style={{ background: '#003478' }}
            >
              다시 시도
            </button>
          </div>
        ) : tournaments.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-4xl mb-3">🏟️</p>
            <p className="text-sm">아직 주최한 대회가 없습니다.</p>
            <button
              onClick={() => navigate('/organizer/create')}
              className="mt-4 px-5 py-2.5 rounded-xl text-white text-sm font-bold active:scale-[.97]"
              style={{ background: 'linear-gradient(135deg, #C60C30, #003478)' }}
            >
              첫 대회 만들기
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {tournaments.map(t => {
              const s = STATUS_LABEL[t.status] ?? STATUS_LABEL.draft
              return (
                <button
                  key={t.id}
                  onClick={() => navigate(`/organizer/${t.id}`)}
                  className="w-full bg-white rounded-2xl p-4 text-left border border-gray-100
                             shadow-sm active:scale-[.98] transition-transform"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="font-bold text-base">{t.title}</p>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${s.cls}`}>
                      {s.text}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-500">{t.date} · {t.venue}</p>
                    <ChevronRight size={16} className="text-gray-300" />
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <BottomNav mode="organizer" />
    </div>
  )
}

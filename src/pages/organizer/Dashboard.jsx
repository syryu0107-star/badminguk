import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import BottomNav from '../../components/BottomNav'
import Spinner from '../../components/Spinner'
import { Plus, ChevronRight } from 'lucide-react'

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

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      const { data } = await supabase
        .from('tournaments')
        .select('*, categories:tournament_categories(count), entries:tournament_entries(count)')
        .eq('organizer_id', user.id)
        .order('created_at', { ascending: false })
      setTournaments(data ?? [])
      setLoading(false)
    }
    load()
  }, [])

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

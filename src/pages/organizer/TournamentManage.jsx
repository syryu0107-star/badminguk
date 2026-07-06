import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import TopBar from '../../components/TopBar'
import Spinner from '../../components/Spinner'
import { Users, GitBranch, Zap, ChevronRight, Send } from 'lucide-react'

export default function TournamentManage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [tournament, setTournament] = useState(null)
  const [entryCounts, setEntryCounts] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [{ data: t }, { data: cats }] = await Promise.all([
        supabase.from('tournaments').select('*').eq('id', id).single(),
        supabase.from('tournament_categories').select('id').eq('tournament_id', id),
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

      setTournament(t)
      setEntryCounts(counts)
      setLoading(false)
    }
    load()
  }, [id])

  async function updateStatus(status) {
    await supabase.from('tournaments').update({ status }).eq('id', id)
    setTournament(prev => ({ ...prev, status }))
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>

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

      {/* 메뉴 */}
      <div className="px-4 py-4 space-y-3">
        {[
          { label: '참가 신청 관리', icon: Users,      path: `/organizer/${id}/entries`, desc: `신청자 관리 및 승인` },
          { label: 'AI 대진표 생성', icon: GitBranch,  path: `/organizer/${id}/bracket`, desc: '자동 일정 및 대진 생성' },
          { label: '실시간 진행',    icon: Zap,         path: `/organizer/${id}/live`,    desc: '경기 스코어 입력 · MMR 반영' },
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
    </div>
  )
}

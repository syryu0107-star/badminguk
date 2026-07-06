import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import BottomNav from '../../components/BottomNav'
import TournamentCard from '../../components/TournamentCard'
import Spinner from '../../components/Spinner'
import { Search } from 'lucide-react'

const FILTERS = [
  { key: 'all',        label: '전체' },
  { key: 'open',       label: '접수중' },
  { key: 'in_progress',label: '진행중' },
  { key: 'completed',  label: '종료' },
]

export default function Tournaments() {
  const [tournaments, setTournaments] = useState([])
  const [filter, setFilter]   = useState('all')
  const [search, setSearch]   = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      let q = supabase
        .from('tournaments')
        .select('*, categories:tournament_categories(*)')
        .order('date', { ascending: true })

      if (filter !== 'all') q = q.eq('status', filter)
      const { data } = await q
      setTournaments(data ?? [])
      setLoading(false)
    }
    load()
  }, [filter])

  const filtered = tournaments.filter(t =>
    t.title.includes(search) || t.venue.includes(search)
  )

  return (
    <div className="safe-bottom">
      {/* 헤더 */}
      <header
        className="px-5 pt-14 pb-4 text-white"
        style={{ background: 'linear-gradient(135deg, #C60C30, #003478)' }}
      >
        <h1 className="text-xl font-black mb-4">🏆 대회 찾기</h1>
        <div className="flex items-center gap-2 bg-white rounded-xl px-3 py-2.5">
          <Search size={16} className="text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="대회명 또는 장소 검색"
            className="flex-1 text-sm text-gray-800 outline-none bg-transparent"
          />
        </div>
      </header>

      {/* 필터 탭 */}
      <div className="flex gap-2 px-4 py-3 bg-white border-b border-gray-100 sticky top-0 z-30">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-semibold transition
                        ${filter === f.key
                          ? 'bg-[#C60C30] text-white'
                          : 'bg-gray-100 text-gray-600'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 목록 */}
      <div className="px-4 py-4">
        {loading ? (
          <div className="flex justify-center py-16"><Spinner size={32} /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-4xl mb-3">🏸</p>
            <p className="text-sm">해당하는 대회가 없습니다.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(t => <TournamentCard key={t.id} tournament={t} />)}
          </div>
        )}
      </div>

      <BottomNav mode="player" />
    </div>
  )
}

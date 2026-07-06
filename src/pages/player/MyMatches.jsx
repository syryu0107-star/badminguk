import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import BottomNav from '../../components/BottomNav'
import MatchCard from '../../components/MatchCard'
import Spinner from '../../components/Spinner'
import { CalendarDays } from 'lucide-react'

export default function MyMatches() {
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // 내가 속한 entries 조회
      const { data: entries } = await supabase
        .from('tournament_entries')
        .select('id')
        .or(`player1_id.eq.${user.id},player2_id.eq.${user.id}`)

      if (!entries?.length) { setLoading(false); return }
      const entryIds = entries.map(e => e.id)

      const { data: ms } = await supabase
        .from('tournament_matches')
        .select(`
          *,
          team1:tournament_entries!team1_entry_id(id,player1:profiles!player1_id(name),player2:profiles!player2_id(name)),
          team2:tournament_entries!team2_entry_id(id,player1:profiles!player1_id(name),player2:profiles!player2_id(name)),
          scores:match_scores(*)
        `)
        .or(`team1_entry_id.in.(${entryIds.join(',')}),team2_entry_id.in.(${entryIds.join(',')})`)
        .order('scheduled_time', { ascending: true })

      const formatted = (ms ?? []).map(m => ({
        ...m,
        scheduledTime: m.scheduled_time,
        team1Name: [m.team1?.player1?.name, m.team1?.player2?.name].filter(Boolean).join(' / '),
        team2Name: [m.team2?.player1?.name, m.team2?.player2?.name].filter(Boolean).join(' / '),
        sets: (m.scores ?? []).map(s => ({ a: s.team1_score, b: s.team2_score })),
        myTeamEntryId: entryIds.find(id => id === m.team1_entry_id) ? m.team1_entry_id : m.team2_entry_id,
      }))

      setMatches(formatted)
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div className="safe-bottom">
      <header
        className="px-5 pt-14 pb-4 text-white"
        style={{ background: 'linear-gradient(135deg, #C60C30, #003478)' }}
      >
        <h1 className="text-xl font-black flex items-center gap-2">
          <CalendarDays size={22} /> 내 경기
        </h1>
        <p className="text-white/70 text-sm mt-1">신청한 대회의 경기 일정</p>
      </header>

      <div className="px-4 py-4">
        {loading ? (
          <div className="flex justify-center py-16"><Spinner size={32} /></div>
        ) : matches.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-4xl mb-3">📅</p>
            <p className="text-sm">예정된 경기가 없습니다.</p>
            <p className="text-xs mt-1">대회에 참가 신청하면 여기에 나타납니다.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {matches.map(m => <MatchCard key={m.id} match={m} />)}
          </div>
        )}
      </div>

      <BottomNav mode="player" />
    </div>
  )
}

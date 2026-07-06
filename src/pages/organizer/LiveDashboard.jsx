import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { resolveMatchMMR } from '../../lib/mmr'
import TopBar from '../../components/TopBar'
import Spinner from '../../components/Spinner'
import { Clock, CheckCircle2, AlertTriangle } from 'lucide-react'

function fmt(dt) {
  if (!dt) return '--:--'
  const d = new Date(dt)
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

export default function LiveDashboard() {
  const { id } = useParams()
  const [tournament, setTournament] = useState(null)
  const [categories, setCategories] = useState([])
  const [matches, setMatches]       = useState([])
  const [activeCat, setActiveCat]   = useState(null)
  const [loading, setLoading]       = useState(true)
  const [scoring, setScoring]       = useState(null) // match id being scored

  useEffect(() => {
    async function load() {
      const [{ data: t }, { data: cats }] = await Promise.all([
        supabase.from('tournaments').select('*').eq('id', id).single(),
        supabase.from('tournament_categories').select('*').eq('tournament_id', id),
      ])
      setTournament(t)
      setCategories(cats ?? [])
      setActiveCat(cats?.[0]?.id)
      setLoading(false)
    }
    load()
  }, [id])

  useEffect(() => {
    if (!activeCat) return
    loadMatches()
    const sub = supabase
      .channel(`matches-${activeCat}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_matches' }, loadMatches)
      .subscribe()
    return () => supabase.removeChannel(sub)
  }, [activeCat])

  async function loadMatches() {
    const { data } = await supabase
      .from('tournament_matches')
      .select(`
        *,
        team1:tournament_entries!team1_entry_id(
          id,
          player1:profiles!player1_id(id,name,mmr,mmr_games_played),
          player2:profiles!player2_id(id,name,mmr,mmr_games_played)
        ),
        team2:tournament_entries!team2_entry_id(
          id,
          player1:profiles!player1_id(id,name,mmr,mmr_games_played),
          player2:profiles!player2_id(id,name,mmr,mmr_games_played)
        ),
        scores:match_scores(*)
      `)
      .eq('category_id', activeCat)
      .order('scheduled_time', { ascending: true })
    setMatches(data ?? [])
  }

  async function startMatch(matchId) {
    await supabase.from('tournament_matches').update({
      status: 'in_progress',
      actual_start: new Date().toISOString(),
    }).eq('id', matchId)
  }

  async function saveScore(matchId, sets, winningSide) {
    const match = matches.find(m => m.id === matchId)
    if (!match) return

    // 스코어 저장
    await supabase.from('match_scores').delete().eq('match_id', matchId)
    await supabase.from('match_scores').insert(
      sets.map((s, i) => ({ match_id: matchId, set_number: i+1, team1_score: s.a, team2_score: s.b }))
    )

    // 승자 결정
    const winnerEntryId = winningSide === 1 ? match.team1_entry_id : match.team2_entry_id
    await supabase.from('tournament_matches').update({
      status: 'completed',
      winner_entry_id: winnerEntryId,
    }).eq('id', matchId)

    // MMR 반영
    if (!match.mmr_applied) {
      const team1 = [match.team1?.player1, match.team1?.player2].filter(Boolean)
      const team2 = [match.team2?.player1, match.team2?.player2].filter(Boolean)
      if (team1.length === 2 && team2.length === 2) {
        const results = resolveMatchMMR({
          team1: team1.map(p => ({ id: p.id, mmr: p.mmr, gamesPlayed: p.mmr_games_played })),
          team2: team2.map(p => ({ id: p.id, mmr: p.mmr, gamesPlayed: p.mmr_games_played })),
          winner: winningSide,
        })
        for (const r of results) {
          await supabase.from('profiles')
            .update({ mmr: r.after, mmr_games_played: supabase.rpc('increment', { row_id: r.id }) })
            .eq('id', r.id)
          await supabase.from('mmr_history').insert({
            player_id: r.id, tournament_id: id, match_id: matchId,
            mmr_before: r.before, mmr_after: r.after, delta: r.delta,
          })
        }
        await supabase.from('tournament_matches').update({ mmr_applied: true }).eq('id', matchId)
      }
    }

    setScoring(null)
    loadMatches()
  }

  async function forfeitMatch(matchId, forfeitTeam) {
    const winningSide = forfeitTeam === 1 ? 2 : 1
    const match = matches.find(m => m.id === matchId)
    const winnerEntryId = winningSide === 1 ? match.team1_entry_id : match.team2_entry_id
    await supabase.from('tournament_matches').update({
      status: 'forfeited', forfeit_team: forfeitTeam, winner_entry_id: winnerEntryId,
    }).eq('id', matchId)
    loadMatches()
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>

  const catMatches = matches.filter(m => m.category_id === activeCat)
  const done = catMatches.filter(m => m.status === 'completed' || m.status === 'forfeited').length

  return (
    <div className="safe-bottom">
      <TopBar title="실시간 진행" />

      {/* 진행률 */}
      <div className="px-4 py-3 bg-white border-b border-gray-100">
        <div className="flex items-center justify-between text-sm mb-1.5">
          <span className="font-semibold">진행률</span>
          <span className="text-[#C60C30] font-bold">{done}/{catMatches.length}</span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: catMatches.length ? `${(done/catMatches.length)*100}%` : '0%',
              background: 'linear-gradient(90deg, #C60C30, #003478)'
            }}
          />
        </div>
      </div>

      {/* 종목 탭 */}
      <div className="flex gap-2 px-4 py-2 bg-white border-b border-gray-100 overflow-x-auto">
        {categories.map(cat => (
          <button key={cat.id} onClick={() => setActiveCat(cat.id)}
            className={`px-3 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap transition
                        ${activeCat === cat.id ? 'bg-[#C60C30] text-white' : 'bg-gray-100 text-gray-600'}`}
          >{cat.sport_type}</button>
        ))}
      </div>

      <div className="px-4 py-4 space-y-3">
        {catMatches.map(m => {
          const t1name = [m.team1?.player1?.name, m.team1?.player2?.name].filter(Boolean).join(' / ')
          const t2name = [m.team2?.player1?.name, m.team2?.player2?.name].filter(Boolean).join(' / ')
          const isScoring = scoring === m.id

          return (
            <div key={m.id} className={`bg-white rounded-2xl border p-4
              ${m.status === 'in_progress' ? 'border-[#C60C30] shadow-md' : 'border-gray-100'}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                  <Clock size={11} /> {fmt(m.scheduled_time)}
                  {m.court_number && <span>코트 {m.court_number}</span>}
                </div>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full
                  ${m.status === 'completed' ? 'bg-emerald-100 text-emerald-700'
                  : m.status === 'in_progress' ? 'bg-red-100 text-red-600 animate-pulse'
                  : m.status === 'forfeited' ? 'bg-yellow-100 text-yellow-700'
                  : 'bg-gray-100 text-gray-500'}`}
                >
                  {m.status === 'scheduled' ? '예정' : m.status === 'in_progress' ? '진행중'
                  : m.status === 'completed' ? '완료' : '기권'}
                </span>
              </div>

              <div className="flex items-center gap-2 text-sm font-semibold mb-3">
                <span className={`flex-1 ${m.winner_entry_id === m.team1_entry_id ? 'text-emerald-600' : ''}`}>
                  {t1name || '팀 A'}
                </span>
                <span className="text-gray-300 text-xs">vs</span>
                <span className={`flex-1 text-right ${m.winner_entry_id === m.team2_entry_id ? 'text-emerald-600' : ''}`}>
                  {t2name || '팀 B'}
                </span>
              </div>

              {m.status === 'scheduled' && (
                <div className="flex gap-2">
                  <button onClick={() => startMatch(m.id)}
                    className="flex-1 py-2 rounded-xl bg-[#003478] text-white text-xs font-bold active:opacity-80">
                    경기 시작
                  </button>
                  <button onClick={() => forfeitMatch(m.id, 1)}
                    className="py-2 px-3 rounded-xl bg-amber-100 text-amber-700 text-xs font-bold active:opacity-80">
                    팀1 기권
                  </button>
                  <button onClick={() => forfeitMatch(m.id, 2)}
                    className="py-2 px-3 rounded-xl bg-amber-100 text-amber-700 text-xs font-bold active:opacity-80">
                    팀2 기권
                  </button>
                </div>
              )}

              {m.status === 'in_progress' && !isScoring && (
                <button onClick={() => setScoring(m.id)}
                  className="w-full py-2.5 rounded-xl bg-[#C60C30] text-white text-sm font-bold active:opacity-80">
                  스코어 입력
                </button>
              )}

              {isScoring && (
                <ScoreInput
                  match={m}
                  t1name={t1name}
                  t2name={t2name}
                  onSave={saveScore}
                  onCancel={() => setScoring(null)}
                />
              )}

              {m.status === 'completed' && m.scores && (
                <div className="flex justify-center gap-3 text-sm text-gray-400 mt-1">
                  {m.scores.map((s,i) => (
                    <span key={i}>{s.team1_score}:{s.team2_score}</span>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ScoreInput({ match, t1name, t2name, onSave, onCancel }) {
  const [sets, setSets] = useState([{ a: '', b: '' }])

  function addSet() { setSets(prev => [...prev, { a: '', b: '' }]) }
  function updateSet(i, side, v) {
    setSets(prev => prev.map((s, idx) => idx === i ? { ...s, [side]: v } : s))
  }

  function determineWinner() {
    let w1 = 0, w2 = 0
    sets.forEach(s => {
      if (Number(s.a) > Number(s.b)) w1++
      else if (Number(s.b) > Number(s.a)) w2++
    })
    return w1 > w2 ? 1 : w2 > w1 ? 2 : null
  }

  const winner = determineWinner()

  return (
    <div className="mt-3 pt-3 border-t border-gray-100 space-y-3 fade-up">
      {sets.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-xs text-gray-400 w-8">{i+1}세트</span>
          <input type="number" inputMode="numeric" value={s.a} onChange={e=>updateSet(i,'a',e.target.value)}
            className="flex-1 border border-gray-200 rounded-lg py-2 text-center text-lg font-bold outline-none focus:border-[#C60C30]" />
          <span className="text-gray-300">:</span>
          <input type="number" inputMode="numeric" value={s.b} onChange={e=>updateSet(i,'b',e.target.value)}
            className="flex-1 border border-gray-200 rounded-lg py-2 text-center text-lg font-bold outline-none focus:border-[#C60C30]" />
        </div>
      ))}
      <button onClick={addSet} className="text-xs text-gray-400 underline">+ 세트 추가</button>

      {winner && (
        <p className="text-sm text-center font-bold text-emerald-600">
          {winner === 1 ? t1name : t2name} 승!
        </p>
      )}

      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-500 font-semibold">
          취소
        </button>
        <button
          onClick={() => winner && onSave(match.id, sets.map(s => ({ a: Number(s.a), b: Number(s.b) })), winner)}
          disabled={!winner}
          className="flex-1 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-bold
                     disabled:opacity-40 active:opacity-80"
        >
          저장 + MMR 반영
        </button>
      </div>
    </div>
  )
}

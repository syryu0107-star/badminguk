import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { resolveMatchMMR, CERT_LEVELS } from '../../lib/mmr'
import TopBar from '../../components/TopBar'
import Spinner from '../../components/Spinner'
import { Clock, Shield } from 'lucide-react'

function fmt(dt) {
  if (!dt) return '--:--'
  const d = new Date(dt)
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

const CERT_COLOR = { none: 'bg-gray-100 text-gray-500', c: 'bg-blue-100 text-blue-700', b: 'bg-purple-100 text-purple-700', a: 'bg-red-100 text-red-700' }

export default function LiveDashboard() {
  const { id } = useParams()
  const [tournament, setTournament] = useState(null)
  const [categories, setCategories] = useState([])
  const [matches, setMatches]       = useState([])
  const [activeCat, setActiveCat]   = useState(null)
  const [loading, setLoading]       = useState(true)
  const [scoring, setScoring]       = useState(null)

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
          player1:profiles!player1_id(id,name,mmr,mmr_games_played,official_grade),
          player2:profiles!player2_id(id,name,mmr,mmr_games_played,official_grade)
        ),
        team2:tournament_entries!team2_entry_id(
          id,
          player1:profiles!player1_id(id,name,mmr,mmr_games_played,official_grade),
          player2:profiles!player2_id(id,name,mmr,mmr_games_played,official_grade)
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

    await supabase.from('match_scores').delete().eq('match_id', matchId)
    await supabase.from('match_scores').insert(
      sets.map((s, i) => ({ match_id: matchId, set_number: i+1, team1_score: s.a, team2_score: s.b }))
    )

    const winnerEntryId = winningSide === 1 ? match.team1_entry_id : match.team2_entry_id
    await supabase.from('tournament_matches').update({
      status: 'completed',
      winner_entry_id: winnerEntryId,
    }).eq('id', matchId)

    // MMR 반영 (이미 적용된 경기 제외)
    if (!match.mmr_applied) {
      const certLevel = tournament?.cert_level ?? 'none'
      const t1raw = [match.team1?.player1, match.team1?.player2].filter(Boolean)
      const t2raw = [match.team2?.player1, match.team2?.player2].filter(Boolean)

      if (t1raw.length === 2 && t2raw.length === 2) {
        const team1 = t1raw.map(p => ({ id: p.id, mmr: p.mmr, gamesPlayed: p.mmr_games_played }))
        const team2 = t2raw.map(p => ({ id: p.id, mmr: p.mmr, gamesPlayed: p.mmr_games_played }))

        const results = resolveMatchMMR({ team1, team2, winner: winningSide, certLevel })

        for (const r of results) {
          const orig = [...t1raw, ...t2raw].find(p => p.id === r.id)
          await supabase.from('profiles')
            .update({ mmr: r.after, mmr_games_played: (orig?.mmr_games_played ?? 0) + 1 })
            .eq('id', r.id)
          await supabase.from('mmr_history').insert({
            player_id:   r.id,
            tournament_id: id,
            match_id:    matchId,
            mmr_before:  r.before,
            mmr_after:   r.after,
            delta:       r.delta,
            cert_level:  certLevel,
            partner_adj: r.partnerAdj ?? 0,
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

  const certLevel = tournament?.cert_level ?? 'none'
  const certInfo  = CERT_LEVELS[certLevel]
  const catMatches = matches.filter(m => m.category_id === activeCat)
  const done = catMatches.filter(m => ['completed','forfeited'].includes(m.status)).length

  return (
    <div className="safe-bottom">
      <TopBar title="실시간 진행" />

      {/* 공인 등급 배지 */}
      <div className="px-4 pt-3 flex items-center gap-2">
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1 ${CERT_COLOR[certLevel]}`}>
          <Shield size={11} /> {certInfo?.label}
        </span>
        <span className="text-xs text-gray-400">{certInfo?.desc}</span>
      </div>

      {/* 진행률 */}
      <div className="px-4 py-3 bg-white border-b border-gray-100 mt-2">
        <div className="flex items-center justify-between text-sm mb-1.5">
          <span className="font-semibold">진행률</span>
          <span className="text-[#C60C30] font-bold">{done}/{catMatches.length}</span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: catMatches.length ? `${(done/catMatches.length)*100}%` : '0%',
              background: 'linear-gradient(90deg, #C60C30, #003478)',
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
          const t1p = [m.team1?.player1, m.team1?.player2].filter(Boolean)
          const t2p = [m.team2?.player1, m.team2?.player2].filter(Boolean)
          const t1name = t1p.map(p => p.name).join(' / ')
          const t2name = t2p.map(p => p.name).join(' / ')
          const t1mmr  = t1p.length ? Math.round(t1p.reduce((a,p) => a+p.mmr, 0)/t1p.length) : 0
          const t2mmr  = t2p.length ? Math.round(t2p.reduce((a,p) => a+p.mmr, 0)/t2p.length) : 0
          const isScoring = scoring === m.id

          return (
            <div key={m.id} className={`bg-white rounded-2xl border p-4
              ${m.status === 'in_progress' ? 'border-[#C60C30] shadow-md' : 'border-gray-100'}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                  <Clock size={11} /> {fmt(m.scheduled_time)}
                  {m.court_number && <span>· 코트 {m.court_number}</span>}
                </div>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full
                  ${m.status === 'completed'   ? 'bg-emerald-100 text-emerald-700'
                  : m.status === 'in_progress' ? 'bg-red-100 text-red-600 animate-pulse'
                  : m.status === 'forfeited'   ? 'bg-yellow-100 text-yellow-700'
                  : 'bg-gray-100 text-gray-500'}`}
                >
                  {m.status === 'scheduled' ? '예정' : m.status === 'in_progress' ? '진행중'
                  : m.status === 'completed' ? '완료' : '기권'}
                </span>
              </div>

              {/* 팀 대결 */}
              <div className="flex items-center gap-2 mb-1">
                <div className="flex-1">
                  <p className={`text-sm font-bold ${m.winner_entry_id === m.team1_entry_id ? 'text-emerald-600' : ''}`}>
                    {t1name || '팀 A'}
                  </p>
                  <p className="text-xs text-gray-400">MMR {t1mmr}</p>
                </div>
                <span className="text-gray-300 text-xs font-bold">VS</span>
                <div className="flex-1 text-right">
                  <p className={`text-sm font-bold ${m.winner_entry_id === m.team2_entry_id ? 'text-emerald-600' : ''}`}>
                    {t2name || '팀 B'}
                  </p>
                  <p className="text-xs text-gray-400">MMR {t2mmr}</p>
                </div>
              </div>

              {m.status === 'scheduled' && (
                <div className="flex gap-2 mt-3">
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
                  className="w-full py-2.5 rounded-xl bg-[#C60C30] text-white text-sm font-bold active:opacity-80 mt-3">
                  스코어 입력
                </button>
              )}

              {isScoring && (
                <ScoreInput
                  match={m}
                  t1name={t1name} t2name={t2name}
                  team1={t1p} team2={t2p}
                  certLevel={certLevel}
                  onSave={saveScore}
                  onCancel={() => setScoring(null)}
                />
              )}

              {m.status === 'completed' && m.scores?.length > 0 && (
                <div className="flex justify-center gap-3 text-sm text-gray-400 mt-2">
                  {m.scores.map((s,i) => (
                    <span key={i} className="font-mono">{s.team1_score}:{s.team2_score}</span>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {catMatches.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">
            대진표를 먼저 생성해주세요.
          </div>
        )}
      </div>
    </div>
  )
}

function ScoreInput({ match, t1name, t2name, team1, team2, certLevel, onSave, onCancel }) {
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

  // 승패 미리보기: 현재 스코어 기준 예상 MMR 변화
  function previewMMR(winningSide) {
    if (!team1?.length || !team2?.length) return []
    const t1 = team1.map(p => ({ id: p.id, mmr: p.mmr, gamesPlayed: p.mmr_games_played }))
    const t2 = team2.map(p => ({ id: p.id, mmr: p.mmr, gamesPlayed: p.mmr_games_played }))
    try {
      return resolveMatchMMR({ team1: t1, team2: t2, winner: winningSide, certLevel })
    } catch { return [] }
  }

  const preview = winner ? previewMMR(winner) : []

  return (
    <div className="mt-3 pt-3 border-t border-gray-100 space-y-3 fade-up">
      {sets.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-xs text-gray-400 w-8">{i+1}세트</span>
          <input type="number" inputMode="numeric" value={s.a}
            onChange={e => updateSet(i,'a',e.target.value)}
            className="flex-1 border border-gray-200 rounded-lg py-2 text-center text-lg font-bold outline-none focus:border-[#C60C30]" />
          <span className="text-gray-300">:</span>
          <input type="number" inputMode="numeric" value={s.b}
            onChange={e => updateSet(i,'b',e.target.value)}
            className="flex-1 border border-gray-200 rounded-lg py-2 text-center text-lg font-bold outline-none focus:border-[#C60C30]" />
        </div>
      ))}
      <button onClick={addSet} className="text-xs text-gray-400 underline">+ 세트 추가</button>

      {winner && (
        <div className="bg-gray-50 rounded-xl p-3">
          <p className="text-xs font-bold text-gray-600 mb-2">
            {winner === 1 ? t1name : t2name} 승 — MMR 변화 미리보기
          </p>
          {preview.map((r, i) => {
            const name = [...(team1 ?? []), ...(team2 ?? [])].find(p => p.id === r.id)?.name
            return (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-gray-600">{name}</span>
                <span className={`font-bold tabular-nums ${r.delta >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {r.before} → {r.after} ({r.delta >= 0 ? '+' : ''}{r.delta})
                  {r.partnerAdj !== 0 && (
                    <span className="text-gray-400 font-normal ml-1">
                      [파트너보정 {r.partnerAdj > 0 ? '+' : ''}{r.partnerAdj}%]
                    </span>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={onCancel}
          className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-500 font-semibold">
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

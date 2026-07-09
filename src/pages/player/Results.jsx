import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { prizeLabel } from '../../lib/tournament'
import TopBar from '../../components/TopBar'
import Spinner from '../../components/Spinner'
import { Trophy, Hourglass, Users, GitBranch, Medal } from 'lucide-react'

// ─── 헬퍼 ────────────────────────────────────────────────────────

function teamLabel(entry) {
  if (!entry) return '미정'
  if (entry.team_name) return entry.team_name
  const names = [entry.player1?.name, entry.player2?.name].filter(Boolean)
  return names.length ? names.join(' / ') : '이름 없음'
}

// match_scores rows → "21-18, 19-21, 21-15"
function scoreText(match) {
  const sets = [...(match.scores ?? [])].sort((a, b) => a.set_number - b.set_number)
  return sets.map(s => `${s.team1_score}-${s.team2_score}`).join(', ')
}

// 녹아웃 라운드 이름 (round_number: 1=1라운드 … 마지막=결승)
function roundName(round, maxRound) {
  const d = maxRound - round
  if (d === 0) return '결승'
  if (d === 1) return '준결승'
  return `${Math.pow(2, d + 1)}강`
}

const RANK_EMOJI = { 1: '🥇', 2: '🥈', 3: '🥉' }

// ─── 페이지 ──────────────────────────────────────────────────────

export default function Results() {
  const { id } = useParams()
  const [tournament, setTournament] = useState(null)
  const [categories, setCategories] = useState([])
  const [entries, setEntries]       = useState([])
  const [pools, setPools]           = useState([])
  const [matches, setMatches]       = useState([])
  const [activeCat, setActiveCat]   = useState(null)
  const [userId, setUserId]         = useState(null)
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      setUserId(user?.id ?? null)

      const [{ data: t }, { data: cats }] = await Promise.all([
        supabase.from('tournaments').select('*').eq('id', id).single(),
        supabase.from('tournament_categories').select('*').eq('tournament_id', id),
      ])

      const catIds = (cats ?? []).map(c => c.id)
      let ents = [], pls = [], mts = []

      if (catIds.length > 0) {
        const [{ data: e }, { data: p }, { data: m }] = await Promise.all([
          supabase.from('tournament_entries')
            .select(`
              *,
              player1:profiles!player1_id(id, name),
              player2:profiles!player2_id(id, name)
            `)
            .in('category_id', catIds),
          supabase.from('tournament_pools')
            .select('*, pool_entries:tournament_pool_entries(entry_id, seeding_rank)')
            .in('category_id', catIds)
            .order('pool_index', { ascending: true }),
          supabase.from('tournament_matches')
            .select('*, scores:match_scores(*)')
            .in('category_id', catIds),
        ])
        ents = e ?? []; pls = p ?? []; mts = m ?? []
      }

      setTournament(t)
      setCategories(cats ?? [])
      setEntries(ents)
      setPools(pls)
      setMatches(mts)
      setActiveCat(cats?.[0]?.id ?? null)
      setLoading(false)
    }
    load()
  }, [id])

  if (loading) return <div className="flex justify-center py-20"><Spinner size={36} /></div>
  if (!tournament) return <div className="text-center py-20 text-gray-400">대회를 찾을 수 없습니다.</div>

  const isCompleted = tournament.status === 'completed'
  const cat = categories.find(c => c.id === activeCat)
  const catEntries = entries.filter(e => e.category_id === activeCat)
  const entryById = Object.fromEntries(catEntries.map(e => [e.id, e]))
  const prizeSpots = cat?.prize_spots ?? 3

  const isMine = e => !!userId && (e?.player1_id === userId || e?.player2_id === userId)
  const myEntry = catEntries.find(isMine)

  // 시상대
  const first  = catEntries.filter(e => e.final_rank === 1)
  const second = catEntries.filter(e => e.final_rank === 2)
  const third  = catEntries.filter(e => e.final_rank === 3)
  const hasPodium = first.length > 0

  // 최종 순위표 (final_rank 없는 팀은 뒤로)
  const ranked = [...catEntries].sort((a, b) =>
    (a.final_rank ?? 999) - (b.final_rank ?? 999) ||
    (a.pool_rank ?? 999) - (b.pool_rank ?? 999)
  )

  // 조별 결과
  const catPools = pools.filter(p => p.category_id === activeCat)

  // 녹아웃 결과
  const koMatches = matches.filter(m => m.category_id === activeCat && m.match_phase === 'knockout')
  const maxRound = koMatches.reduce((mx, m) => Math.max(mx, m.round_number ?? 1), 1)
  const koRounds = []
  for (let r = 1; r <= maxRound; r++) {
    const rm = koMatches
      .filter(m => (m.round_number ?? 1) === r)
      .sort((a, b) => (a.bracket_pos ?? 0) - (b.bracket_pos ?? 0))
    if (rm.length > 0) koRounds.push({ round: r, matches: rm })
  }

  function poolRecord(pool, entryId) {
    let w = 0, l = 0
    for (const m of matches) {
      if (m.pool_id !== pool.id || !m.winner_entry_id) continue
      if (m.team1_entry_id !== entryId && m.team2_entry_id !== entryId) continue
      if (m.winner_entry_id === entryId) w++
      else l++
    }
    return { w, l }
  }

  return (
    <div className="safe-bottom">
      <TopBar title="대회 결과" />

      {/* 헤더 배너 */}
      <div
        className="px-5 py-5 text-white"
        style={{ background: 'linear-gradient(135deg, #003478, #C60C30)' }}
      >
        <div className="flex items-center gap-2">
          <Trophy size={18} className="text-yellow-300" />
          <p className="text-white/70 text-sm">{tournament.date} · {tournament.venue}</p>
        </div>
        <p className="text-xl font-black mt-1">{tournament.title}</p>
        <p className="text-white/70 text-xs mt-1">
          {isCompleted ? '대회가 끝났어요. 최종 결과입니다.' : '대회 진행 중 — 결과를 집계하고 있어요.'}
        </p>
      </div>

      {/* 집계 중 안내 */}
      {!isCompleted && (
        <div className="mx-4 mt-4 bg-amber-50 border border-amber-200 rounded-2xl p-3.5 flex items-center gap-2.5">
          <Hourglass size={16} className="text-amber-600 shrink-0" />
          <p className="text-xs text-amber-700 leading-relaxed">
            아직 <strong>집계 중</strong>이에요. 모든 경기가 끝나고 대회가 종료되면 최종 순위가 확정됩니다.
          </p>
        </div>
      )}

      {/* 종목 탭 */}
      <div className="flex gap-2 px-4 pt-4 pb-1 overflow-x-auto">
        {categories.map(c => (
          <button key={c.id} onClick={() => setActiveCat(c.id)}
            className={`px-3 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap transition
                        ${activeCat === c.id ? 'bg-[#C60C30] text-white' : 'bg-gray-100 text-gray-600'}`}
          >{c.sport_type}</button>
        ))}
      </div>

      {categories.length === 0 && (
        <div className="text-center py-16 text-gray-400 text-sm">등록된 종목이 없습니다.</div>
      )}

      {cat && (
        <div className="px-4 py-4 space-y-6">

          {/* 내 결과 */}
          {myEntry && (
            <div className="rounded-2xl p-4 text-white"
              style={{ background: 'linear-gradient(135deg, #C60C30, #003478)' }}>
              <p className="text-white/70 text-xs">내 결과 · {cat.sport_type}</p>
              <div className="flex items-end justify-between mt-1">
                <p className="text-lg font-black">{teamLabel(myEntry)}</p>
                <p className="text-2xl font-black">
                  {myEntry.final_rank
                    ? `${RANK_EMOJI[myEntry.final_rank] ?? ''} ${prizeLabel(myEntry.final_rank, prizeSpots) ?? `${myEntry.final_rank}위`}`
                    : '집계 중'}
                </p>
              </div>
            </div>
          )}

          {/* 시상대 */}
          <div>
            <h2 className="font-bold mb-3 flex items-center gap-1.5">
              <Medal size={16} className="text-[#C60C30]" /> 시상대
            </h2>
            {hasPodium ? (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-end justify-center gap-2">
                  {/* 2위 */}
                  <PodiumColumn
                    emoji="🥈" height="h-20" bg="bg-gray-100"
                    label={prizeLabel(2, prizeSpots) ?? '준우승'}
                    teams={second} mineFn={isMine}
                  />
                  {/* 1위 */}
                  <PodiumColumn
                    emoji="🥇" height="h-28" bg="bg-yellow-50 border border-yellow-200"
                    label={prizeLabel(1, prizeSpots) ?? '우승'}
                    teams={first} mineFn={isMine} big
                  />
                  {/* 3위 (공동 가능) */}
                  <PodiumColumn
                    emoji="🥉" height="h-14" bg="bg-orange-50"
                    label={prizeLabel(3, prizeSpots) ?? '3위'}
                    teams={third} mineFn={isMine}
                  />
                </div>
              </div>
            ) : (
              <div className="bg-gray-50 rounded-2xl p-6 text-center">
                <p className="text-2xl mb-1">🏸</p>
                <p className="text-sm text-gray-500 font-semibold">아직 순위가 확정되지 않았어요</p>
                <p className="text-xs text-gray-400 mt-1">결승까지 끝나면 여기에 시상대가 나타나요.</p>
              </div>
            )}
          </div>

          {/* 최종 순위표 */}
          <div>
            <h2 className="font-bold mb-3 flex items-center gap-1.5">
              <Users size={16} className="text-[#003478]" /> 전체 순위
            </h2>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50">
              {ranked.length === 0 && (
                <p className="text-center py-8 text-gray-400 text-sm">참가 팀이 없습니다.</p>
              )}
              {ranked.map(e => {
                const mine = isMine(e)
                const prize = e.final_rank ? prizeLabel(e.final_rank, prizeSpots) : null
                return (
                  <div key={e.id}
                    className={`flex items-center gap-3 px-4 py-3 ${mine ? 'bg-blue-50/70' : ''}`}
                  >
                    <span className={`w-9 text-center font-black shrink-0
                      ${e.final_rank === 1 ? 'text-yellow-500 text-lg'
                      : e.final_rank === 2 ? 'text-gray-400 text-lg'
                      : e.final_rank === 3 ? 'text-orange-400 text-lg'
                      : 'text-gray-400 text-sm'}`}
                    >
                      {e.final_rank ? (RANK_EMOJI[e.final_rank] ?? `${e.final_rank}위`) : '—'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm truncate ${mine ? 'font-black text-[#003478]' : 'font-semibold'}`}>
                        {teamLabel(e)}
                        {mine && <span className="ml-1.5 text-[10px] font-bold text-white bg-[#003478] px-1.5 py-0.5 rounded-full align-middle">나</span>}
                      </p>
                      {e.pool_rank && (
                        <p className="text-xs text-gray-400">조별리그 {e.pool_rank}위</p>
                      )}
                    </div>
                    {prize && (
                      <span className="text-xs font-bold text-[#C60C30] shrink-0">{prize}</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* 조별 결과 */}
          {catPools.length > 0 && (
            <div>
              <h2 className="font-bold mb-3 flex items-center gap-1.5">
                <Users size={16} className="text-[#C60C30]" /> 조별 결과
              </h2>
              <div className="space-y-3">
                {catPools.map(pool => {
                  const rows = (pool.pool_entries ?? [])
                    .map(pe => entryById[pe.entry_id])
                    .filter(Boolean)
                    .sort((a, b) => (a.pool_rank ?? 999) - (b.pool_rank ?? 999))
                  return (
                    <div key={pool.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                      <p className="font-bold text-sm mb-2 text-[#003478]">{pool.pool_name}</p>
                      <div className="space-y-1.5">
                        {rows.map(e => {
                          const { w, l } = poolRecord(pool, e.id)
                          const mine = isMine(e)
                          return (
                            <div key={e.id} className={`flex items-center gap-2 text-sm rounded-lg px-2 py-1
                              ${mine ? 'bg-blue-50/70' : ''}`}>
                              <span className="w-8 text-xs font-bold text-gray-400 shrink-0">
                                {e.pool_rank ? `${e.pool_rank}위` : '—'}
                              </span>
                              <span className={`flex-1 truncate ${mine ? 'font-black text-[#003478]' : 'font-semibold'}`}>
                                {teamLabel(e)}
                              </span>
                              <span className="text-xs text-gray-400 font-mono shrink-0">{w}승 {l}패</span>
                            </div>
                          )
                        })}
                        {rows.length === 0 && (
                          <p className="text-xs text-gray-400 text-center py-2">조 편성 정보가 없습니다.</p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* 토너먼트 결과 */}
          {koRounds.length > 0 && (
            <div>
              <h2 className="font-bold mb-3 flex items-center gap-1.5">
                <GitBranch size={16} className="text-[#003478]" /> 토너먼트 결과
              </h2>
              <div className="space-y-4">
                {[...koRounds].reverse().map(({ round, matches: rms }) => (
                  <div key={round}>
                    <p className="text-xs font-bold text-gray-500 mb-1.5">{roundName(round, maxRound)}</p>
                    <div className="space-y-2">
                      {rms.map(m => {
                        const t1 = entryById[m.team1_entry_id]
                        const t2 = entryById[m.team2_entry_id]
                        const finished = ['completed', 'forfeited', 'bye'].includes(m.status)
                        const score = scoreText(m)
                        return (
                          <div key={m.id} className="bg-white rounded-xl border border-gray-100 px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <p className={`flex-1 text-sm truncate text-left
                                ${finished && m.winner_entry_id === m.team1_entry_id
                                  ? 'font-black text-[#003478]'
                                  : finished ? 'text-gray-400' : 'font-semibold'}`}>
                                {teamLabel(t1)}
                                {isMine(t1) && <span className="ml-1 text-[10px] font-bold text-[#003478]">(나)</span>}
                              </p>
                              <span className="text-[10px] text-gray-300 font-bold shrink-0">VS</span>
                              <p className={`flex-1 text-sm truncate text-right
                                ${finished && m.winner_entry_id === m.team2_entry_id
                                  ? 'font-black text-[#003478]'
                                  : finished ? 'text-gray-400' : 'font-semibold'}`}>
                                {teamLabel(t2)}
                                {isMine(t2) && <span className="ml-1 text-[10px] font-bold text-[#003478]">(나)</span>}
                              </p>
                            </div>
                            <p className="text-center text-xs font-mono text-gray-400 mt-1">
                              {m.status === 'bye' ? '부전승'
                                : m.status === 'forfeited' ? `기권${score ? ` (${score})` : ''}`
                                : m.status === 'completed' ? (score || '점수 미입력')
                                : '경기 전'}
                            </p>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  )
}

// ─── 시상대 기둥 ─────────────────────────────────────────────────

function PodiumColumn({ emoji, height, bg, label, teams, mineFn, big = false }) {
  return (
    <div className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
      <span className={big ? 'text-3xl' : 'text-2xl'}>{emoji}</span>
      <div className="w-full text-center space-y-0.5 min-h-8">
        {teams.length > 0 ? teams.map(e => (
          <p key={e.id}
            className={`text-xs leading-tight break-keep
              ${mineFn(e) ? 'font-black text-[#003478]' : 'font-bold text-gray-700'}`}
          >
            {teamLabel(e)}
          </p>
        )) : (
          <p className="text-xs text-gray-300">—</p>
        )}
      </div>
      <div className={`w-full ${height} ${bg} rounded-t-xl flex items-start justify-center pt-1.5`}>
        <span className="text-[10px] font-bold text-gray-500">{label}</span>
      </div>
    </div>
  )
}

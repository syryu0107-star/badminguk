import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { getGradeInfo } from '../../lib/grades'
import BottomNav from '../../components/BottomNav'
import GradeChip from '../../components/GradeChip'
import Spinner from '../../components/Spinner'
import { TrendingUp, Medal } from 'lucide-react'

const GRADE_FILTERS = ['전체', 'A조', 'B조', 'C조', 'D조', '왕초심']

const RANK_COLORS = [
  'text-yellow-500',  // 1
  'text-gray-400',    // 2
  'text-amber-600',   // 3
]

export default function Ranking() {
  const [players, setPlayers]   = useState([])
  const [myRank, setMyRank]     = useState(null)
  const [myProfile, setMyProfile] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState('전체')
  const [tab, setTab]           = useState('doubles') // 'doubles' | 'singles'

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()

      // 내 프로필
      let me = null
      if (user) {
        const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
        me = data
        setMyProfile(me)
      }

      await fetchRanking(filter, tab, me)
      setLoading(false)
    }
    load()
  }, [])

  async function fetchRanking(gradeFilter, gameTab, meProfile) {
    setLoading(true)
    const mmrCol   = gameTab === 'singles' ? 'singles_mmr'   : 'mmr'
    const gamesCol = gameTab === 'singles' ? 'singles_games_played' : 'mmr_games_played'
    const gradeCol = gameTab === 'singles' ? 'singles_grade'  : 'official_grade'

    let query = supabase
      .from('profiles')
      .select(`id, name, official_grade, mmr, mmr_games_played, singles_grade, singles_mmr, singles_games_played`)
      .gt(mmrCol, 0)
      .gt(gamesCol, 0)
      .order(mmrCol, { ascending: false })
      .limit(100)

    if (gradeFilter !== '전체') {
      query = query.eq(gradeCol, gradeFilter)
    }

    const { data } = await query
    setPlayers(data ?? [])

    // 내 순위 계산
    if (meProfile) {
      const { count } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .gt(mmrCol, meProfile[mmrCol] ?? 0)
        .gt(gamesCol, 0)
      setMyRank((count ?? 0) + 1)
    }

    setLoading(false)
  }

  function changeFilter(f) {
    setFilter(f)
    fetchRanking(f, tab, myProfile)
  }

  function changeTab(t) {
    setTab(t)
    fetchRanking(filter, t, myProfile)
  }

  const mmrKey   = tab === 'singles' ? 'singles_mmr'          : 'mmr'
  const gamesKey = tab === 'singles' ? 'singles_games_played' : 'mmr_games_played'
  const gradeKey = tab === 'singles' ? 'singles_grade'        : 'official_grade'

  return (
    <div className="safe-bottom">
      {/* 헤더 */}
      <header
        className="px-5 pt-14 pb-5 text-white"
        style={{ background: 'linear-gradient(160deg, #003478 0%, #C60C30 100%)' }}
      >
        <div className="flex items-center gap-2 mb-1">
          <Medal size={18} />
          <h1 className="text-xl font-black">전국 랭킹</h1>
        </div>
        <p className="text-white/60 text-xs">MMR 기반 실시간 순위</p>

        {/* 내 순위 */}
        {myProfile && (
          <div className="mt-4 bg-white/15 rounded-2xl px-4 py-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <TrendingUp size={18} className="text-white" />
            </div>
            <div className="flex-1">
              <p className="text-white/70 text-xs">내 순위</p>
              <p className="font-black text-lg">
                {myRank ? `전국 ${myRank.toLocaleString()}위` : '—'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-white/70 text-xs">{tab === 'singles' ? '단식' : '복식'} MMR</p>
              <p className="font-black">{(myProfile[mmrKey] ?? 1000).toLocaleString()}</p>
            </div>
          </div>
        )}
      </header>

      {/* 단식/복식 탭 */}
      <div className="flex mx-4 mt-4 bg-gray-100 rounded-xl p-1 gap-1">
        {[
          { key: 'doubles', label: '🏸 복식' },
          { key: 'singles', label: '🙋 단식' },
        ].map(t => (
          <button key={t.key} onClick={() => changeTab(t.key)}
            className={`flex-1 py-2 rounded-lg text-sm font-bold transition
              ${tab === t.key ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}
          >{t.label}</button>
        ))}
      </div>

      {/* 급수 필터 */}
      <div className="flex gap-2 px-4 mt-3 overflow-x-auto pb-1">
        {GRADE_FILTERS.map(g => (
          <button key={g} onClick={() => changeFilter(g)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition
                        ${filter === g ? 'bg-[#C60C30] text-white' : 'bg-gray-100 text-gray-500'}`}
          >{g}</button>
        ))}
      </div>

      {/* 리스트 */}
      <div className="px-4 mt-4 pb-24">
        {loading ? (
          <div className="flex justify-center py-16"><Spinner size={32} /></div>
        ) : players.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-3xl mb-2">🏸</p>
            <p className="text-sm">랭킹 데이터가 없습니다.<br/>첫 공인 대회에 참가해보세요!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {players.map((p, i) => {
              const rank = i + 1
              const isMe = myProfile?.id === p.id
              const gradeInfo = getGradeInfo(p[gradeKey])

              return (
                <div key={p.id}
                  className={`rounded-2xl border px-4 py-3 flex items-center gap-3 transition
                    ${isMe
                      ? 'bg-[#C60C30]/5 border-[#C60C30]/30'
                      : 'bg-white border-gray-100'}`}
                >
                  {/* 순위 */}
                  <div className="w-8 text-center shrink-0">
                    {rank <= 3 ? (
                      <span className={`text-xl ${RANK_COLORS[rank - 1]}`}>
                        {rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'}
                      </span>
                    ) : (
                      <span className="text-sm font-black text-gray-400">{rank}</span>
                    )}
                  </div>

                  {/* 급수 아이콘 */}
                  <div className="w-9 h-9 rounded-full bg-gray-50 flex items-center justify-center text-lg shrink-0">
                    {gradeInfo?.flair ?? '🏸'}
                  </div>

                  {/* 이름 + 급수 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`font-bold text-sm truncate ${isMe ? 'text-[#C60C30]' : ''}`}>
                        {p.name} {isMe && '(나)'}
                      </p>
                      <GradeChip grade={p[gradeKey]} size="sm" />
                    </div>
                    <p className="text-xs text-gray-400">{p[gamesKey] ?? 0}경기</p>
                  </div>

                  {/* MMR */}
                  <div className="text-right shrink-0">
                    <p className="font-black text-gray-800 tabular-nums">{(p[mmrKey] ?? 1000).toLocaleString()}</p>
                    <p className="text-[10px] text-gray-400">MMR</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <BottomNav mode="player" />
    </div>
  )
}

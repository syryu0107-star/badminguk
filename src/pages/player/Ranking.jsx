import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { getGradeInfo, UNITS, gradeColumn, trackGrade, unitLabel, modeLabel as modeLabelFn } from '../../lib/grades'
import { calcReliability, isRanked, MIN_RANKED_GAMES } from '../../lib/reliability'
import BottomNav from '../../components/BottomNav'
import GradeChip from '../../components/GradeChip'
import ReliabilityBadge from '../../components/ReliabilityBadge'
import Spinner from '../../components/Spinner'
import { TrendingUp, Medal, UserPlus, X } from 'lucide-react'

const GRADE_FILTERS = ['전체', 'A조', 'B조', 'C조', 'D조', '왕초심']

// 실명 마스킹 (017 bmg_mask_name 파리티) — 미가입 선수 이름만 가린다.
//   0자→'' · 1자→그대로 · 2자→앞1+* (김철→김*) · 3자+→앞1 + *×(len-2) + 뒤1 (홍길동→홍*동)
//   가입 회원(profiles)은 가입 동의가 있으므로 마스킹하지 않는다.
export function maskName(name) {
  const chars = [...String(name ?? '').trim()]
  const len = chars.length
  if (len === 0) return ''
  if (len === 1) return chars[0]
  if (len === 2) return chars[0] + '*'
  return chars[0] + '*'.repeat(len - 2) + chars[len - 1]
}

// 프로필에서 읽어올 6개 급수 트랙 컬럼(단위 × 종목)
const TRACK_COLS = [
  'grade_gu_dbl', 'grade_si_dbl', 'grade_nat_dbl',
  'grade_gu_sgl', 'grade_si_sgl', 'grade_nat_sgl',
]

const RANK_COLORS = [
  'text-yellow-500',  // 1
  'text-gray-400',    // 2
  'text-amber-600',   // 3
]

// 선택한 단위의 트랙 급수 칩. 미보유(null)면 회색 "미보유"로 표시.
function TrackGradeChip({ profile, unit, mode }) {
  const g = trackGrade(profile, unit, mode)
  if (!g) {
    return (
      <span className="inline-flex items-center rounded-full font-semibold whitespace-nowrap
                       text-xs px-2 py-0.5 bg-gray-100 text-gray-400">
        미보유
      </span>
    )
  }
  return <GradeChip grade={g} size="sm" />
}

export default function Ranking() {
  const navigate = useNavigate()
  const [players, setPlayers]   = useState([])
  const [provisional, setProvisional] = useState([])
  const [myRank, setMyRank]     = useState(null)
  const [myProfile, setMyProfile] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState('전체')
  const [tab, setTab]           = useState('doubles') // 'doubles' | 'singles' (=종목/mode)
  const [unit, setUnit]         = useState('si')       // 'gu' | 'si' | 'nat' (=단위, 급수 트랙 축)
  const [claimTarget, setClaimTarget] = useState(null) // 이어받기 안내를 띄운 미가입 선수 행
  const [claiming, setClaiming] = useState(false)
  const [claimMsg, setClaimMsg] = useState(null)       // { tone:'ok'|'err', text }

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession(); const user = session?.user ?? null

      // 내 프로필
      let me = null
      if (user) {
        const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
        me = data
        setMyProfile(me)
      }

      await fetchRanking(filter, tab, unit, me)
      setLoading(false)
    }
    load()
  }, [])

  async function fetchRanking(gradeFilter, gameTab, unitKey, meProfile) {
    setLoading(true)
    // MMR·경기수는 단위 무관(단식/복식 2트랙만). 급수만 선택한 단위의 트랙을 사용.
    const mmrCol   = gameTab === 'singles' ? 'singles_mmr'   : 'mmr'
    const gamesCol = gameTab === 'singles' ? 'singles_games_played' : 'mmr_games_played'
    const gradeCol = gradeColumn(unitKey, gameTab)   // 예: grade_si_dbl

    let query = supabase
      .from('profiles')
      .select(`id, name, mmr, mmr_rd, mmr_games_played, singles_mmr, singles_mmr_rd, singles_games_played, ${TRACK_COLS.join(', ')}`)
      .gt(mmrCol, 0)
      .gt(gamesCol, 0)
      .order(mmrCol, { ascending: false })
      .limit(100)

    // 급수 필터는 선택한 단위의 트랙 컬럼 기준
    if (gradeFilter !== '전체' && gradeCol) {
      query = query.eq(gradeCol, gradeFilter)
    }

    const { data } = await query
    const rows = data ?? []

    // ── 레이팅 신뢰도 계산 (4-5) + 정식/잠정 분리 (4-13) ──
    const gameMode = gameTab === 'singles' ? 'singles' : 'doubles'
    let historyByPlayer = {}
    if (rows.length) {
      const { data: hist } = await supabase
        .from('mmr_history')
        .select('player_id, created_at, cert_level, tournament_id, game_mode')
        .in('player_id', rows.map(p => p.id))
        .eq('game_mode', gameMode)
        .order('created_at', { ascending: false })
        .limit(2000)
      for (const h of hist ?? []) {
        (historyByPlayer[h.player_id] ??= []).push(h)
      }
    }

    const withReliability = rows.map(p => {
      const rel = calcReliability({
        gamesPlayed: p[gamesCol] ?? 0,
        history: historyByPlayer[p.id] ?? [],
      })
      return { ...p, reliability: rel, _games: p[gamesCol] ?? 0 }
    })

    // 정식 등재(경기 수·신뢰도 충족)만 순위 매김, 나머지는 잠정 섹션
    const ranked  = withReliability.filter(p => isRanked(p._games, p.reliability.score))
    const pending = withReliability.filter(p => !isRanked(p._games, p.reliability.score))

    // ── 미가입 선수(imported_players / v_imported_ranking) 합치기 (017) ──
    // 경기 0 → isRanked 미충족 → 항상 잠정(측정 중) 섹션에 노출(정직).
    // 선택한 단위·종목·급수 필터를 그대로 적용하고, 표시는 마스킹(홍*동)한다.
    let importedRows = []
    {
      let impQuery = supabase
        .from('v_imported_ranking')
        .select('*')
        .eq('unit', unitKey)
        .eq('mode', gameTab)
        .order(mmrCol, { ascending: false })
        .limit(100)
      if (gradeFilter !== '전체' && gradeCol) impQuery = impQuery.eq(gradeCol, gradeFilter)
      const { data: imp } = await impQuery
      importedRows = (imp ?? []).map(r => ({
        ...r,
        is_imported: true,
        _games: 0,
        reliability: { score: 0 },
      }))
    }

    // 잠정 섹션 = 미검증 프로필 + 미가입 선수, MMR 내림차순 정렬
    const pendingAll = [...pending, ...importedRows]
      .sort((a, b) => (b[mmrCol] ?? 0) - (a[mmrCol] ?? 0))

    setPlayers(ranked)
    setProvisional(pendingAll)

    // 내 순위 계산(단위 무관 · MMR 기준)
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
    fetchRanking(f, tab, unit, myProfile)
  }

  function changeTab(t) {
    setTab(t)
    fetchRanking(filter, t, unit, myProfile)
  }

  function changeUnit(u) {
    setUnit(u)
    fetchRanking(filter, tab, u, myProfile)
  }

  // 프로필 + 랭킹 다시 불러오기 (claim 성공 후 반영용)
  async function reload() {
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user ?? null
    let me = myProfile
    if (user) {
      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      me = data
      setMyProfile(me)
    }
    await fetchRanking(filter, tab, unit, me)
  }

  // "이어받기" — 미가입 선수 기록을 내 프로필로 이관(017 claim_imported_player RPC).
  async function handleClaim() {
    if (!claimTarget) return
    // 로그인/프로필 없으면 이어받기 불가 → 가입 흐름으로 안내
    if (!myProfile) { navigate('/auth'); return }
    setClaiming(true)
    setClaimMsg(null)
    const { data, error } = await supabase.rpc('claim_imported_player', { p_imported_id: claimTarget.id })
    setClaiming(false)
    if (error || !data?.ok) {
      setClaimMsg({ tone: 'err', text: error?.message || '이어받기에 실패했어요. 잠시 후 다시 시도해 주세요.' })
      return
    }
    setClaimMsg({ tone: 'ok', text: '내 기록으로 이어받았어요! 랭킹에 반영됩니다.' })
    await reload()
    // 잠깐 성공 메시지를 보여준 뒤 닫기
    setTimeout(() => { setClaimTarget(null); setClaimMsg(null) }, 1400)
  }

  const mmrKey   = tab === 'singles' ? 'singles_mmr'          : 'mmr'
  const gamesKey = tab === 'singles' ? 'singles_games_played' : 'mmr_games_played'
  const rdKey    = tab === 'singles' ? 'singles_mmr_rd'       : 'mmr_rd'
  const modeLabel = tab === 'singles' ? '단식' : '복식'

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
        <p className="text-white/60 text-xs">MMR 기반 실시간 순위 · 급수는 단위별로 표시</p>

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
              <p className="text-white/70 text-xs">{modeLabel} MMR</p>
              <p className="font-black">{(myProfile[mmrKey] ?? 1000).toLocaleString()}</p>
            </div>
          </div>
        )}
      </header>

      {/* 단식/복식 탭 (종목) */}
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

      {/* 단위(구/시/전국) 탭 — 표시할 급수 트랙 선택 */}
      <div className="flex mx-4 mt-2 bg-gray-100 rounded-xl p-1 gap-1">
        {UNITS.map(u => (
          <button key={u.key} onClick={() => changeUnit(u.key)}
            className={`flex-1 py-2 rounded-lg text-sm font-bold transition
              ${unit === u.key ? 'bg-white text-[#003478] shadow-sm' : 'text-gray-500'}`}
          >{u.label}</button>
        ))}
      </div>

      {/* 급수 필터 (선택한 단위 트랙 기준) */}
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
        ) : players.length === 0 && provisional.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-3xl mb-2">🏸</p>
            <p className="text-sm">
              {filter === '전체'
                ? <>랭킹 데이터가 없습니다.<br/>첫 대회에 참가해보세요!</>
                : <>{unitLabel(unit)} {modeLabel} {filter} 선수가 아직 없어요.</>}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {players.map((p, i) => {
              const rank = i + 1
              const isMe = myProfile?.id === p.id
              const g = trackGrade(p, unit, tab)
              const gradeInfo = getGradeInfo(g)

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

                  {/* 급수 아이콘 (선택 단위 트랙) */}
                  <div className="w-9 h-9 rounded-full bg-gray-50 flex items-center justify-center text-lg shrink-0">
                    {g ? (gradeInfo?.flair ?? '🏸') : '🏸'}
                  </div>

                  {/* 이름 + 급수 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`font-bold text-sm truncate ${isMe ? 'text-[#C60C30]' : ''}`}>
                        {p.name} {isMe && '(나)'}
                      </p>
                      <TrackGradeChip profile={p} unit={unit} mode={tab} />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs text-gray-400">{p[gamesKey] ?? 0}경기</p>
                      <ReliabilityBadge rd={p[rdKey]} games={p[gamesKey] ?? 0} relScore={p.reliability?.score} size="sm" />
                    </div>
                  </div>

                  {/* MMR */}
                  <div className="text-right shrink-0">
                    <p className="font-black text-gray-800 tabular-nums">{(p[mmrKey] ?? 1000).toLocaleString()}</p>
                    <p className="text-[10px] text-gray-400">MMR</p>
                  </div>
                </div>
              )
            })}

            {/* ── 잠정 (검증 중) 섹션 — 4-13 리더보드 등재 최소 요건 ── */}
            {provisional.length > 0 && (
              <div className="pt-4">
                <div className="flex items-center gap-2 mb-2 px-1">
                  <span className="text-xs font-bold text-gray-500">잠정 (검증 중)</span>
                  <span className="text-[10px] text-gray-400">
                    · 최소 {MIN_RANKED_GAMES}경기 이상, 신뢰도 확보 시 정식 랭킹 등재
                  </span>
                </div>
                <div className="space-y-2">
                  {provisional.map(p => {
                    const g = trackGrade(p, unit, tab)
                    const gradeInfo = getGradeInfo(g)

                    // ── 미가입 선수 행 (마스킹 + 회색 "미가입" 뱃지 + 이어받기 CTA) ──
                    if (p.is_imported) {
                      const shown = p.name_masked ?? maskName(p.name)
                      return (
                        <button key={`imp-${p.id}`} type="button"
                          onClick={() => { setClaimMsg(null); setClaimTarget(p) }}
                          className="w-full text-left rounded-2xl border border-dashed border-gray-200 bg-gray-50/60
                                     px-4 py-3 flex items-center gap-3 transition active:scale-[0.99]
                                     hover:border-[#003478]/30 hover:bg-[#003478]/5"
                        >
                          <div className="w-8 text-center shrink-0 text-sm font-black text-gray-300">–</div>
                          <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-lg shrink-0 opacity-70">
                            {g ? (gradeInfo?.flair ?? '🏸') : '🏸'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-bold text-sm truncate text-gray-500">{shown}</p>
                              <TrackGradeChip profile={p} unit={unit} mode={tab} />
                              <span className="inline-flex items-center rounded-full font-semibold whitespace-nowrap
                                               text-[10px] px-2 py-0.5 bg-gray-200 text-gray-500">
                                미가입
                              </span>
                            </div>
                            <div className="flex items-center gap-1 mt-0.5 text-[11px] font-semibold text-[#003478]">
                              <UserPlus size={12} />
                              이 기록의 주인이신가요? 이어받기 ›
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-black text-gray-400 tabular-nums">{(p[mmrKey] ?? 1000).toLocaleString()}</p>
                            <p className="text-[10px] text-gray-300">MMR</p>
                          </div>
                        </button>
                      )
                    }

                    // ── 가입 회원(잠정) 행 ──
                    const isMe = myProfile?.id === p.id
                    return (
                      <div key={p.id}
                        className={`rounded-2xl border border-dashed px-4 py-3 flex items-center gap-3
                          ${isMe ? 'bg-[#C60C30]/5 border-[#C60C30]/30' : 'bg-gray-50/60 border-gray-200'}`}
                      >
                        <div className="w-8 text-center shrink-0 text-sm font-black text-gray-300">–</div>
                        <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-lg shrink-0 opacity-70">
                          {g ? (gradeInfo?.flair ?? '🏸') : '🏸'}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className={`font-bold text-sm truncate ${isMe ? 'text-[#C60C30]' : 'text-gray-600'}`}>
                              {p.name} {isMe && '(나)'}
                            </p>
                            <TrackGradeChip profile={p} unit={unit} mode={tab} />
                          </div>
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs text-gray-400">{p[gamesKey] ?? 0}경기</p>
                            <ReliabilityBadge rd={p[rdKey]} games={p[gamesKey] ?? 0} relScore={p.reliability?.score} size="sm" showPct />
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-black text-gray-400 tabular-nums">{(p[mmrKey] ?? 1000).toLocaleString()}</p>
                          <p className="text-[10px] text-gray-300">MMR</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── 미가입 선수 이어받기 안내 (바텀시트) ── */}
      {claimTarget && (
        <div className="fixed inset-0 z-50 flex items-end justify-center"
          onClick={() => { if (!claiming) { setClaimTarget(null); setClaimMsg(null) } }}
        >
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full max-w-md bg-white rounded-t-3xl px-5 pt-4 pb-8 safe-bottom"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-black text-lg text-gray-800">이 기록의 주인이신가요?</h3>
              <button type="button" onClick={() => { if (!claiming) { setClaimTarget(null); setClaimMsg(null) } }}
                className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500">
                <X size={18} />
              </button>
            </div>

            {/* 대상 정보 카드 */}
            <div className="rounded-2xl bg-gray-50 border border-gray-100 px-4 py-3 flex items-center gap-3 mb-4">
              <div className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-xl shrink-0">
                {trackGrade(claimTarget, unit, tab)
                  ? (getGradeInfo(trackGrade(claimTarget, unit, tab))?.flair ?? '🏸')
                  : '🏸'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-black text-gray-800">{claimTarget.name_masked ?? maskName(claimTarget.name)}</p>
                  <span className="inline-flex items-center rounded-full font-semibold text-[10px] px-2 py-0.5 bg-gray-200 text-gray-500">
                    미가입
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  {unitLabel(unit)} {modeLabelFn(tab)}
                  {trackGrade(claimTarget, unit, tab) ? ` · ${trackGrade(claimTarget, unit, tab)}` : ''}
                  {` · MMR ${(claimTarget[mmrKey] ?? 1000).toLocaleString()}`}
                </p>
                {claimTarget.source_label && (
                  <p className="text-[11px] text-gray-400 mt-0.5 truncate">기록: {claimTarget.source_label}</p>
                )}
              </div>
            </div>

            <p className="text-sm text-gray-500 leading-relaxed mb-4">
              아직 배드민국에 가입하지 않은 선수의 대회 기록이에요.
              본인이 맞다면 이어받아 내 프로필의 급수·MMR로 가져올 수 있어요.
              <span className="text-gray-400"> (기록은 유리한 쪽으로만 반영되고, 낮아지지 않아요.)</span>
            </p>

            {claimMsg && (
              <div className={`rounded-xl px-3 py-2 text-sm font-semibold mb-3
                ${claimMsg.tone === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                {claimMsg.text}
              </div>
            )}

            <button type="button" onClick={handleClaim} disabled={claiming}
              className="w-full py-3.5 rounded-2xl font-black text-white flex items-center justify-center gap-2
                         disabled:opacity-60"
              style={{ background: 'linear-gradient(160deg, #003478 0%, #C60C30 100%)' }}
            >
              {claiming ? <Spinner size={18} /> : <UserPlus size={18} />}
              {myProfile ? '내 기록으로 이어받기' : '가입하고 이어받기'}
            </button>
            <p className="text-center text-[11px] text-gray-400 mt-3">
              내 기록이 아니라면 그냥 닫아 주세요.
            </p>
          </div>
        </div>
      )}

      <BottomNav mode="player" />
    </div>
  )
}

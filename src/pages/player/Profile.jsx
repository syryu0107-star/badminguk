import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { getGradeInfo, getMMRPercentile, GRADES, promotionHint, UNITS, MODES, trackGrade, unitLabel } from '../../lib/grades'
import { CERT_LEVELS } from '../../lib/mmr'
import { calcReliability, MIN_RANKED_GAMES, MIN_RANKED_RELIABILITY, isRanked } from '../../lib/reliability'
import { computeCareerRecord, hasCareerRecord } from '../../lib/record'
import BottomNav from '../../components/BottomNav'
import GradeChip from '../../components/GradeChip'
import ReliabilityBadge from '../../components/ReliabilityBadge'
import Spinner from '../../components/Spinner'
import { LogOut, Upload, Award, Shield, TrendingUp, TrendingDown, ChevronsUp, PartyPopper, Swords } from 'lucide-react'

// MMR 출처 라벨 (016 mmr_source: self_report|import|match) — 초보용 쉬운 우리말
const SOURCE_LABEL = { self_report: '자기 신고', import: '불러온 기록', match: '경기 기록' }

// 미니 MMR 추이 차트 (SVG)
function MiniChart({ history }) {
  if (!history.length) return null
  const vals = [...history].reverse().map(h => h.mmr_after)
  const min  = Math.min(...vals)
  const max  = Math.max(...vals)
  const range = max - min || 1
  const W = 280, H = 48, pad = 4

  const pts = vals.map((v, i) => {
    const x = pad + (i / Math.max(vals.length - 1, 1)) * (W - pad * 2)
    const y = pad + (1 - (v - min) / range) * (H - pad * 2)
    return `${x},${y}`
  })

  const isUp = vals[vals.length - 1] >= vals[0]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={isUp ? '#10b981' : '#ef4444'}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// 승급 진행 카드 — grade_promotion_progress(RPC) 결과 렌더
function PromoProgressCard({ prog, modeLabel }) {
  if (!prog) return null
  const atCap = prog.at_auto_cap
  const pts   = Number(prog.points ?? 0)
  const need  = Number(prog.points_needed ?? 0)
  const ratio = need > 0 ? Math.min(100, Math.round((pts / need) * 100)) : 0

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <ChevronsUp size={16} className="text-[#003478]" />
        <h3 className="font-bold text-sm">{modeLabel} 승급까지</h3>
      </div>

      {atCap ? (
        <p className="text-xs text-gray-500 leading-relaxed">
          자동 승급 상한 <strong className="text-gray-700">A조</strong>에 도달했어요.
          준자강·자강조는 전국대회 입상·선수 경력 기반 <strong>수동 심사</strong>로만 올라갑니다.
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <GradeChip grade={prog.current_grade} size="xs" />
              <span className="text-gray-300 text-xs">→</span>
              <GradeChip grade={prog.next_grade} size="xs" />
            </div>
            <span className="text-xs text-gray-400 tabular-nums">{pts} / {need}점</span>
          </div>
          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${ratio}%`, background: 'linear-gradient(90deg, #C60C30, #003478)' }}
            />
          </div>
          <p className="mt-2.5 text-xs text-[#C60C30] font-bold">
            {promotionHint(Number(prog.remaining))}
          </p>
          <p className="mt-1 text-[11px] text-gray-400 leading-relaxed">
            대회 입상(우승 3점 · 준우승 2점 · 3위 1점 × 단위 배수)이 쌓이면 자동 승급돼요.
            급수는 절대 떨어지지 않아요.
          </p>
        </>
      )}
    </div>
  )
}

// 승급 이력 타임라인 — grade_history 조회 결과
function GradeTimeline({ items }) {
  if (!items?.length) {
    return (
      <p className="text-xs text-gray-400 text-center py-6">
        아직 승급 이력이 없어요.<br/>대회 입상으로 급수를 올려보세요!
      </p>
    )
  }
  return (
    <div className="space-y-2">
      {items.map(g => (
        <div key={g.id} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5">
          <span className="text-lg shrink-0">🎉</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-800">
              {g.from_grade} → <span className="text-[#C60C30]">{g.to_grade}</span>
              <span className="ml-1.5 text-[11px] font-normal text-gray-400">
                {unitLabel(g.unit ?? 'si')} · {g.game_mode === 'singles' ? '단식' : '복식'}
              </span>
            </p>
            <p className="text-[11px] text-gray-400">
              {new Date(g.created_at).toLocaleDateString('ko-KR')}
              {' · '}
              {g.reason === '입상 누적 승급' ? '입상 누적' : (g.reason || '조정')}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

// 최근(유예기간 내) 자동 승급 여부 — 축하 배지 기준
function isRecentPromotion(ts) {
  if (!ts) return false
  return Date.now() - new Date(ts).getTime() < 30 * 24 * 60 * 60 * 1000
}

export default function Profile() {
  const navigate = useNavigate()
  const [profile, setProfile]     = useState(null)
  const [history, setHistory]     = useState([])
  const [tourneys, setTourneys]   = useState([])
  const [gradeHistory, setGradeHistory] = useState([])   // 승급 이력 (grade_history)
  const [promos, setPromos] = useState({})               // 트랙별 승급 진행 (v2 RPC): { 'si:doubles': {...} }
  const [record, setRecord] = useState(null)             // 통합 전적 (전 대회 실경기 W/L + 상대 전적)
  const [loading, setLoading]     = useState(true)
  const [uploading, setUploading] = useState(false)
  const [tab, setTab]             = useState('mmr')  // 'mmr' | 'career'
  const fileRef = useRef()

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession(); const user = session?.user ?? null
      if (!user) { setLoading(false); return }

      // 6개 급수 트랙(단위 × 종목)별 승급 진행 프리뷰 (014 v2 RPC)
      const promoTracks = []
      for (const u of UNITS) for (const m of MODES) promoTracks.push({ unit: u.key, mode: m.key })

      const [
        { data: p }, { data: h }, { data: entries }, { data: gh },
        ...promoResults
      ] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('mmr_history')
          .select('*')
          .eq('player_id', user.id)
          .order('created_at', { ascending: false })
          .limit(30),
        supabase.from('tournament_entries')
          .select(`
            *,
            category:tournament_categories(
              sport_type, grade_min, grade_max,
              tournament:tournaments(id, title, date, unit, cert_level, status)
            ),
            p1:profiles!player1_id(id, name),
            p2:profiles!player2_id(id, name)
          `)
          .or(`player1_id.eq.${user.id},player2_id.eq.${user.id}`)
          .order('created_at', { ascending: false })
          .limit(20),
        // 급수 승급 이력 (grade_history, 단위 태그 포함)
        supabase.from('grade_history')
          .select('*')
          .eq('player_id', user.id)
          .order('created_at', { ascending: false })
          .limit(20),
        // 트랙별 승급 프리뷰 (grade_promotion_progress_v2)
        ...promoTracks.map(t =>
          supabase.rpc('grade_promotion_progress_v2', { p_player: user.id, p_mode: t.mode, p_unit: t.unit })
        ),
      ])

      const promoMap = {}
      promoTracks.forEach((t, i) => { promoMap[`${t.unit}:${t.mode}`] = promoResults[i]?.data ?? null })

      setProfile(p)
      setHistory(h ?? [])
      setTourneys(entries ?? [])
      setGradeHistory(gh ?? [])
      setPromos(promoMap)

      // 통합 전적: 내가 낀 모든 엔트리의 완료 경기를 모아 실제 W/L·세트·상대 전적 집계.
      // 헤더의 승/패(mmr_history delta 근사)와 달리 경기 결과 기반 정확 전적.
      // 조회 실패/테이블 이슈에도 프로필 자체는 뜨도록 try-catch로 조용히 degrade.
      try {
        const { data: idRows } = await supabase
          .from('tournament_entries')
          .select('id')
          .or(`player1_id.eq.${user.id},player2_id.eq.${user.id}`)
          .order('created_at', { ascending: false })
          .limit(300)                      // URL 길이 방어(활성 선수도 통상 이 이하)
        const myEntryIds = (idRows ?? []).map(r => r.id)
        if (myEntryIds.length) {
          const idList = myEntryIds.join(',')
          const { data: mrows } = await supabase
            .from('tournament_matches')
            .select(`
              id, status, team1_entry_id, team2_entry_id, winner_entry_id,
              category:tournament_categories!category_id(
                sport_type, tournament:tournaments!tournament_id(id, title, date)
              ),
              team1:tournament_entries!team1_entry_id(
                id, team_name,
                player1:profiles!player1_id(id, name),
                player2:profiles!player2_id(id, name)
              ),
              team2:tournament_entries!team2_entry_id(
                id, team_name,
                player1:profiles!player1_id(id, name),
                player2:profiles!player2_id(id, name)
              ),
              scores:match_scores(set_number, team1_score, team2_score)
            `)
            .or(`team1_entry_id.in.(${idList}),team2_entry_id.in.(${idList})`)
          setRecord(computeCareerRecord({
            matches: mrows ?? [], myEntryIds: new Set(myEntryIds), myPlayerId: user.id,
          }))
        }
      } catch (e) {
        console.warn('[프로필] 통합 전적 조회 실패 — 전적 카드 생략:', e?.message || e)
      }

      setLoading(false)
    }
    load()
  }, [])

  async function uploadProof(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const { data: { session } } = await supabase.auth.getSession(); const user = session?.user ?? null
    const path = `grade-proofs/${user.id}/${Date.now()}.${file.name.split('.').pop()}`
    const { error } = await supabase.storage.from('proofs').upload(path, file)
    if (!error) {
      const { data: { publicUrl } } = supabase.storage.from('proofs').getPublicUrl(path)
      await supabase.from('profiles').update({ grade_proof_url: publicUrl }).eq('id', user.id)
      setProfile(prev => ({ ...prev, grade_proof_url: publicUrl }))
    }
    setUploading(false)
  }

  async function signOut() {
    await supabase.auth.signOut()
    navigate('/', { replace: true })
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner size={36} /></div>

  const mmr         = profile?.mmr ?? 1000
  const grade       = profile?.official_grade ?? '왕초심'
  const recentlyPromoted = isRecentPromotion(profile?.grade_promoted_at)
                        || isRecentPromotion(profile?.singles_grade_promoted_at)
  const gradeInfo   = getGradeInfo(grade)
  const pct         = getMMRPercentile(mmr)
  const gamesPlayed = profile?.mmr_games_played ?? 0
  const wins        = history.filter(h => h.delta > 0).length
  const losses      = history.filter(h => h.delta < 0).length
  const winRate     = gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : 0

  // 레이팅 신뢰도 (4-5) — 복식 기록 기준
  const doublesHistory = history.filter(h => (h.game_mode ?? 'doubles') === 'doubles')
  const reliability = calcReliability({ gamesPlayed, history: doublesHistory })
  const ranked = isRanked(gamesPlayed, reliability.score)

  // 트랙 키('si:doubles') → "시 복식" 라벨
  const trackTitle = (key) => {
    const [u, m] = key.split(':')
    const ml = MODES.find(x => x.key === m)?.label ?? m
    return `${unitLabel(u)} ${ml}`
  }
  // 승급 점수가 쌓였거나 급수를 이미 가진 트랙만 프리뷰로 노출(빈 카드 6개 방지)
  const activePromos = Object.entries(promos)
    .filter(([, p]) => p && (p.at_auto_cap || Number(p.points) > 0 || p.current_grade !== '왕초심'))

  return (
    <div className="safe-bottom">
      {/* 헤더 */}
      <div
        className="px-5 pt-14 pb-6 text-white"
        style={{ background: 'linear-gradient(160deg, #003478, #C60C30)' }}
      >
        <div className="flex items-center gap-4 mb-5">
          <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center text-3xl">
            {gradeInfo?.flair ?? '🏸'}
          </div>
          <div>
            <h1 className="text-xl font-black">{profile?.name ?? '게스트'}</h1>
            <div className="flex items-center gap-2 mt-1">
              <GradeChip grade={grade} size="md" />
              {profile?.grade_verified && (
                <span className="text-xs bg-emerald-400/30 text-emerald-200 px-2 py-0.5 rounded-full font-semibold">
                  ✓ 인증
                </span>
              )}
              {recentlyPromoted && (
                <span className="text-xs bg-amber-300/30 text-amber-100 px-2 py-0.5 rounded-full font-bold flex items-center gap-0.5">
                  <PartyPopper size={11} /> 승급!
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 급수 vs MMR 분리 스탯 */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-white/10 rounded-2xl p-3">
            <p className="text-white/60 text-xs flex items-center gap-1 mb-1">
              <Award size={11}/> 내 급수 <span className="text-white/40">(하락 없음)</span>
            </p>
            <p className="font-black text-xl">{grade}</p>
            <p className="text-white/50 text-xs">대회 인정 급수</p>
          </div>
          <div className="bg-white/10 rounded-2xl p-3">
            <p className="text-white/60 text-xs flex items-center gap-1 mb-1">
              <TrendingUp size={11}/> 플랫폼 MMR <span className="text-white/40">(실시간)</span>
            </p>
            <p className="font-black text-xl tabular-nums">{mmr.toLocaleString()}</p>
            <p className="text-white/50 text-xs">{pct}</p>
          </div>
        </div>

        {/* 승/패/승률 */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: '승', value: wins,     color: 'text-emerald-300' },
            { label: '패', value: losses,   color: 'text-red-300' },
            { label: '승률', value: `${winRate}%`, color: 'text-white' },
          ].map(s => (
            <div key={s.label} className="bg-white/10 rounded-xl p-2.5 text-center">
              <p className="text-white/60 text-xs">{s.label}</p>
              <p className={`font-black text-lg ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* 미니 MMR 추이 그래프 */}
        {history.length > 1 && (
          <div className="mt-3 bg-white/10 rounded-xl p-2">
            <p className="text-white/50 text-xs mb-1">최근 MMR 추이</p>
            <MiniChart history={history.slice(0, 20)} />
          </div>
        )}
      </div>

      {/* 탭 */}
      <div className="flex border-b border-gray-100 bg-white sticky top-0 z-10">
        {[
          { key: 'mmr',    label: 'MMR 기록' },
          { key: 'career', label: '대회 커리어' },
          { key: 'cert',   label: '급수 인증' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-3 text-sm font-semibold transition
              ${tab === t.key ? 'text-[#C60C30] border-b-2 border-[#C60C30]' : 'text-gray-400'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* MMR 기록 탭 */}
      {tab === 'mmr' && (
        <section className="px-4 py-4">
          {/* 레이팅 신뢰도 카드 (4-5) */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="font-bold text-sm">레이팅 신뢰도</p>
                <p className="text-xs text-gray-400">이 MMR이 실력을 얼마나 반영하는지</p>
              </div>
              <ReliabilityBadge rd={profile?.mmr_rd} games={gamesPlayed} relScore={reliability.score} size="md" showPct />
            </div>
            {/* 신뢰도 게이지 */}
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  reliability.tier.color === 'emerald' ? 'bg-emerald-500'
                  : reliability.tier.color === 'amber' ? 'bg-amber-400'
                  : 'bg-gray-300'}`}
                style={{ width: `${reliability.score}%` }}
              />
            </div>
            {/* 구성 요소 */}
            <div className="grid grid-cols-4 gap-1 mt-3 text-center">
              {[
                { label: '경기량', v: reliability.volume },
                { label: '최근성', v: reliability.recency },
                { label: '다양성', v: reliability.diversity },
                { label: '검증도', v: reliability.verified },
              ].map(c => (
                <div key={c.label}>
                  <p className="text-[10px] text-gray-400">{c.label}</p>
                  <p className="text-xs font-bold tabular-nums text-gray-600">{Math.round(c.v * 100)}%</p>
                </div>
              ))}
            </div>
            {/* 현재 MMR 출처 (자기 신고 / 불러온 기록 / 경기 기록) */}
            <p className="mt-3 text-[11px] text-gray-400 text-center">
              지금 MMR 출처: <strong className="text-gray-600">{SOURCE_LABEL[profile?.mmr_source] ?? '자기 신고'}</strong>
              {(profile?.mmr_source == null || profile?.mmr_source === 'self_report') && ' · 경기를 뛰면 실측으로 바뀌어요'}
            </p>
            {!ranked && (
              <p className="mt-3 text-[11px] text-amber-600 bg-amber-50 rounded-lg px-2.5 py-1.5 leading-relaxed">
                아직 <strong>잠정</strong> 상태입니다. 최소 {MIN_RANKED_GAMES}경기 이상 + 신뢰도 {MIN_RANKED_RELIABILITY}% 이상이면
                전국 랭킹에 정식 등재됩니다.
                {reliability.daysSinceLast != null && reliability.daysSinceLast > 60 &&
                  ` (마지막 경기 ${reliability.daysSinceLast}일 전 — 최근 경기가 신뢰도를 높입니다)`}
              </p>
            )}
          </div>

          {history.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">
              아직 대회 기록이 없습니다.
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              {history.slice(0, 20).map((h, i) => {
                const certInfo = CERT_LEVELS[h.cert_level] ?? CERT_LEVELS.none
                return (
                  <div
                    key={h.id}
                    className={`flex items-center px-4 py-3 gap-3
                                ${i < history.length - 1 ? 'border-b border-gray-50' : ''}`}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded-md
                          ${h.cert_level === 'a' ? 'bg-red-100 text-red-700'
                          : h.cert_level === 'b' ? 'bg-purple-100 text-purple-700'
                          : h.cert_level === 'c' ? 'bg-blue-100 text-blue-700'
                          : 'bg-gray-100 text-gray-500'}`}
                        >
                          {certInfo.label}
                        </span>
                        {h.partner_adj !== 0 && h.partner_adj != null && (
                          <span className="text-xs text-gray-400">
                            파트너보정 {h.partner_adj > 0 ? '+' : ''}{h.partner_adj}%
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400">{new Date(h.created_at).toLocaleDateString('ko-KR')}</p>
                      <p className="text-sm font-semibold tabular-nums">
                        {h.mmr_before} → {h.mmr_after}
                      </p>
                    </div>
                    <span className={`font-black text-xl tabular-nums ${h.delta >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {h.delta >= 0 ? '+' : ''}{h.delta}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}

      {/* 대회 커리어 탭 */}
      {tab === 'career' && (
        <section className="px-4 py-4">
          {/* 통합 전적 — 전 대회 실제 경기 기록 (C12) */}
          {hasCareerRecord(record) && (() => {
            const tt = record.totals
            const decided = tt.wins + tt.losses
            return (
              <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-4">
                <div className="flex items-center gap-2 mb-1">
                  <Swords size={16} className="text-[#C60C30]" />
                  <h3 className="font-bold text-sm">통합 전적</h3>
                  <span className="text-[11px] text-gray-400 ml-auto">전 {record.tournaments}개 대회 · 실제 경기 기준</span>
                </div>
                {/* 승 / 패 / 승률 */}
                <div className="grid grid-cols-3 gap-2 mt-3">
                  {[
                    { label: '승', value: tt.wins, color: 'text-emerald-600' },
                    { label: '패', value: tt.losses, color: 'text-red-500' },
                    { label: '승률', value: record.winRate == null ? '-' : `${record.winRate}%`, color: 'text-gray-800' },
                  ].map(s => (
                    <div key={s.label} className="bg-gray-50 rounded-xl p-2.5 text-center">
                      <p className="text-gray-400 text-xs">{s.label}</p>
                      <p className={`font-black text-xl tabular-nums ${s.color}`}>{s.value}</p>
                    </div>
                  ))}
                </div>
                {/* 승률 게이지 */}
                {decided > 0 && (
                  <div className="mt-3 h-2 rounded-full bg-red-100 overflow-hidden flex">
                    <div className="h-full bg-emerald-500" style={{ width: `${Math.round((tt.wins / decided) * 100)}%` }} />
                  </div>
                )}
                {/* 세부 지표 */}
                <div className="grid grid-cols-3 gap-1 mt-3 text-center">
                  {[
                    { label: '세트 득실', v: `${tt.setsWon}-${tt.setsLost}` },
                    { label: '점수 득실', v: `${tt.pointsFor}-${tt.pointsAgainst}` },
                    { label: '풀세트 접전', v: `${tt.fullSets}회` },
                  ].map(c => (
                    <div key={c.label}>
                      <p className="text-[10px] text-gray-400">{c.label}</p>
                      <p className="text-xs font-bold tabular-nums text-gray-600">{c.v}</p>
                    </div>
                  ))}
                </div>
                {(tt.walkoverWins > 0 || tt.walkoverLosses > 0) && (
                  <p className="mt-3 text-[11px] text-gray-400 text-center">
                    부전승 {tt.walkoverWins}회 · 부전패 {tt.walkoverLosses}회 포함
                  </p>
                )}
              </div>
            )
          })()}

          {/* 상대 전적 — 자주 만난 상대별 W/L (head-to-head, C12) */}
          {record?.byOpponent?.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-4">
              <div className="flex items-center gap-2 mb-3">
                <Shield size={16} className="text-[#003478]" />
                <h3 className="font-bold text-sm">상대 전적</h3>
                <span className="text-[11px] text-gray-400 ml-auto">자주 만난 순</span>
              </div>
              <div className="space-y-1.5">
                {record.byOpponent.slice(0, 8).map(o => {
                  const lead = o.wins > o.losses ? 'text-emerald-600' : o.wins < o.losses ? 'text-red-500' : 'text-gray-500'
                  return (
                    <div key={o.id} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2">
                      <span className="flex-1 min-w-0 text-sm font-semibold text-gray-700 truncate">{o.name}</span>
                      <span className="text-[11px] text-gray-400 tabular-nums">{o.games}경기</span>
                      <span className={`text-sm font-black tabular-nums ${lead}`}>{o.wins}승 {o.losses}패</span>
                    </div>
                  )
                })}
              </div>
              {record.byOpponent.length > 8 && (
                <p className="mt-2 text-[11px] text-gray-400 text-center">외 {record.byOpponent.length - 8}명</p>
              )}
            </div>
          )}

          <p className="text-xs font-bold text-gray-400 mb-2 px-1">참가한 대회</p>
          {tourneys.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">
              참가한 대회가 없습니다.
            </div>
          ) : (
            <div className="space-y-3">
              {tourneys.map((entry, i) => {
                const t = entry.category?.tournament
                const tUnit = t?.unit ?? 'si'
                const partnerName = entry.player1_id === profile?.id
                  ? entry.p2?.name
                  : entry.p1?.name
                const iAmPartner = entry.player2_id === profile?.id
                return (
                  <div key={i} className="bg-white rounded-2xl border border-gray-100 p-4">
                    <div className="flex items-start justify-between mb-1">
                      <p className="font-bold text-sm">{t?.title ?? '대회'}</p>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-0.5
                        ${tUnit === 'nat' ? 'bg-red-100 text-red-700'
                        : tUnit === 'si' ? 'bg-purple-100 text-purple-700'
                        : 'bg-blue-100 text-blue-700'}`}
                      >
                        <Shield size={9}/> {unitLabel(tUnit)} 대회
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <span>{t?.date}</span>
                      <span>·</span>
                      <span>{entry.category?.sport_type}</span>
                      {entry.category?.grade_max && (
                        <>
                          <span>·</span>
                          <GradeChip grade={entry.category.grade_max} size="xs" />
                          <span>이하</span>
                        </>
                      )}
                    </div>
                    {/* 파트너 표시 */}
                    <div className="mt-2 text-xs text-gray-500">
                      {partnerName ? (
                        <>🤝 파트너: <strong className="text-gray-700">{partnerName}</strong>
                          {iAmPartner && <span className="text-gray-400"> (내가 파트너)</span>}</>
                      ) : (
                        <span className="text-gray-400">개인 신청</span>
                      )}
                    </div>
                    <div className="mt-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full
                        ${entry.entry_status === 'approved' ? 'bg-emerald-100 text-emerald-700'
                        : entry.entry_status === 'rejected' ? 'bg-red-100 text-red-600'
                        : entry.entry_status === 'partner_rejected' ? 'bg-red-100 text-red-600'
                        : entry.entry_status === 'partner_pending' ? 'bg-amber-100 text-amber-700'
                        : entry.entry_status === 'applied' ? 'bg-blue-100 text-blue-700'
                        : 'bg-amber-100 text-amber-700'}`}
                      >
                        {entry.entry_status === 'approved' ? '✅ 참가 확정'
                        : entry.entry_status === 'rejected' ? '❌ 주최자 반려'
                        : entry.entry_status === 'partner_rejected' ? '❌ 파트너 거절'
                        : entry.entry_status === 'partner_pending' ? '⏳ 파트너 수락 대기'
                        : entry.entry_status === 'applied' ? '📮 접수 완료 (승인 대기)'
                        : '⏳ 검토 중'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}

      {/* 급수 인증 탭 */}
      {tab === 'cert' && (
        <section className="px-4 py-4">
          {/* 내 급수 — 단위(구/시/전국) × 종목(복식/단식) 6트랙 표 */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-4">
            <div className="flex items-center gap-2 mb-1">
              <Award size={16} className="text-[#003478]" />
              <h3 className="font-bold text-sm">내 급수</h3>
            </div>
            <p className="text-xs text-gray-400 mb-3 leading-relaxed">
              대회 단위(구·시·전국)마다 급수가 따로 있어요. 그 단위 대회에서 입상해야 올라가요.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400">
                    <th className="text-left font-medium pb-2 pl-1">단위</th>
                    {MODES.map(m => (
                      <th key={m.key} className="font-medium pb-2 text-center">{m.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {UNITS.map(u => (
                    <tr key={u.key} className="border-t border-gray-50">
                      <td className="py-2.5 pl-1 font-bold text-gray-700">{u.label}</td>
                      {MODES.map(m => {
                        const g = trackGrade(profile, u.key, m.key)
                        return (
                          <td key={m.key} className="py-2.5 text-center">
                            {g
                              ? <GradeChip grade={g} size="xs" />
                              : <span className="text-xs text-gray-300">미보유</span>}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 승급 진행 프리뷰 — 트랙별(어느 단위·종목인지 표시) */}
          {activePromos.length > 0 ? (
            activePromos.map(([key, prog]) => (
              <PromoProgressCard key={key} prog={prog} modeLabel={trackTitle(key)} />
            ))
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-4">
              <p className="text-xs text-gray-400 text-center py-2 leading-relaxed">
                아직 승급 점수가 없어요.<br/>대회에 참가해 입상하면 그 단위 급수가 올라가요.
              </p>
            </div>
          )}

          {/* 승급 이력 타임라인 */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <PartyPopper size={16} className="text-[#C60C30]" />
              <h3 className="font-bold text-sm">승급 이력</h3>
            </div>
            <GradeTimeline items={gradeHistory} />
          </div>

          <div className="bg-white rounded-2xl p-4 border border-gray-100 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <Award size={18} className="text-amber-500" />
              <h2 className="font-bold">급수 인증</h2>
            </div>
            <p className="text-xs text-gray-500 mb-3 leading-relaxed">
              대회 상장·급수 확인 화면을 캡처해 업로드하세요.<br/>
              인증 완료 시 <strong>인증 뱃지</strong>가 부여됩니다.<br/>
              ※ 급수는 절대 하락하지 않습니다.
            </p>
            {profile?.grade_proof_url && (
              <img
                src={profile.grade_proof_url}
                className="w-full h-36 object-cover rounded-xl mb-3"
                alt="급수 증빙"
              />
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={uploadProof} />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="w-full py-2.5 border-2 border-dashed border-gray-200 rounded-xl
                         text-sm text-gray-500 font-semibold flex items-center justify-center gap-2
                         active:bg-gray-50 disabled:opacity-50"
            >
              <Upload size={15} />
              {uploading ? '업로드 중...' : profile?.grade_proof_url ? '다시 업로드' : '캡처 이미지 업로드'}
            </button>
          </div>

          {/* 급수 체계 안내 */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <h3 className="font-bold text-sm mb-3">배드민국 급수 체계</h3>
            <div className="space-y-1.5">
              {GRADES.map((g, i) => (
                <div key={g.key}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl
                    ${g.key === grade ? 'bg-red-50 border border-[#C60C30]' : 'bg-gray-50'}`}
                >
                  <span className="text-lg">{g.flair}</span>
                  <span className={`font-bold text-sm ${g.key === grade ? 'text-[#C60C30]' : 'text-gray-700'}`}>
                    {g.label}
                  </span>
                  <span className="text-xs text-gray-400 ml-auto">기준 MMR {g.initialMMR}</span>
                  {g.key === grade && (
                    <span className="text-xs text-[#C60C30] font-bold">← 현재</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 로그아웃 */}
      <section className="px-4 mt-4 mb-8">
        <button
          onClick={signOut}
          className="w-full py-3 rounded-xl border border-gray-200 text-gray-500
                     font-semibold text-sm flex items-center justify-center gap-2 active:bg-gray-50"
        >
          <LogOut size={16} /> 로그아웃
        </button>
      </section>

      <BottomNav mode="player" />
    </div>
  )
}

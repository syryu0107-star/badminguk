import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { checkEligibility } from '../../lib/grades'
import { preferredRegions, recommendTournaments } from '../../lib/discover'
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

  // 개인화 추천 재료(로그인 시): 내 프로필(급수 자격)·자주 가던 지역·이미 신청한 대회
  const [profile, setProfile]       = useState(null)
  const [myRegions, setMyRegions]   = useState([])
  const [appliedIds, setAppliedIds] = useState(() => new Set())

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

  // 로그인 선수라면 추천에 쓸 프로필·참가 이력을 한 번 로드(대회 무관, 실패 시 조용히 추천만 생략)
  useEffect(() => {
    let cancelled = false
    async function loadMe() {
      try {
        const { data: { session } } = await supabase.auth.getSession(); const user = session?.user ?? null
        if (!user || cancelled) return
        const { data: prof } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
        if (!cancelled) setProfile(prof ?? null)

        const { data: es } = await supabase
          .from('tournament_entries')
          .select('category:tournament_categories(tournament:tournaments(id, venue, venue_address))')
          .or(`player1_id.eq.${user.id},player2_id.eq.${user.id}`)
        if (cancelled) return

        const ids = new Set()
        const past = new Map()
        for (const e of es ?? []) {
          const t = e?.category?.tournament
          if (!t?.id) continue
          ids.add(t.id)
          if (!past.has(t.id)) past.set(t.id, t)
        }
        setAppliedIds(ids)
        setMyRegions(preferredRegions([...past.values()]))
      } catch {
        /* RLS/컬럼/네트워크 실패 → 추천 없이 검색만 degrade */
      }
    }
    loadMe()
    return () => { cancelled = true }
  }, [])

  const filtered = tournaments.filter(t =>
    t.title.includes(search) || t.venue.includes(search)
  )

  // "나에게 맞는 대회" — 급수로 참가 가능한 접수중 대회를 지역·마감 임박순으로 추천
  const recs = useMemo(() => {
    if (!profile) return []
    return recommendTournaments({
      tournaments,
      appliedIds,
      myRegions,
      fitOf: (t) => {
        const cats = t.categories ?? []
        let eligibleCount = 0
        for (const c of cats) if (checkEligibility(profile, c, t).ok) eligibleCount++
        return { eligibleCount, totalCats: cats.length }
      },
      limit: 4,
    })
  }, [tournaments, profile, appliedIds, myRegions])

  const showRecs = filter === 'all' && !search && recs.length > 0

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
        {/* 개인화 추천: 로그인 선수에게만, 전체 탭·검색 없을 때만 */}
        {showRecs && (
          <div className="mb-5">
            <div className="flex items-center gap-1.5 mb-2 px-0.5">
              <span className="text-base">🎯</span>
              <h2 className="text-sm font-black text-gray-800">나에게 맞는 대회</h2>
              <span className="text-[11px] text-gray-400">급수·지역 맞춤 추천</span>
            </div>
            <div className="space-y-3">
              {recs.map(r => (
                <div key={r.tournament.id}>
                  <TournamentCard tournament={r.tournament} />
                  <div className="flex flex-wrap gap-1 mt-1.5 px-1">
                    {r.reasons.map((rs, i) => (
                      <span
                        key={i}
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                          rs.kind === 'grade'  ? 'bg-blue-50 text-[#003478]'
                          : rs.kind === 'region' ? 'bg-emerald-50 text-emerald-700'
                          : rs.urgent ? 'bg-red-100 text-[#C60C30]'
                          : 'bg-orange-50 text-orange-600'
                        }`}
                      >
                        {rs.text}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-4 mb-1">
              <div className="h-px bg-gray-100 flex-1" />
              <span className="text-[11px] text-gray-400">전체 대회</span>
              <div className="h-px bg-gray-100 flex-1" />
            </div>
          </div>
        )}

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

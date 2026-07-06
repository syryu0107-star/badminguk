import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { getGradeInfo, getMMRPercentile } from '../../lib/grades'
import BottomNav from '../../components/BottomNav'
import GradeChip from '../../components/GradeChip'
import TournamentCard from '../../components/TournamentCard'
import Spinner from '../../components/Spinner'
import { Bell, ChevronRight, TrendingUp } from 'lucide-react'

export default function Home() {
  const navigate = useNavigate()
  const [profile, setProfile]       = useState(null)
  const [upcoming, setUpcoming]     = useState([])
  const [mmrHistory, setMmrHistory] = useState([])
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const [{ data: p }, { data: t }, { data: h }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('tournaments')
          .select('*, categories:tournament_categories(*)')
          .eq('status', 'open')
          .order('date', { ascending: true })
          .limit(3),
        supabase.from('mmr_history')
          .select('*')
          .eq('player_id', user.id)
          .order('created_at', { ascending: false })
          .limit(5),
      ])

      setProfile(p)
      setUpcoming(t ?? [])
      setMmrHistory(h ?? [])
      setLoading(false)
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center h-screen">
        <Spinner size={36} />
      </div>
    )
  }

  const gradeInfo = getGradeInfo(profile?.official_grade)
  const pct = getMMRPercentile(profile?.mmr ?? 1000)

  return (
    <div className="safe-bottom">
      {/* 헤더 */}
      <header
        className="px-5 pt-14 pb-6 text-white"
        style={{ background: 'linear-gradient(160deg, #C60C30 0%, #003478 100%)' }}
      >
        <div className="flex items-start justify-between mb-5">
          <div>
            <p className="text-white/70 text-sm">안녕하세요</p>
            <h1 className="text-2xl font-black">{profile?.name ?? '선수'}님</h1>
          </div>
          <button className="p-2 rounded-full bg-white/10 active:bg-white/20">
            <Bell size={20} className="text-white" />
          </button>
        </div>

        {/* MMR 카드 */}
        <div className="bg-white/15 backdrop-blur rounded-2xl p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-white/70 text-xs mb-1">플랫폼 MMR</p>
              <p className="text-4xl font-black tabular-nums">{(profile?.mmr ?? 1000).toLocaleString()}</p>
              <p className="text-white/60 text-xs mt-0.5">{pct}</p>
            </div>
            <div className="text-right">
              <p className="text-white/70 text-xs mb-1">전국 급수</p>
              <GradeChip grade={profile?.official_grade ?? '왕초심'} size="lg" className="border-white/30" />
              <p className="text-white/60 text-xs mt-1">
                {profile?.mmr_games_played ?? 0}경기
              </p>
            </div>
          </div>

          {/* 간단한 최근 MMR 변화 */}
          {mmrHistory.length > 0 && (
            <div className="flex items-center gap-1 mt-3 pt-3 border-t border-white/20">
              <TrendingUp size={13} className="text-white/60" />
              <p className="text-xs text-white/60">최근 5경기 MMR 변화:</p>
              <div className="flex gap-1 ml-1">
                {mmrHistory.map((h, i) => (
                  <span
                    key={i}
                    className={`text-xs font-bold ${h.delta >= 0 ? 'text-emerald-300' : 'text-red-300'}`}
                  >
                    {h.delta >= 0 ? '+' : ''}{h.delta}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </header>

      {/* 급수 안내 */}
      {!(profile?.grade_verified) && (
        <div className="mx-4 mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3">
          <span className="text-xl">⚠️</span>
          <div className="flex-1 text-sm">
            <p className="font-semibold text-amber-800">급수 미인증 상태</p>
            <p className="text-amber-600 text-xs">스포넷 캡처를 업로드하면 인증 뱃지가 부여됩니다.</p>
          </div>
          <button
            onClick={() => navigate('/profile')}
            className="text-xs font-bold text-amber-700 shrink-0"
          >
            인증하기
          </button>
        </div>
      )}

      {/* 접수 중인 대회 */}
      <section className="px-4 mt-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-base">접수 중인 대회</h2>
          <button
            onClick={() => navigate('/tournaments')}
            className="flex items-center text-xs text-[#C60C30] font-semibold"
          >
            전체 보기 <ChevronRight size={14} />
          </button>
        </div>

        {upcoming.length === 0 ? (
          <div className="bg-white rounded-2xl p-6 text-center text-gray-400 text-sm border border-gray-100">
            현재 접수 중인 대회가 없습니다.
          </div>
        ) : (
          <div className="space-y-3">
            {upcoming.map(t => <TournamentCard key={t.id} tournament={t} />)}
          </div>
        )}
      </section>

      {/* 주최자 배너 */}
      <section className="px-4 mt-6">
        <button
          onClick={() => navigate('/organizer')}
          className="w-full rounded-2xl p-4 text-left text-white flex items-center gap-3
                     active:scale-[.98] transition-transform"
          style={{ background: 'linear-gradient(135deg, #003478, #001f4d)' }}
        >
          <span className="text-3xl">🏟️</span>
          <div className="flex-1">
            <p className="font-bold">대회 주최자이신가요?</p>
            <p className="text-white/70 text-xs">AI가 대진표를 자동으로 생성해드립니다.</p>
          </div>
          <ChevronRight size={18} className="text-white/50" />
        </button>
      </section>

      <BottomNav mode="player" />
    </div>
  )
}

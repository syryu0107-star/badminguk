import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { getGradeInfo, getMMRPercentile } from '../../lib/grades'
import BottomNav from '../../components/BottomNav'
import GradeChip from '../../components/GradeChip'
import TournamentCard from '../../components/TournamentCard'
import Spinner from '../../components/Spinner'
import { Bell, ChevronRight, TrendingUp, TrendingDown, Award } from 'lucide-react'

export default function Home() {
  const navigate = useNavigate()
  const [profile, setProfile]       = useState(null)
  const [upcoming, setUpcoming]     = useState([])
  const [mmrHistory, setMmrHistory] = useState([])
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

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
          .limit(10),
      ])

      setProfile(p)
      setUpcoming(t ?? [])
      setMmrHistory(h ?? [])
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return (
    <div className="flex-1 flex items-center justify-center h-screen">
      <Spinner size={36} />
    </div>
  )

  const mmr        = profile?.mmr ?? 1000
  const grade      = profile?.official_grade ?? '왕초심'
  const gradeInfo  = getGradeInfo(grade)
  const pct        = getMMRPercentile(mmr)
  const gamesPlayed = profile?.mmr_games_played ?? 0

  // 최근 5경기 MMR 변동 합계
  const recent5    = mmrHistory.slice(0, 5)
  const recentSum  = recent5.reduce((a, h) => a + (h.delta ?? 0), 0)

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
            <h1 className="text-2xl font-black">{profile?.name ?? '게스트'}님</h1>
          </div>
          <button className="p-2 rounded-full bg-white/10 active:bg-white/20">
            <Bell size={20} className="text-white" />
          </button>
        </div>

        {/* 급수 / MMR 분리 카드 */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          {/* 공인 급수 — 내려가지 않음 */}
          <div className="bg-white/15 backdrop-blur rounded-2xl p-3.5">
            <div className="flex items-center gap-1 mb-1.5">
              <Award size={12} className="text-white/60" />
              <p className="text-white/60 text-xs">공인 급수</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">{gradeInfo?.flair}</span>
              <p className="text-xl font-black">{grade}</p>
            </div>
            <p className="text-white/50 text-xs mt-1">스포넷 기준 · 하락 없음</p>
          </div>

          {/* 플랫폼 MMR — 매 경기 변동 */}
          <div className="bg-white/15 backdrop-blur rounded-2xl p-3.5">
            <div className="flex items-center gap-1 mb-1.5">
              <TrendingUp size={12} className="text-white/60" />
              <p className="text-white/60 text-xs">플랫폼 MMR</p>
            </div>
            <p className="text-2xl font-black tabular-nums">{mmr.toLocaleString()}</p>
            <p className="text-white/50 text-xs mt-1">{pct} · {gamesPlayed}경기</p>
          </div>
        </div>

        {/* 최근 경기 MMR 흐름 */}
        {recent5.length > 0 && (
          <div className="bg-white/10 rounded-xl px-3 py-2 flex items-center gap-2">
            <p className="text-xs text-white/60 shrink-0">최근 {recent5.length}경기</p>
            <div className="flex gap-1.5 flex-1">
              {recent5.map((h, i) => (
                <div key={i} className="flex items-center gap-0.5">
                  {h.delta >= 0
                    ? <TrendingUp size={10} className="text-emerald-300" />
                    : <TrendingDown size={10} className="text-red-300" />
                  }
                  <span className={`text-xs font-bold tabular-nums ${h.delta >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                    {h.delta >= 0 ? '+' : ''}{h.delta}
                  </span>
                </div>
              ))}
            </div>
            <span className={`text-xs font-bold shrink-0 ${recentSum >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
              합계 {recentSum >= 0 ? '+' : ''}{recentSum}
            </span>
          </div>
        )}
      </header>

      {/* 급수 미인증 안내 */}
      {profile && !profile.grade_verified && (
        <div className="mx-4 mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3">
          <span className="text-xl">⚠️</span>
          <div className="flex-1 text-sm">
            <p className="font-semibold text-amber-800">급수 미인증</p>
            <p className="text-amber-600 text-xs">스포넷 캡처 업로드 시 인증 뱃지가 부여됩니다.</p>
          </div>
          <button onClick={() => navigate('/profile')} className="text-xs font-bold text-amber-700 shrink-0">
            인증하기
          </button>
        </div>
      )}

      {/* 급수 vs MMR 설명 */}
      {!profile && (
        <div className="mx-4 mt-4 bg-blue-50 rounded-2xl p-4 border border-blue-100">
          <p className="text-sm font-bold text-blue-800 mb-1">🏸 배드민국 MMR이란?</p>
          <p className="text-xs text-blue-600 leading-relaxed">
            <strong>공인 급수</strong>는 스포넷 기준 자격 등급으로 절대 내려가지 않습니다.<br/>
            <strong>플랫폼 MMR</strong>은 매 경기 Elo 공식으로 자동 계산되는 실력 점수입니다.<br/>
            강한 상대를 이기면 더 많이 올라가고, 약한 상대에게 지면 더 많이 떨어집니다.
          </p>
        </div>
      )}

      {/* 접수 중인 대회 */}
      <section className="px-4 mt-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-base">접수 중인 대회</h2>
          <button onClick={() => navigate('/tournaments')}
            className="flex items-center text-xs text-[#C60C30] font-semibold">
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
            <p className="text-white/70 text-xs">AI 대진표 + 공인 MMR 자동 반영</p>
          </div>
          <ChevronRight size={18} className="text-white/50" />
        </button>
      </section>

      <BottomNav mode="player" />
    </div>
  )
}

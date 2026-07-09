import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { getGradeInfo, getMMRPercentile, GRADES } from '../../lib/grades'
import { CERT_LEVELS } from '../../lib/mmr'
import { calcReliability, MIN_RANKED_GAMES, MIN_RANKED_RELIABILITY, isRanked } from '../../lib/reliability'
import BottomNav from '../../components/BottomNav'
import GradeChip from '../../components/GradeChip'
import ReliabilityBadge from '../../components/ReliabilityBadge'
import Spinner from '../../components/Spinner'
import { LogOut, Upload, Award, Shield, TrendingUp, TrendingDown } from 'lucide-react'

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

export default function Profile() {
  const navigate = useNavigate()
  const [profile, setProfile]     = useState(null)
  const [history, setHistory]     = useState([])
  const [tourneys, setTourneys]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [uploading, setUploading] = useState(false)
  const [tab, setTab]             = useState('mmr')  // 'mmr' | 'career'
  const fileRef = useRef()

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      const [{ data: p }, { data: h }, { data: entries }] = await Promise.all([
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
              tournament:tournaments(id, title, date, cert_level, status)
            )
          `)
          .or(`player1_id.eq.${user.id},player2_id.eq.${user.id}`)
          .order('created_at', { ascending: false })
          .limit(20),
      ])

      setProfile(p)
      setHistory(h ?? [])
      setTourneys(entries ?? [])
      setLoading(false)
    }
    load()
  }, [])

  async function uploadProof(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const { data: { user } } = await supabase.auth.getUser()
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
                  ✓ 공인
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 급수 vs MMR 분리 스탯 */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-white/10 rounded-2xl p-3">
            <p className="text-white/60 text-xs flex items-center gap-1 mb-1">
              <Award size={11}/> 공인 급수 <span className="text-white/40">(하락 없음)</span>
            </p>
            <p className="font-black text-xl">{grade}</p>
            <p className="text-white/50 text-xs">스포넷 기준 인증</p>
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
              <ReliabilityBadge result={reliability} size="md" />
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
              아직 공인 대회 기록이 없습니다.
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
          {tourneys.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">
              참가한 대회가 없습니다.
            </div>
          ) : (
            <div className="space-y-3">
              {tourneys.map((entry, i) => {
                const t = entry.category?.tournament
                const certLevel = t?.cert_level ?? 'none'
                const certInfo = CERT_LEVELS[certLevel]
                return (
                  <div key={i} className="bg-white rounded-2xl border border-gray-100 p-4">
                    <div className="flex items-start justify-between mb-1">
                      <p className="font-bold text-sm">{t?.title ?? '대회'}</p>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-0.5
                        ${certLevel === 'a' ? 'bg-red-100 text-red-700'
                        : certLevel === 'b' ? 'bg-purple-100 text-purple-700'
                        : certLevel === 'c' ? 'bg-blue-100 text-blue-700'
                        : 'bg-gray-100 text-gray-500'}`}
                      >
                        <Shield size={9}/> {certInfo?.label}
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
                    <div className="mt-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full
                        ${entry.entry_status === 'approved' ? 'bg-emerald-100 text-emerald-700'
                        : entry.entry_status === 'rejected' ? 'bg-red-100 text-red-600'
                        : 'bg-amber-100 text-amber-700'}`}
                      >
                        {entry.entry_status === 'approved' ? '✅ 승인'
                        : entry.entry_status === 'rejected' ? '❌ 거절'
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
          <div className="bg-white rounded-2xl p-4 border border-gray-100 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <Award size={18} className="text-amber-500" />
              <h2 className="font-bold">스포넷 급수 인증</h2>
            </div>
            <p className="text-xs text-gray-500 mb-3 leading-relaxed">
              스포넷 앱에서 내 급수 확인 화면을 캡처해 업로드하세요.<br/>
              인증 완료 시 <strong>공인 급수 뱃지</strong>가 부여됩니다.<br/>
              ※ 공인 급수는 절대 하락하지 않습니다.
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

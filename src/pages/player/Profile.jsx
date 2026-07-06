import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { getMMRPercentile } from '../../lib/grades'
import BottomNav from '../../components/BottomNav'
import GradeChip from '../../components/GradeChip'
import Spinner from '../../components/Spinner'
import { LogOut, Upload, ChevronRight, Award } from 'lucide-react'

export default function Profile() {
  const navigate = useNavigate()
  const [profile, setProfile]   = useState(null)
  const [history, setHistory]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef()

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      const [{ data: p }, { data: h }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('mmr_history')
          .select('*')
          .eq('player_id', user.id)
          .order('created_at', { ascending: false })
          .limit(20),
      ])
      setProfile(p)
      setHistory(h ?? [])
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
    navigate('/auth', { replace: true })
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner size={36} /></div>

  const pct = getMMRPercentile(profile?.mmr ?? 1000)
  const wins  = history.filter(h => h.delta > 0).length
  const losses = history.filter(h => h.delta < 0).length

  return (
    <div className="safe-bottom">
      {/* 프로필 헤더 */}
      <div
        className="px-5 pt-14 pb-8 text-white"
        style={{ background: 'linear-gradient(160deg, #003478, #C60C30)' }}
      >
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center text-3xl">
            🏸
          </div>
          <div>
            <h1 className="text-xl font-black">{profile?.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <GradeChip grade={profile?.official_grade} size="md" />
              {profile?.grade_verified && (
                <span className="text-xs bg-emerald-400/30 text-emerald-200 px-2 py-0.5 rounded-full font-semibold">
                  ✓ 인증
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 스탯 3종 */}
        <div className="grid grid-cols-3 gap-3 mt-5">
          {[
            { label: 'MMR', value: (profile?.mmr ?? 1000).toLocaleString() },
            { label: '전체 %', value: pct.replace('상위 ', '') },
            { label: '총 경기', value: `${profile?.mmr_games_played ?? 0}경기` },
          ].map(s => (
            <div key={s.label} className="bg-white/15 rounded-xl p-3 text-center">
              <p className="text-white/70 text-xs">{s.label}</p>
              <p className="font-black text-lg">{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 급수 인증 */}
      <section className="px-4 mt-5">
        <div className="bg-white rounded-2xl p-4 border border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Award size={18} className="text-amber-500" />
              <h2 className="font-bold">급수 인증</h2>
            </div>
            {profile?.grade_verified && (
              <span className="text-xs text-emerald-600 font-semibold">인증 완료 ✓</span>
            )}
          </div>
          <p className="text-xs text-gray-500 mb-3">
            스포넷 급수 확인 캡처를 업로드하면 <strong>공인 급수</strong> 인증 뱃지가 부여됩니다.
          </p>
          {profile?.grade_proof_url ? (
            <img
              src={profile.grade_proof_url}
              className="w-full h-32 object-cover rounded-xl mb-2"
              alt="급수 증빙"
            />
          ) : null}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={uploadProof} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="w-full py-2.5 border-2 border-dashed border-gray-200 rounded-xl
                       text-sm text-gray-500 font-semibold flex items-center justify-center gap-2
                       active:bg-gray-50"
          >
            <Upload size={15} />
            {uploading ? '업로드 중...' : profile?.grade_proof_url ? '다시 업로드' : '스포넷 캡처 업로드'}
          </button>
        </div>
      </section>

      {/* MMR 히스토리 */}
      {history.length > 0 && (
        <section className="px-4 mt-5">
          <h2 className="font-bold mb-3">최근 MMR 변화</h2>
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            {history.slice(0, 10).map((h, i) => (
              <div
                key={h.id}
                className={`flex items-center justify-between px-4 py-3
                            ${i < history.length - 1 ? 'border-b border-gray-50' : ''}`}
              >
                <div>
                  <p className="text-xs text-gray-400">{new Date(h.created_at).toLocaleDateString('ko-KR')}</p>
                  <p className="text-sm font-semibold">{h.mmr_before} → {h.mmr_after}</p>
                </div>
                <span className={`font-black text-base ${h.delta >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {h.delta >= 0 ? '+' : ''}{h.delta}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 로그아웃 */}
      <section className="px-4 mt-5 mb-8">
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

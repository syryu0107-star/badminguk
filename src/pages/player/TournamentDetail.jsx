import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { GRADES, getGradeIndex, gradeRangeLabel } from '../../lib/grades'
import { getGradeFromMMR } from '../../lib/sandbag'
import { CERT_LEVELS } from '../../lib/mmr'
import TopBar from '../../components/TopBar'
import GradeChip from '../../components/GradeChip'
import Spinner from '../../components/Spinner'
import { MapPin, Calendar, Users, ChevronDown, ChevronUp, Shield, Lock } from 'lucide-react'

// 급수+MMR 자격 검사
function checkEligibility(profile, cat) {
  if (!profile) return { ok: false, reason: '로그인 필요' }
  const userIdx = getGradeIndex(profile.official_grade)

  if (cat.grade_min) {
    const minIdx = getGradeIndex(cat.grade_min)
    if (userIdx < minIdx) return { ok: false, reason: `${cat.grade_min} 이상만 참가 가능` }
  }
  if (cat.grade_max) {
    const maxIdx = getGradeIndex(cat.grade_max)
    if (userIdx > maxIdx) return { ok: false, reason: `${cat.grade_max} 이하만 참가 가능 (반샌드배깅)` }
  }
  if (cat.min_mmr && profile.mmr < cat.min_mmr) {
    return { ok: false, reason: `MMR ${cat.min_mmr} 이상 필요 (현재 ${profile.mmr})` }
  }
  if (cat.max_mmr && profile.mmr > cat.max_mmr) {
    return { ok: false, reason: `MMR ${cat.max_mmr} 이하만 참가 가능 (현재 ${profile.mmr})` }
  }
  return { ok: true }
}

const CERT_BADGE = {
  none: 'bg-gray-100 text-gray-500',
  c:    'bg-blue-100 text-blue-700',
  b:    'bg-purple-100 text-purple-700',
  a:    'bg-red-100 text-red-700',
}

export default function TournamentDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [tournament, setTournament] = useState(null)
  const [categories, setCategories] = useState([])
  const [myEntries, setMyEntries]   = useState([])
  const [loading, setLoading]       = useState(true)
  const [selectedCat, setSelectedCat] = useState(null)
  const [partner, setPartner]       = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess]       = useState(false)
  const [profile, setProfile]       = useState(null)
  const [entryError, setEntryError] = useState('')

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      const [{ data: t }, { data: c }] = await Promise.all([
        supabase.from('tournaments').select('*').eq('id', id).single(),
        supabase.from('tournament_categories').select('*').eq('tournament_id', id),
      ])

      let p = null
      if (user) {
        const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
        p = data
        if (c?.length) {
          const { data: entries } = await supabase
            .from('tournament_entries')
            .select('*, category:tournament_categories(*)')
            .in('category_id', c.map(x => x.id))
            .eq('player1_id', user.id)
          setMyEntries(entries ?? [])
        }
      }

      setTournament(t)
      setCategories(c ?? [])
      setProfile(p)
      setLoading(false)
    }
    load()
  }, [id])

  async function submitEntry() {
    if (!selectedCat) return
    const cat = categories.find(c => c.id === selectedCat)
    const elig = checkEligibility(profile, cat)
    if (!elig.ok) { setEntryError(elig.reason); return }

    setSubmitting(true); setEntryError('')
    const { data: { user } } = await supabase.auth.getUser()

    let p2id = null
    if (partner.trim()) {
      // 파트너를 이름으로 조회 (동명이인·미가입자 방어)
      const { data: matches } = await supabase
        .from('profiles')
        .select('id,name,official_grade,grade_verified,mmr,mmr_games_played')
        .ilike('name', partner.trim())
        .limit(5)

      if (!matches?.length) {
        setEntryError(`'${partner.trim()}' 회원을 찾을 수 없습니다. 파트너가 먼저 가입해야 신청할 수 있습니다.`)
        setSubmitting(false); return
      }
      if (matches.length > 1) {
        setEntryError('동명이인이 여러 명입니다. 정확한 파트너를 특정할 수 없어 신청할 수 없습니다.')
        setSubmitting(false); return
      }
      const pm = matches[0]
      if (pm.id === user.id) {
        setEntryError('본인을 파트너로 지정할 수 없습니다.')
        setSubmitting(false); return
      }
      // 파트너에게도 동일한 급수·MMR 자격 검사 (반샌드배깅 파트너 구멍 봉합)
      const pElig = checkEligibility(pm, cat)
      if (!pElig.ok) {
        setEntryError(`파트너(${pm.name}) 자격 미달: ${pElig.reason}`)
        setSubmitting(false); return
      }
      p2id = pm.id
    }

    const { error } = await supabase.from('tournament_entries').insert({
      category_id:  selectedCat,
      player1_id:   user.id,
      player2_id:   p2id,
      entry_status: 'applied',
    })

    if (error) { setEntryError(error.message); setSubmitting(false); return }
    setSuccess(true); setSubmitting(false)
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner size={36} /></div>
  if (!tournament) return <div className="text-center py-20 text-gray-400">대회를 찾을 수 없습니다.</div>

  const certLevel = tournament.cert_level ?? 'none'
  const certInfo  = CERT_LEVELS[certLevel]
  const canApply  = tournament.status === 'open'

  return (
    <div className="safe-bottom">
      <TopBar title={tournament.title} />

      {/* 배너 */}
      <div
        className="h-44 flex flex-col justify-end px-5 pb-5"
        style={{ background: 'linear-gradient(135deg, #C60C30, #003478)' }}
      >
        {/* 공인 등급 배지 */}
        <div className="mb-2">
          <span className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full ${CERT_BADGE[certLevel]}`}>
            <Shield size={11} /> {certInfo?.label}
            {certLevel !== 'none' && <span className="ml-1">{certInfo?.desc}</span>}
          </span>
        </div>
        <h1 className="text-xl font-black text-white">{tournament.title}</h1>
        <div className="flex items-center gap-3 text-white/80 text-sm mt-1">
          <span className="flex items-center gap-1"><Calendar size={12} /> {tournament.date}</span>
          <span className="flex items-center gap-1"><MapPin size={12} /> {tournament.venue}</span>
        </div>
      </div>

      {/* 내 현재 급수/MMR */}
      {profile && (
        <div className="mx-4 mt-4 bg-gray-50 rounded-2xl px-4 py-3 flex items-center gap-3">
          <div>
            <p className="text-xs text-gray-400">내 공인 급수</p>
            <GradeChip grade={profile.official_grade} size="sm" />
          </div>
          <div className="w-px h-8 bg-gray-200" />
          <div>
            <p className="text-xs text-gray-400">플랫폼 MMR</p>
            <p className="font-black text-gray-800">{(profile.mmr ?? 1000).toLocaleString()}</p>
          </div>
          {(() => {
            const implied = getGradeFromMMR(profile.mmr)
            const mismatch = getGradeIndex(implied) > getGradeIndex(profile.official_grade)
            return (
              <div className="ml-auto text-right">
                <p className="text-xs text-gray-400">MMR 실측 수준</p>
                <p className={`text-sm font-bold ${mismatch ? 'text-amber-600' : 'text-gray-700'}`}>
                  {implied}{mismatch && ' ⚠'}
                </p>
              </div>
            )
          })()}
        </div>
      )}

      <div className="px-4 py-5 space-y-5">
        {/* 설명 */}
        {tournament.description && (
          <div className="bg-white rounded-2xl p-4 border border-gray-100">
            <p className="text-sm text-gray-600 leading-relaxed">{tournament.description}</p>
          </div>
        )}

        {/* 참가 종목 */}
        <div>
          <h2 className="font-bold mb-3">참가 종목</h2>
          <div className="space-y-3">
            {categories.map(cat => {
              const alreadyApplied = myEntries.some(e => e.category_id === cat.id)
              const elig = checkEligibility(profile, cat)
              const gradeLabel = gradeRangeLabel(cat.grade_min, cat.grade_max)
              const hasMMRGate = cat.min_mmr || cat.max_mmr

              return (
                <div key={cat.id} className={`bg-white rounded-2xl p-4 border transition
                  ${selectedCat === cat.id ? 'border-[#C60C30]' : 'border-gray-100'}
                  ${!elig.ok && !alreadyApplied ? 'opacity-70' : ''}`}
                >
                  {/* 헤더 */}
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold">{cat.sport_type}</span>
                        {cat.grade_max && <GradeChip grade={cat.grade_max} size="sm" />}
                        {gradeLabel !== '급수 제한 없음' && (
                          <span className="text-xs text-gray-400">{gradeLabel}</span>
                        )}
                      </div>
                      {hasMMRGate && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          MMR {cat.min_mmr ?? '∞'} ~ {cat.max_mmr ?? '∞'}
                        </p>
                      )}
                    </div>
                    <span className="text-sm font-bold text-[#C60C30] shrink-0 ml-2">
                      {cat.entry_fee === 0 ? '무료' : `${cat.entry_fee.toLocaleString()}원`}
                    </span>
                  </div>

                  {/* 자격 불충족 사유 */}
                  {!elig.ok && !alreadyApplied && (
                    <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5 mb-2">
                      <Lock size={11} /> {elig.reason}
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400 flex items-center gap-1">
                      <Users size={11} /> 최대 {cat.max_teams}팀
                    </span>
                    {alreadyApplied ? (
                      <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                        ✅ 신청 완료
                      </span>
                    ) : canApply && elig.ok && (
                      <button
                        onClick={() => { setSelectedCat(cat.id === selectedCat ? null : cat.id); setEntryError(''); setSuccess(false) }}
                        className="text-xs font-bold text-white bg-[#C60C30] px-3 py-1 rounded-full
                                   flex items-center gap-1 active:opacity-80"
                      >
                        신청 {cat.id === selectedCat ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                    )}
                  </div>

                  {/* 신청 폼 */}
                  {selectedCat === cat.id && !alreadyApplied && (
                    <div className="mt-3 pt-3 border-t border-gray-100 space-y-3 fade-up">
                      <div>
                        <label className="text-xs font-semibold text-gray-600 block mb-1">파트너 이름</label>
                        <input
                          value={partner}
                          onChange={e => setPartner(e.target.value)}
                          placeholder="파트너 이름 (없으면 비워두세요)"
                          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#C60C30]"
                        />
                      </div>
                      {entryError && <p className="text-xs text-red-500">{entryError}</p>}
                      {success ? (
                        <p className="text-emerald-600 font-semibold text-sm text-center">✅ 신청 완료!</p>
                      ) : (
                        <button
                          onClick={submitEntry}
                          disabled={submitting}
                          className="w-full py-2.5 rounded-xl text-white font-bold text-sm
                                     transition active:scale-[.97] disabled:opacity-60"
                          style={{ background: 'linear-gradient(135deg, #C60C30, #003478)' }}
                        >
                          {submitting ? '신청 중...' : '참가 신청'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

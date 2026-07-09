import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { GRADES, getGradeIndex, gradeRangeLabel } from '../../lib/grades'
import { getGradeFromMMR } from '../../lib/sandbag'
import { CERT_LEVELS } from '../../lib/mmr'
import TopBar from '../../components/TopBar'
import GradeChip from '../../components/GradeChip'
import Spinner from '../../components/Spinner'
import { MapPin, Calendar, Users, ChevronDown, ChevronUp, Shield, Lock, Search, X } from 'lucide-react'

// 복식 종목(파트너 필수) — 그 외(남단/여단)는 단식(혼자 신청)
const DOUBLES_TYPES = ['남복', '여복', '혼복']
function isDoubles(cat) {
  return DOUBLES_TYPES.includes(cat?.sport_type)
}

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
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess]       = useState(false)
  const [profile, setProfile]       = useState(null)
  const [entryError, setEntryError] = useState('')

  // ── 파트너 검색 상태 ─────────────────────────────────────────
  const [partnerQuery, setPartnerQuery]       = useState('')
  const [partnerResults, setPartnerResults]   = useState([])
  const [partnerSearching, setPartnerSearching] = useState(false)
  const [searched, setSearched]               = useState(false)
  const [searchError, setSearchError]         = useState('')
  const [selectedPartner, setSelectedPartner] = useState(null)

  // 파트너 관련 상태 초기화 (종목 전환 시)
  function resetPartner() {
    setPartnerQuery('')
    setPartnerResults([])
    setPartnerSearching(false)
    setSearched(false)
    setSearchError('')
    setSelectedPartner(null)
  }

  // 카테고리 신청 폼 열기/닫기
  function toggleCat(catId) {
    setSelectedCat(prev => (prev === catId ? null : catId))
    setEntryError('')
    setSuccess(false)
    resetPartner()
  }

  // 내 신청 목록 조회 (S1(c): 양방향 — 내가 신청자이거나 파트너인 경우 모두)
  async function fetchMyEntries(uid, cats) {
    if (!uid || !cats?.length) return []
    const { data } = await supabase
      .from('tournament_entries')
      .select('*, category:tournament_categories(*)')
      .in('category_id', cats.map(x => x.id))
      .or(`player1_id.eq.${uid},player2_id.eq.${uid}`)
    return data ?? []
  }

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
          setMyEntries(await fetchMyEntries(user.id, c))
        }
      }

      setTournament(t)
      setCategories(c ?? [])
      setProfile(p)
      setLoading(false)
    }
    load()
  }, [id])

  // ── 파트너 검색 (전화번호 정확일치 → id / 이름 부분일치 리스트) ──
  async function searchPartner() {
    const q = partnerQuery.trim()
    if (!q) return
    setPartnerSearching(true)
    setSearchError('')
    setPartnerResults([])
    setSelectedPartner(null)

    const digits = q.replace(/\D/g, '')
    const cols = 'id,name,phone,official_grade,grade_verified,mmr,mmr_games_played'
    let rows = []

    if (digits.length >= 10) {
      // 전화번호 검색: 저장 포맷이 갈릴 수 있어 여러 표기를 함께 정확일치(.in)
      const candidates = [q, digits]
      if (digits.length === 11 && digits.startsWith('010')) {
        candidates.push('+82' + digits.slice(1))
      }
      const { data } = await supabase
        .from('profiles')
        .select(cols)
        .in('phone', candidates)
      rows = data ?? []
    } else {
      // 이름 검색: 동명이인 방어를 위해 리스트로 노출 후 사용자가 직접 선택
      const { data } = await supabase
        .from('profiles')
        .select(cols)
        .ilike('name', `%${q}%`)
        .limit(10)
      rows = data ?? []
    }

    // 본인 제외 (no_self_pair 이중 방어)
    rows = rows.filter(r => r.id !== profile?.id)

    setPartnerResults(rows)
    setSearched(true)
    if (!rows.length) {
      setSearchError('검색 결과가 없습니다. 파트너가 먼저 배드민국에 가입해야 신청할 수 있어요.')
    }
    setPartnerSearching(false)
  }

  function selectPartner(pm) {
    setSelectedPartner(pm)
    setPartnerResults([])
    setSearched(false)
    setSearchError('')
    setEntryError('')
  }

  function clearPartner() {
    setSelectedPartner(null)
    setEntryError('')
  }

  async function submitEntry() {
    if (!selectedCat) return
    const cat = categories.find(c => c.id === selectedCat)
    const elig = checkEligibility(profile, cat)
    if (!elig.ok) { setEntryError(elig.reason); return }

    const doubles = isDoubles(cat)
    if (doubles && !selectedPartner) { setEntryError('파트너를 선택하세요'); return }

    setSubmitting(true); setEntryError('')
    const { data: { user } } = await supabase.auth.getUser()

    let p2id = null
    let entryStatus = 'applied'

    if (doubles) {
      const pm = selectedPartner
      if (pm.id === user.id) {
        setEntryError('본인을 파트너로 지정할 수 없습니다.')
        setSubmitting(false); return
      }
      // 파트너에게도 동일 급수·MMR 자격 검사 (반샌드배깅 파트너 구멍 봉합, M1)
      const pElig = checkEligibility(pm, cat)
      if (!pElig.ok) {
        setEntryError(`파트너(${pm.name || '상대'}) 자격 미달: ${pElig.reason}`)
        setSubmitting(false); return
      }
      p2id = pm.id
      entryStatus = 'partner_pending' // 초대 → 파트너 수락 대기 (명세 상태값)
    }

    const { error } = await supabase.from('tournament_entries').insert({
      category_id:  selectedCat,
      player1_id:   user.id,
      player2_id:   p2id,
      entry_status: entryStatus,
    })

    if (error) { setEntryError(error.message); setSubmitting(false); return }

    // 성공 후 내 신청 목록 즉시 갱신 (M6: 로컬 success만 true였던 문제 봉합)
    setMyEntries(await fetchMyEntries(user.id, categories))
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
              const doubles = isDoubles(cat)
              const partnerElig = selectedPartner ? checkEligibility(selectedPartner, cat) : null

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
                        onClick={() => toggleCat(cat.id)}
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
                      {doubles ? (
                        <div>
                          <label className="text-xs font-semibold text-gray-600 block mb-1">
                            파트너 찾기 <span className="text-[#C60C30]">*</span>
                          </label>

                          {selectedPartner ? (
                            /* 선택된 파트너 카드 */
                            <div>
                              <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-semibold text-sm truncate">{selectedPartner.name || '이름없음'}</span>
                                    <GradeChip grade={selectedPartner.official_grade} size="sm" />
                                  </div>
                                  <p className="text-xs text-gray-400 mt-0.5">
                                    MMR {(selectedPartner.mmr ?? 1000).toLocaleString()} · {selectedPartner.mmr_games_played ?? 0}경기
                                  </p>
                                </div>
                                <button
                                  onClick={clearPartner}
                                  className="shrink-0 ml-2 text-gray-400 active:text-gray-600"
                                  aria-label="파트너 선택 해제"
                                >
                                  <X size={16} />
                                </button>
                              </div>
                              {/* 선택 시점 파트너 자격 경고 (제출 시 재검증됨) */}
                              {partnerElig && !partnerElig.ok && (
                                <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5 mt-2">
                                  <Lock size={11} /> 파트너 자격 미달: {partnerElig.reason}
                                </div>
                              )}
                            </div>
                          ) : (
                            /* 검색 입력 + 결과 */
                            <>
                              <div className="flex gap-2">
                                <input
                                  value={partnerQuery}
                                  onChange={e => { setPartnerQuery(e.target.value); setSearchError('') }}
                                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); searchPartner() } }}
                                  placeholder="전화번호 또는 이름으로 검색"
                                  className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#C60C30]"
                                />
                                <button
                                  onClick={searchPartner}
                                  disabled={partnerSearching || !partnerQuery.trim()}
                                  className="shrink-0 px-3 rounded-xl bg-gray-100 text-gray-700 font-semibold text-sm
                                             flex items-center gap-1 active:opacity-80 disabled:opacity-50"
                                >
                                  <Search size={14} /> 검색
                                </button>
                              </div>

                              {partnerSearching && (
                                <p className="text-xs text-gray-400 mt-2">검색 중...</p>
                              )}

                              {searchError && (
                                <p className="text-xs text-amber-700 mt-2">{searchError}</p>
                              )}

                              {partnerResults.length > 0 && (
                                <div className="mt-2 space-y-1.5">
                                  <p className="text-[11px] text-gray-400">
                                    파트너를 선택하세요 ({partnerResults.length}명)
                                  </p>
                                  {partnerResults.map(r => (
                                    <button
                                      key={r.id}
                                      onClick={() => selectPartner(r)}
                                      className="w-full text-left border border-gray-200 rounded-xl px-3 py-2
                                                 flex items-center justify-between gap-2 active:bg-gray-50"
                                    >
                                      <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="font-semibold text-sm truncate">{r.name || '이름없음'}</span>
                                          <GradeChip grade={r.official_grade} size="sm" />
                                          {r.grade_verified && (
                                            <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">인증</span>
                                          )}
                                        </div>
                                      </div>
                                      <span className="text-xs text-gray-400 shrink-0">
                                        MMR {(r.mmr ?? 1000).toLocaleString()}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-500 bg-gray-50 rounded-xl px-3 py-2">
                          단식 종목이에요. 파트너 없이 혼자 신청합니다.
                        </p>
                      )}

                      {entryError && <p className="text-xs text-red-500">{entryError}</p>}

                      {success ? (
                        <p className="text-emerald-600 font-semibold text-sm text-center">
                          {doubles && selectedPartner
                            ? `✅ 신청 완료! 파트너 ${selectedPartner.name || ''}님의 수락을 기다리는 중이에요.`
                            : '✅ 신청 완료!'}
                        </p>
                      ) : (
                        <button
                          onClick={submitEntry}
                          disabled={submitting || (doubles && !selectedPartner)}
                          className="w-full py-2.5 rounded-xl text-white font-bold text-sm
                                     transition active:scale-[.97] disabled:opacity-60"
                          style={{ background: 'linear-gradient(135deg, #C60C30, #003478)' }}
                        >
                          {submitting
                            ? '신청 중...'
                            : doubles && !selectedPartner
                            ? '파트너를 선택하세요'
                            : '참가 신청'}
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

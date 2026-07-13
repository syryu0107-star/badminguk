import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { GRADES, getInitialMMR, getGradeIndex, getGradeInfo, unitLabel, modeLabel } from '../lib/grades'
import { surveyToRating, crossCheckSandbag } from '../lib/rating'
import { MIN_RANKED_GAMES } from '../lib/reliability'
import { ChevronRight, ShieldCheck, Camera, Sparkles, Check, Search, UserCheck, Trophy } from 'lucide-react'

// 실명 마스킹 — 홍길동 → 홍*동 (017 bmg_mask_name와 동일 규칙).
// 미가입 명단(imported_players)은 타인 PII라 후보 표시 때도 항상 가린다.
function maskName(name) {
  const s = (name ?? '').trim()
  if (s.length === 0) return ''
  if (s.length === 1) return s
  if (s.length === 2) return s[0] + '*'
  return s[0] + '*'.repeat(s.length - 2) + s[s.length - 1]
}

// ── 온보딩 예측변수 옵션 (전략 3-2: "감"이 아니라 검증가능 사실) ──────────
// 각 답은 rating.js.surveyToRating 입력으로 변환된다(점 추정 아닌 밴드).
const ELITE_OPTS = [
  { key: 'none', label: '선수부는 아니에요', emoji: '🙂', elite: false },
  { key: 'elem', label: '초등 선수부',       emoji: '🏫', elite: true  },
  { key: 'mid',  label: '중등 선수부',       emoji: '🎒', elite: true  },
  { key: 'high', label: '고등 선수부',       emoji: '🎓', elite: true  },
  { key: 'univ', label: '대학 선수부',       emoji: '🏛️', elite: true  },
  { key: 'pro',  label: '실업팀 선수 출신',  emoji: '🏆', elite: true  },
]

const CAREER_OPTS = [
  { key: 'none',  label: '아직 안 쳐봤어요', emoji: '🐣', months: 0  },
  { key: 'lt6',   label: '6개월 미만',        emoji: '🌱', months: 3  },
  { key: '6to12', label: '6개월 ~ 1년',       emoji: '🎯', months: 9  },
  { key: '1to2',  label: '1 ~ 2년',           emoji: '🏸', months: 18 },
  { key: '2to4',  label: '2 ~ 4년',           emoji: '🔥', months: 36 },
  { key: 'gt4',   label: '4년 이상',          emoji: '⚡', months: 60 },
]

const SESSION_OPTS = [
  { key: 'low',  label: '주 1회 이하',  sessions: 1 },
  { key: 'mid',  label: '주 2 ~ 3회',   sessions: 3 },
  { key: 'high', label: '주 4회 이상',  sessions: 4 },
]

// 급수를 어디서 받았는지(단위) — 같은 조라도 전국>시>구 순으로 실력이 높다(전략 3-3③).
const UNIT_OPTS = [
  { key: 'gu',  label: '동네·구 대회' },
  { key: 'si',  label: '시 대회' },
  { key: 'nat', label: '전국 대회' },
]

// 최근 대회 성적 → 역추정 보정(전략 6-3: 조 우승이면 한 조 위 실력).
const RESULT_OPTS = [
  { key: 'win',   label: '우승했어요',       bump: 1 },
  { key: 'place', label: '입상 (4강 이상)',  bump: 0 },
  { key: 'none',  label: '그 외 / 예선 탈락', bump: 0 },
]

// 최근 출전 조 + 성적 → 역추정 급수(입상이력 기반). 없으면 null.
function inferGradeFromResult(recentGrade, recentResult) {
  if (!recentGrade) return null
  const idx = getGradeIndex(recentGrade)
  if (idx < 0) return null
  const bump = RESULT_OPTS.find(o => o.key === recentResult)?.bump ?? 0
  const nIdx = Math.min(GRADES.length - 1, idx + bump)
  return GRADES[nIdx].key
}

export default function Onboarding() {
  const navigate = useNavigate()
  const location = useLocation()

  const phoneRecord = location.state?.phoneRecord ?? null
  const phone       = location.state?.phone ?? null
  const role        = location.state?.role ?? 'player'

  // phone_records가 있으면 급수는 변경 불가(최고 급수 고정) → 설문 생략, 기록 복원.
  const gradeIsLocked = !!phoneRecord

  // 복귀 유저: [이름 → 급수(잠금) → 종목].  신규 유저: 예측변수 설문.
  const steps = gradeIsLocked
    ? ['name', 'grade', 'sports']
    : ['name', 'elite', 'career', 'sessions', 'grade', 'club', 'sports']

  const [step, setStep] = useState(0)
  const current = steps[step]

  const [name,     setName]     = useState('')
  const [elite,    setElite]    = useState('none')
  const [career,   setCareer]   = useState('')
  const [sessions, setSessions] = useState('')
  const [selfGrade, setSelfGrade] = useState(phoneRecord?.peak_grade ?? '')
  const [gradeUnit, setGradeUnit] = useState('gu')
  const [recentGrade,  setRecentGrade]  = useState('')
  const [recentResult, setRecentResult] = useState('')
  const [proofUrl, setProofUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [club,   setClub]   = useState('')
  const [sports, setSports] = useState([])
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  // ── 지난 기록 이어받기(claim) — 이름 입력 직후 미가입 명단에서 본인 후보 검색 ──
  const [showClaim,      setShowClaim]      = useState(false)  // 후보 카드 화면 표시
  const [claimSearching, setClaimSearching] = useState(false)
  const [claimCandidates, setClaimCandidates] = useState([])
  const [claiming,       setClaiming]       = useState(false)

  function toggleSport(s) {
    setSports(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }

  async function uploadProof(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setError('')
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user ?? null
    if (!user) { setUploading(false); return }
    const ext  = file.name.split('.').pop()
    const path = `grade-proofs/${user.id}/${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('proofs').upload(path, file)
    if (!upErr) {
      const { data: { publicUrl } } = supabase.storage.from('proofs').getPublicUrl(path)
      setProofUrl(publicUrl)
    } else {
      setError('업로드 실패: ' + upErr.message)
    }
    setUploading(false)
  }

  async function goNext() {
    if (current === 'sports') { finish(); return }
    // 이름 입력 직후(신규 유저): 같은 이름의 미가입 명단 후보를 찾아 "이어받기" 제안.
    // 복귀 유저(gradeIsLocked)는 phone_records로 이미 기록이 복원되므로 생략.
    if (current === 'name' && !gradeIsLocked && !showClaim) {
      const found = await searchClaimCandidates(name)
      if (found.length) { setClaimCandidates(found); setShowClaim(true); return }
    }
    setStep(s => Math.min(steps.length - 1, s + 1))
  }

  // 미가입 선수 명단에서 같은 이름 + 미claim 후보 검색(공개 SELECT).
  async function searchClaimCandidates(nm) {
    const q = (nm ?? '').trim()
    if (q.length < 2) return []
    setClaimSearching(true)
    const { data } = await supabase
      .from('imported_players')
      .select('id, name, unit, mode, grade, mmr, source_label, created_at')
      .ilike('name', q)
      .is('claimed_by', null)
      .order('created_at', { ascending: false })
      .limit(10)
    setClaimSearching(false)
    return data ?? []
  }

  // "이게 나예요" 확정 — 최소 프로필 생성 후 claim RPC로 급수·MMR 상향 이관(설문 생략).
  async function confirmClaim(candidate) {
    setClaiming(true); setError('')
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user ?? null
    if (!user) { setError('로그인이 필요합니다.'); setClaiming(false); return }

    // 1) 기본 프로필(없으면 생성). 급수/MMR은 왕초심 기본값 → claim이 상향만 덮어씀(하향 없음).
    const base = {
      id: user.id, name, phone, role,
      official_grade: '왕초심', self_reported_grade: '왕초심',
      preferred_sports: sports,
      mmr: 1000, mmr_rd: 350, mmr_source: 'self_report', provisional: true, mmr_games_played: 0,
      singles_mmr: 1000, singles_mmr_rd: 350, singles_mmr_source: 'self_report', singles_provisional: true,
      onboarding_done: true,
    }
    const { error: pErr } = await supabase.from('profiles').upsert(base)
    if (pErr) { setError(pErr.message); setClaiming(false); return }

    // 2) claim — 지난 급수·MMR·RD를 내 프로필로 이관(유리할 때만).
    const { error: cErr } = await supabase.rpc('claim_imported_player', { p_imported_id: candidate.id })
    if (cErr) { setError('이어받기에 실패했어요: ' + cErr.message); setClaiming(false); return }

    navigate(role === 'organizer' ? '/organizer' : '/home', { replace: true })
  }

  // "제 기록이 아니에요" — 후보 무시하고 일반 설문 흐름으로 진행.
  function skipClaim() {
    setShowClaim(false)
    setStep(s => Math.min(steps.length - 1, s + 1))
  }

  async function finish() {
    setSaving(true); setError('')
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user ?? null
    if (!user) { setError('로그인이 필요합니다.'); setSaving(false); return }

    let payload
    if (gradeIsLocked) {
      // ── 복귀 유저: 이전 기록 복원(설문 생략). 급수는 peak 이상 고정. ──
      const restoredMMR = phoneRecord?.current_mmr ?? getInitialMMR(selfGrade)
      const games = phoneRecord?.total_games ?? 0
      payload = {
        id: user.id, name, phone, role,
        official_grade:      selfGrade,
        self_reported_grade: selfGrade,
        preferred_sports:    sports,
        mmr:                 restoredMMR,
        mmr_rd:              games >= MIN_RANKED_GAMES ? 110 : 350,
        mmr_source:          'import',
        provisional:         games < MIN_RANKED_GAMES,
        mmr_games_played:    games,
        onboarding_done:     true,
      }
    } else {
      // ── 신규 유저: 예측변수 → 초기 MMR+RD 밴드(rating.js 단일 소스). ──
      const careerMonths   = CAREER_OPTS.find(o => o.key === career)?.months   ?? null
      const weeklySessions = SESSION_OPTS.find(o => o.key === sessions)?.sessions ?? null
      const isElite        = ELITE_OPTS.find(o => o.key === elite)?.elite ?? false
      const hasEvidence    = !!proofUrl

      // 자기신고 급수 ↔ 최근 입상이력 역추정 교차검증(전략 4·6-3).
      const inferredFromResults = inferGradeFromResult(recentGrade, recentResult)
      const sandbag = (selfGrade && inferredFromResults)
        ? crossCheckSandbag(selfGrade, inferredFromResults)
        : { flagged: false, gap: 0, level: 'none', reason: null }

      // 언더디클레어(신고 ≪ 실제)면 앵커를 역추정(높은) 급수로 래칫업(하향 불가).
      const anchorGrade = sandbag.flagged ? inferredFromResults : (selfGrade || undefined)

      const rating = surveyToRating({
        selfReportedGrade: anchorGrade,
        unit: gradeUnit,
        mode: 'doubles',
        isElite, careerMonths, weeklySessions, hasEvidence,
      })

      payload = {
        id: user.id, name, phone, role,
        // 유효 급수 = 앵커(역추정 반영). 원본 신고값은 self_reported_grade에 불변 보존
        //   → (self_reported_grade < official_grade) 괴리 자체가 샌드배깅 검증 큐 신호.
        official_grade:      rating.inferredGrade,
        self_reported_grade: selfGrade || rating.inferredGrade,
        preferred_sports:    sports,
        // 복식 트랙 시드
        mmr:              rating.mmr,
        mmr_rd:           rating.rd,
        mmr_source:       'self_report',
        provisional:      true,
        mmr_games_played: 0,
        // 단식 트랙도 같은 밴드로 잠정 앵커(경기 시 자동 재보정)
        singles_mmr:        rating.mmr,
        singles_mmr_rd:     rating.rd,
        singles_mmr_source: 'self_report',
        singles_provisional: true,
        // 예측 변수(전략 3-2)
        career_months:   careerMonths,
        is_elite:        isElite,
        club_name:       club.trim() || null,
        weekly_sessions: weeklySessions,
        onboarding_done: true,
        // 증빙 캡처(선택). 있으면 RD 이미 축소됨. grade_verified는 사람 검증 전까지 유지.
        ...(proofUrl ? { grade_proof_url: proofUrl } : {}),
      }
    }

    const { error: e } = await supabase.from('profiles').upsert(payload)
    if (e) { setError(e.message); setSaving(false); return }
    navigate(role === 'organizer' ? '/organizer' : '/home', { replace: true })
  }

  // 다음 버튼 활성 조건(대부분 선택 단계 → 항상 통과, 이름/복귀급수만 필수)
  const canNext =
    current === 'name'   ? !!name.trim()
    : current === 'career' ? career !== ''
    : current === 'grade'  ? (gradeIsLocked ? !!selfGrade : true)
    : current === 'sports' ? !saving
    : true

  // 복귀 유저 급수 잠금 목록(peak 이상만)
  const lockedGradeList = gradeIsLocked
    ? GRADES.filter((g) => getGradeIndex(g.key) >= getGradeIndex(phoneRecord.peak_grade))
    : GRADES

  // ── 지난 기록 찾음! 이어받기 제안 화면(이름 입력 직후 인터스티셜) ──────────
  if (showClaim) {
    return (
      <div className="min-h-screen bg-white flex flex-col px-6 pt-12 pb-8">
        <div className="flex-1 fade-up overflow-y-auto">
          <div className="w-14 h-14 rounded-2xl bg-red-50 flex items-center justify-center mb-4">
            <Trophy size={26} className="text-[#C60C30]" />
          </div>
          <h2 className="text-2xl font-black mb-1">지난 대회 기록을 찾았어요! 🔎</h2>
          <p className="text-gray-500 mb-5 text-sm leading-relaxed">
            <strong className="text-gray-700">{name.trim()}</strong>님과 같은 이름으로 지난 대회 명단이 있어요.<br/>
            내 기록이 맞으면 <strong>이어받기</strong>로 지난 급수·MMR을 그대로 가져올 수 있어요.
          </p>

          <div className="space-y-2.5">
            {claimCandidates.map(c => {
              const info = getGradeInfo(c.grade)
              return (
                <div key={c.id} className="p-4 rounded-2xl border-2 border-gray-100 bg-white">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-lg">{info?.flair ?? '🏸'}</span>
                    <p className="font-bold flex-1">{maskName(c.name)}</p>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                      {unitLabel(c.unit)} {modeLabel(c.mode)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500 mb-3">
                    {c.grade && <span className="font-bold text-[#003478]">{c.grade}</span>}
                    {c.source_label && <span className="truncate">· {c.source_label}</span>}
                  </div>
                  <button
                    onClick={() => confirmClaim(c)}
                    disabled={claiming}
                    className="w-full py-2.5 rounded-xl font-bold text-white text-sm
                               flex items-center justify-center gap-1.5 active:scale-[.98] transition disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, #C60C30, #003478)' }}
                  >
                    <UserCheck size={16} />
                    {claiming ? '이어받는 중...' : '이게 나예요 · 이어받기'}
                  </button>
                </div>
              )
            })}
          </div>

          {error && <p className="text-red-500 text-sm mt-4">{error}</p>}

          <p className="text-[11px] text-gray-400 mt-4 leading-relaxed">
            급수는 지금보다 <strong>유리할 때만</strong> 올라가요(하락 없음). 다른 사람의 기록을
            잘못 가져오지 않도록 대회 이름·급수를 꼭 확인해주세요.
          </p>
        </div>

        <button
          onClick={skipClaim}
          disabled={claiming}
          className="w-full py-4 rounded-2xl font-bold text-gray-500 text-base mt-4
                     border-2 border-gray-200 active:scale-[.97] transition disabled:opacity-50"
        >
          제 기록이 아니에요 · 처음이에요
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white flex flex-col px-6 pt-12 pb-8">
      {/* 진행 바 */}
      <div className="flex gap-1 mb-8">
        {steps.map((_, i) => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-colors
            ${i <= step ? 'bg-[#C60C30]' : 'bg-gray-100'}`} />
        ))}
      </div>

      {/* 복귀 유저 복원 배너 */}
      {phoneRecord && current === 'name' && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-2xl flex gap-3 fade-up">
          <ShieldCheck size={22} className="text-blue-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-blue-800 text-sm">이전 기록이 복원됩니다</p>
            <p className="text-blue-600 text-xs mt-0.5">
              최고 급수 <strong>{phoneRecord.peak_grade}</strong> · MMR <strong>{phoneRecord.current_mmr}</strong>
              이 자동으로 적용됩니다.<br/>
              낮은 급수 출전은 허용되지 않습니다.
            </p>
          </div>
        </div>
      )}

      {/* ── 이름 ───────────────────────────────────────────── */}
      {current === 'name' && (
        <div className="flex-1 fade-up">
          <h2 className="text-2xl font-black mb-2">
            {phoneRecord ? '다시 오셨군요! 👋' : '반갑습니다! 👋'}
          </h2>
          <p className="text-gray-500 mb-8">배드민국에서 사용할 이름을 알려주세요.</p>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && name.trim() && goNext()}
            placeholder="홍길동"
            className="w-full border-b-2 border-gray-200 focus:border-[#C60C30] outline-none
                       text-2xl font-bold pb-2 transition-colors"
          />
          <p className="text-xs text-gray-400 mt-2">실명 또는 닉네임 모두 가능합니다.</p>
        </div>
      )}

      {/* ── 선수부 출신 ────────────────────────────────────── */}
      {current === 'elite' && (
        <div className="flex-1 fade-up overflow-y-auto">
          <h2 className="text-2xl font-black mb-1">선수부 출신이신가요?</h2>
          <p className="text-gray-500 mb-5 text-sm">
            초·중·고·대·실업 선수 경험이 있으면 실력을 <strong>높게</strong> 잡아드려요.<br/>
            아니어도 괜찮아요. 경기를 하면 자동으로 맞춰집니다.
          </p>
          <div className="space-y-2">
            {ELITE_OPTS.map(o => (
              <button
                key={o.key}
                onClick={() => setElite(o.key)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 transition text-left
                            ${elite === o.key ? 'border-[#C60C30] bg-red-50' : 'border-gray-100 bg-white'}`}
              >
                <span className="text-xl">{o.emoji}</span>
                <p className="flex-1 font-bold">{o.label}</p>
                {elite === o.key && <Check size={18} className="text-[#C60C30]" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── 구력 ───────────────────────────────────────────── */}
      {current === 'career' && (
        <div className="flex-1 fade-up overflow-y-auto">
          <h2 className="text-2xl font-black mb-1">배드민턴 친 지 얼마나 됐어요?</h2>
          <p className="text-gray-500 mb-5 text-sm">레슨·구력 기준으로 편하게 골라주세요.</p>
          <div className="space-y-2">
            {CAREER_OPTS.map(o => (
              <button
                key={o.key}
                onClick={() => setCareer(o.key)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 transition text-left
                            ${career === o.key ? 'border-[#C60C30] bg-red-50' : 'border-gray-100 bg-white'}`}
              >
                <span className="text-xl">{o.emoji}</span>
                <p className="flex-1 font-bold">{o.label}</p>
                {career === o.key && <Check size={18} className="text-[#C60C30]" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── 주 운동 횟수 ───────────────────────────────────── */}
      {current === 'sessions' && (
        <div className="flex-1 fade-up">
          <h2 className="text-2xl font-black mb-1">일주일에 몇 번 정도 치세요?</h2>
          <p className="text-gray-500 mb-5 text-sm">자주 칠수록 실력을 조금 더 높게 잡아드려요. (선택)</p>
          <div className="space-y-2">
            {SESSION_OPTS.map(o => (
              <button
                key={o.key}
                onClick={() => setSessions(o.key)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 transition text-left
                            ${sessions === o.key ? 'border-[#C60C30] bg-red-50' : 'border-gray-100 bg-white'}`}
              >
                <p className="flex-1 font-bold">{o.label}</p>
                {sessions === o.key && <Check size={18} className="text-[#C60C30]" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── 급수(신규=선택 설문 / 복귀=peak 잠금) ─────────────── */}
      {current === 'grade' && gradeIsLocked && (
        <div className="flex-1 fade-up overflow-y-auto">
          <h2 className="text-2xl font-black mb-1">내 급수는?</h2>
          <p className="text-sm text-blue-600 font-medium mb-4">
            ⚠️ 이전 최고 급수 이상만 선택 가능합니다 (하위급수 출전 방지)
          </p>
          <div className="space-y-2">
            {lockedGradeList.map(g => (
              <button
                key={g.key}
                onClick={() => setSelfGrade(g.key)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 transition
                            ${selfGrade === g.key ? 'border-[#C60C30] bg-red-50' : 'border-gray-100 bg-white'}`}
              >
                <span className="text-xl">{g.flair}</span>
                <div className="flex-1 text-left">
                  <p className="font-bold">{g.label}</p>
                  <p className="text-xs text-gray-400">초기 MMR: {g.initialMMR}</p>
                </div>
                {g.key === phoneRecord?.peak_grade && (
                  <span className="text-xs text-blue-600 font-semibold bg-blue-50 px-2 py-0.5 rounded-full">
                    이전 최고
                  </span>
                )}
                {selfGrade === g.key && <Check size={18} className="text-[#C60C30]" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {current === 'grade' && !gradeIsLocked && (
        <div className="flex-1 fade-up overflow-y-auto">
          <h2 className="text-2xl font-black mb-1">혹시 급수가 있으신가요? <span className="text-gray-400 text-lg">(선택)</span></h2>
          <p className="text-gray-500 mb-5 text-sm">
            없으면 <strong>건너뛰어도</strong> 돼요. 경기를 하면 실력이 자동으로 맞춰집니다.
          </p>

          {/* 급수 없음 토글 */}
          <button
            onClick={() => { setSelfGrade(''); setRecentGrade(''); setRecentResult('') }}
            className={`w-full mb-2 px-4 py-3 rounded-2xl border-2 font-bold transition text-left
                        ${selfGrade === '' ? 'border-[#003478] bg-blue-50 text-[#003478]' : 'border-gray-100 bg-white text-gray-500'}`}
          >
            급수 없음 · 잘 모르겠어요
          </button>

          <div className="grid grid-cols-4 gap-2 mb-4">
            {GRADES.map(g => (
              <button
                key={g.key}
                onClick={() => setSelfGrade(g.key)}
                className={`flex flex-col items-center gap-0.5 py-2.5 rounded-xl border-2 transition
                            ${selfGrade === g.key ? 'border-[#C60C30] bg-red-50' : 'border-gray-100 bg-white'}`}
              >
                <span className="text-lg">{g.flair}</span>
                <span className="text-xs font-bold">{g.label}</span>
              </button>
            ))}
          </div>

          {selfGrade && (
            <div className="fade-up space-y-5">
              {/* 어디서 받은 급수(단위) */}
              <div>
                <p className="text-sm font-bold mb-2">어디서 받은 급수예요?</p>
                <div className="flex gap-2">
                  {UNIT_OPTS.map(u => (
                    <button
                      key={u.key}
                      onClick={() => setGradeUnit(u.key)}
                      className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-bold transition
                                  ${gradeUnit === u.key ? 'border-[#C60C30] bg-red-50' : 'border-gray-100 bg-white text-gray-600'}`}
                    >
                      {u.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 최근 대회 성적(입상이력 역추정 → 샌드배깅 교차검증) */}
              <div>
                <p className="text-sm font-bold mb-1">최근 나간 대회에서 어느 조로 쳤나요? <span className="text-gray-400 font-normal">(선택)</span></p>
                <div className="grid grid-cols-4 gap-2 mb-2">
                  {GRADES.map(g => (
                    <button
                      key={g.key}
                      onClick={() => setRecentGrade(recentGrade === g.key ? '' : g.key)}
                      className={`py-2 rounded-xl border-2 text-xs font-bold transition
                                  ${recentGrade === g.key ? 'border-[#003478] bg-blue-50' : 'border-gray-100 bg-white'}`}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
                {recentGrade && (
                  <div className="flex gap-2 fade-up">
                    {RESULT_OPTS.map(r => (
                      <button
                        key={r.key}
                        onClick={() => setRecentResult(r.key)}
                        className={`flex-1 py-2 rounded-xl border-2 text-xs font-bold transition
                                    ${recentResult === r.key ? 'border-[#003478] bg-blue-50' : 'border-gray-100 bg-white text-gray-600'}`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 증빙 캡처(선택 + 보상형) */}
              <div className="p-4 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50">
                <div className="flex items-start gap-2 mb-2">
                  <Sparkles size={18} className="text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-sm font-bold text-gray-700">
                    급수 캡처를 올리면 <span className="text-amber-600">‘신뢰도 ↑’ 뱃지</span>를 받아요 <span className="text-gray-400 font-normal">(선택)</span>
                  </p>
                </div>
                {proofUrl && (
                  <img src={proofUrl} alt="증빙" className="w-full max-h-40 object-contain rounded-xl mb-2 border border-gray-200" />
                )}
                <label className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white border-2 border-gray-200
                                  text-sm font-bold text-gray-600 cursor-pointer active:scale-[.98] transition">
                  <Camera size={16} />
                  {uploading ? '업로드 중...' : proofUrl ? '다시 올리기' : '캡처 이미지 올리기'}
                  <input type="file" accept="image/*" className="hidden" onChange={uploadProof} disabled={uploading} />
                </label>
                <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
                  ⚠️ 남의 이름·전화번호가 보이면 <strong>가리고</strong> 올려주세요. 본인 화면만 올리는 게 안전해요.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 소속 클럽 ──────────────────────────────────────── */}
      {current === 'club' && (
        <div className="flex-1 fade-up">
          <h2 className="text-2xl font-black mb-1">소속 클럽이 있나요? <span className="text-gray-400 text-lg">(선택)</span></h2>
          <p className="text-gray-500 mb-6 text-sm">
            같은 클럽 회원을 찾고, 실력 확인에도 도움이 돼요. 없으면 비워두세요.
          </p>
          <input
            value={club}
            onChange={e => setClub(e.target.value)}
            placeholder="예) 한빛 배드민턴클럽"
            className="w-full border-b-2 border-gray-200 focus:border-[#C60C30] outline-none
                       text-xl font-bold pb-2 transition-colors"
          />
        </div>
      )}

      {/* ── 종목 ───────────────────────────────────────────── */}
      {current === 'sports' && (
        <div className="flex-1 fade-up">
          <h2 className="text-2xl font-black mb-2">주로 치는 종목은?</h2>
          <p className="text-gray-500 mb-6">여러 개 선택 가능합니다.</p>
          <div className="flex flex-col gap-3">
            {[
              { key: '남복', emoji: '👬', desc: '남자 복식' },
              { key: '여복', emoji: '👭', desc: '여자 복식' },
              { key: '혼복', emoji: '👫', desc: '혼합 복식' },
            ].map(s => (
              <button
                key={s.key}
                onClick={() => toggleSport(s.key)}
                className={`flex items-center gap-4 px-5 py-4 rounded-2xl border-2 transition text-left
                            ${sports.includes(s.key) ? 'border-[#C60C30] bg-red-50' : 'border-gray-100 bg-white'}`}
              >
                <span className="text-2xl">{s.emoji}</span>
                <div>
                  <p className="text-base font-bold">{s.key}</p>
                  <p className="text-xs text-gray-400">{s.desc}</p>
                </div>
              </button>
            ))}
          </div>
          {error && <p className="text-red-500 text-sm mt-4">{error}</p>}
        </div>
      )}

      {error && current !== 'sports' && <p className="text-red-500 text-sm mt-4">{error}</p>}

      <button
        onClick={goNext}
        disabled={!canNext || claimSearching}
        className="w-full py-4 rounded-2xl font-bold text-white text-lg mt-6
                   transition active:scale-[.97] disabled:opacity-40 flex items-center justify-center gap-2"
        style={{ background: 'linear-gradient(135deg, #C60C30, #003478)' }}
      >
        {current === 'sports'
          ? (saving ? '저장 중...' : '배드민국 시작하기 🏸')
          : current === 'name' && claimSearching
          ? <><Search size={18} /><span>지난 기록 찾는 중...</span></>
          : <><span>다음</span><ChevronRight size={20} /></>
        }
      </button>
    </div>
  )
}

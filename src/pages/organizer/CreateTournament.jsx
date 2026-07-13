import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { GRADES, SPORT_TYPES, UNITS } from '../../lib/grades'
import { TIEBREAKER_PRESETS } from '../../lib/tournament'
import TopBar from '../../components/TopBar'
import { Plus, Trash2, Info, ChevronDown, ChevronUp, Settings, Sparkles, FileText, Clock } from 'lucide-react'
import {
  recommendSetup, estimateSchedule, estimateTournament,
  formatKoreanTime, formatDuration, printGuidelines,
} from '../../lib/planWizard'

const DEFAULT_CAT = {
  sport_type: '남복',
  allowed_grades: [],   // 참가 가능 조 화이트리스트(빈 배열=제한 없음). grade_min/max는 레거시 폴백.
  min_mmr: '',
  max_mmr: '',
  max_teams: 16,
  entry_fee: 0,
  // 대진 방식
  tournament_format: 'pool_knockout',
  pool_size: 4,
  advancement_per_pool: 2,
  wildcard_count: 0,
  wildcard_criteria: 'score_diff',
  tiebreaker_order: ['h2h', 'game_diff', 'point_diff', 'points_for'],
  games_per_match: 3,
  points_per_game: 21,
  prize_spots: 3,
  min_teams: 4,
  seeding_enabled: false,
}

const FORMAT_OPTIONS = [
  { key: 'pool_knockout', label: '조별+토너먼트', sub: '풀리그 후 토너먼트' },
  { key: 'round_robin',   label: '리그전',        sub: '모두와 한 번씩' },
  { key: 'single_elim',  label: '토너먼트',       sub: '단판 제거전' },
  { key: 'pool_only',    label: '조별리그만',     sub: '조 1위팀 우승' },
]

const GAMES_OPTIONS = [
  { value: 1, label: '단판', sub: '빠른 진행' },
  { value: 3, label: '3판2선승', sub: '공정한 결과' },
]

const POINTS_OPTIONS = [
  { value: 21, label: '21점제', sub: '표준' },
  { value: 15, label: '15점제', sub: '빠른' },
  { value: 11, label: '11점제', sub: '초빠른' },
]

const PRIZE_OPTIONS = [
  { value: 1, label: '우승만', sub: '1팀' },
  { value: 3, label: '3위까지', sub: '3팀' },
  { value: 4, label: '4강', sub: '4팀' },
]

function formatSummary(cat) {
  const fmt = FORMAT_OPTIONS.find(f => f.key === cat.tournament_format)?.label ?? '조별+토너먼트'
  const pool = (cat.tournament_format === 'pool_knockout' || cat.tournament_format === 'pool_only')
    ? ` · ${cat.pool_size}팀조` : ''
  const games = cat.games_per_match === 1 ? ' · 단판' : ' · 3판2선승'
  return `${fmt}${pool}${games}`
}

function Stepper({ value, min, max, step = 1, onChange, format }) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onChange(Math.max(min, value - step))}
        className="w-7 h-7 rounded-full bg-gray-100 font-bold flex items-center justify-center text-base leading-none select-none"
      >−</button>
      <span className="text-sm font-bold min-w-[64px] text-center">{format ? format(value) : value}</span>
      <button
        onClick={() => onChange(Math.min(max, value + step))}
        className="w-7 h-7 rounded-full bg-gray-100 font-bold flex items-center justify-center text-base leading-none select-none"
      >+</button>
    </div>
  )
}

// AI 대회 설계 도우미 — 예상 팀 수(정원)로 대진 방식 추천 + 경기 수·예상 종료 역산
function WizardCard({ cat, idx, form, applyCat }) {
  const teams = Number(cat.max_teams) || 0
  const rec = recommendSetup(teams)
  const startISO = form.start_time ? `${form.date || '2000-01-01'}T${form.start_time}` : null
  const est = estimateSchedule({
    cat, teams,
    courtCount: form.court_count,
    startTime: startISO,
  })

  // 현재 설정이 추천과 다른가?
  const isPool = cat.tournament_format === 'pool_knockout' || cat.tournament_format === 'pool_only'
  const differs = rec && (
    rec.tournament_format !== cat.tournament_format ||
    (rec.pool_size && isPool && rec.pool_size !== cat.pool_size)
  )

  function apply() {
    if (!rec) return
    const patch = { tournament_format: rec.tournament_format }
    if (rec.pool_size) { patch.pool_size = rec.pool_size; patch.advancement_per_pool = rec.advancement_per_pool }
    applyCat(idx, patch)
  }

  if (teams < 2) return null

  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 space-y-2.5">
      <div className="flex items-center gap-1.5 text-[#003478]">
        <Sparkles size={14} />
        <span className="text-xs font-bold">AI 대회 설계 도우미</span>
        <span className="text-[11px] text-gray-400 ml-auto">정원 {teams}팀 기준</span>
      </div>

      {differs && (
        <div className="bg-white rounded-lg p-2.5 border border-blue-100">
          <p className="text-xs font-bold text-gray-800">{rec.headline}</p>
          <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">{rec.reason}</p>
          <button
            onClick={apply}
            className="mt-2 w-full py-1.5 rounded-lg bg-[#003478] text-white text-xs font-bold active:opacity-80"
          >이 추천 적용</button>
        </div>
      )}

      <div className="flex items-start gap-2 text-[11px] text-gray-600 leading-relaxed">
        <Clock size={13} className="text-blue-500 shrink-0 mt-0.5" />
        <p>
          예상 <b className="text-gray-800">{est.total}경기</b>
          {est.pools.length > 1 && ` · ${est.pools.length}개 조`}
          {' · '}소요 <b className="text-gray-800">{formatDuration(est.totalMinutes)}</b>
          {est.endTime && <> · 코트 {est.courts}면이면 <b className="text-[#C60C30]">{formatKoreanTime(est.endTime)}쯤 종료</b></>}
          {!form.start_time && ' · 시작 시간을 정하면 종료 시각도 계산돼요'}
        </p>
      </div>
    </div>
  )
}

function FormatSection({ cat, idx, updateCat, form, applyCat }) {
  const showPool = cat.tournament_format === 'pool_knockout' || cat.tournament_format === 'pool_only'

  return (
    <div className="space-y-4 pt-1">
      {/* AI 설계 도우미 */}
      <WizardCard cat={cat} idx={idx} form={form} applyCat={applyCat} />

      {/* A: 대진 방식 */}
      <div>
        <p className="text-xs font-semibold text-gray-500 mb-2">대진 방식</p>
        <div className="grid grid-cols-2 gap-2">
          {FORMAT_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => updateCat(idx, 'tournament_format', opt.key)}
              className={`py-2.5 px-3 rounded-xl border-2 text-left transition
                ${cat.tournament_format === opt.key
                  ? 'border-[#C60C30] bg-red-50'
                  : 'border-gray-100 bg-gray-50'}`}
            >
              <p className={`text-sm font-bold ${cat.tournament_format === opt.key ? 'text-[#C60C30]' : 'text-gray-700'}`}>
                {opt.label}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">{opt.sub}</p>
            </button>
          ))}
        </div>
      </div>

      {/* B: 조 설정 (pool_knockout / pool_only만) */}
      {showPool && (
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-2">조 설정</p>
          <div className="bg-gray-50 rounded-xl divide-y divide-gray-100">
            <div className="flex items-center justify-between px-3 py-2.5">
              <span className="text-sm text-gray-600">조 크기</span>
              <Stepper
                value={cat.pool_size}
                min={4} max={8}
                onChange={v => updateCat(idx, 'pool_size', v)}
                format={v => `${v}팀/조`}
              />
            </div>
            <div className="flex items-center justify-between px-3 py-2.5">
              <span className="text-sm text-gray-600">조별 진출</span>
              <Stepper
                value={cat.advancement_per_pool}
                min={1} max={3}
                onChange={v => updateCat(idx, 'advancement_per_pool', v)}
                format={v => `${v}팀/조 진출`}
              />
            </div>
            {cat.tournament_format === 'pool_knockout' && (
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-sm text-gray-600">와일드카드</span>
                <Stepper
                  value={cat.wildcard_count}
                  min={0} max={4}
                  onChange={v => updateCat(idx, 'wildcard_count', v)}
                  format={v => v === 0 ? '없음' : `와일드카드 ${v}장`}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* B-2: 동률 처리 기준 (조가 있는 포맷만) */}
      {showPool && (
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-2">동점(동률)일 때 순위 기준</p>
          <div className="space-y-2">
            {TIEBREAKER_PRESETS.map(opt => {
              const selected = JSON.stringify(cat.tiebreaker_order) === JSON.stringify(opt.order)
              return (
                <button
                  key={opt.key}
                  onClick={() => updateCat(idx, 'tiebreaker_order', opt.order)}
                  className={`w-full py-2.5 px-3 rounded-xl border-2 text-left transition
                    ${selected ? 'border-[#C60C30] bg-red-50' : 'border-gray-100 bg-gray-50'}`}
                >
                  <p className={`text-sm font-bold ${selected ? 'text-[#C60C30]' : 'text-gray-700'}`}>
                    {opt.label}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{opt.sub}</p>
                </button>
              )
            })}
          </div>
          <p className="text-[11px] text-gray-400 mt-1.5 px-1">
            승수가 같은 팀의 순위를 어떤 기준으로 가를지 정합니다. 승자승은 두 팀이 동률일 때만 적용됩니다.
          </p>
        </div>
      )}

      {/* C: 경기 방식 */}
      <div>
        <p className="text-xs font-semibold text-gray-500 mb-2">경기 방식</p>
        <div className="grid grid-cols-2 gap-2">
          {GAMES_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => updateCat(idx, 'games_per_match', opt.value)}
              className={`py-2.5 px-3 rounded-xl border-2 text-left transition
                ${cat.games_per_match === opt.value
                  ? 'border-[#C60C30] bg-red-50'
                  : 'border-gray-100 bg-gray-50'}`}
            >
              <p className={`text-sm font-bold ${cat.games_per_match === opt.value ? 'text-[#C60C30]' : 'text-gray-700'}`}>
                {opt.label}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">{opt.sub}</p>
            </button>
          ))}
        </div>
      </div>

      {/* D: 점수 방식 */}
      <div>
        <p className="text-xs font-semibold text-gray-500 mb-2">점수 방식</p>
        <div className="grid grid-cols-3 gap-2">
          {POINTS_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => updateCat(idx, 'points_per_game', opt.value)}
              className={`py-2.5 px-2 rounded-xl border-2 text-center transition
                ${cat.points_per_game === opt.value
                  ? 'border-[#C60C30] bg-red-50'
                  : 'border-gray-100 bg-gray-50'}`}
            >
              <p className={`text-sm font-bold ${cat.points_per_game === opt.value ? 'text-[#C60C30]' : 'text-gray-700'}`}>
                {opt.label}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">{opt.sub}</p>
            </button>
          ))}
        </div>
      </div>

      {/* E: 입상 */}
      <div>
        <p className="text-xs font-semibold text-gray-500 mb-2">입상</p>
        <div className="grid grid-cols-3 gap-2">
          {PRIZE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => updateCat(idx, 'prize_spots', opt.value)}
              className={`py-2.5 px-2 rounded-xl border-2 text-center transition
                ${cat.prize_spots === opt.value
                  ? 'border-[#C60C30] bg-red-50'
                  : 'border-gray-100 bg-gray-50'}`}
            >
              <p className={`text-sm font-bold ${cat.prize_spots === opt.value ? 'text-[#C60C30]' : 'text-gray-700'}`}>
                {opt.label}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">{opt.sub}</p>
            </button>
          ))}
        </div>
      </div>

      {/* F: 최소 팀 수 + G: 시드 배정 */}
      <div className="bg-gray-50 rounded-xl divide-y divide-gray-100">
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="text-sm text-gray-600">최소 팀 수</span>
          <Stepper
            value={cat.min_teams}
            min={4} max={32} step={2}
            onChange={v => updateCat(idx, 'min_teams', v)}
            format={v => `${v}팀 이상`}
          />
        </div>

        <div className="flex items-center justify-between px-3 py-2.5">
          <div>
            <span className="text-sm text-gray-600">시드 배정</span>
            <p className="text-xs text-gray-400 mt-0.5">상위 MMR 선수를 다른 조에 배치</p>
          </div>
          <button
            onClick={() => updateCat(idx, 'seeding_enabled', !cat.seeding_enabled)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors
              ${cat.seeding_enabled ? 'bg-[#C60C30]' : 'bg-gray-200'}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform
                ${cat.seeding_enabled ? 'translate-x-6' : 'translate-x-1'}`}
            />
          </button>
        </div>
      </div>
    </div>
  )
}

export default function CreateTournament() {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    title: '',
    venue: '',
    venue_address: '',
    date: '',
    start_time: '09:00',
    court_count: 4,
    registration_end: '',
    description: '',
    unit: 'gu',   // 대회 단위(구/시/전국). 저장 시 DB 트리거가 cert_level·K를 자동 세팅.
    bank_name: '',    // 무통장 입금 은행명 (선택·018)
    bank_account: '', // 무통장 입금 계좌번호 (선택·018)
    bank_holder: '',  // 무통장 입금 예금주 (선택·018)
  })
  const [categories, setCategories] = useState([{ ...DEFAULT_CAT }])
  const [expandedCats, setExpandedCats] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  function update(k, v) { setForm(prev => ({ ...prev, [k]: v })) }
  function updateCat(i, k, v) {
    setCategories(prev => prev.map((c, idx) => idx === i ? { ...c, [k]: v } : c))
  }
  function applyCat(i, patch) {
    setCategories(prev => prev.map((c, idx) => idx === i ? { ...c, ...patch } : c))
  }
  function addCat()      { setCategories(prev => [...prev, { ...DEFAULT_CAT }]) }
  function removeCat(i)  { setCategories(prev => prev.filter((_, idx) => idx !== i)) }
  function toggleExpand(i) {
    setExpandedCats(prev => ({ ...prev, [i]: !prev[i] }))
  }

  async function submit() {
    if (!form.title || !form.venue || !form.date) {
      setError('대회명, 장소, 날짜는 필수입니다.'); return
    }
    setSaving(true); setError('')
    const { data: { session } } = await supabase.auth.getSession(); const user = session?.user ?? null

    // 무통장 입금 계좌(018)는 컬럼 미적용 시 insert 를 깨뜨리지 않도록 분리 —
    // 기본 대회는 항상 생성되고, 계좌는 적용 시 별도 UPDATE 로 채운다(degrade-safe).
    const { bank_name, bank_account, bank_holder, ...baseForm } = form
    const { data: t, error: te } = await supabase
      .from('tournaments')
      .insert({ ...baseForm, organizer_id: user?.id ?? null, status: 'draft' })
      .select().single()

    if (te) { setError(te.message); setSaving(false); return }

    // 계좌 입력이 있으면 best-effort 저장 — 018 미적용이면 조용히 생략(대회는 이미 생성됨).
    if (bank_name || bank_account || bank_holder) {
      try {
        const { error: be } = await supabase
          .from('tournaments')
          .update({ bank_name, bank_account, bank_holder })
          .eq('id', t.id)
        if (be) throw be
      } catch (err) {
        if (import.meta.env.DEV) console.warn('[create] 입금 계좌 저장 생략(018 미적용?):', err.message)
      }
    }

    await supabase.from('tournament_categories').insert(
      categories.map(c => ({
        ...c,
        tournament_id: t.id,
        min_mmr: c.min_mmr ? Number(c.min_mmr) : null,
        max_mmr: c.max_mmr ? Number(c.max_mmr) : null,
      }))
    )

    navigate(`/organizer/${t.id}`, { replace: true })
  }

  return (
    <div className="safe-bottom">
      <TopBar
        title="대회 만들기"
        right={
          <button
            onClick={submit}
            disabled={saving}
            className="bg-[#C60C30] text-white text-sm font-bold px-3 py-1.5 rounded-lg
                       active:opacity-80 disabled:opacity-50"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        }
      />

      <div className="px-4 py-5 space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-sm">
            {error}
          </div>
        )}

        {/* 기본 정보 */}
        <section>
          <h2 className="font-bold mb-3 text-gray-700">기본 정보</h2>
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            {[
              { key: 'title',         label: '대회명',    placeholder: '예) 2026 여름 배드민턴 대회' },
              { key: 'venue',         label: '경기 장소', placeholder: '예) 강남 배드민턴 센터' },
              { key: 'venue_address', label: '상세 주소', placeholder: '선택사항' },
            ].map(({ key, label, placeholder }, i) => (
              <div key={key} className={`px-4 py-3 ${i > 0 ? 'border-t border-gray-50' : ''}`}>
                <label className="text-xs text-gray-400 font-semibold">{label}</label>
                <input
                  value={form[key]}
                  onChange={e => update(key, e.target.value)}
                  placeholder={placeholder}
                  className="w-full text-sm mt-0.5 outline-none"
                />
              </div>
            ))}
            <div className="px-4 py-3 border-t border-gray-50">
              <label className="text-xs text-gray-400 font-semibold">대회 설명</label>
              <textarea
                value={form.description}
                onChange={e => update('description', e.target.value)}
                placeholder="대회 규정, 상품, 주의사항 등"
                rows={3}
                className="w-full text-sm mt-0.5 outline-none resize-none"
              />
            </div>
          </div>
        </section>

        {/* 무통장 입금 계좌 (선택·018) — 입력하면 선수 "입금 안내"에 계좌가 자동 표시 */}
        <section>
          <h2 className="font-bold mb-1 text-gray-700">입금 계좌 <span className="text-xs font-normal text-gray-400">(선택)</span></h2>
          <p className="text-xs text-gray-400 mb-3 leading-relaxed">
            참가비가 있는 대회라면 입금받을 계좌를 적어 두세요. 선수 "입금 안내" 화면에
            계좌번호가 <strong>복사 버튼과 함께</strong> 자동으로 떠, 단톡방으로 따로 물어볼
            필요가 없어요. (카드·간편결제는 준비 중이에요.)
          </p>
          <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50">
            <div className="flex px-4 py-3 gap-3">
              <div className="w-28 shrink-0">
                <label className="text-xs text-gray-400 font-semibold">은행</label>
                <input
                  value={form.bank_name}
                  onChange={e => update('bank_name', e.target.value)}
                  placeholder="예) 국민"
                  className="w-full text-sm mt-0.5 outline-none"
                />
              </div>
              <div className="flex-1 min-w-0">
                <label className="text-xs text-gray-400 font-semibold">계좌번호</label>
                <input
                  value={form.bank_account}
                  onChange={e => update('bank_account', e.target.value)}
                  placeholder="예) 123456-01-234567"
                  inputMode="numeric"
                  className="w-full text-sm mt-0.5 outline-none"
                />
              </div>
            </div>
            <div className="px-4 py-3">
              <label className="text-xs text-gray-400 font-semibold">예금주</label>
              <input
                value={form.bank_holder}
                onChange={e => update('bank_holder', e.target.value)}
                placeholder="예) 홍길동"
                className="w-full text-sm mt-0.5 outline-none"
              />
            </div>
          </div>
        </section>

        {/* 대회 단위 (구/시/전국) — 저장 시 DB 트리거가 cert_level·K를 자동 세팅 */}
        <section>
          <h2 className="font-bold mb-3 text-gray-700">대회 단위</h2>
          <div className="grid grid-cols-3 gap-2">
            {UNITS.map(u => (
              <button
                key={u.key}
                onClick={() => update('unit', u.key)}
                className={`py-3 rounded-xl border-2 text-center transition
                  ${form.unit === u.key ? 'border-[#C60C30] bg-red-50' : 'border-gray-100 bg-gray-50'}`}
              >
                <p className={`text-sm font-bold ${form.unit === u.key ? 'text-[#C60C30]' : 'text-gray-700'}`}>
                  {u.label} 대회
                </p>
                <p className="text-xs text-gray-400 mt-0.5">순위 변동 {u.impact}</p>
              </button>
            ))}
          </div>
          <div className="flex items-start gap-2.5 bg-blue-50 rounded-2xl px-4 py-3.5 mt-3">
            <Info size={18} className="text-blue-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-blue-800">모든 대회 결과는 전국 랭킹(MMR)에 반영됩니다</p>
              <p className="text-xs text-blue-600 mt-1 leading-relaxed">
                단위가 클수록 순위 변동과 급수 승급 폭이 커져요 (구 &lt; 시 &lt; 전국). 승급은 선택한 단위의 급수에 반영됩니다.
              </p>
            </div>
          </div>
        </section>

        {/* 일정 */}
        <section>
          <h2 className="font-bold mb-3 text-gray-700">일정</h2>
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            {[
              { key: 'date',             label: '대회 날짜', type: 'date' },
              { key: 'start_time',       label: '시작 시간', type: 'time' },
              { key: 'registration_end', label: '접수 마감', type: 'datetime-local' },
            ].map(({ key, label, type }, i) => (
              <div key={key} className={`px-4 py-3 flex items-center justify-between ${i > 0 ? 'border-t border-gray-50' : ''}`}>
                <label className="text-sm text-gray-600">{label}</label>
                <input
                  type={type}
                  value={form[key]}
                  onChange={e => update(key, e.target.value)}
                  className="text-sm outline-none text-right"
                />
              </div>
            ))}
            <div className="px-4 py-3 border-t border-gray-50 flex items-center justify-between">
              <label className="text-sm text-gray-600">코트 수</label>
              <div className="flex items-center gap-3">
                <button onClick={() => update('court_count', Math.max(1, form.court_count - 1))}
                  className="w-7 h-7 rounded-full bg-gray-100 font-bold text-lg flex items-center justify-center">−</button>
                <span className="font-bold w-4 text-center">{form.court_count}</span>
                <button onClick={() => update('court_count', form.court_count + 1)}
                  className="w-7 h-7 rounded-full bg-gray-100 font-bold text-lg flex items-center justify-center">+</button>
              </div>
            </div>
          </div>
        </section>

        {/* 종목 설정 */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-700">참가 종목</h2>
            <button onClick={addCat} className="flex items-center gap-1 text-sm text-[#C60C30] font-semibold">
              <Plus size={15} /> 종목 추가
            </button>
          </div>

          <div className="space-y-3">
            {categories.map((cat, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-semibold text-sm">종목 {i + 1}</span>
                  {categories.length > 1 && (
                    <button onClick={() => removeCat(i)} className="text-red-400">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>

                {/* 종목 선택 */}
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {SPORT_TYPES.map(s => (
                    <button
                      key={s}
                      onClick={() => updateCat(i, 'sport_type', s)}
                      className={`py-2 rounded-xl text-sm font-semibold transition
                                  ${cat.sport_type === s ? 'bg-[#C60C30] text-white' : 'bg-gray-100 text-gray-600'}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>

                <div className="space-y-2.5">
                  {/* 참가 가능 급수 (allowed_grades 화이트리스트) */}
                  <div>
                    <label className="text-xs text-gray-500 block mb-1.5">참가 가능 급수</label>
                    <div className="flex flex-wrap gap-1.5">
                      {GRADES.map(g => {
                        const on = (cat.allowed_grades ?? []).includes(g.key)
                        return (
                          <button
                            key={g.key}
                            onClick={() => {
                              const cur = cat.allowed_grades ?? []
                              updateCat(i, 'allowed_grades',
                                on ? cur.filter(k => k !== g.key) : [...cur, g.key])
                            }}
                            className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition
                              ${on
                                ? 'bg-[#C60C30] text-white border-[#C60C30]'
                                : 'bg-gray-50 text-gray-500 border-gray-200'}`}
                          >
                            {g.label}
                          </button>
                        )
                      })}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">
                      선택 안 하면 급수 제한 없음. {UNITS.find(u => u.key === form.unit)?.label} 대회의 해당 급수 트랙만 대조돼요.
                    </p>
                  </div>

                  {/* MMR 범위 (선택) */}
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-500 w-16 shrink-0">MMR 하한</label>
                    <input
                      type="number"
                      placeholder="없음"
                      value={cat.min_mmr}
                      onChange={e => updateCat(i, 'min_mmr', e.target.value)}
                      className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-1.5 outline-none"
                    />
                    <label className="text-xs text-gray-500 w-16 shrink-0">MMR 상한</label>
                    <input
                      type="number"
                      placeholder="없음"
                      value={cat.max_mmr}
                      onChange={e => updateCat(i, 'max_mmr', e.target.value)}
                      className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-1.5 outline-none"
                    />
                  </div>

                  {/* 최대 팀 / 참가비 */}
                  <div className="flex items-center gap-3">
                    <label className="text-xs text-gray-500 shrink-0">최대 팀</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={2}
                      value={cat.max_teams}
                      onChange={e => updateCat(i, 'max_teams', Number(e.target.value))}
                      className="text-sm border border-gray-200 rounded-lg px-2 py-1 w-20 outline-none text-right"
                    />
                    <label className="text-xs text-gray-500 ml-auto shrink-0">참가비</label>
                    <input
                      type="number"
                      value={cat.entry_fee}
                      onChange={e => updateCat(i, 'entry_fee', Number(e.target.value))}
                      className="text-sm border border-gray-200 rounded-lg px-2 py-1 w-20 outline-none text-right"
                    />
                    <span className="text-xs text-gray-400">원</span>
                  </div>
                </div>

                {/* 대진 방식 설정 (expandable) */}
                <div className="mt-4 border-t border-gray-100 pt-3">
                  <button
                    onClick={() => toggleExpand(i)}
                    className="w-full flex items-center justify-between group"
                  >
                    <div className="flex items-center gap-1.5 text-gray-500">
                      <Settings size={13} />
                      <span className="text-xs font-semibold">대진 방식 설정</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {!expandedCats[i] && (
                        <span className="text-xs text-gray-400">{formatSummary(cat)}</span>
                      )}
                      {expandedCats[i]
                        ? <ChevronUp size={15} className="text-gray-400" />
                        : <ChevronDown size={15} className="text-gray-400" />
                      }
                    </div>
                  </button>

                  {expandedCats[i] && (
                    <div className="mt-3">
                      <FormatSection cat={cat} idx={i} updateCat={updateCat} form={form} applyCat={applyCat} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 예상 진행 & 요강 문서 (C8 마법사) */}
        <WizardSummary form={form} categories={categories} />
      </div>
    </div>
  )
}

// 전체 종목 합산 예상 진행 + 요강 문서 생성
function WizardSummary({ form, categories }) {
  const startISO = form.start_time ? `${form.date || '2000-01-01'}T${form.start_time}` : null
  const est = estimateTournament({
    categories,
    courtCount: form.court_count,
    startTime: startISO,
  })
  const estimatedEnd = est.endTime ? formatKoreanTime(est.endTime) : null
  const canDoc = form.title && form.date

  function makeDoc() {
    const ok = printGuidelines(form, categories, {
      estimatedEnd: estimatedEnd ? `${estimatedEnd}쯤 (예상)` : null,
      organizerName: '배드민국',
    })
    if (!ok) alert('팝업이 차단되어 요강을 열 수 없어요. 팝업 허용 후 다시 시도해 주세요.')
  }

  return (
    <section>
      <h2 className="font-bold mb-3 text-gray-700">예상 진행 · 요강</h2>
      <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-gray-50 rounded-xl px-3 py-2.5">
            <p className="text-[11px] text-gray-400 font-semibold">전체 예상 경기</p>
            <p className="text-lg font-extrabold text-gray-800">{est.totalMatches}<span className="text-xs font-bold text-gray-400 ml-0.5">경기</span></p>
          </div>
          <div className="bg-gray-50 rounded-xl px-3 py-2.5">
            <p className="text-[11px] text-gray-400 font-semibold">예상 소요</p>
            <p className="text-lg font-extrabold text-gray-800">{formatDuration(est.totalMinutes).replace('약 ', '')}</p>
          </div>
        </div>
        {estimatedEnd ? (
          <p className="text-xs text-gray-500 leading-relaxed">
            {form.start_time && `${formatKoreanTime(new Date(startISO))} 시작 · `}
            코트 {form.court_count}면 기준 <b className="text-[#C60C30]">{estimatedEnd}쯤 종료</b> 예상이에요.
            정원 기준 계산이라 실제 참가 팀 수에 따라 달라질 수 있어요.
          </p>
        ) : (
          <p className="text-xs text-gray-400">시작 시간을 정하면 예상 종료 시각을 계산해 드려요.</p>
        )}

        <button
          onClick={makeDoc}
          disabled={!canDoc}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border-2 border-[#003478] text-[#003478] text-sm font-bold active:opacity-80 disabled:opacity-40 disabled:border-gray-200 disabled:text-gray-400"
        >
          <FileText size={15} /> 요강 문서 만들기 (PDF)
        </button>
        {!canDoc && <p className="text-[11px] text-gray-400 text-center">대회명·날짜를 입력하면 요강을 만들 수 있어요.</p>}
      </div>
    </section>
  )
}

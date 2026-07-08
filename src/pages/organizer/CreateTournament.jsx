import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { GRADES, SPORT_TYPES } from '../../lib/grades'
import { CERT_LEVELS } from '../../lib/mmr'
import TopBar from '../../components/TopBar'
import { Plus, Trash2, Info, ChevronDown, ChevronUp, Settings } from 'lucide-react'

const DEFAULT_CAT = {
  sport_type: '남복',
  grade_min: '',
  grade_max: '',
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
  games_per_match: 3,
  points_per_game: 21,
  prize_spots: 3,
  min_teams: 4,
  seeding_enabled: false,
}

const CERT_OPTIONS = [
  { key: 'none', label: '비공인', icon: '🤝', desc: 'MMR 변동 없음 · 친선전' },
  { key: 'c',    label: '공인 C', icon: '⭐', desc: 'K=32 · 일반 동호회' },
  { key: 'b',    label: '공인 B', icon: '⭐⭐', desc: 'K=48 · 인증 주최자' },
  { key: 'a',    label: '공인 A', icon: '⭐⭐⭐', desc: 'K=64 · 협회 연계' },
]

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

function FormatSection({ cat, idx, updateCat }) {
  const showPool = cat.tournament_format === 'pool_knockout' || cat.tournament_format === 'pool_only'

  return (
    <div className="space-y-4 pt-1">
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
    cert_level: 'none',
  })
  const [categories, setCategories] = useState([{ ...DEFAULT_CAT }])
  const [expandedCats, setExpandedCats] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  function update(k, v) { setForm(prev => ({ ...prev, [k]: v })) }
  function updateCat(i, k, v) {
    setCategories(prev => prev.map((c, idx) => idx === i ? { ...c, [k]: v } : c))
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
    const { data: { user } } = await supabase.auth.getUser()

    const { data: t, error: te } = await supabase
      .from('tournaments')
      .insert({ ...form, organizer_id: user?.id ?? null, status: 'draft' })
      .select().single()

    if (te) { setError(te.message); setSaving(false); return }

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

        {/* 공인 등급 */}
        <section>
          <h2 className="font-bold mb-1 text-gray-700">공인 등급</h2>
          <p className="text-xs text-gray-400 mb-3">
            등급이 높을수록 MMR 변동 폭이 커집니다.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {CERT_OPTIONS.map(opt => (
              <button
                key={opt.key}
                onClick={() => update('cert_level', opt.key)}
                className={`p-3 rounded-2xl border-2 text-left transition
                            ${form.cert_level === opt.key
                              ? 'border-[#C60C30] bg-red-50'
                              : 'border-gray-100 bg-white'}`}
              >
                <p className="text-base mb-0.5">{opt.icon}</p>
                <p className="font-bold text-sm">{opt.label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{opt.desc}</p>
              </button>
            ))}
          </div>
          {form.cert_level !== 'none' && (
            <div className="mt-2 flex items-start gap-2 bg-blue-50 rounded-xl px-3 py-2">
              <Info size={14} className="text-blue-500 shrink-0 mt-0.5" />
              <p className="text-xs text-blue-700">
                공인 대회는 향후 배드민국에서 심사 후 승인됩니다. 현재는 테스트 목적으로 즉시 적용됩니다.
              </p>
            </div>
          )}
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
                  {/* 급수 제한 */}
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-500 w-16 shrink-0">급수 하한</label>
                    <select
                      value={cat.grade_min}
                      onChange={e => updateCat(i, 'grade_min', e.target.value)}
                      className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-1.5 outline-none"
                    >
                      <option value="">제한 없음</option>
                      {GRADES.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
                    </select>
                    <label className="text-xs text-gray-500 w-16 shrink-0">급수 상한</label>
                    <select
                      value={cat.grade_max}
                      onChange={e => updateCat(i, 'grade_max', e.target.value)}
                      className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-1.5 outline-none"
                    >
                      <option value="">제한 없음</option>
                      {GRADES.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
                    </select>
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
                    <div className="flex items-center gap-2">
                      <button onClick={() => updateCat(i, 'max_teams', Math.max(4, cat.max_teams - 4))}
                        className="w-6 h-6 rounded-full bg-gray-100 font-bold flex items-center justify-center text-sm">−</button>
                      <span className="text-sm font-bold w-6 text-center">{cat.max_teams}</span>
                      <button onClick={() => updateCat(i, 'max_teams', cat.max_teams + 4)}
                        className="w-6 h-6 rounded-full bg-gray-100 font-bold flex items-center justify-center text-sm">+</button>
                    </div>
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
                      <FormatSection cat={cat} idx={i} updateCat={updateCat} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

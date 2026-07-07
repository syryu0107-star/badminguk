import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { GRADES, SPORT_TYPES } from '../../lib/grades'
import { CERT_LEVELS } from '../../lib/mmr'
import TopBar from '../../components/TopBar'
import { Plus, Trash2, Info } from 'lucide-react'

const DEFAULT_CAT = {
  sport_type: '남복',
  grade_min: '',
  grade_max: '',
  min_mmr: '',
  max_mmr: '',
  max_teams: 16,
  entry_fee: 0,
}

const CERT_OPTIONS = [
  { key: 'none', label: '비공인', icon: '🤝', desc: 'MMR 변동 없음 · 친선전' },
  { key: 'c',    label: '공인 C', icon: '⭐', desc: 'K=32 · 일반 동호회' },
  { key: 'b',    label: '공인 B', icon: '⭐⭐', desc: 'K=48 · 인증 주최자' },
  { key: 'a',    label: '공인 A', icon: '⭐⭐⭐', desc: 'K=64 · 협회 연계' },
]

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
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  function update(k, v) { setForm(prev => ({ ...prev, [k]: v })) }
  function updateCat(i, k, v) {
    setCategories(prev => prev.map((c, idx) => idx === i ? { ...c, [k]: v } : c))
  }
  function addCat()      { setCategories(prev => [...prev, { ...DEFAULT_CAT }]) }
  function removeCat(i)  { setCategories(prev => prev.filter((_, idx) => idx !== i)) }

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

  const certInfo = CERT_LEVELS[form.cert_level]

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
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

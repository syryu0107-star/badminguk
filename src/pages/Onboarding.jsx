import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { GRADES, getInitialMMR } from '../lib/grades'
import { ChevronRight, ShieldCheck } from 'lucide-react'

export default function Onboarding() {
  const navigate  = useNavigate()
  const location  = useLocation()

  // Auth.jsx에서 넘겨준 이전 기록
  const phoneRecord = location.state?.phoneRecord ?? null
  const phone       = location.state?.phone ?? null

  const [step,    setStep]    = useState(0)  // 0=이름 1=급수 2=종목
  const [name,    setName]    = useState('')
  const [grade,   setGrade]   = useState(phoneRecord?.peak_grade ?? '')
  const [sports,  setSports]  = useState([])
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  // phone_records가 있으면 급수는 변경 불가 (최고 급수 고정)
  const gradeIsLocked = !!phoneRecord

  function toggleSport(s) {
    setSports(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }

  async function finish() {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()

    // 복원 MMR: 이전 기록 있으면 그 값 사용, 없으면 급수 기반 초기값
    const restoredMMR = phoneRecord?.current_mmr ?? getInitialMMR(grade)

    const { error: e } = await supabase.from('profiles').upsert({
      id:              user.id,
      name,
      phone,
      official_grade:  grade,
      preferred_sports: sports,
      mmr:             restoredMMR,
      mmr_games_played: phoneRecord?.total_games ?? 0,
    })

    if (e) { setError(e.message); setSaving(false); return }
    navigate('/home', { replace: true })
  }

  const gradeList = gradeIsLocked
    // 이전 기록 있으면 peak 이상의 급수만 선택 가능
    ? GRADES.filter(g => {
        const idx = GRADES.findIndex(x => x.key === phoneRecord.peak_grade)
        return GRADES.indexOf(g) >= idx
      })
    : GRADES

  return (
    <div className="min-h-screen bg-white flex flex-col px-6 pt-12 pb-8">
      {/* 진행 바 */}
      <div className="flex gap-1 mb-8">
        {[0,1,2].map(i => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-colors
            ${i <= step ? 'bg-[#C60C30]' : 'bg-gray-100'}`} />
        ))}
      </div>

      {/* 이전 기록 복원 배너 */}
      {phoneRecord && step === 0 && (
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

      {step === 0 && (
        <div className="flex-1 fade-up">
          <h2 className="text-2xl font-black mb-2">
            {phoneRecord ? '다시 오셨군요! 👋' : '반갑습니다! 👋'}
          </h2>
          <p className="text-gray-500 mb-8">배드민국에서 사용할 이름을 알려주세요.</p>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && name.trim() && setStep(1)}
            placeholder="홍길동"
            className="w-full border-b-2 border-gray-200 focus:border-[#C60C30] outline-none
                       text-2xl font-bold pb-2 transition-colors"
          />
          <p className="text-xs text-gray-400 mt-2">실명 또는 닉네임 모두 가능합니다.</p>
        </div>
      )}

      {step === 1 && (
        <div className="flex-1 fade-up overflow-y-auto">
          <h2 className="text-2xl font-black mb-1">내 급수는?</h2>
          {gradeIsLocked ? (
            <p className="text-sm text-blue-600 font-medium mb-4">
              ⚠️ 이전 최고 급수 이상만 선택 가능합니다 (하위급수 출전 방지)
            </p>
          ) : (
            <p className="text-gray-500 mb-4 text-sm">
              스포넷 기준 공인 급수를 선택하세요.<br/>
              처음이라면 <strong>왕초심</strong>을 선택하세요.
            </p>
          )}
          <div className="space-y-2">
            {gradeList.map(g => {
              const isLocked = gradeIsLocked &&
                GRADES.findIndex(x => x.key === g.key) <
                GRADES.findIndex(x => x.key === phoneRecord.peak_grade)
              return (
                <button
                  key={g.key}
                  onClick={() => !isLocked && setGrade(g.key)}
                  disabled={isLocked}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 transition
                              ${grade === g.key ? 'border-[#C60C30] bg-red-50'
                              : isLocked ? 'border-gray-100 bg-gray-50 opacity-40 cursor-not-allowed'
                              : 'border-gray-100 bg-white'}`}
                >
                  <span className="text-xl">{g.flair}</span>
                  <div className="flex-1 text-left">
                    <p className="font-bold">{g.label}</p>
                    <p className="text-xs text-gray-400">초기 MMR: {g.initialMMR}</p>
                  </div>
                  {grade === g.key && (
                    <div className="w-5 h-5 rounded-full bg-[#C60C30] flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-white" />
                    </div>
                  )}
                  {g.key === phoneRecord?.peak_grade && gradeIsLocked && (
                    <span className="text-xs text-blue-600 font-semibold bg-blue-50 px-2 py-0.5 rounded-full">
                      이전 최고
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {step === 2 && (
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

      <button
        onClick={() => {
          if (step === 0 && name.trim()) setStep(1)
          else if (step === 1 && grade) setStep(2)
          else if (step === 2) finish()
        }}
        disabled={
          (step === 0 && !name.trim()) ||
          (step === 1 && !grade) ||
          (step === 2 && saving)
        }
        className="w-full py-4 rounded-2xl font-bold text-white text-lg mt-6
                   transition active:scale-[.97] disabled:opacity-40 flex items-center justify-center gap-2"
        style={{ background: 'linear-gradient(135deg, #C60C30, #003478)' }}
      >
        {step === 2
          ? (saving ? '저장 중...' : '배드민국 시작하기 🏸')
          : <><span>다음</span><ChevronRight size={20} /></>
        }
      </button>
    </div>
  )
}

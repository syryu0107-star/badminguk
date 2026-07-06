import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { GRADES, getInitialMMR } from '../lib/grades'
import { ChevronRight } from 'lucide-react'

export default function Onboarding() {
  const navigate = useNavigate()
  const [step, setStep]   = useState(0)  // 0=이름 1=급수 2=종목
  const [name, setName]   = useState('')
  const [grade, setGrade] = useState('')
  const [sports, setSports] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  function toggleSport(s) {
    setSports(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }

  async function finish() {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const initialMMR = getInitialMMR(grade)
    const { error: e } = await supabase.from('profiles').upsert({
      id: user.id,
      name,
      official_grade: grade,
      preferred_sports: sports,
      mmr: initialMMR,
      mmr_games_played: 0,
    })
    if (e) { setError(e.message); setSaving(false); return }
    navigate('/home', { replace: true })
  }

  return (
    <div className="min-h-screen bg-white flex flex-col px-6 pt-12 pb-8">
      {/* 진행 바 */}
      <div className="flex gap-1 mb-10">
        {[0,1,2].map(i => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? 'bg-[#C60C30]' : 'bg-gray-100'}`} />
        ))}
      </div>

      {step === 0 && (
        <div className="flex-1 fade-up">
          <h2 className="text-2xl font-black mb-2">반갑습니다! 👋</h2>
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
        <div className="flex-1 fade-up">
          <h2 className="text-2xl font-black mb-2">내 급수는?</h2>
          <p className="text-gray-500 mb-6">
            스포넷 기준 공인 급수를 선택하세요.<br/>
            <span className="text-xs">처음이라면 <strong>왕초심</strong>을 선택하세요.</span>
          </p>
          <div className="space-y-2">
            {GRADES.map(g => (
              <button
                key={g.key}
                onClick={() => setGrade(g.key)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 transition
                            ${grade === g.key
                              ? 'border-[#C60C30] bg-red-50'
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
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex-1 fade-up">
          <h2 className="text-2xl font-black mb-2">주로 치는 종목은?</h2>
          <p className="text-gray-500 mb-6">여러 개 선택 가능합니다.</p>
          <div className="flex flex-col gap-3">
            {['남복', '여복', '혼복'].map(s => (
              <button
                key={s}
                onClick={() => toggleSport(s)}
                className={`flex items-center gap-3 px-4 py-4 rounded-2xl border-2 transition
                            ${sports.includes(s)
                              ? 'border-[#C60C30] bg-red-50'
                              : 'border-gray-100 bg-white'}`}
              >
                <span className="text-2xl">
                  {s === '남복' ? '👬' : s === '여복' ? '👭' : '👫'}
                </span>
                <span className="text-lg font-bold">{s}</span>
              </button>
            ))}
          </div>
          {error && <p className="text-red-500 text-sm mt-4">{error}</p>}
        </div>
      )}

      {/* CTA */}
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
        {step === 2 ? (saving ? '저장 중...' : '시작하기 🏸') : (
          <><span>{step === 0 ? '다음' : '다음'}</span><ChevronRight size={20} /></>
        )}
      </button>
    </div>
  )
}

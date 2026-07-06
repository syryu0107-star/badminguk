import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Auth() {
  const [step, setStep] = useState('email')  // email | otp
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function sendOTP() {
    if (!email.includes('@')) { setError('이메일을 올바르게 입력해주세요.'); return }
    setLoading(true); setError('')
    const { error: e } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })
    if (e) setError(e.message)
    else setStep('otp')
    setLoading(false)
  }

  async function verifyOTP() {
    if (otp.length < 6) { setError('인증 코드 6자리를 입력해주세요.'); return }
    setLoading(true); setError('')
    const { error: e } = await supabase.auth.verifyOtp({ email, token: otp, type: 'email' })
    if (e) setError('인증 코드가 올바르지 않습니다.')
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-white">
      {/* 로고 */}
      <div className="mb-10 text-center">
        <div
          className="w-20 h-20 rounded-3xl mx-auto mb-4 flex items-center justify-center text-3xl"
          style={{ background: 'linear-gradient(135deg, #C60C30, #003478)' }}
        >
          🏸
        </div>
        <h1 className="text-2xl font-black tracking-tight">배드민국</h1>
        <p className="text-sm text-gray-500 mt-1">대한민국 배드민턴 공인 MMR</p>
      </div>

      {step === 'email' ? (
        <div className="w-full max-w-sm space-y-4 fade-up">
          <div>
            <label className="block text-sm font-semibold mb-1.5">이메일</label>
            <input
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setError('') }}
              onKeyDown={e => e.key === 'Enter' && sendOTP()}
              placeholder="example@gmail.com"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none
                         focus:ring-2 focus:ring-[#C60C30]/30 focus:border-[#C60C30] transition"
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            onClick={sendOTP}
            disabled={loading}
            className="w-full py-3.5 rounded-xl font-bold text-white text-base
                       transition active:scale-[.97] disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #C60C30, #a00a28)' }}
          >
            {loading ? '전송 중...' : '인증 코드 받기'}
          </button>
          <p className="text-xs text-gray-400 text-center">
            이메일로 6자리 인증 코드가 전송됩니다.
          </p>
        </div>
      ) : (
        <div className="w-full max-w-sm space-y-4 fade-up">
          <p className="text-sm text-gray-600 text-center">
            <strong>{email}</strong>으로 전송된<br/>인증 코드를 입력하세요.
          </p>
          <input
            type="text"
            value={otp}
            onChange={e => { setOtp(e.target.value.replace(/\D/g,'')); setError('') }}
            onKeyDown={e => e.key === 'Enter' && verifyOTP()}
            placeholder="6자리 코드"
            maxLength={6}
            inputMode="numeric"
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-2xl tracking-[.4em]
                       text-center font-bold focus:outline-none focus:ring-2 focus:ring-[#C60C30]/30
                       focus:border-[#C60C30]"
          />
          {error && <p className="text-sm text-red-500 text-center">{error}</p>}
          <button
            onClick={verifyOTP}
            disabled={loading}
            className="w-full py-3.5 rounded-xl font-bold text-white text-base
                       transition active:scale-[.97] disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #C60C30, #a00a28)' }}
          >
            {loading ? '확인 중...' : '로그인'}
          </button>
          <button
            onClick={() => { setStep('email'); setOtp(''); setError('') }}
            className="w-full text-sm text-gray-400 underline"
          >
            이메일 다시 입력
          </button>
        </div>
      )}
    </div>
  )
}

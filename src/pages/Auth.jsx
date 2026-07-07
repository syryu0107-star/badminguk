import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// 한국 전화번호 포맷 (입력 중 자동 하이픈)
function formatPhone(v) {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length < 4) return d
  if (d.length < 8) return d.slice(0, 3) + '-' + d.slice(3)
  return d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7)
}

function normalizePhone(v) {
  const d = v.replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('010')) return '+82' + d.slice(1)
  return null
}

export default function Auth() {
  const navigate = useNavigate()
  const [step,    setStep]    = useState('phone')   // phone | otp
  const [phone,   setPhone]   = useState('')
  const [otp,     setOtp]     = useState('')
  const [masked,  setMasked]  = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  async function sendOTP() {
    const norm = normalizePhone(phone)
    if (!norm) { setError('010으로 시작하는 11자리 번호를 입력해주세요.'); return }
    setLoading(true); setError('')

    const { data, error: e } = await supabase.functions.invoke('send-otp', {
      body: { phone: norm },
    })

    if (e || data?.error) {
      setError(data?.error ?? '인증 코드 전송에 실패했습니다. 잠시 후 다시 시도해주세요.')
    } else {
      setMasked(data.phone ?? norm)
      setStep('otp')
    }
    setLoading(false)
  }

  async function verifyOTP() {
    if (otp.length !== 6) { setError('6자리 인증 코드를 입력해주세요.'); return }
    const norm = normalizePhone(phone)
    setLoading(true); setError('')

    const { data, error: e } = await supabase.functions.invoke('verify-otp', {
      body: { phone: norm, otp },
    })

    if (e || data?.error) {
      setError(data?.error ?? '인증에 실패했습니다.')
      setLoading(false)
      return
    }

    // Edge Function이 반환한 hashed_token으로 세션 복원
    if (data.accessToken) {
      const { error: sessionErr } = await supabase.auth.verifyOtp({
        token_hash: data.accessToken,
        type: 'magiclink',
      })
      if (sessionErr) {
        setError('로그인 처리 중 오류가 발생했습니다.')
        setLoading(false)
        return
      }
    }

    // phone_records가 있으면 (기존 사용자) → 온보딩 스킵
    if (data.isNewUser) {
      navigate('/onboarding', { state: { phoneRecord: data.phoneRecord, phone: norm }, replace: true })
    } else {
      navigate('/home', { replace: true })
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-white">
      {/* 로고 */}
      <div className="mb-10 text-center">
        <div
          className="w-20 h-20 rounded-3xl mx-auto mb-4 flex items-center justify-center text-4xl shadow-lg"
          style={{ background: 'linear-gradient(135deg, #C60C30, #003478)' }}
        >
          🏸
        </div>
        <h1 className="text-2xl font-black tracking-tight">배드민국</h1>
        <p className="text-sm text-gray-500 mt-1">대한민국 배드민턴 공인 MMR</p>
      </div>

      {step === 'phone' ? (
        <div className="w-full max-w-sm space-y-4 fade-up">
          <div>
            <label className="block text-sm font-bold mb-2 text-gray-700">
              휴대폰 번호
            </label>
            <div className="flex items-center border-2 border-gray-200 rounded-2xl px-4 py-3.5
                            focus-within:border-[#C60C30] transition-colors">
              <span className="text-gray-400 mr-2 text-sm font-medium">🇰🇷 +82</span>
              <input
                type="tel"
                inputMode="numeric"
                value={phone}
                onChange={e => { setPhone(formatPhone(e.target.value)); setError('') }}
                onKeyDown={e => e.key === 'Enter' && sendOTP()}
                placeholder="010-0000-0000"
                className="flex-1 text-base font-medium outline-none"
              />
            </div>
          </div>
          {error && <p className="text-sm text-red-500 font-medium">{error}</p>}
          <button
            onClick={sendOTP}
            disabled={loading || phone.replace(/\D/g,'').length < 11}
            className="w-full py-4 rounded-2xl font-bold text-white text-base
                       transition active:scale-[.97] disabled:opacity-50 shadow-sm"
            style={{ background: 'linear-gradient(135deg, #C60C30, #a00a28)' }}
          >
            {loading ? '전송 중...' : '인증 코드 받기'}
          </button>
          <p className="text-xs text-gray-400 text-center leading-relaxed">
            가입 시 서비스 이용약관에 동의하게 됩니다.<br/>
            전화번호로 본인 확인 후 서비스를 이용할 수 있습니다.
          </p>
        </div>
      ) : (
        <div className="w-full max-w-sm space-y-4 fade-up">
          <div className="text-center mb-2">
            <p className="text-sm text-gray-500">
              <span className="font-bold text-gray-800">{masked}</span> 으로<br/>
              인증 코드를 발송했습니다.
            </p>
          </div>

          <input
            autoFocus
            type="text"
            value={otp}
            onChange={e => { setOtp(e.target.value.replace(/\D/g,'').slice(0,6)); setError('') }}
            onKeyDown={e => e.key === 'Enter' && verifyOTP()}
            placeholder="6자리 인증 코드"
            maxLength={6}
            inputMode="numeric"
            className="w-full border-2 border-gray-200 rounded-2xl px-4 py-4
                       text-3xl tracking-[.5em] text-center font-black
                       focus:outline-none focus:border-[#C60C30] transition-colors"
          />
          {error && <p className="text-sm text-red-500 font-medium text-center">{error}</p>}
          <button
            onClick={verifyOTP}
            disabled={loading || otp.length !== 6}
            className="w-full py-4 rounded-2xl font-bold text-white text-base
                       transition active:scale-[.97] disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #C60C30, #003478)' }}
          >
            {loading ? '확인 중...' : '인증 완료'}
          </button>
          <div className="flex items-center justify-center gap-4 text-sm">
            <button onClick={() => { setStep('phone'); setOtp(''); setError('') }}
              className="text-gray-400 underline">
              번호 다시 입력
            </button>
            <span className="text-gray-200">|</span>
            <button onClick={sendOTP} disabled={loading}
              className="text-[#C60C30] font-semibold disabled:opacity-50">
              재전송
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

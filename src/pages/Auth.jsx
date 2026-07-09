import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

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

function formatBirth(v) {
  const d = v.replace(/\D/g, '').slice(0, 8)
  if (d.length < 5) return d
  if (d.length < 7) return d.slice(0, 4) + '-' + d.slice(4)
  return d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6)
}

const ROLES = [
  {
    key: 'player',
    emoji: '🏸',
    title: '선수',
    desc: 'MMR 확인 · 대회 참가 · 전국 랭킹',
    bg: 'from-[#C60C30] to-[#a00a28]',
  },
  {
    key: 'organizer',
    emoji: '🏟️',
    title: '대회 주최자',
    desc: 'AI 대진표 · 실시간 스코어 · 참가자 관리',
    bg: 'from-[#003478] to-[#001f4d]',
  },
]

export default function Auth() {
  const navigate = useNavigate()
  const [step,    setStep]    = useState('role')   // role | phone | otp | identity
  const [role,    setRole]    = useState('')
  const [phone,   setPhone]   = useState('')
  const [otp,     setOtp]     = useState('')
  const [masked,  setMasked]  = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  // 본인인증 스텝 상태
  const [idName,    setIdName]    = useState('')
  const [idBirth,   setIdBirth]   = useState('')
  const [isNewUser, setIsNewUser] = useState(false)
  const [phoneRecord, setPhoneRecord] = useState(null)

  function selectRole(r) {
    setRole(r)
    setStep('phone')
  }

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

    setIsNewUser(!!data.isNewUser)
    setPhoneRecord(data.phoneRecord ?? null)

    // 기존 사용자이고 이미 실명인증 완료 → 바로 이동
    if (!data.isNewUser && data.phoneRecord?.identity_verified) {
      navigate(role === 'organizer' ? '/organizer' : '/home', { replace: true })
      return
    }

    // 신규 사용자 or 미인증 → 본인인증 스텝으로
    setStep('identity')
    setLoading(false)
  }

  async function verifyIdentity() {
    const birthRaw = idBirth.replace(/\D/g, '')
    if (!idName.trim() || idName.trim().length < 2) {
      setError('이름을 올바르게 입력해주세요.')
      return
    }
    if (birthRaw.length !== 8) {
      setError('생년월일 8자리를 입력해주세요. (예: 19900101)')
      return
    }

    setLoading(true); setError('')
    const norm = normalizePhone(phone)

    const { data, error: e } = await supabase.functions.invoke('verify-identity', {
      body: { name: idName.trim(), birth: birthRaw, phone: norm },
    })

    if (e || data?.error) {
      setError(data?.error ?? '본인인증에 실패했습니다.')
      setLoading(false)
      return
    }

    // profiles에도 저장
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await supabase.from('profiles').update({
        verified_name: data.verified_name,
        verified_birth: data.verified_birth,
        identity_verified: true,
      }).eq('id', user.id)
    }

    if (isNewUser) {
      navigate('/onboarding', {
        state: { phoneRecord, phone: norm, role },
        replace: true,
      })
    } else {
      navigate(role === 'organizer' ? '/organizer' : '/home', { replace: true })
    }
  }

  // 본인인증 건너뛰기 (나중에 하기)
  function skipIdentity() {
    if (isNewUser) {
      navigate('/onboarding', {
        state: { phoneRecord, phone: normalizePhone(phone), role },
        replace: true,
      })
    } else {
      navigate(role === 'organizer' ? '/organizer' : '/home', { replace: true })
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* 로고 */}
      <div className="pt-14 pb-6 text-center px-6">
        <div
          className="w-16 h-16 rounded-2xl mx-auto mb-3 flex items-center justify-center text-3xl shadow-md"
          style={{ background: 'linear-gradient(135deg, #C60C30, #003478)' }}
        >
          🏸
        </div>
        <h1 className="text-xl font-black tracking-tight">배드민국</h1>
        <p className="text-xs text-gray-400 mt-0.5">대한민국 배드민턴 실력 MMR</p>
      </div>

      {/* 진행 단계 표시 */}
      {step !== 'role' && (
        <div className="flex items-center justify-center gap-2 mb-2">
          {['phone', 'otp', 'identity'].map((s, i) => (
            <div key={s} className="flex items-center gap-1">
              <div className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center
                ${['phone','otp','identity'].indexOf(step) >= i
                  ? 'bg-[#C60C30] text-white'
                  : 'bg-gray-100 text-gray-400'}`}
              >{i + 1}</div>
              {i < 2 && <div className="w-6 h-px bg-gray-200" />}
            </div>
          ))}
        </div>
      )}

      {/* ── 역할 선택 ─────────────────────────────────────────── */}
      {step === 'role' && (
        <div className="flex-1 px-6 fade-up">
          <h2 className="text-lg font-black mb-1 text-center">어떤 역할로 입장할까요?</h2>
          <p className="text-sm text-gray-400 text-center mb-8">
            한 계정으로 두 역할 모두 이용 가능합니다.
          </p>
          <div className="space-y-4">
            {ROLES.map(r => (
              <button
                key={r.key}
                onClick={() => selectRole(r.key)}
                className={`w-full rounded-3xl p-5 text-left text-white active:scale-[.98]
                            transition-transform bg-gradient-to-r ${r.bg} shadow-md`}
              >
                <div className="flex items-center gap-4">
                  <span className="text-4xl">{r.emoji}</span>
                  <div>
                    <p className="text-lg font-black">{r.title}</p>
                    <p className="text-white/70 text-xs mt-0.5">{r.desc}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── 전화번호 입력 ──────────────────────────────────────── */}
      {step === 'phone' && (
        <div className="flex-1 px-6 fade-up">
          <div className="flex items-center justify-center gap-2 mb-8">
            <span className="text-xl">{ROLES.find(r => r.key === role)?.emoji}</span>
            <span className="font-bold text-gray-700">
              {ROLES.find(r => r.key === role)?.title}로 입장
            </span>
            <button
              onClick={() => { setStep('role'); setError('') }}
              className="text-xs text-gray-400 underline ml-2"
            >
              변경
            </button>
          </div>

          <label className="block text-sm font-bold mb-2 text-gray-700">휴대폰 번호</label>
          <div className="flex items-center border-2 border-gray-200 rounded-2xl px-4 py-3.5
                          focus-within:border-[#C60C30] transition-colors mb-4">
            <span className="text-gray-400 mr-2 text-sm font-medium">🇰🇷 +82</span>
            <input
              type="tel"
              inputMode="numeric"
              autoFocus
              value={phone}
              onChange={e => { setPhone(formatPhone(e.target.value)); setError('') }}
              onKeyDown={e => e.key === 'Enter' && sendOTP()}
              placeholder="010-0000-0000"
              className="flex-1 text-base font-medium outline-none"
            />
          </div>
          {error && <p className="text-sm text-red-500 font-medium mb-3">{error}</p>}
          <button
            onClick={sendOTP}
            disabled={loading || phone.replace(/\D/g,'').length < 11}
            className="w-full py-4 rounded-2xl font-bold text-white text-base
                       transition active:scale-[.97] disabled:opacity-50 shadow-sm"
            style={{ background: 'linear-gradient(135deg, #C60C30, #a00a28)' }}
          >
            {loading ? '전송 중...' : '인증 코드 받기'}
          </button>
          <p className="text-xs text-gray-400 text-center mt-4 leading-relaxed">
            인증 코드를 받으면{' '}
            <a href="/terms" target="_blank" rel="noreferrer" className="underline text-gray-500">이용약관</a>과{' '}
            <a href="/privacy" target="_blank" rel="noreferrer" className="underline text-gray-500">개인정보처리방침</a>에
            동의하는 것으로 봅니다. (만 14세 이상만 가입 가능)
          </p>
        </div>
      )}

      {/* ── OTP 입력 ──────────────────────────────────────────── */}
      {step === 'otp' && (
        <div className="flex-1 px-6 fade-up">
          <div className="text-center mb-8">
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
                       focus:outline-none focus:border-[#C60C30] transition-colors mb-4"
          />
          {error && <p className="text-sm text-red-500 font-medium text-center mb-3">{error}</p>}
          <button
            onClick={verifyOTP}
            disabled={loading || otp.length !== 6}
            className="w-full py-4 rounded-2xl font-bold text-white text-base
                       transition active:scale-[.97] disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #C60C30, #003478)' }}
          >
            {loading ? '확인 중...' : '인증 완료'}
          </button>
          <div className="flex items-center justify-center gap-4 text-sm mt-4">
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

      {/* ── 본인인증 (이름 + 생년월일) ─────────────────────────── */}
      {step === 'identity' && (
        <div className="flex-1 px-6 fade-up">
          <div className="text-center mb-6">
            <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-3">
              <span className="text-2xl">🪪</span>
            </div>
            <h2 className="text-lg font-black">본인 확인</h2>
            <p className="text-sm text-gray-400 mt-1 leading-relaxed">
              대회 대리출전 방지를 위해<br/>실명 확인이 필요합니다.
            </p>
          </div>

          <div className="space-y-4 mb-6">
            <div>
              <label className="block text-sm font-bold mb-1.5 text-gray-700">이름 (실명)</label>
              <input
                autoFocus
                type="text"
                value={idName}
                onChange={e => { setIdName(e.target.value); setError('') }}
                placeholder="홍길동"
                className="w-full border-2 border-gray-200 rounded-2xl px-4 py-3.5 text-base
                           font-medium outline-none focus:border-[#C60C30] transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-bold mb-1.5 text-gray-700">생년월일</label>
              <input
                type="text"
                inputMode="numeric"
                value={idBirth}
                onChange={e => { setIdBirth(formatBirth(e.target.value)); setError('') }}
                onKeyDown={e => e.key === 'Enter' && verifyIdentity()}
                placeholder="1990-01-01"
                maxLength={10}
                className="w-full border-2 border-gray-200 rounded-2xl px-4 py-3.5 text-base
                           font-medium outline-none focus:border-[#C60C30] transition-colors"
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-500 font-medium mb-3">{error}</p>}

          <div className="bg-blue-50 rounded-2xl p-3.5 mb-5">
            <p className="text-xs text-blue-700 leading-relaxed">
              🔒 입력한 정보는 대회 당일 신원 확인에만 사용되며,<br/>
              다른 참가자에게는 공개되지 않습니다.
            </p>
          </div>

          <button
            onClick={verifyIdentity}
            disabled={loading}
            className="w-full py-4 rounded-2xl font-bold text-white text-base
                       transition active:scale-[.97] disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #003478, #C60C30)' }}
          >
            {loading ? '확인 중...' : '본인 확인 완료'}
          </button>

          <button
            onClick={skipIdentity}
            className="w-full py-3 mt-3 text-sm text-gray-400 underline"
          >
            나중에 하기
          </button>
        </div>
      )}
    </div>
  )
}

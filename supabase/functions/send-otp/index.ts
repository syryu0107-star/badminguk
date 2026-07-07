import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SOLAPI_KEY    = Deno.env.get('SOLAPI_API_KEY') ?? ''
const SOLAPI_SECRET = Deno.env.get('SOLAPI_API_SECRET') ?? ''
const SENDER_PHONE  = Deno.env.get('SMS_SENDER_PHONE') ?? ''

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const { phone } = await req.json()
    const normalized = normalizeKoreanPhone(phone)
    if (!normalized) {
      return res({ error: '올바른 전화번호를 입력해주세요. (예: 010-1234-5678)' }, 400)
    }

    // 6자리 OTP 생성
    const otp = Math.floor(100000 + Math.random() * 900000).toString()

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // OTP 저장 (5분 유효)
    const { error: dbErr } = await supabase.from('phone_otps').upsert({
      phone: normalized,
      otp,
      attempts: 0,
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    })
    if (dbErr) throw dbErr

    // 솔라피 SMS 발송
    await sendSolapiSMS(normalized, `[배드민국] 인증번호: ${otp}\n5분 이내 입력하세요.`)

    return res({ success: true, phone: masked(normalized) })
  } catch (e) {
    return res({ error: String(e) }, 500)
  }
})

// ── 한국 전화번호 정규화 (+821012345678) ───────────────────────
function normalizeKoreanPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('82') && digits.length >= 11) return '+' + digits
  if (digits.startsWith('010') && digits.length === 11) return '+82' + digits.slice(1)
  if (digits.startsWith('10') && digits.length === 10) return '+82' + digits
  return null
}

// ── 마스킹 표시 ─────────────────────────────────────────────
function masked(phone: string) {
  return phone.replace(/(\+82\d{2})(\d{4})(\d{4})/, '$1****$3')
}

// ── 솔라피 SMS 발송 ─────────────────────────────────────────
async function sendSolapiSMS(to: string, text: string) {
  const date      = new Date().toISOString()
  const salt      = crypto.randomUUID().replace(/-/g, '')
  const signature = await hmacSha256(SOLAPI_SECRET, date + salt)

  const resp = await fetch('https://api.solapi.com/messages/v4/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `HMAC-SHA256 apiKey=${SOLAPI_KEY},date=${date},salt=${salt},signature=${signature}`,
    },
    body: JSON.stringify({
      message: {
        to,
        from: SENDER_PHONE,
        text,
      },
    }),
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`솔라피 발송 실패: ${err}`)
  }
  return resp.json()
}

async function hmacSha256(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function res(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const { phone, otp } = await req.json()
    const normalized = normalizeKoreanPhone(phone)
    if (!normalized || !otp) return res({ error: '잘못된 요청입니다.' }, 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // OTP 조회
    const { data: record } = await supabase
      .from('phone_otps')
      .select('*')
      .eq('phone', normalized)
      .single()

    if (!record) return res({ error: '인증 코드를 먼저 요청해주세요.' }, 400)

    // 만료 확인
    if (new Date(record.expires_at) < new Date()) {
      await supabase.from('phone_otps').delete().eq('phone', normalized)
      return res({ error: '인증 코드가 만료됐습니다. 다시 요청해주세요.' }, 400)
    }

    // 시도 횟수 제한 (5회)
    if (record.attempts >= 5) {
      return res({ error: '인증 시도 횟수를 초과했습니다. 다시 요청해주세요.' }, 429)
    }

    if (record.otp !== otp) {
      await supabase.from('phone_otps').update({ attempts: record.attempts + 1 }).eq('phone', normalized)
      return res({ error: `인증 코드가 틀렸습니다. (${5 - record.attempts - 1}회 남음)` }, 400)
    }

    // OTP 삭제
    await supabase.from('phone_otps').delete().eq('phone', normalized)

    // phone_records 조회 (이전 급수/MMR 복원용)
    const { data: phoneRecord } = await supabase
      .from('phone_records')
      .select('*')
      .eq('phone', normalized)
      .single()

    // 기존 사용자 있는지 확인
    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('phone', normalized)
      .single()

    let userId: string
    let isNewUser = false

    if (existingProfile) {
      // 기존 사용자 → 세션 생성
      userId = existingProfile.id
    } else {
      // 신규 사용자 → auth 계정 생성 (admin API)
      const email = `phone_${normalized.replace('+', '')}@badminguk.app`
      const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { phone: normalized },
      })
      if (authErr) throw authErr
      userId = authUser.user.id
      isNewUser = true
    }

    // 매직 링크 방식으로 세션 토큰 발급
    const { data: link, error: linkErr } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: `phone_${normalized.replace('+', '')}@badminguk.app`,
    })
    if (linkErr) throw linkErr

    return res({
      success: true,
      isNewUser,
      userId,
      phoneRecord: phoneRecord ?? null, // 이전 급수/MMR 정보
      // 클라이언트는 이 hashed_token으로 세션 복원
      accessToken: link.properties?.hashed_token ?? null,
    })
  } catch (e) {
    return res({ error: String(e) }, 500)
  }
})

function normalizeKoreanPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('82') && digits.length >= 11) return '+' + digits
  if (digits.startsWith('010') && digits.length === 11) return '+82' + digits.slice(1)
  if (digits.startsWith('10') && digits.length === 10) return '+82' + digits
  return null
}

function res(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// MOCK_MODE: NICE_API_KEY 없으면 형식 검증만 통과
// 실 배포 시: NICE_API_KEY + NICE_API_SECRET 설정 → 아래 callNiceAPI 활성화
const MOCK_MODE = !Deno.env.get('NICE_API_KEY')

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const { name, birth, phone } = await req.json()

    if (!name || name.trim().length < 2) {
      return res({ error: '이름을 2자 이상 입력해주세요.' }, 400)
    }
    if (!birth || !/^\d{8}$/.test(birth)) {
      return res({ error: '생년월일 8자리를 입력해주세요. (예: 19900101)' }, 400)
    }

    const birthYear = parseInt(birth.slice(0, 4))
    const currentYear = new Date().getFullYear()
    if (currentYear - birthYear < 10 || birthYear < 1900) {
      return res({ error: '유효하지 않은 생년월일입니다.' }, 400)
    }

    let verifiedName = name.trim()
    let verifiedBirth = birth

    if (!MOCK_MODE) {
      // ── 실제 NICE 실명인증 API (키 발급 후 활성화) ────────────────
      // const result = await callNiceAPI({ name: verifiedName, birth: verifiedBirth, phone })
      // if (!result.success) return res({ error: result.message }, 400)
      // verifiedName = result.name
      // verifiedBirth = result.birth
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // phone_records에 영구 저장 (재가입해도 유지)
    if (phone) {
      const { error: prErr } = await supabase.from('phone_records')
        .update({ verified_name: verifiedName, verified_birth: verifiedBirth, identity_verified: true })
        .eq('phone', phone)
      if (prErr) console.error('phone_records update error:', prErr.message)
    }

    return res({
      success: true,
      verified_name: verifiedName,
      verified_birth: verifiedBirth,
      mock: MOCK_MODE,
    })
  } catch (e) {
    return res({ error: String(e) }, 500)
  }
})

/* ── 추후 NICE 실명인증 연동 시 사용 ──────────────────────────────
async function callNiceAPI(params: { name: string; birth: string; phone: string }) {
  const apiKey    = Deno.env.get('NICE_API_KEY')!
  const apiSecret = Deno.env.get('NICE_API_SECRET')!
  // NICE 표준 인증 API 호출 구현
  // 참고: https://www.niceapi.co.kr/ 실명확인 API
  const resp = await fetch('https://svc.niceapi.co.kr:22001/digital/niceid/api/v1.0/name/check', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `bearer ${await getNiceToken(apiKey, apiSecret)}`,
    },
    body: JSON.stringify({
      dataBody: {
        request_no: crypto.randomUUID().replace(/-/g,'').slice(0, 30),
        utf8_name: encodeURIComponent(params.name),
        birth_date: params.birth,
      }
    }),
  })
  const json = await resp.json()
  return {
    success: json.dataBody?.result_cd === '0000',
    message: json.dataBody?.result_msg ?? '인증 실패',
    name: params.name,
    birth: params.birth,
  }
}
*/

function res(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

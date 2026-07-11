// ── Supabase 싱글턴 스텁 (테스트 전용, 의존성 0) ─────────────────────────
// notify.js 는 유일하게 `import { supabase } from './supabase'` 로 실 클라이언트
// 싱글턴을 끌어온다(supabase.js 는 @supabase/supabase-js + import.meta.env 를 써서
// 순정 Node 에서 임포트 자체가 불가). 테스트에서 notify.js 의 순수 로직(페이로드
// 빌더·채널명·상수)을 검증하려면 이 싱글턴 임포트가 해석돼야만 하므로,
// ext-loader 의 resolve 훅이 `./supabase` 를 이 스텁으로 리다이렉트한다.
//
// 순수 함수 테스트는 supabase 를 건드리지 않지만, 혹시 send 경로가 불려도
// 죽지 않도록 broadcast/persist 표면을 무해한 no-op 으로 채워 둔다.
import { makeSupabase } from './_supabase-stub.mjs'

const client = makeSupabase({})

// 실시간 채널 표면 (broadcast() 가 subscribe→send→removeChannel 을 쓴다)
client.channel = () => {
  const ch = {
    on: () => ch,
    subscribe: (cb) => { if (typeof cb === 'function') cb('SUBSCRIBED'); return ch },
    send: async () => ({}),
  }
  return ch
}
client.removeChannel = () => {}
client.functions = { invoke: async () => ({ data: null, error: null }) }

export const supabase = client

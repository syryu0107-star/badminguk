import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('[배드민국] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 설정되지 않았습니다.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  // 실시간 신뢰성 보강 (로드맵 7-3): heartbeat 주기를 줄여 백그라운드 태블릿의
  // 연결 끊김을 더 빨리 감지 → 화면의 재연결 표시·전체 재조회가 빠르게 동작.
  realtime: {
    heartbeatIntervalMs: 15000,
  },
})

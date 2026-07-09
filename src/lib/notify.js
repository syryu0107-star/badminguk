// 경기 호출·알림 인프라 (C1) — 오케스트레이션/커뮤니케이션 레이어
// ──────────────────────────────────────────────────────────────────────
// 목적: "지금 몇 번 코트로 입장하세요" 같은 호출을 사람 없이 선수에게 도달시킨다.
// 3개 채널로 팬아웃한다:
//   1) 인앱 실시간(Supabase Realtime broadcast) — 스키마 불필요, 즉시 도달 (기본).
//   2) 지속 저장(notifications 테이블) — 감사 로그 + 미확인 재알림 + 푸시 큐.
//      013 마이그레이션 미적용 시 조용히 degrade(인앱 방송은 이미 나감).
//   3) 외부 채널(웹푸시/카카오 알림톡/SMS) — 서버 키가 필요 → human-gated 스텁.
//      VITE_ENABLE_PUSH 플래그가 켜지고 키가 발급되기 전까지 실발송하지 않는다.
//
// 엔진 로직은 이 파일에 집중하고, scheduler/advance 등 기존 엔진은 재사용한다.

import { supabase } from './supabase'

// 알림 종류 (수신자·발신자 동일 규약)
export const NOTIFY = {
  MATCH_CALL:     'match_call',      // 지금 코트로 입장 (즉시 호출)
  MATCH_SOON:     'match_soon',      // 곧 호출 예정 (사전 알림)
  SCHEDULE_SHIFT: 'schedule_shift',  // 일정 앞당김/지연 재조정
  WALKOVER_WARN:  'walkover_warn',   // 미응답 워크오버 카운트다운
  RESULT:         'result',          // 결과·급수 반영
}

const PUSH_ENABLED = import.meta.env.VITE_ENABLE_PUSH === 'true'
const DEV = import.meta.env.DEV

// 대회별 실시간 채널 이름 — 발신/수신이 반드시 같은 이름을 써야 도달한다.
export function notifyChannel(tournamentId) {
  return `tourn-notify-${tournamentId}`
}

// ── 페이로드 빌더 ──────────────────────────────────────────────────────
// 코트 배정 훅에서 넘어온 match(코트 포함) → 선수용 호출 페이로드로 변환.
export function buildMatchCall({ match, tournamentId, court, sport }) {
  const c = court ?? match?.court_number ?? null
  return {
    type: NOTIFY.MATCH_CALL,
    tournamentId,
    matchId: match?.id ?? null,
    court: c,
    sport: sport ?? null,
    // 수신자가 "내 경기인가"를 판정하는 키 (엔트리 단위)
    entryIds: [match?.team1_entry_id, match?.team2_entry_id].filter(Boolean),
    title: '🔔 경기 호출',
    body: c != null
      ? `지금 ${c}번 코트로 입장해주세요!`
      : '지금 코트로 입장해주세요! (현장 안내를 따라주세요)',
    createdAt: new Date().toISOString(),
  }
}

// ── 채널 1: 인앱 실시간 방송 (스키마 불필요) ───────────────────────────
async function broadcast(payload) {
  if (!payload?.tournamentId) return { sent: false }
  const ch = supabase.channel(notifyChannel(payload.tournamentId))
  // 방송은 채널이 SUBSCRIBED 된 뒤에만 나간다 → 구독 완료를 기다린다(최대 2초).
  await new Promise(resolve => {
    let done = false
    const finish = () => { if (!done) { done = true; resolve() } }
    ch.subscribe(status => { if (status === 'SUBSCRIBED') finish() })
    setTimeout(finish, 2000)
  })
  try {
    await ch.send({ type: 'broadcast', event: payload.type, payload })
  } finally {
    supabase.removeChannel(ch)
  }
  return { sent: true }
}

// ── 채널 2: 지속 저장 (테이블 없으면 degrade) ──────────────────────────
async function persist(payload, recipients = []) {
  const ids = [...new Set(recipients.filter(Boolean))]
  if (!ids.length) return { persisted: false, reason: 'no_recipients' }
  const rows = ids.map(rid => ({
    recipient_id: rid,
    tournament_id: payload.tournamentId,
    match_id: payload.matchId,
    type: payload.type,
    title: payload.title,
    body: payload.body,
    payload,
    channels: ['in_app'],
    status: 'sent',
  }))
  try {
    const { error } = await supabase.from('notifications').insert(rows)
    if (error) throw error
    return { persisted: true, count: rows.length }
  } catch (e) {
    // notifications 테이블(013) 미적용 시 여기로 온다. 인앱 방송은 이미 도달했으므로
    // 대회 진행은 막지 않는다. 적용 후엔 자동으로 이력·재알림이 살아난다.
    if (DEV) console.warn('[notify] 지속 저장 생략(notifications 테이블 미적용?):', e.message)
    return { persisted: false, reason: 'table_missing' }
  }
}

// ── 채널 3: 외부 발송 (human-gated 스텁) ───────────────────────────────
function dispatchExternal(payload, recipients = []) {
  if (!PUSH_ENABLED) {
    if (DEV) console.info('[notify:stub] 외부 발송 생략 (VITE_ENABLE_PUSH 미설정):', payload.body)
    return { sent: false, reason: 'disabled' }
  }
  // TODO(human-gated): FCM/VAPID 웹푸시 · 카카오 알림톡 · SMS 실발송.
  //   서버 키가 필요하므로 Edge Function(예: send-push)에 큐잉을 위임한다:
  //     await supabase.functions.invoke('send-push', { body: { payload, recipients } })
  //   키 발급(원장 '사람이 해야 할 일') 전까지 이 분기는 실행되지 않는다.
  return { sent: false, reason: 'not_implemented' }
}

// ── 고수준 진입점: 경기 호출 ───────────────────────────────────────────
// 코트 배정 직후/호출 버튼에서 부른다. 3채널로 동시에 팬아웃.
export async function callMatch({ match, tournamentId, court, sport, recipients = [] }) {
  const payload = buildMatchCall({ match, tournamentId, court, sport })
  const bc = await broadcast(payload)
  const ps = await persist(payload, recipients)
  const ex = dispatchExternal(payload, recipients)
  return { payload, broadcast: bc, persist: ps, external: ex }
}

// ── 수신자 헬퍼: 내 대회들의 알림 채널 구독 ────────────────────────────
// tournamentIds 각각에 대해 broadcast 를 듣고, 모든 NOTIFY 이벤트를 handler 로 넘긴다.
// 반환값은 정리 함수(unsubscribe).
export function subscribeNotifications(tournamentIds, handler) {
  const ids = [...new Set((tournamentIds ?? []).filter(Boolean))]
  const chans = ids.map(tid => {
    const ch = supabase.channel(notifyChannel(tid))
    Object.values(NOTIFY).forEach(evt => {
      ch.on('broadcast', { event: evt }, ({ payload }) => {
        try { handler(payload) } catch { /* 수신 콜백 오류는 구독을 죽이지 않는다 */ }
      })
    })
    ch.subscribe()
    return ch
  })
  return () => chans.forEach(c => supabase.removeChannel(c))
}

// ── 미확인 호출 복구: 방송을 놓친 선수용(예: 앱을 닫았다 다시 열었을 때) ──
// notifications 테이블이 있으면 최근 미읽음 호출을 반환, 없으면 빈 배열로 degrade.
export async function fetchRecentCalls(recipientId, { withinMin = 20 } = {}) {
  if (!recipientId) return []
  try {
    const since = new Date(Date.now() - withinMin * 60000).toISOString()
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('recipient_id', recipientId)
      .eq('type', NOTIFY.MATCH_CALL)
      .is('read_at', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(5)
    if (error) throw error
    return data ?? []
  } catch {
    return [] // 테이블 미적용 시 조용히 degrade
  }
}

// 호출 확인(읽음) 처리 — 테이블 없으면 no-op.
export async function markCallRead(notificationId) {
  if (!notificationId) return
  try {
    await supabase.from('notifications')
      .update({ status: 'read', read_at: new Date().toISOString() })
      .eq('id', notificationId)
  } catch { /* degrade */ }
}

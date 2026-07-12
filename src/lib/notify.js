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

// 사후 커뮤니케이션 캠페인 종류 (C11) — 대회 생애주기 안내·공지.
// 경기 호출(NOTIFY)과 달리 "지금 당장"이 아니라 지속 도달(공지함)이 핵심이라
// 인앱 방송 + notifications 지속 저장으로 팬아웃한다.
export const CAMPAIGN = {
  REMIND_D1:   'campaign_remind_d1',    // 대회 전날 안내
  REMIND_DDAY: 'campaign_remind_dday',  // 대회 당일 아침 안내
  THANKS:      'campaign_thanks',       // 종료 후 감사 + 결과 안내
  SURVEY:      'campaign_survey',       // 만족도 설문 요청
}

// 공지함(inbox)에 모아 보여줄 지속형 알림 종류 (전송성 호출과 구분)
export const NOTICE_TYPES = [...Object.values(CAMPAIGN), NOTIFY.RESULT, NOTIFY.SCHEDULE_SHIFT]

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

// 사전 알림(곧 호출 예정) 페이로드 — 앞 경기가 진행 중이라 곧 코트가 비는 팀에게.
export function buildMatchSoon({ match, tournamentId, court, sport, aheadCount }) {
  const c = court ?? match?.court_number ?? null
  const ahead = typeof aheadCount === 'number' ? aheadCount : null
  return {
    type: NOTIFY.MATCH_SOON,
    tournamentId,
    matchId: match?.id ?? null,
    court: c,
    sport: sport ?? null,
    entryIds: [match?.team1_entry_id, match?.team2_entry_id].filter(Boolean),
    aheadCount: ahead,
    title: '⏳ 곧 경기 호출',
    body: c != null
      ? `곧 ${c}번 코트로 호출돼요. 코트 근처에서 준비해주세요!`
      : '곧 호출될 예정이에요. 코트 근처에서 준비해주세요!',
    createdAt: new Date().toISOString(),
  }
}

// 미입장 부전승 경고(곧 부전승) 페이로드 — 호출했는데 응답이 없는 팀에게.
export function buildWalkoverWarn({ match, tournamentId, court, sport, secondsLeft }) {
  const c = court ?? match?.court_number ?? null
  const secs = typeof secondsLeft === 'number' ? Math.max(0, secondsLeft) : null
  const mins = secs != null ? Math.max(1, Math.ceil(secs / 60)) : null
  return {
    type: NOTIFY.WALKOVER_WARN,
    tournamentId,
    matchId: match?.id ?? null,
    court: c,
    sport: sport ?? null,
    entryIds: [match?.team1_entry_id, match?.team2_entry_id].filter(Boolean),
    secondsLeft: secs,
    title: '⚠️ 미입장 부전승 경고',
    body: c != null
      ? (mins != null
          ? `${c}번 코트 호출에 응답이 없어요. ${mins}분 내 입장하지 않으면 부전승 처리될 수 있어요!`
          : `${c}번 코트 호출에 응답이 없어요. 지금 바로 입장하지 않으면 부전승 처리될 수 있어요!`)
      : '경기 호출에 응답이 없어요. 지금 바로 입장하지 않으면 부전승 처리될 수 있어요!',
    createdAt: new Date().toISOString(),
  }
}

// 채널이 SUBSCRIBED 될 때까지 기다린다(최대 2초). 방송은 구독 완료 후에만 도달한다.
function waitSubscribed(ch) {
  return new Promise(resolve => {
    let done = false
    let timer = null
    const finish = () => { if (!done) { done = true; if (timer) clearTimeout(timer); resolve() } }
    ch.subscribe(status => { if (status === 'SUBSCRIBED') finish() })
    timer = setTimeout(finish, 2000)
  })
}

// notifications 테이블 저장용 행 — persist/persistBatch 공용(단일 소스).
export function notificationRow(payload, recipientId) {
  return {
    recipient_id: recipientId,
    tournament_id: payload.tournamentId,
    match_id: payload.matchId ?? null,
    type: payload.type,
    title: payload.title,
    body: payload.body,
    payload,
    channels: ['in_app'],
    status: 'sent',
  }
}

// ── 채널 1: 인앱 실시간 방송 (스키마 불필요) ───────────────────────────
async function broadcast(payload) {
  if (!payload?.tournamentId) return { sent: false }
  const ch = supabase.channel(notifyChannel(payload.tournamentId))
  await waitSubscribed(ch)
  try {
    await ch.send({ type: 'broadcast', event: payload.type, payload })
  } finally {
    supabase.removeChannel(ch)
  }
  return { sent: true }
}

// 여러 페이로드를 한 채널 구독으로 연달아 방송한다(모두 같은 대회 채널이므로 재사용).
//   낱개 broadcast() 를 N번 부르면 매번 채널을 새로 열고 SUBSCRIBED 를 최대 2초씩
//   기다려 무인 오케스트레이터의 동시 호출이 직렬로 밀린다(코트 여러 개가 한꺼번에
//   비면 N×2초). 채널 하나만 구독해 한 번의 대기로 전부 보내 그 지연을 없앤다.
async function broadcastBatch(tournamentId, payloads) {
  const list = (payloads ?? []).filter(p => p?.type)
  if (!tournamentId || !list.length) return { sent: false, count: 0 }
  const ch = supabase.channel(notifyChannel(tournamentId))
  await waitSubscribed(ch)
  try {
    for (const p of list) {
      await ch.send({ type: 'broadcast', event: p.type, payload: p })
    }
  } finally {
    supabase.removeChannel(ch)
  }
  return { sent: true, count: list.length }
}

// ── 채널 2: 지속 저장 (테이블 없으면 degrade) ──────────────────────────
async function persist(payload, recipients = []) {
  const ids = [...new Set(recipients.filter(Boolean))]
  if (!ids.length) return { persisted: false, reason: 'no_recipients' }
  const rows = ids.map(rid => notificationRow(payload, rid))
  return insertNotifications(rows)
}

// 여러 (payload, recipients) 조합을 한 번의 insert 로 저장(낱개 insert N회 → 1회).
async function persistBatch(items) {
  const rows = []
  for (const it of items ?? []) {
    const ids = [...new Set((it.recipients ?? []).filter(Boolean))]
    for (const rid of ids) rows.push(notificationRow(it.payload, rid))
  }
  if (!rows.length) return { persisted: false, reason: 'no_recipients' }
  return insertNotifications(rows)
}

async function insertNotifications(rows) {
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

// ── 고수준 진입점: 사전 알림(곧 호출) ──────────────────────────────────
// 빈 코트 자동 투입 오케스트레이터가, 다음 차례 팀에게 미리 "곧 호출" 을 보낸다.
export async function callMatchSoon({ match, tournamentId, court, sport, aheadCount, recipients = [] }) {
  const payload = buildMatchSoon({ match, tournamentId, court, sport, aheadCount })
  const bc = await broadcast(payload)
  const ps = await persist(payload, recipients)
  const ex = dispatchExternal(payload, recipients)
  return { payload, broadcast: bc, persist: ps, external: ex }
}

// ── 고수준 진입점: 미입장 부전승 경고 (C7) ────────────────────────────
// 노쇼 타이머가 경고 임계를 넘긴 팀에게 "곧 부전승" 을 1회 보낸다.
export async function callWalkoverWarn({ match, tournamentId, court, sport, secondsLeft, recipients = [] }) {
  const payload = buildWalkoverWarn({ match, tournamentId, court, sport, secondsLeft })
  const bc = await broadcast(payload)
  const ps = await persist(payload, recipients)
  const ex = dispatchExternal(payload, recipients)
  return { payload, broadcast: bc, persist: ps, external: ex }
}

// ── 고수준 진입점: 경기 호출 배치 (무인 오케스트레이터용) ──────────────
// 빈 코트가 여러 개 한꺼번에 비면 오케스트레이터가 여러 경기를 동시에 호출한다.
// 낱개 callMatch/callMatchSoon 를 순차 await 하면 매번 채널 구독(최대 2초)을
// 기다려 호출이 직렬로 밀리므로(코트 N개면 N×2초), 한 대회 채널 하나로 방송을
// 모으고 지속 저장도 한 번의 insert 로 처리한다. 결과는 항목별로 되돌려 준다.
//   calls: [{ match, court, sport, recipients }]
//   soons: [{ match, court, sport, aheadCount, recipients }]
export function buildCallBatchItems({ tournamentId, calls = [], soons = [] }) {
  const callItems = calls.map(c => ({
    kind: 'call', match: c.match,
    payload: buildMatchCall({ match: c.match, tournamentId, court: c.court, sport: c.sport }),
    recipients: c.recipients ?? [],
  }))
  const soonItems = soons.map(s => ({
    kind: 'soon', match: s.match,
    payload: buildMatchSoon({ match: s.match, tournamentId, court: s.court, sport: s.sport, aheadCount: s.aheadCount }),
    recipients: s.recipients ?? [],
  }))
  return [...callItems, ...soonItems]
}

export async function callMatchBatch({ tournamentId, calls = [], soons = [] }) {
  const items = buildCallBatchItems({ tournamentId, calls, soons })
  if (!items.length) return { sent: 0, broadcast: { sent: false, count: 0 }, persist: { persisted: false }, items: [] }
  const bc = await broadcastBatch(tournamentId, items.map(i => i.payload))
  const ps = await persistBatch(items)
  // 외부 발송(웹푸시/알림톡/SMS)은 human-gated 스텁 — 항목별로 위임(키 없으면 no-op).
  items.forEach(it => dispatchExternal(it.payload, it.recipients))
  return { sent: items.length, broadcast: bc, persist: ps, items }
}

// ── 고수준 진입점: 사후 커뮤니케이션 캠페인 (C11) ──────────────────────
// 대회 생애주기 안내(전날/당일 리마인더·감사·설문)를 참가자에게 팬아웃한다.
// 경기 호출과 동일하게 3채널(인앱 방송·지속 저장·외부 스텁)을 쓰되 matchId 는 없다.
export async function sendCampaign({ type, tournamentId, title, body, recipients = [], data = {} }) {
  const payload = {
    type,
    tournamentId,
    matchId: null,
    title,
    body,
    ...data,
    createdAt: new Date().toISOString(),
  }
  const bc = await broadcast(payload)
  const ps = await persist(payload, recipients)   // 공지함에 남으려면 지속 저장이 핵심
  const ex = dispatchExternal(payload, recipients) // 실발송은 human-gated 스텁
  return { payload, broadcast: bc, persist: ps, external: ex }
}

// ── 수신자 헬퍼: 내 대회들의 알림 채널 구독 ────────────────────────────
// tournamentIds 각각에 대해 broadcast 를 듣고, 모든 NOTIFY·CAMPAIGN 이벤트를 handler 로 넘긴다.
// 반환값은 정리 함수(unsubscribe).
export function subscribeNotifications(tournamentIds, handler) {
  const ids = [...new Set((tournamentIds ?? []).filter(Boolean))]
  const events = [...Object.values(NOTIFY), ...Object.values(CAMPAIGN)]
  const chans = ids.map(tid => {
    const ch = supabase.channel(notifyChannel(tid))
    events.forEach(evt => {
      ch.on('broadcast', { event: evt }, ({ payload }) => {
        try { handler(payload) } catch { /* 수신 콜백 오류는 구독을 죽이지 않는다 */ }
      })
    })
    ch.subscribe()
    return ch
  })
  return () => chans.forEach(c => supabase.removeChannel(c))
}

// ── 공지함(inbox): 내가 받은 지속형 안내·공지 최근 목록 ─────────────────
// 경기 호출/사전알림 같은 전송성 알림은 배너로 처리하므로 제외하고,
// 캠페인·결과·일정변경 같은 "남겨두고 볼" 공지만 모은다. 테이블 없으면 빈 배열.
export async function fetchNotices(recipientId, { withinDays = 45, limit = 30 } = {}) {
  if (!recipientId) return []
  try {
    const since = new Date(Date.now() - withinDays * 86400000).toISOString()
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('recipient_id', recipientId)
      .in('type', NOTICE_TYPES)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    return data ?? []
  } catch {
    return [] // 013 미적용 시 조용히 degrade
  }
}

// 공지 읽음 처리 — markCallRead 와 동일한 갱신(테이블 없으면 no-op).
export const markNoticeRead = markCallRead

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

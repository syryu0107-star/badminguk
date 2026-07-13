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

// 선수→주최자 신호 (C1) — 호출에 대한 선수 응답. 호출(NOTIFY)과 방향이 반대라
// 별도 이벤트로 두고, 지속 저장 없이 대회 채널 방송으로만 도달한다(무인 대시보드가
// 실시간으로 소비하는 순간 신호 — 재호출마다 다시 확인하면 되므로 이력은 불필요).
export const SIGNAL = {
  CALL_ACK: 'call_ack',   // "가고 있어요" — 선수가 호출을 확인함
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

// ── 결과·급수 개인 알림 (C11 · C10) ───────────────────────────────────
// 대회 종료(finalizeTournament) 직후 참가자 각자에게 "최종 순위·급수 승급" 을 담아
// 공지함에 남긴다. 캠페인(THANKS)이 대회 전체에 같은 문구를 뿌리는 것과 달리 이건
// **선수별 개인 결과**라, 대회 채널로 방송하면 다른 선수 화면에 남의 결과가 노출된다
// → 방송하지 않고 recipient 로 스코프되는 지속 저장(persist)만 쓴다. 선수는 다음에
// 공지함(fetchNotices)·결과 화면을 열 때 자기 결과만 본다(013 RLS: 본인 알림만 조회).
//
// buildResultNotice: 한 선수의 순위 요약 + 승급을 초보용 문구로 조립(순수).
export function buildResultNotice({ tournamentId, tournamentName, ranks = [], gradeTo = null }) {
  const name = tournamentName || '대회'
  const valid = (ranks ?? []).filter(r => r && r.rank != null)
  const best = valid.reduce((m, r) => (m == null || r.rank < m ? r.rank : m), null)
  const medal = best === 1 ? '🥇' : best === 2 ? '🥈' : best === 3 ? '🥉' : '🏆'
  const rankText = valid.map(r => `${r.categoryName ?? '종목'} ${r.rank}위`).join(' · ')
  const parts = []
  if (rankText) parts.push(rankText)
  if (gradeTo) parts.push(`🎉 ${gradeTo} 급수로 승급했어요`)
  parts.push('상장과 급수 반영을 앱에서 확인해보세요.')
  return {
    type: NOTIFY.RESULT,
    tournamentId: tournamentId ?? null,
    matchId: null,
    title: `${medal} ${name} 결과가 나왔어요`,
    body: parts.join(' · '),
    ranks: valid,
    gradeTo: gradeTo ?? null,
    podium: best != null && best <= 3,
    createdAt: new Date().toISOString(),
  }
}

// buildResultNotices: finalize 산출물(byCategory·promotions) + 엔트리→선수 매핑을 받아
// 선수별 { payload, recipients:[playerId] } 배열로 만든다(순수 — DB 접근 없음).
//   byCategory : { [categoryId]: [{ entryId, rank }] }  (finalizeTournament 반환)
//   categories : [{ id, sport_type }]                   (종목 이름)
//   entries    : [{ id, player1_id, player2_id }]        (엔트리→선수)
//   promotions : [{ player_id, to_grade }]               (승급 심사 결과)
// 한 선수가 여러 종목에 나갔으면 한 알림에 순위를 모아 담는다(순위 오름차순).
// 게스트·미가입(player_id null)은 수신 대상에서 제외한다.
export function buildResultNotices({
  tournamentId, tournamentName, byCategory = {}, categories = [], entries = [], promotions = [],
}) {
  const catName = {}
  for (const c of categories ?? []) catName[c.id] = c.sport_type ?? c.name ?? '종목'

  const entryMeta = {} // entryId → { categoryId, rank, total }
  for (const [catId, ranks] of Object.entries(byCategory ?? {})) {
    const total = (ranks ?? []).length
    for (const r of ranks ?? []) {
      if (!r || r.entryId == null || r.rank == null) continue
      entryMeta[r.entryId] = { categoryId: catId, rank: r.rank, total }
    }
  }

  const gradeBy = {} // playerId → to_grade
  for (const p of promotions ?? []) {
    if (p?.player_id) gradeBy[p.player_id] = p.to_grade ?? p.grade ?? null
  }

  const byPlayer = {} // playerId → [{ categoryName, rank, total }]
  for (const e of entries ?? []) {
    const meta = entryMeta[e?.id]
    if (!meta) continue
    const line = { categoryName: catName[meta.categoryId] ?? '종목', rank: meta.rank, total: meta.total }
    for (const pid of [e.player1_id, e.player2_id]) {
      if (!pid) continue
      if (!byPlayer[pid]) byPlayer[pid] = []
      byPlayer[pid].push(line)
    }
  }

  return Object.keys(byPlayer).map(pid => ({
    payload: buildResultNotice({
      tournamentId,
      tournamentName,
      ranks: byPlayer[pid].slice().sort((a, b) => a.rank - b.rank),
      gradeTo: gradeBy[pid] ?? null,
    }),
    recipients: [pid],
  }))
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
// 재알림(호출 반복)·미입장 경고도 여러 경기가 동시에 무응답이면 낱개 발송이
// 그만큼 채널을 새로 열고 insert 를 N회 한다 → warns 로 함께 배치해 낭비를 없앤다.
//   calls: [{ match, court, sport, recipients }]           (호출·재알림 공용)
//   soons: [{ match, court, sport, aheadCount, recipients }]
//   warns: [{ match, court, sport, secondsLeft, recipients }] (미입장 부전승 경고)
export function buildCallBatchItems({ tournamentId, calls = [], soons = [], warns = [] }) {
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
  const warnItems = warns.map(w => ({
    kind: 'warn', match: w.match,
    payload: buildWalkoverWarn({ match: w.match, tournamentId, court: w.court, sport: w.sport, secondsLeft: w.secondsLeft }),
    recipients: w.recipients ?? [],
  }))
  return [...callItems, ...soonItems, ...warnItems]
}

export async function callMatchBatch({ tournamentId, calls = [], soons = [], warns = [] }) {
  const items = buildCallBatchItems({ tournamentId, calls, soons, warns })
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

// ── 일정 지연 안내 (C6 · C1) — 진행이 밀릴 때 선수에게 프로액티브 통지 ──────
// analyzeDelay(주최자 대시보드)가 낸 예상 지연을 지금껏 주최자만 봤다. 선수는 앱을
// 직접 열어 "예상 시작" 카드를 봐야 지연을 알았다. 이 안내는 진행이 계획보다 크게
// 밀리면 아직 순서가 안 온 선수에게 "약 N분 지연되고 있어요 — 여유있게 준비하세요"를
// 밀어준다. 경기 호출(match_call, "지금 오세요")과 달리 **대회 전체 안내**라 엔트리
// 타겟이 없고, 대회 채널로 방송해 공지함(NOTICE_TYPES ∋ SCHEDULE_SHIFT)에 남긴다.
// buildScheduleShift 는 순수 — 발송은 sendScheduleShift 가 담당.
export function buildScheduleShift({ tournamentId, delayMin, kind = 'delay' }) {
  const mins = Math.max(0, Math.round(delayMin ?? 0))
  return {
    type: NOTIFY.SCHEDULE_SHIFT,
    tournamentId: tournamentId ?? null,
    matchId: null,
    kind,
    delayMin: mins,
    title: '⏳ 경기 진행 지연 안내',
    body: `현재 예상보다 약 ${mins}분 지연되고 있어요. 순서가 되면 다시 알려드릴게요 — 여유있게 준비해주세요.`,
    createdAt: new Date().toISOString(),
  }
}

// 대회 전체 지연 안내 발송 — 방송(연결된 선수 공지함 즉시 도달) + 지속 저장(오프라인·복귀
// 선수 도달). 방송은 대회 채널이라 done 선수도 인앱으로 보지만 대회 정보라 무해하고,
// persist recipients 는 아직 대기 중인(미완료 경기) 선수로 좁혀 알림 이력을 남긴다.
export async function sendScheduleShift({ tournamentId, delayMin, kind = 'delay', recipients = [] }) {
  if (!tournamentId) return { sent: false, reason: 'no_tournament' }
  const payload = buildScheduleShift({ tournamentId, delayMin, kind })
  const bc = await broadcast(payload)
  const ps = await persist(payload, recipients)
  return { payload, broadcast: bc, persist: ps }
}

// ── 고수준 진입점: 결과·급수 개인 알림 (C11 · C10) ─────────────────────
// finalizeTournament 직후 호출부(LiveDashboard)가 부른다. 엔트리→선수 매핑만 조회하고
// 선수별 personalized 결과를 **한 번의 insert 로 지속 저장**한다(방송 없음 — 개인 결과라
// 대회 채널 방송 시 남의 결과가 노출됨). 013 미적용 시 persistBatch 가 조용히 degrade.
export async function sendResultNotices({ tournamentId, tournamentName, byCategory = {}, categories = [], promotions = [] }) {
  if (!tournamentId) return { sent: false, count: 0, reason: 'no_tournament' }
  const entryIds = [...new Set(
    Object.values(byCategory ?? {}).flatMap(ranks => (ranks ?? []).map(r => r?.entryId).filter(Boolean))
  )]
  if (!entryIds.length) return { sent: false, count: 0, reason: 'no_ranks' }

  let entries = []
  try {
    const { data, error } = await supabase
      .from('tournament_entries')
      .select('id, player1_id, player2_id')
      .in('id', entryIds)
    if (error) throw error
    entries = data ?? []
  } catch {
    return { sent: false, count: 0, reason: 'entries_unavailable' } // 조회 실패 시 시상은 이미 확정 — 막지 않음
  }

  const items = buildResultNotices({ tournamentId, tournamentName, byCategory, categories, entries, promotions })
  if (!items.length) return { sent: false, count: 0, reason: 'no_recipients' }
  const ps = await persistBatch(items)
  return { sent: ps.persisted === true, count: items.length, persist: ps }
}

// ── 선수 호출 확인(ack) 발신/수신 (C1) ────────────────────────────────
// 선수가 호출 배너에서 "가고 있어요" 를 누르면 대회 채널로 확인 신호를 방송한다.
// 지속 저장·외부 발송 없음(오는 중인 선수를 노쇼 타이머가 봐주게 하는 순간 신호).
export function buildCallAck({ tournamentId, matchId, entryIds = [], court = null, sport = null }) {
  return {
    type: SIGNAL.CALL_ACK,
    tournamentId,
    matchId: matchId ?? null,
    entryIds: (entryIds ?? []).filter(Boolean),
    court,
    sport,
    createdAt: new Date().toISOString(),
  }
}

export async function ackMatchCall({ tournamentId, matchId, entryIds = [], court, sport }) {
  const payload = buildCallAck({ tournamentId, matchId, entryIds, court, sport })
  const bc = await broadcast(payload)   // 방송만 — 이력 저장 불필요
  return { payload, broadcast: bc }
}

// 주최자(무인 대시보드)가 선수 호출 확인을 실시간으로 받는다. 반환값은 정리 함수.
export function subscribeCallAcks(tournamentId, handler) {
  if (!tournamentId) return () => {}
  const ch = supabase.channel(notifyChannel(tournamentId))
  ch.on('broadcast', { event: SIGNAL.CALL_ACK }, ({ payload }) => {
    try { handler(payload) } catch { /* 수신 콜백 오류는 구독을 죽이지 않는다 */ }
  })
  ch.subscribe()
  return () => supabase.removeChannel(ch)
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

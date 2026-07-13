// ── notify.js / campaign.js 회귀 테스트 (C1 호출 인프라 + C11 캠페인) ─────
// notify.js 의 페이로드 빌더(호출·사전알림·부전승 경고 문구)와 campaign.js 의
// 발송 판정 상태머신(전날/당일/감사/설문)이 깨지면, 선수가 **엉뚱한 코트로
// 불려가거나(잘못된 body/court)** · **때 아닌 안내가 나가거나(due 오판)** ·
// **참가하지도 않은 사람에게 발송(수신자 오집계)** 되는데, 지금껏 이 두 엔진은
// import.meta.env + 실 Supabase 싱글턴 의존이라 커밋된 테스트가 0이었다.
// (ext-loader 가 테스트에서 env 를 shim + `./supabase` 를 스텁으로 리다이렉트한다.)
import { test, assert } from './_harness.mjs'
import { makeSupabase } from './_supabase-stub.mjs'
import {
  NOTIFY, SIGNAL, CAMPAIGN, NOTICE_TYPES, notifyChannel,
  buildMatchCall, buildMatchSoon, buildWalkoverWarn, buildCallAck,
  buildCallBatchItems, notificationRow, callMatchBatch,
} from '../src/lib/notify.js'
import {
  localDateStr, dayDiff, planCampaigns, pendingCampaigns,
  loadSentCampaigns, markCampaignSent, fetchCampaignRecipients,
} from '../src/lib/campaign.js'

// campaign 의 idempotency 는 localStorage 기반 → 테스트용 최소 shim
if (!globalThis.localStorage) {
  const store = new Map()
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
  }
}

// ══════════════════════ notify: 상수·채널 ══════════════════════
test('notify: notifyChannel — 발신/수신 동일 이름', () => {
  assert.equal(notifyChannel('t1'), 'tourn-notify-t1')
})

test('notify: NOTICE_TYPES — 공지함용 지속형만 포함, 전송성 호출 제외', () => {
  // 캠페인 4종 + 결과 + 일정변경은 포함
  for (const t of Object.values(CAMPAIGN)) assert.ok(NOTICE_TYPES.includes(t))
  assert.ok(NOTICE_TYPES.includes(NOTIFY.RESULT))
  assert.ok(NOTICE_TYPES.includes(NOTIFY.SCHEDULE_SHIFT))
  // 즉시 배너로 처리되는 전송성 호출은 공지함에서 제외
  assert.ok(!NOTICE_TYPES.includes(NOTIFY.MATCH_CALL))
  assert.ok(!NOTICE_TYPES.includes(NOTIFY.MATCH_SOON))
  assert.ok(!NOTICE_TYPES.includes(NOTIFY.WALKOVER_WARN))
})

// ══════════════════════ notify: buildCallAck (선수 호출 확인) ══════════════════════
test('notify: buildCallAck — 선수 확인 신호 페이로드(entryIds null 제거)', () => {
  const p = buildCallAck({ tournamentId: 't1', matchId: 'm1', entryIds: ['e1', null, 'e2'], court: 4, sport: '남복' })
  assert.equal(p.type, SIGNAL.CALL_ACK)
  assert.equal(p.type, 'call_ack')
  assert.equal(p.tournamentId, 't1')
  assert.equal(p.matchId, 'm1')
  assert.equal(p.court, 4)
  assert.deepEqual(p.entryIds, ['e1', 'e2'])
  assert.ok(typeof p.createdAt === 'string')
  // 호출 확인은 공지함에 남지 않는 순간 신호
  assert.ok(!NOTICE_TYPES.includes(p.type))
})

test('notify: buildCallAck — 인자 없어도 안전(빈 배열·null)', () => {
  const p = buildCallAck({ tournamentId: 't1' })
  assert.deepEqual(p.entryIds, [])
  assert.equal(p.matchId, null)
  assert.equal(p.court, null)
})

// ══════════════════════ notify: buildMatchCall ══════════════════════
test('notify: buildMatchCall — court 인자 우선, entryIds 는 null 제거', () => {
  const p = buildMatchCall({
    match: { id: 'm1', team1_entry_id: 'a', team2_entry_id: null, court_number: 3 },
    tournamentId: 't', court: 5, sport: '남복',
  })
  assert.equal(p.type, NOTIFY.MATCH_CALL)
  assert.equal(p.court, 5)                 // 넘겨준 court 가 match.court_number(3) 보다 우선
  assert.equal(p.matchId, 'm1')
  assert.equal(p.sport, '남복')
  assert.deepEqual(p.entryIds, ['a'])      // null team2 제거
  assert.equal(p.body, '지금 5번 코트로 입장해주세요!')
  assert.ok(typeof p.createdAt === 'string')
})

test('notify: buildMatchCall — court 미지정 시 match.court_number 폴백', () => {
  const p = buildMatchCall({
    match: { id: 'm1', team1_entry_id: 'a', team2_entry_id: 'b', court_number: 7 },
    tournamentId: 't',
  })
  assert.equal(p.court, 7)
  assert.deepEqual(p.entryIds, ['a', 'b'])
  assert.equal(p.body, '지금 7번 코트로 입장해주세요!')
})

test('notify: buildMatchCall — 코트 없음 시 현장 안내 문구', () => {
  const p = buildMatchCall({ match: { id: 'm', team1_entry_id: 'a', team2_entry_id: 'b' }, tournamentId: 't' })
  assert.equal(p.court, null)
  assert.equal(p.body, '지금 코트로 입장해주세요! (현장 안내를 따라주세요)')
})

// ══════════════════════ notify: buildMatchSoon ══════════════════════
test('notify: buildMatchSoon — aheadCount 숫자 보존 + 코트 문구', () => {
  const p = buildMatchSoon({ match: { id: 'm', court_number: 2 }, tournamentId: 't', aheadCount: 2 })
  assert.equal(p.type, NOTIFY.MATCH_SOON)
  assert.equal(p.court, 2)
  assert.equal(p.aheadCount, 2)
  assert.equal(p.body, '곧 2번 코트로 호출돼요. 코트 근처에서 준비해주세요!')
})

test('notify: buildMatchSoon — aheadCount 비숫자→null, 코트 없음 문구', () => {
  const p = buildMatchSoon({ match: { id: 'm' }, tournamentId: 't' })
  assert.equal(p.aheadCount, null)
  assert.equal(p.court, null)
  assert.equal(p.body, '곧 호출될 예정이에요. 코트 근처에서 준비해주세요!')
})

// ══════════════════════ notify: buildWalkoverWarn ══════════════════════
test('notify: buildWalkoverWarn — 초→분 올림(90s=2분), 코트 문구', () => {
  const p = buildWalkoverWarn({ match: { id: 'm', court_number: 4 }, tournamentId: 't', secondsLeft: 90 })
  assert.equal(p.type, NOTIFY.WALKOVER_WARN)
  assert.equal(p.secondsLeft, 90)
  assert.equal(p.body, '4번 코트 호출에 응답이 없어요. 2분 내 입장하지 않으면 부전승 처리될 수 있어요!')
})

test('notify: buildWalkoverWarn — 30s 는 최소 1분으로 표기', () => {
  const p = buildWalkoverWarn({ match: { id: 'm', court_number: 4 }, tournamentId: 't', secondsLeft: 30 })
  assert.ok(p.body.includes('1분 내'))
})

test('notify: buildWalkoverWarn — 음수 초는 0으로 클램프(최소 1분)', () => {
  const p = buildWalkoverWarn({ match: { id: 'm', court_number: 4 }, tournamentId: 't', secondsLeft: -5 })
  assert.equal(p.secondsLeft, 0)
  assert.ok(p.body.includes('1분 내'))
})

test('notify: buildWalkoverWarn — secondsLeft 없으면 "지금 바로" 문구', () => {
  const p = buildWalkoverWarn({ match: { id: 'm', court_number: 4 }, tournamentId: 't' })
  assert.equal(p.secondsLeft, null)
  assert.equal(p.body, '4번 코트 호출에 응답이 없어요. 지금 바로 입장하지 않으면 부전승 처리될 수 있어요!')
})

test('notify: buildWalkoverWarn — 코트 없음 폴백', () => {
  const p = buildWalkoverWarn({ match: { id: 'm' }, tournamentId: 't', secondsLeft: 60 })
  assert.equal(p.court, null)
  assert.equal(p.body, '경기 호출에 응답이 없어요. 지금 바로 입장하지 않으면 부전승 처리될 수 있어요!')
})

// ══════════════════════ notify: notificationRow ══════════════════════
test('notify: notificationRow — 지속 저장 행 스키마', () => {
  const payload = buildMatchCall({ match: { id: 'm1', team1_entry_id: 'a', team2_entry_id: 'b', court_number: 3 }, tournamentId: 't1' })
  const row = notificationRow(payload, 'u1')
  assert.equal(row.recipient_id, 'u1')
  assert.equal(row.tournament_id, 't1')
  assert.equal(row.match_id, 'm1')
  assert.equal(row.type, NOTIFY.MATCH_CALL)
  assert.equal(row.status, 'sent')
  assert.deepEqual(row.channels, ['in_app'])
  assert.equal(row.payload, payload)
})

test('notify: notificationRow — matchId 없는 페이로드(캠페인)는 match_id null', () => {
  const row = notificationRow({ type: CAMPAIGN.THANKS, tournamentId: 't', title: 'x', body: 'y' }, 'u1')
  assert.equal(row.match_id, null)
})

// ══════════════════════ notify: buildCallBatchItems ══════════════════════
test('notify: buildCallBatchItems — 호출·사전알림 항목을 정확히 구성', () => {
  const items = buildCallBatchItems({
    tournamentId: 't',
    calls: [{ match: { id: 'm1', court_number: 1, team1_entry_id: 'a', team2_entry_id: 'b' }, court: 1, sport: '남복', recipients: ['a', 'b'] }],
    soons: [{ match: { id: 'm2', court_number: 2 }, court: 2, sport: '여복', aheadCount: 1, recipients: ['c'] }],
  })
  assert.equal(items.length, 2)
  // 호출 항목
  assert.equal(items[0].kind, 'call')
  assert.equal(items[0].payload.type, NOTIFY.MATCH_CALL)
  assert.equal(items[0].payload.court, 1)
  assert.deepEqual(items[0].recipients, ['a', 'b'])
  assert.equal(items[0].payload.body, '지금 1번 코트로 입장해주세요!')
  // 사전 알림 항목
  assert.equal(items[1].kind, 'soon')
  assert.equal(items[1].payload.type, NOTIFY.MATCH_SOON)
  assert.equal(items[1].payload.aheadCount, 1)
  assert.deepEqual(items[1].recipients, ['c'])
})

test('notify: buildCallBatchItems — 빈 입력 → 빈 배열, recipients 기본값 []', () => {
  assert.deepEqual(buildCallBatchItems({ tournamentId: 't' }), [])
  const items = buildCallBatchItems({ tournamentId: 't', calls: [{ match: { id: 'm', court_number: 5 } }] })
  assert.equal(items.length, 1)
  assert.deepEqual(items[0].recipients, [])  // recipients 미지정 폴백
})

test('notify: buildCallBatchItems — warns(미입장 경고)를 부전승 경고 페이로드로 구성', () => {
  const items = buildCallBatchItems({
    tournamentId: 't',
    calls: [{ match: { id: 'm1', court_number: 1 }, court: 1, recipients: ['a'] }],  // 재알림도 호출 페이로드
    warns: [{ match: { id: 'm2', court_number: 2 }, court: 2, secondsLeft: 90, recipients: ['c', 'd'] }],
  })
  assert.equal(items.length, 2)
  // 재알림 항목은 MATCH_CALL(호출 반복)
  assert.equal(items[0].kind, 'call')
  assert.equal(items[0].payload.type, NOTIFY.MATCH_CALL)
  // 경고 항목은 WALKOVER_WARN + 초→분 올림 문구
  assert.equal(items[1].kind, 'warn')
  assert.equal(items[1].payload.type, NOTIFY.WALKOVER_WARN)
  assert.equal(items[1].payload.secondsLeft, 90)
  assert.equal(items[1].payload.body, '2번 코트 호출에 응답이 없어요. 2분 내 입장하지 않으면 부전승 처리될 수 있어요!')
  assert.deepEqual(items[1].recipients, ['c', 'd'])
})

// ══════════════════════ notify: callMatchBatch (배치 발송) ══════════════════════
test('notify: callMatchBatch — 빈 입력이면 발송 0, 채널/insert 미사용', async () => {
  const res = await callMatchBatch({ tournamentId: 't', calls: [], soons: [] })
  assert.equal(res.sent, 0)
  assert.equal(res.broadcast.sent, false)
  assert.deepEqual(res.items, [])
})

test('notify: callMatchBatch — 여러 경기를 한 채널로 방송하고 항목을 되돌려줌', async () => {
  const res = await callMatchBatch({
    tournamentId: 't',
    calls: [
      { match: { id: 'm1', court_number: 1, team1_entry_id: 'a', team2_entry_id: 'b' }, court: 1, recipients: ['a', 'b'] },
      { match: { id: 'm2', court_number: 2, team1_entry_id: 'c', team2_entry_id: 'd' }, court: 2, recipients: ['c', 'd'] },
    ],
    soons: [{ match: { id: 'm3', court_number: 3 }, court: 3, aheadCount: 2, recipients: ['e', 'f'] }],
  })
  assert.equal(res.sent, 3)
  assert.equal(res.broadcast.sent, true)
  assert.equal(res.broadcast.count, 3)     // 세 경기 모두 단일 구독으로 방송
  assert.equal(res.items.length, 3)
  assert.equal(res.items[0].match.id, 'm1')
  assert.equal(res.items[2].kind, 'soon')
})

test('notify: callMatchBatch — 재알림(calls)+경고(warns)를 한 채널로 함께 방송', async () => {
  const res = await callMatchBatch({
    tournamentId: 't',
    calls: [{ match: { id: 'r1', court_number: 1, team1_entry_id: 'a', team2_entry_id: 'b' }, court: 1, recipients: ['a', 'b'] }],
    warns: [{ match: { id: 'w1', court_number: 2, team1_entry_id: 'c', team2_entry_id: 'd' }, court: 2, secondsLeft: 60, recipients: ['c', 'd'] }],
  })
  assert.equal(res.sent, 2)
  assert.equal(res.broadcast.count, 2)     // 재알림 1 + 경고 1을 단일 구독으로 방송
  const kinds = res.items.map(i => i.kind)
  assert.ok(kinds.includes('call') && kinds.includes('warn'))
})

// ══════════════════════ campaign: 날짜 유틸 ══════════════════════
test('campaign: localDateStr — 로컬 자정 YYYY-MM-DD', () => {
  assert.equal(localDateStr(new Date(2026, 6, 5)), '2026-07-05') // month index 6 = 7월
})

test('campaign: dayDiff — 내일/오늘/어제', () => {
  const now = new Date(2026, 6, 11)
  assert.equal(dayDiff('2026-07-12', now), 1)
  assert.equal(dayDiff('2026-07-11', now), 0)
  assert.equal(dayDiff('2026-07-10', now), -1)
})

test('campaign: dayDiff — datetime 앞 10자만 파싱(타임존 밀림 방지)', () => {
  assert.equal(dayDiff('2026-07-11T09:30:00', new Date(2026, 6, 11)), 0)
})

test('campaign: dayDiff — 파싱 불가/빈 값은 null', () => {
  const now = new Date(2026, 6, 11)
  assert.equal(dayDiff(null, now), null)
  assert.equal(dayDiff('not-a-date', now), null)
  assert.equal(dayDiff('2026/07/12', now), null) // 슬래시 포맷 불허
})

// ══════════════════════ campaign: planCampaigns 상태머신 ══════════════════════
const T = (over = {}) => ({ title: '여름오픈', venue: '서울체육관', date: '2026-07-12', status: 'open', ...over })
const NOW_D1 = new Date(2026, 6, 11) // 대회일(2026-07-12) 하루 전

test('campaign: planCampaigns — 접수중 + D-1 → 전날 안내', () => {
  const out = planCampaigns(T({ status: 'open' }), { now: NOW_D1 })
  assert.equal(out.length, 1)
  assert.equal(out[0].type, CAMPAIGN.REMIND_D1)
  assert.equal(out[0].kind, 'pre')
  assert.equal(out[0].label, '전날 안내')
  assert.ok(out[0].body.includes('여름오픈'))
  assert.ok(out[0].body.includes('서울체육관'))
})

test('campaign: planCampaigns — 마감 + D-1 도 전날 안내', () => {
  const out = planCampaigns(T({ status: 'closed' }), { now: NOW_D1 })
  assert.equal(out.length, 1)
  assert.equal(out[0].type, CAMPAIGN.REMIND_D1)
})

test('campaign: planCampaigns — 마감/진행중 + D-0 → 당일 안내', () => {
  const now = new Date(2026, 6, 12)
  const a = planCampaigns(T({ status: 'closed' }), { now })
  const b = planCampaigns(T({ status: 'in_progress' }), { now })
  assert.equal(a[0].type, CAMPAIGN.REMIND_DDAY)
  assert.equal(a[0].label, '당일 안내')
  assert.equal(b[0].type, CAMPAIGN.REMIND_DDAY)
})

test('campaign: planCampaigns — 접수중 D-0 는 발송 없음(당일 안내는 마감 이후만)', () => {
  const out = planCampaigns(T({ status: 'open' }), { now: new Date(2026, 6, 12) })
  assert.deepEqual(out, [])
})

test('campaign: planCampaigns — 대회 이틀 전은 발송 없음', () => {
  const out = planCampaigns(T({ status: 'open' }), { now: new Date(2026, 6, 10) })
  assert.deepEqual(out, [])
})

test('campaign: planCampaigns — 종료 → 감사 + 설문(날짜 무관)', () => {
  const out = planCampaigns(T({ status: 'completed', date: '2020-01-01' }), { now: NOW_D1 })
  assert.deepEqual(out.map(c => c.type), [CAMPAIGN.THANKS, CAMPAIGN.SURVEY])
  assert.ok(out.every(c => c.kind === 'post'))
})

test('campaign: planCampaigns — sent 집합이면 해당 항목 sent=true', () => {
  const out = planCampaigns(T({ status: 'completed' }), { now: NOW_D1, sent: new Set([CAMPAIGN.THANKS]) })
  const thanks = out.find(c => c.type === CAMPAIGN.THANKS)
  const survey = out.find(c => c.type === CAMPAIGN.SURVEY)
  assert.equal(thanks.sent, true)
  assert.equal(survey.sent, false)
})

test('campaign: planCampaigns — null 대회 안전', () => {
  assert.deepEqual(planCampaigns(null), [])
})

test('campaign: pendingCampaigns — 이미 보낸 것 제외', () => {
  const out = pendingCampaigns(T({ status: 'completed' }), { now: NOW_D1, sent: new Set([CAMPAIGN.THANKS]) })
  assert.deepEqual(out.map(c => c.type), [CAMPAIGN.SURVEY])
})

// ══════════════════════ campaign: idempotency(localStorage) ══════════════════════
test('campaign: markCampaignSent/loadSentCampaigns — 기록·중복 안전', () => {
  assert.equal(loadSentCampaigns('tourn-x').size, 0) // 초기 빈 집합
  markCampaignSent('tourn-x', CAMPAIGN.THANKS)
  markCampaignSent('tourn-x', CAMPAIGN.THANKS) // 중복
  markCampaignSent('tourn-x', CAMPAIGN.SURVEY)
  const s = loadSentCampaigns('tourn-x')
  assert.equal(s.size, 2)
  assert.ok(s.has(CAMPAIGN.THANKS) && s.has(CAMPAIGN.SURVEY))
  // 다른 대회는 격리
  assert.equal(loadSentCampaigns('tourn-y').size, 0)
})

// ══════════════════════ campaign: fetchCampaignRecipients ══════════════════════
test('campaign: fetchCampaignRecipients — approved 만·player1/2 중복제거', async () => {
  const sb = makeSupabase({
    tournament_entries: [
      { category_id: 'c1', entry_status: 'approved', player1_id: 'p1', player2_id: 'p2' },
      { category_id: 'c1', entry_status: 'approved', player1_id: 'p1', player2_id: null }, // p1 중복
      { category_id: 'c2', entry_status: 'pending', player1_id: 'p9', player2_id: 'p8' },  // 미승인
      { category_id: 'c3', entry_status: 'approved', player1_id: 'p3', player2_id: 'p4' },
    ],
  })
  const ids = await fetchCampaignRecipients(sb, ['c1', 'c3'])
  assert.deepEqual(ids, ['p1', 'p2', 'p3', 'p4'])
})

test('campaign: fetchCampaignRecipients — 빈 categoryIds → []', async () => {
  const sb = makeSupabase({ tournament_entries: [] })
  assert.deepEqual(await fetchCampaignRecipients(sb, []), [])
  assert.deepEqual(await fetchCampaignRecipients(sb, null), [])
})

test('campaign: fetchCampaignRecipients — 조회 실패 시 조용히 [] degrade', async () => {
  const broken = { from() { throw new Error('RLS 거부') } }
  assert.deepEqual(await fetchCampaignRecipients(broken, ['c1']), [])
})

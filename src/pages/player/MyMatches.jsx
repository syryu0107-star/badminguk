import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { subscribeNotifications, fetchRecentCalls, markCallRead } from '../../lib/notify'
import BottomNav from '../../components/BottomNav'
import MatchCard from '../../components/MatchCard'
import Spinner from '../../components/Spinner'
import { CalendarDays, Mail, Check, X, Clock, Megaphone } from 'lucide-react'

// ── 다음 경기 하이라이트용 상수·헬퍼 ────────────────────────────
// 이미 끝난 경기 상태 (다음 경기 후보에서 제외)
const DONE_STATUSES = ['completed', 'forfeited', 'bye']

// 경기 정렬 기준: 예정시각 → 라운드 → 경기번호 (null 은 맨 뒤)
function cmpMatches(a, b) {
  const ta = a.scheduled_time ? new Date(a.scheduled_time).getTime() : Infinity
  const tb = b.scheduled_time ? new Date(b.scheduled_time).getTime() : Infinity
  if (ta !== tb) return ta - tb
  const ra = a.round_number ?? Infinity, rb = b.round_number ?? Infinity
  if (ra !== rb) return ra - rb
  return (a.match_number ?? Infinity) - (b.match_number ?? Infinity)
}

// 내 다음 경기 판정: 진행중 우선 → 없으면 가장 이른 예정 경기
function pickNextMatch(list) {
  const live = list.find(m => m.status === 'in_progress')
  if (live) return { match: live, live: true }
  const scheduled = list.filter(m => m.status === 'scheduled').sort(cmpMatches)
  if (!scheduled.length) return null
  return { match: scheduled[0], live: false }
}

function fmtTime(ms) {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 내 관점에서 상대 팀 이름
function opponentOf(m) {
  const iAmTeam1 = m.team1_entry_id === m.myTeamEntryId
  return (iAmTeam1 ? m.team2Name : m.team1Name) || '상대 팀 미정'
}

// 다음 경기 강조 카드 (브랜드 그라데이션)
function NextMatchHighlight({ info }) {
  if (!info) return null
  const m = info.match
  const opp = opponentOf(m)
  const est = info.estimate

  return (
    <section>
      <div
        className="rounded-2xl p-5 text-white shadow-md"
        style={{ background: 'linear-gradient(135deg, #C60C30, #003478)' }}
      >
        <div className="flex items-center gap-2 mb-3">
          {info.live ? (
            <span className="flex items-center gap-1 bg-white text-[#C60C30] text-xs font-black px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-[#C60C30] animate-pulse" /> LIVE
            </span>
          ) : (
            <span className="bg-white/20 text-white text-xs font-bold px-2 py-0.5 rounded-full">
              다음 경기
            </span>
          )}
          <span className="text-white/80 text-xs font-semibold">
            {info.live ? '지금 경기 중이에요' : '곧 시작해요'}
          </span>
        </div>

        <div className="flex items-center gap-4">
          {/* 코트 배지 */}
          <div className="shrink-0 w-16 h-16 rounded-2xl bg-white/15 flex flex-col items-center justify-center leading-none">
            {m.court_number != null ? (
              <>
                <span className="text-2xl font-black">{m.court_number}</span>
                <span className="text-[10px] text-white/70 mt-1">번 코트</span>
              </>
            ) : (
              <span className="text-[10px] text-white/70 text-center px-1">코트<br />배정중</span>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-white/60 text-xs">상대 팀</p>
            <p className="text-lg font-black truncate">{opp}</p>
            {info.live ? (
              <p className="text-sm font-bold mt-1 tabular-nums">
                현재 {m.live_score_t1} : {m.live_score_t2}
              </p>
            ) : (
              <p className="text-sm text-white/80 mt-1">
                {est?.at ? (
                  <>
                    예상 시작 <strong className="font-black">약 {fmtTime(est.at)}쯤</strong>
                    {typeof est.ahead === 'number' && est.ahead > 0 && (
                      <> · 앞에 {est.ahead}경기</>
                    )}
                  </>
                ) : m.scheduled_time ? (
                  <>예상 시작 <strong className="font-black">약 {fmtTime(new Date(m.scheduled_time).getTime())}쯤</strong></>
                ) : (
                  '시작 시각 미정 · 코트에서 대기'
                )}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

// 신청 상태 뱃지 표시 (entry_status)
const STATUS_BADGE = {
  partner_pending:  { label: '⏳ 파트너 수락 대기', cls: 'bg-amber-100 text-amber-700' },
  partner_rejected: { label: '❌ 파트너 거절',       cls: 'bg-red-100 text-red-600' },
  applied:          { label: '📮 접수 완료 (승인 대기)', cls: 'bg-blue-100 text-blue-700' },
  approved:         { label: '✅ 참가 확정',          cls: 'bg-emerald-100 text-emerald-700' },
  rejected:         { label: '❌ 주최자 반려',        cls: 'bg-red-100 text-red-600' },
  withdrawn:        { label: '↩️ 철회됨',            cls: 'bg-gray-100 text-gray-500' },
  waitlisted:       { label: '🕓 대기순번',          cls: 'bg-purple-100 text-purple-700' },
}

// 입금 상태 뱃지
const PAY_BADGE = {
  pending:   { label: '입금 대기', cls: 'bg-amber-50 text-amber-600' },
  confirmed: { label: '입금 완료', cls: 'bg-emerald-50 text-emerald-600' },
  refunded:  { label: '환불됨',   cls: 'bg-gray-100 text-gray-500' },
}

export default function MyMatches() {
  const [userId, setUserId]     = useState(null)
  const [entries, setEntries]   = useState([])   // 내가 신청자(A) 또는 파트너(B)인 모든 신청
  const [matches, setMatches]   = useState([])   // 경기 일정
  const [nextMatch, setNextMatch] = useState(null) // 다음 경기 하이라이트
  const [loading, setLoading]   = useState(true)
  const [acting, setActing]     = useState(null) // 처리 중인 entry id
  const [call, setCall]         = useState(null) // 수신한 경기 호출 { court, sport, matchId, notificationId }
  const myEntryIds     = useRef(new Set())        // 내가 속한 엔트리 id (호출 대상 판정용)
  const myTournamentIds = useRef([])              // 내가 참가한 대회 id (구독 대상)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }
    setUserId(user.id)

    // ── 내가 속한 모든 신청 (양방향: 신청자 or 파트너) ──────────────
    const { data: es } = await supabase
      .from('tournament_entries')
      .select(`
        *,
        category:tournament_categories(
          sport_type,
          tournament:tournaments(id, title, date)
        ),
        p1:profiles!player1_id(id, name),
        p2:profiles!player2_id(id, name)
      `)
      .or(`player1_id.eq.${user.id},player2_id.eq.${user.id}`)
      .order('created_at', { ascending: false })

    setEntries(es ?? [])

    // ── 호출 수신용: 내 엔트리·대회 id 집합 ───────────────────────
    myEntryIds.current = new Set((es ?? []).map(e => e.id))
    myTournamentIds.current = [...new Set(
      (es ?? []).map(e => e.category?.tournament?.id).filter(Boolean),
    )]

    // ── 경기 일정 (기존 로직 유지) ───────────────────────────────
    const entryIds = (es ?? []).map(e => e.id)
    if (entryIds.length) {
      const { data: ms } = await supabase
        .from('tournament_matches')
        .select(`
          *,
          category:tournament_categories(match_duration_min),
          team1:tournament_entries!team1_entry_id(id,player1:profiles!player1_id(name),player2:profiles!player2_id(name)),
          team2:tournament_entries!team2_entry_id(id,player1:profiles!player1_id(name),player2:profiles!player2_id(name)),
          scores:match_scores(*)
        `)
        .or(`team1_entry_id.in.(${entryIds.join(',')}),team2_entry_id.in.(${entryIds.join(',')})`)
        .order('scheduled_time', { ascending: true })

      const formatted = (ms ?? []).map(m => ({
        ...m,
        scheduledTime: m.scheduled_time,
        team1Name: [m.team1?.player1?.name, m.team1?.player2?.name].filter(Boolean).join(' / '),
        team2Name: [m.team2?.player1?.name, m.team2?.player2?.name].filter(Boolean).join(' / '),
        sets: (m.scores ?? []).map(s => ({ a: s.team1_score, b: s.team2_score })),
        myTeamEntryId: entryIds.find(id => id === m.team1_entry_id) ? m.team1_entry_id : m.team2_entry_id,
      }))
      setMatches(formatted)

      // ── 다음 경기 하이라이트 계산 ─────────────────────────────
      const nm = pickNextMatch(formatted)
      if (nm && !nm.live) {
        const m = nm.match
        const now = Date.now()
        const sched = m.scheduled_time ? new Date(m.scheduled_time).getTime() : null
        if (sched && sched > now) {
          // ② 주최자가 지정한 예정시각이 미래면 그대로 사용
          nm.estimate = { at: sched, ahead: null }
        } else if (m.court_number != null) {
          // ③ 코트 큐 기반 추정 (보조 쿼리 1건)
          const { data: queue } = await supabase
            .from('tournament_matches')
            .select('id,court_number,scheduled_time,match_number,round_number,status,actual_start')
            .eq('category_id', m.category_id)
            .eq('court_number', m.court_number)
          const perMatch = (m.category?.match_duration_min ?? 30) * 60000
          const running = (queue ?? []).find(q => q.status === 'in_progress')
          const base = running?.actual_start ? new Date(running.actual_start).getTime() : now
          const ahead = (queue ?? []).filter(q => {
            if (q.id === m.id) return false
            if (DONE_STATUSES.includes(q.status)) return false
            if (q.status === 'in_progress') return true      // 진행중 경기는 항상 앞선 것으로
            return cmpMatches(q, m) < 0
          }).length
          nm.estimate = { at: base + ahead * perMatch, ahead }
        }
      }
      setNextMatch(nm)
    } else {
      setMatches([])
      setNextMatch(null)
    }

    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // ── 경기 호출 수신: 내 대회 채널 구독 + 놓친 호출 복구 (C1) ─────────
  useEffect(() => {
    if (!entries.length) return

    // 방송을 놓쳤어도 앱을 다시 열면 최근 미확인 호출을 복구(테이블 있으면).
    if (userId) {
      fetchRecentCalls(userId).then(rows => {
        const hit = rows[0]
        if (hit) setCall({
          court: hit.payload?.court ?? null,
          sport: hit.payload?.sport ?? null,
          matchId: hit.match_id,
          notificationId: hit.id,
        })
      })
    }

    const unsub = subscribeNotifications(myTournamentIds.current, payload => {
      if (payload?.type !== 'match_call') return
      // 내 경기인지 판정 (엔트리 교집합)
      const mine = (payload.entryIds ?? []).some(eid => myEntryIds.current.has(eid))
      if (!mine) return
      setCall({ court: payload.court, sport: payload.sport, matchId: payload.matchId })
      // 진동·알림(있으면). 화면을 보고 있지 않아도 감지되도록.
      try { if (navigator.vibrate) navigator.vibrate([300, 120, 300]) } catch { /* noop */ }
    })
    return unsub
  }, [entries, userId])

  function dismissCall() {
    if (call?.notificationId) markCallRead(call.notificationId)
    setCall(null)
  }

  // ── 파트너 초대 수락 / 거절 ─────────────────────────────────────
  async function respondInvite(entryId, accept) {
    setActing(entryId)
    const { error } = await supabase
      .from('tournament_entries')
      .update({
        entry_status: accept ? 'applied' : 'partner_rejected',
        partner_responded_at: new Date().toISOString(),
      })
      .eq('id', entryId)
    setActing(null)
    if (error) { alert('처리 중 오류가 발생했습니다: ' + error.message); return }
    await load()
  }

  // 받은 초대 = 내가 파트너(player2)이고 아직 수락 대기 중
  const invites = entries.filter(
    e => e.entry_status === 'partner_pending' && e.player2_id === userId,
  )

  // 내 신청 내역 = 전부 (초대 대기 중이지만 내가 파트너인 건 위에서 별도 노출하므로 제외)
  const myApplications = entries.filter(
    e => !(e.entry_status === 'partner_pending' && e.player2_id === userId),
  )

  // 파트너 이름 (내 관점의 상대) 계산
  function partnerName(e) {
    if (e.player1_id === userId) return e.p2?.name ?? null
    return e.p1?.name ?? null
  }
  // 내가 파트너로 초대받은 건인지 (신청자는 상대)
  function inviterName(e) {
    return e.p1?.name ?? '상대'
  }

  return (
    <div className="safe-bottom">
      {/* ── 경기 호출 배너 (주최자 호출 시 즉시 표시) ─────────────── */}
      {call && (
        <div className="fixed inset-x-0 top-0 z-50 px-3 pt-3 fade-up">
          <div
            className="rounded-2xl p-4 text-white shadow-xl flex items-center gap-3 animate-pulse"
            style={{ background: 'linear-gradient(135deg, #C60C30, #003478)' }}
            role="alert"
          >
            <Megaphone size={26} className="shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-white/80">경기 호출{call.sport ? ` · ${call.sport}` : ''}</p>
              <p className="text-lg font-black leading-tight">
                {call.court != null ? `지금 ${call.court}번 코트로 입장하세요!` : '지금 코트로 입장하세요!'}
              </p>
            </div>
            <button
              onClick={dismissCall}
              className="shrink-0 bg-white text-[#C60C30] font-black text-sm px-3 py-2 rounded-xl active:opacity-80"
            >
              확인
            </button>
          </div>
        </div>
      )}

      <header
        className="px-5 pt-14 pb-4 text-white"
        style={{ background: 'linear-gradient(135deg, #C60C30, #003478)' }}
      >
        <h1 className="text-xl font-black flex items-center gap-2">
          <CalendarDays size={22} /> 내 신청 · 경기
        </h1>
        <p className="text-white/70 text-sm mt-1">파트너 초대, 신청 상태, 경기 일정</p>
      </header>

      <div className="px-4 py-4 space-y-6">
        {loading ? (
          <div className="flex justify-center py-16"><Spinner size={32} /></div>
        ) : (
          <>
            {/* ── 다음 경기 하이라이트 ─────────────────────────── */}
            <NextMatchHighlight info={nextMatch} />

            {/* ── 받은 파트너 초대 ─────────────────────────────── */}
            {invites.length > 0 && (
              <section>
                <h2 className="font-bold text-sm mb-2 flex items-center gap-1.5 text-[#C60C30]">
                  <Mail size={16} /> 받은 파트너 초대
                  <span className="bg-[#C60C30] text-white text-[11px] font-bold rounded-full px-1.5 py-0.5 leading-none">
                    {invites.length}
                  </span>
                </h2>
                <div className="space-y-3">
                  {invites.map(e => {
                    const t = e.category?.tournament
                    return (
                      <div
                        key={e.id}
                        className="bg-white rounded-2xl border-2 border-[#C60C30]/30 p-4 shadow-sm"
                      >
                        <p className="text-sm">
                          <strong className="text-[#C60C30]">{inviterName(e)}</strong> 님이
                          함께 나가자고 초대했어요
                        </p>
                        <p className="font-bold mt-1">{t?.title ?? '대회'}</p>
                        <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
                          <span>{t?.date}</span>
                          <span>·</span>
                          <span>{e.category?.sport_type}</span>
                          {e.team_name && <><span>·</span><span>팀명: {e.team_name}</span></>}
                        </div>
                        <div className="flex gap-2 mt-3">
                          <button
                            onClick={() => respondInvite(e.id, true)}
                            disabled={acting === e.id}
                            className="flex-1 py-2.5 rounded-xl text-white font-bold text-sm
                                       flex items-center justify-center gap-1 active:scale-[.97]
                                       disabled:opacity-60"
                            style={{ background: 'linear-gradient(135deg, #C60C30, #003478)' }}
                          >
                            <Check size={15} /> 수락
                          </button>
                          <button
                            onClick={() => respondInvite(e.id, false)}
                            disabled={acting === e.id}
                            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-500
                                       font-bold text-sm flex items-center justify-center gap-1
                                       active:bg-gray-50 disabled:opacity-60"
                          >
                            <X size={15} /> 거절
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {/* ── 내 신청 내역 ─────────────────────────────────── */}
            <section>
              <h2 className="font-bold text-sm mb-2 flex items-center gap-1.5">
                <Clock size={16} className="text-gray-500" /> 내 신청 내역
              </h2>
              {myApplications.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm bg-white rounded-2xl border border-gray-100">
                  아직 신청한 대회가 없습니다.
                </div>
              ) : (
                <div className="space-y-3">
                  {myApplications.map(e => {
                    const t = e.category?.tournament
                    const sb = STATUS_BADGE[e.entry_status] ?? { label: e.entry_status, cls: 'bg-gray-100 text-gray-500' }
                    const pb = PAY_BADGE[e.payment_status]
                    const pn = partnerName(e)
                    const iAmPartner = e.player2_id === userId
                    return (
                      <div key={e.id} className="bg-white rounded-2xl border border-gray-100 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-bold text-sm">{t?.title ?? '대회'}</p>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${sb.cls}`}>
                            {sb.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-400 mt-1">
                          <span>{t?.date}</span>
                          <span>·</span>
                          <span>{e.category?.sport_type}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          {pn ? (
                            <span className="text-xs text-gray-600">
                              🤝 파트너: <strong>{pn}</strong>
                              {iAmPartner && <span className="text-gray-400"> (내가 파트너)</span>}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">개인 신청 (파트너 없음)</span>
                          )}
                          {pb && (
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${pb.cls}`}>
                              {pb.label}
                            </span>
                          )}
                        </div>
                        {e.entry_status === 'partner_pending' && !iAmPartner && (
                          <p className="text-xs text-amber-600 mt-2">
                            파트너 <strong>{pn ?? ''}</strong> 님의 수락을 기다리는 중이에요.
                          </p>
                        )}
                        {e.entry_status === 'partner_rejected' && (
                          <p className="text-xs text-red-500 mt-2">
                            파트너가 초대를 거절했어요. 다른 파트너로 다시 신청할 수 있습니다.
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </section>

            {/* ── 경기 일정 ────────────────────────────────────── */}
            <section>
              <h2 className="font-bold text-sm mb-2 flex items-center gap-1.5">
                <CalendarDays size={16} className="text-gray-500" /> 경기 일정
              </h2>
              {matches.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm bg-white rounded-2xl border border-gray-100">
                  <p className="text-3xl mb-2">📅</p>
                  <p>아직 배정된 경기가 없습니다.</p>
                  <p className="text-xs mt-1">참가가 확정되면 대진표가 여기에 나타납니다.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {matches.map(m => <MatchCard key={m.id} match={m} />)}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      <BottomNav mode="player" />
    </div>
  )
}

import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { subscribeNotifications, fetchRecentCalls, markCallRead, fetchNotices, markNoticeRead, NOTICE_TYPES } from '../../lib/notify'
import { getCheckinWindow, assessSelfCheckin, selfCheckin, fetchMyCheckins } from '../../lib/checkin'
import { depositGuide, shouldShowDeposit, formatWon } from '../../lib/deposit'
import {
  evaluateGames, buildSelfScoreEvent, parseSelfScores, reconcileSelfScores, gamesText,
} from '../../lib/selfScore'
import BottomNav from '../../components/BottomNav'
import MatchCard from '../../components/MatchCard'
import Spinner from '../../components/Spinner'
import { CalendarDays, Mail, Check, X, Clock, Megaphone, AlertTriangle, UserCheck, ShieldCheck, MapPin, Bell, Gavel, Send, CheckCircle2 } from 'lucide-react'

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

function fmtClock(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 디지털 선수증 + 셀프 체크인 카드 (C4)
function CheckinCard({ card, checkin, profile, checkingIn, onCheckin }) {
  const t = card.tournament
  const win = getCheckinWindow(t)
  const assess = assessSelfCheckin(profile)
  const isCheckedIn = !!checkin && !checkin.flagged
  const displayName = (profile?.identity_verified && profile?.verified_name) || profile?.name || '선수'
  const busy = checkingIn === t.id

  return (
    <div
      className={`rounded-2xl border overflow-hidden shadow-sm
        ${isCheckedIn ? 'border-emerald-300' : 'border-gray-100'}`}
    >
      {/* 디지털 선수증 상단 */}
      <div
        className="px-4 pt-4 pb-3 text-white"
        style={{ background: isCheckedIn
          ? 'linear-gradient(135deg, #047857, #003478)'
          : 'linear-gradient(135deg, #C60C30, #003478)' }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold text-white/80 flex items-center gap-1">
            <UserCheck size={13} /> 디지털 선수증
          </span>
          {profile?.identity_verified ? (
            <span className="text-[10px] font-bold bg-white/20 px-2 py-0.5 rounded-full flex items-center gap-1">
              <ShieldCheck size={11} /> 실명인증
            </span>
          ) : (
            <span className="text-[10px] font-bold bg-white/15 px-2 py-0.5 rounded-full">미인증</span>
          )}
        </div>
        <p className="text-xl font-black mt-1.5 leading-tight truncate">{displayName}</p>
        <p className="text-white/80 text-xs mt-0.5 truncate">{t.title ?? '대회'}</p>
        <div className="flex items-center gap-2 text-white/70 text-[11px] mt-1 flex-wrap">
          <span className="flex items-center gap-0.5"><CalendarDays size={11} /> {t.date ?? '날짜 미정'}</span>
          {t.location && <span className="flex items-center gap-0.5"><MapPin size={11} /> {t.location}</span>}
        </div>
        <div className="flex gap-1 mt-2 flex-wrap">
          {card.sports.map(sp => (
            <span key={sp} className="text-[10px] font-semibold bg-white/15 px-2 py-0.5 rounded-full">{sp}</span>
          ))}
        </div>
      </div>

      {/* 하단 액션 */}
      <div className="bg-white px-4 py-3">
        {isCheckedIn ? (
          <div className="flex items-center gap-2 text-emerald-700">
            <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
              <Check size={20} />
            </div>
            <div className="min-w-0">
              <p className="font-black text-sm">체크인 완료{checkin.checked_in_at ? ` · ${fmtClock(checkin.checked_in_at)}` : ''}</p>
              <p className="text-[11px] text-gray-500">
                {checkin.verified_method === 'self' ? '셀프 체크인' : '현장 확인'} 완료됐어요. 경기 호출을 기다려주세요.
              </p>
            </div>
          </div>
        ) : win.canCheckin ? (
          <>
            <button
              onClick={() => onCheckin(t.id)}
              disabled={busy}
              className="w-full py-3 rounded-xl text-white font-black text-sm flex items-center justify-center gap-2
                         active:scale-[.98] disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, #C60C30, #003478)' }}
            >
              <UserCheck size={17} /> {busy ? '체크인 중…' : '지금 셀프 체크인'}
            </button>
            <p className={`text-[11px] mt-2 leading-relaxed ${assess.needsReview ? 'text-amber-600' : 'text-gray-500'}`}>
              {assess.needsReview ? '⚠️ ' : '✓ '}{assess.note}
            </p>
          </>
        ) : (
          <div className="text-center py-1">
            <p className="text-sm font-bold text-gray-600">{win.label}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">{win.sub}</p>
          </div>
        )}
      </div>
    </div>
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

// ── 무심판 코트 셀프 점수 입력 (C7·심판) ─────────────────────────────
// 심판 없는 코트에서 경기에 뛴 선수가 자기 폰으로 최종 게임 점수를 제출한다.
// match_events 에 self_score 로 append(양 팀 각자 제출) → 양 팀이 같은 결과를 내면
// 주최자 실시간 진행 화면이 자동(무인)으로 경기를 확정하고, 어긋나면 주최자가 확인.
// 이 패널은 "제출·현황 표시"만 담당하고 확정은 하지 않는다(선수는 경기 결과를 못 바꿈).
function SelfScorePanel({ match, myTeam, config, userId, t1Name, t2Name }) {
  const [events, setEvents] = useState([])
  const [rows, setRows] = useState([])     // [[t1,t2], ...] 입력값(문자열)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)
  const [notActive, setNotActive] = useState(false) // 마이그레이션 미적용(기능 비활성)

  const gpm = config?.gamesPerMatch ?? 3
  const ppg = config?.pointsPerGame ?? 21

  const loadEvents = useCallback(async () => {
    try {
      const { data, error: e } = await supabase
        .from('match_events')
        .select('event_type, team_no, meta, created_by, created_at')
        .eq('match_id', match.id)
        .eq('event_type', 'self_score')
        .order('created_at', { ascending: true })
      if (e) return
      setEvents(data ?? [])
    } catch { /* degrade: 셀프 점수 없음 */ }
  }, [match.id])

  useEffect(() => {
    setRows(Array.from({ length: gpm }, () => ['', '']))
    setError(null); setNotActive(false); setOpen(false)
    loadEvents()
    const ch = supabase
      .channel(`selfscore-${match.id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'match_events' },
        (payload) => { if (payload.new?.match_id === match.id) loadEvents() })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [match.id, gpm, loadEvents])

  const subs = parseSelfScores(events)
  const rec = reconcileSelfScores(subs)
  const mine = myTeam === 1 ? subs.team1 : subs.team2
  const theirs = myTeam === 1 ? subs.team2 : subs.team1

  async function submit() {
    setError(null)
    const games = rows
      .map(r => [r[0], r[1]])
      .filter(r => r[0] !== '' || r[1] !== '')
      .map(r => [Number(r[0]), Number(r[1])])
    const ev = evaluateGames(games, { pointsPerGame: ppg, gamesPerMatch: gpm })
    if (!ev.valid) { setError(ev.error); return }
    setSaving(true)
    try {
      const row = buildSelfScoreEvent(ev, myTeam)
      const { error: e } = await supabase.from('match_events').insert({
        ...row, match_id: match.id, created_by: userId,
      })
      if (e) {
        // CHECK 제약(23514) = 마이그레이션 015 미적용 → 기능 비활성 안내
        if (e.code === '23514' || /chk_event_type|check constraint/i.test(e.message || '')) {
          setNotActive(true)
        } else {
          setError('점수 제출에 실패했어요. 잠시 후 다시 시도해주세요.')
        }
        setSaving(false)
        return
      }
      setOpen(false)
      await loadEvents()
    } catch {
      setError('점수 제출에 실패했어요.')
    }
    setSaving(false)
  }

  // 상대가 낸 점수를 그대로 채워 넣기(동일 확인 → 합의 확정 유도)
  function fillFromTheirs() {
    if (!theirs?.games?.length) return
    const filled = Array.from({ length: gpm }, (_, i) => {
      const g = theirs.games[i]
      return g ? [String(g[0]), String(g[1])] : ['', '']
    })
    setRows(filled); setOpen(true); setError(null)
  }

  const oppLabel = myTeam === 1 ? (t2Name || '상대 팀') : (t1Name || '상대 팀')

  return (
    <section className="rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
        <Gavel size={16} className="text-[#C60C30] shrink-0" />
        <div className="min-w-0">
          <p className="font-bold text-sm">셀프 점수 입력</p>
          <p className="text-[11px] text-gray-400 leading-snug">
            심판이 없는 코트라면, 경기 후 최종 점수를 직접 제출하세요.
          </p>
        </div>
      </div>

      <div className="px-4 py-3.5 space-y-3">
        {/* 현황 배지 */}
        {rec.status === 'agreed' && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2.5 flex items-start gap-2">
            <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />
            <p className="text-xs text-emerald-700 leading-relaxed">
              <strong>양 팀 점수가 일치</strong>해요 ({gamesText(rec.submission.games)}).<br />
              곧 결과가 자동으로 확정돼요.
            </p>
          </div>
        )}
        {rec.status === 'disputed' && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 flex items-start gap-2">
            <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 leading-relaxed">
              양 팀이 낸 점수가 <strong>서로 달라요</strong>. 주최자가 확인 후 확정해요.<br />
              우리 팀: {gamesText(mine?.games)} · {oppLabel}: {gamesText(theirs?.games)}
            </p>
          </div>
        )}
        {rec.status !== 'agreed' && rec.status !== 'disputed' && (
          <>
            {mine && (
              <div className="rounded-xl bg-blue-50 border border-blue-100 px-3 py-2.5 flex items-start gap-2">
                <Check size={15} className="text-[#003478] shrink-0 mt-0.5" />
                <p className="text-xs text-[#003478] leading-relaxed">
                  <strong>제출 완료</strong> ({gamesText(mine.games)}) · {oppLabel}의 확인을 기다리는 중이에요.
                </p>
              </div>
            )}
            {theirs && !mine && (
              <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2.5">
                <p className="text-xs text-gray-600 leading-relaxed">
                  {oppLabel}이 점수를 제출했어요: <strong>{gamesText(theirs.games)}</strong>
                </p>
                <button
                  onClick={fillFromTheirs}
                  className="mt-2 text-xs font-bold text-[#003478] underline underline-offset-2"
                >
                  이 점수가 맞아요 → 같은 점수로 확인
                </button>
              </div>
            )}
          </>
        )}

        {notActive && (
          <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2.5">
            <p className="text-xs text-gray-500 leading-relaxed">
              아직 셀프 점수 기능이 켜지지 않은 대회예요. 주최자에게 코트 심판 배정을 요청해주세요.
            </p>
          </div>
        )}

        {/* 입력 폼 (합의 전까지 언제든 다시 제출 가능) */}
        {rec.status !== 'agreed' && !notActive && (
          open ? (
            <div className="space-y-2">
              <div className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-2">
                <span className="text-[11px] text-gray-400" />
                <span className="text-[11px] font-bold text-center truncate" style={{ color: '#C60C30' }}>{t1Name || '팀1'}</span>
                <span className="text-[11px] text-gray-300 text-center">:</span>
                <span className="text-[11px] font-bold text-center truncate" style={{ color: '#003478' }}>{t2Name || '팀2'}</span>
                {rows.map((r, i) => (
                  <FragmentRow
                    key={i}
                    idx={i}
                    r={r}
                    onChange={(a, b) => setRows(rs => rs.map((x, j) => j === i ? [a, b] : x))}
                  />
                ))}
              </div>
              {error && <p className="text-xs text-[#C60C30] font-semibold px-1">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setOpen(false)}
                  className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-600 text-sm font-bold active:opacity-80"
                >
                  취소
                </button>
                <button
                  onClick={submit}
                  disabled={saving}
                  className="flex-[2] py-2.5 rounded-xl text-white text-sm font-bold active:opacity-80 disabled:opacity-50 flex items-center justify-center gap-1.5"
                  style={{ background: 'linear-gradient(135deg, #C60C30, #003478)' }}
                >
                  <Send size={15} /> {mine ? '점수 다시 제출' : '점수 제출'}
                </button>
              </div>
              <p className="text-[11px] text-gray-400 leading-relaxed px-1">
                {gpm}판 {Math.floor(gpm / 2) + 1}선승 · {ppg}점제. 진행한 게임만 입력하면 돼요.
              </p>
            </div>
          ) : (
            <button
              onClick={() => setOpen(true)}
              className="w-full py-3 rounded-xl text-white text-sm font-bold active:opacity-80 flex items-center justify-center gap-1.5"
              style={{ background: 'linear-gradient(135deg, #C60C30, #003478)' }}
            >
              <Gavel size={16} /> {mine ? '점수 수정하기' : '우리 경기 점수 입력'}
            </button>
          )
        )}
      </div>
    </section>
  )
}

// 한 게임 점수 입력 행 (grid 셀 4개)
function FragmentRow({ idx, r, onChange }) {
  return (
    <>
      <span className="text-[11px] text-gray-400 tabular-nums">{idx + 1}게임</span>
      <input
        type="number" inputMode="numeric" min="0" value={r[0]}
        onChange={e => onChange(e.target.value, r[1])}
        className="w-full text-center text-base font-bold border border-gray-200 rounded-lg py-1.5 tabular-nums"
        aria-label={`${idx + 1}게임 팀1 점수`}
      />
      <span className="text-gray-300 text-center">:</span>
      <input
        type="number" inputMode="numeric" min="0" value={r[1]}
        onChange={e => onChange(r[0], e.target.value)}
        className="w-full text-center text-base font-bold border border-gray-200 rounded-lg py-1.5 tabular-nums"
        aria-label={`${idx + 1}게임 팀2 점수`}
      />
    </>
  )
}

export default function MyMatches() {
  const [userId, setUserId]     = useState(null)
  const [profile, setProfile]   = useState(null) // 내 프로필(디지털 선수증·인증여부)
  const [copiedName, setCopiedName] = useState(false) // 입금자명 복사 피드백
  const [entries, setEntries]   = useState([])   // 내가 신청자(A) 또는 파트너(B)인 모든 신청
  const [matches, setMatches]   = useState([])   // 경기 일정
  const [nextMatch, setNextMatch] = useState(null) // 다음 경기 하이라이트
  const [checkins, setCheckins] = useState({})   // { [tournamentId]: row } 내 체크인 상태
  const [checkingIn, setCheckingIn] = useState(null) // 체크인 처리 중인 tournamentId
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState(false) // 불러오기 실패(네트워크 등) → 재시도 안내
  const [acting, setActing]     = useState(null) // 처리 중인 entry id
  const [call, setCall]         = useState(null) // 수신한 경기 호출 { court, sport, matchId, notificationId }
  const [soon, setSoon]         = useState(null) // 사전 알림 { court, sport, aheadCount }
  const [warn, setWarn]         = useState(null) // 미입장 부전승 경고 { court, sport, secondsLeft }
  const [notices, setNotices]   = useState([])   // 공지함: 받은 대회 안내·공지 (C11)
  const myEntryIds     = useRef(new Set())        // 내가 속한 엔트리 id (호출 대상 판정용)
  const myTournamentIds = useRef([])              // 내가 참가한 대회 id (구독 대상)

  const load = useCallback(async () => {
    setLoadError(false)
    try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }
    setUserId(user.id)

    // ── 내 프로필 (디지털 선수증·본인확인 자동판정용) ────────────────
    const { data: prof } = await supabase
      .from('profiles')
      .select('id, name, verified_name, identity_verified')
      .eq('id', user.id)
      .maybeSingle()
    setProfile(prof ?? null)

    // ── 내가 속한 모든 신청 (양방향: 신청자 or 파트너) ──────────────
    const { data: es } = await supabase
      .from('tournament_entries')
      .select(`
        *,
        category:tournament_categories(
          sport_type,
          entry_fee,
          tournament:tournaments(id, title, date, status, location)
        ),
        p1:profiles!player1_id(id, name),
        p2:profiles!player2_id(id, name)
      `)
      .or(`player1_id.eq.${user.id},player2_id.eq.${user.id}`)
      .order('created_at', { ascending: false })

    setEntries(es ?? [])

    // ── 내 체크인 상태 (참가 확정 대회 대상) ─────────────────────────
    const tIds = [...new Set(
      (es ?? [])
        .filter(e => e.entry_status === 'approved')
        .map(e => e.category?.tournament?.id)
        .filter(Boolean),
    )]
    setCheckins(await fetchMyCheckins(supabase, tIds, user.id))

    // ── 공지함: 받은 대회 안내·공지 (C11) ────────────────────────────
    setNotices(await fetchNotices(user.id))

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
          category:tournament_categories(match_duration_min, games_per_match, points_per_game),
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
    } catch (e) {
      // 네트워크·일시 오류로 조회가 던지면 스피너에 영영 갇히지 않도록 에러 화면으로 폴백
      console.error('[내 경기] 불러오기 실패:', e)
      setLoadError(true)
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // 재시도: 스피너를 다시 띄우고 load 재실행(액션 후 조용한 재조회 UX는 그대로 유지)
  const retry = useCallback(() => { setLoading(true); load() }, [load])

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
      // 대회 안내·공지(C11) — 내 대회면 수신(엔트리 대상 없이 대회 전체 발송).
      if (NOTICE_TYPES.includes(payload?.type)) {
        setNotices(prev => {
          if (prev.some(n => n.payload?.createdAt === payload.createdAt && n.type === payload.type)) return prev
          const row = {
            id: `live-${payload.type}-${payload.createdAt}`,
            type: payload.type,
            title: payload.title,
            body: payload.body,
            created_at: payload.createdAt,
            read_at: null,
            payload,
          }
          return [row, ...prev]
        })
        try { if (navigator.vibrate) navigator.vibrate(80) } catch { /* noop */ }
        return
      }
      const mine = (payload?.entryIds ?? []).some(eid => myEntryIds.current.has(eid))
      if (!mine) return
      // 사전 알림(곧 호출) — 가벼운 준비 안내. 실제 호출이 오면 아래에서 덮어씀.
      if (payload.type === 'match_soon') {
        setSoon({ court: payload.court, sport: payload.sport, aheadCount: payload.aheadCount ?? null })
        try { if (navigator.vibrate) navigator.vibrate(120) } catch { /* noop */ }
        return
      }
      // 미입장 부전승 경고 — 가장 급함(부전승 처리 직전). 다른 배너를 덮는다.
      if (payload.type === 'walkover_warn') {
        setWarn({ court: payload.court, sport: payload.sport, secondsLeft: payload.secondsLeft ?? null })
        setSoon(null)
        try { if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 500]) } catch { /* noop */ }
        return
      }
      if (payload.type !== 'match_call') return
      setCall({ court: payload.court, sport: payload.sport, matchId: payload.matchId })
      setSoon(null) // 진짜 호출이 왔으니 사전 알림은 내림
      setWarn(null) // 정상 호출이 다시 왔으니 경고는 내림
      // 진동·알림(있으면). 화면을 보고 있지 않아도 감지되도록.
      try { if (navigator.vibrate) navigator.vibrate([300, 120, 300]) } catch { /* noop */ }
    })
    return unsub
  }, [entries, userId])

  function dismissCall() {
    if (call?.notificationId) markCallRead(call.notificationId)
    setCall(null)
  }

  // 공지 읽음 처리 (라이브 수신 임시행은 서버 갱신 없이 상태만)
  function readNotice(n) {
    if (n.read_at) return
    if (typeof n.id === 'string' && !n.id.startsWith('live-')) markNoticeRead(n.id)
    setNotices(prev => prev.map(x => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)))
  }

  const unreadNotices = notices.filter(n => !n.read_at).length

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

  // ── 셀프 체크인 (C4) ────────────────────────────────────────────
  async function doSelfCheckin(tournamentId) {
    if (!userId) return
    setCheckingIn(tournamentId)
    const { error } = await selfCheckin(supabase, { tournamentId, playerId: userId })
    setCheckingIn(null)
    if (error) { alert('체크인 중 문제가 생겼어요: ' + error.message); return }
    // 방금 체크인한 행을 즉시 반영(재조회 없이 낙관적 업데이트)
    setCheckins(prev => ({
      ...prev,
      [tournamentId]: {
        tournament_id: tournamentId,
        player_id: userId,
        verified_method: 'self',
        checked_in_at: new Date().toISOString(),
        flagged: false,
      },
    }))
  }

  // 참가 확정 대회를 대회 단위로 묶어 체크인 카드 목록 생성(중복 종목은 1장으로)
  const checkinCards = (() => {
    const seen = new Map()
    for (const e of entries) {
      if (e.entry_status !== 'approved') continue
      const t = e.category?.tournament
      if (!t?.id) continue
      if (!seen.has(t.id)) seen.set(t.id, { tournament: t, sports: [] })
      const sp = e.category?.sport_type
      if (sp && !seen.get(t.id).sports.includes(sp)) seen.get(t.id).sports.push(sp)
    }
    return [...seen.values()]
      // 종료/마감된 대회는 카드에서 숨김(체크인할 게 없음). 이미 체크인한 종료대회도 숨김.
      .filter(c => getCheckinWindow(c.tournament).phase !== 'ended')
      .sort((a, b) => (a.tournament.date ?? '').localeCompare(b.tournament.date ?? ''))
  })()

  // 무심판 셀프 점수 대상 경기: 진행중 우선, 없으면 코트 배정된 가장 임박한 예정 경기.
  // 양 팀이 확정된(entry_id 둘 다 있는) 경기만 — 아직 상대 미정이면 점수 낼 수 없음.
  const selfScoreMatch = (() => {
    const eligible = matches.filter(m =>
      !DONE_STATUSES.includes(m.status) && m.team1_entry_id && m.team2_entry_id && m.myTeamEntryId)
    const live = eligible.find(m => m.status === 'in_progress')
    if (live) return live
    return eligible
      .filter(m => m.court_number != null)
      .sort(cmpMatches)[0] ?? null
  })()

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
      {/* ── 미입장 부전승 경고 배너 (가장 급함 — 부전승 직전) ───────── */}
      {warn && (
        <div className="fixed inset-x-0 top-0 z-50 px-3 pt-3 fade-up">
          <div
            className="rounded-2xl p-4 text-white shadow-xl flex items-center gap-3 animate-pulse"
            style={{ background: 'linear-gradient(135deg, #C60C30, #7a0a1f)' }}
            role="alert"
          >
            <AlertTriangle size={26} className="shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-white/80">미입장 부전승 경고{warn.sport ? ` · ${warn.sport}` : ''}</p>
              <p className="text-base font-black leading-tight">
                {warn.court != null ? `지금 바로 ${warn.court}번 코트로 입장하세요!` : '지금 바로 코트로 입장하세요!'}
              </p>
              <p className="text-[11px] text-white/80">
                {typeof warn.secondsLeft === 'number' && warn.secondsLeft > 0
                  ? `약 ${Math.max(1, Math.ceil(warn.secondsLeft / 60))}분 내 미입장 시 부전승 처리돼요`
                  : '응답이 없으면 부전승 처리돼요'}
              </p>
            </div>
            <button
              onClick={() => setWarn(null)}
              className="shrink-0 bg-white text-[#C60C30] font-black text-sm px-3 py-2 rounded-xl active:opacity-80"
            >
              확인
            </button>
          </div>
        </div>
      )}

      {/* ── 경기 호출 배너 (주최자 호출 시 즉시 표시) ─────────────── */}
      {!warn && call && (
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

      {/* ── 곧 호출 사전 알림 (자동 진행 시 미리 도착) ─────────────── */}
      {!warn && !call && soon && (
        <div className="fixed inset-x-0 top-0 z-40 px-3 pt-3 fade-up">
          <div className="rounded-2xl p-3.5 bg-[#003478] text-white shadow-lg flex items-center gap-3" role="status">
            <Clock size={22} className="shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-white/80">곧 경기 호출{soon.sport ? ` · ${soon.sport}` : ''}</p>
              <p className="text-sm font-black leading-tight">
                {soon.court != null ? `곧 ${soon.court}번 코트로 호출돼요` : '곧 호출될 예정이에요'}
                {typeof soon.aheadCount === 'number' && soon.aheadCount > 0 && (
                  <span className="font-semibold text-white/80"> · 앞에 {soon.aheadCount}경기</span>
                )}
              </p>
              <p className="text-[11px] text-white/70">코트 근처에서 준비해주세요!</p>
            </div>
            <button
              onClick={() => setSoon(null)}
              className="shrink-0 bg-white/20 text-white font-bold text-xs px-2.5 py-1.5 rounded-lg active:opacity-80"
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
        ) : loadError ? (
          <div className="py-16 flex flex-col items-center text-center gap-3">
            <AlertTriangle size={30} className="text-[#C60C30]" />
            <p className="text-sm font-bold text-gray-700">정보를 불러오지 못했어요</p>
            <p className="text-xs text-gray-500">인터넷 연결을 확인한 뒤 다시 시도해 주세요.</p>
            <button
              onClick={retry}
              className="mt-1 px-5 py-2.5 rounded-xl text-sm font-bold text-white active:opacity-80"
              style={{ background: '#003478' }}
            >
              다시 시도
            </button>
          </div>
        ) : (
          <>
            {/* ── 다음 경기 하이라이트 ─────────────────────────── */}
            <NextMatchHighlight info={nextMatch} />

            {/* ── 무심판 코트 셀프 점수 입력 (C7·심판) ─────────────
                진행중 경기 우선, 없으면 코트가 배정된 가장 임박한 예정 경기.
                양 팀 확정된 경기에만. */}
            {selfScoreMatch && (
              <SelfScorePanel
                match={selfScoreMatch}
                myTeam={selfScoreMatch.team1_entry_id === selfScoreMatch.myTeamEntryId ? 1 : 2}
                config={{
                  gamesPerMatch: selfScoreMatch.category?.games_per_match ?? 3,
                  pointsPerGame: selfScoreMatch.category?.points_per_game ?? 21,
                }}
                userId={userId}
                t1Name={selfScoreMatch.team1Name}
                t2Name={selfScoreMatch.team2Name}
              />
            )}

            {/* ── 셀프 체크인 · 디지털 선수증 (C4) ─────────────── */}
            {checkinCards.length > 0 && (
              <section>
                <h2 className="font-bold text-sm mb-2 flex items-center gap-1.5">
                  <UserCheck size={16} className="text-[#003478]" /> 체크인
                </h2>
                <div className="space-y-3">
                  {checkinCards.map(card => (
                    <CheckinCard
                      key={card.tournament.id}
                      card={card}
                      checkin={checkins[card.tournament.id]}
                      profile={profile}
                      checkingIn={checkingIn}
                      onCheckin={doSelfCheckin}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* ── 공지 · 안내 (C11 사후 커뮤니케이션) ──────────────── */}
            {notices.length > 0 && (
              <section>
                <h2 className="font-bold text-sm mb-2 flex items-center gap-1.5">
                  <Bell size={16} className="text-[#003478]" /> 공지 · 안내
                  {unreadNotices > 0 && (
                    <span className="bg-[#C60C30] text-white text-[11px] font-bold rounded-full px-1.5 py-0.5 leading-none">
                      {unreadNotices}
                    </span>
                  )}
                </h2>
                <div className="space-y-2">
                  {notices.map(n => (
                    <button
                      key={n.id}
                      onClick={() => readNotice(n)}
                      className={`w-full text-left rounded-2xl border p-3.5 transition active:scale-[.99]
                        ${n.read_at ? 'bg-white border-gray-100' : 'bg-blue-50/60 border-blue-100'}`}
                    >
                      <div className="flex items-center gap-2">
                        {!n.read_at && <span className="w-1.5 h-1.5 rounded-full bg-[#C60C30] shrink-0" />}
                        <p className="font-bold text-sm flex-1 min-w-0 truncate">{n.title}</p>
                        <span className="text-[10px] text-gray-400 shrink-0">{n.created_at ? fmtClock(n.created_at) : ''}</span>
                      </div>
                      <p className="text-xs text-gray-500 leading-relaxed mt-1">{n.body}</p>
                    </button>
                  ))}
                </div>
              </section>
            )}

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
                    const fee = e.category?.entry_fee ?? 0
                    const myDepositName =
                      (profile?.identity_verified && profile?.verified_name) || profile?.name || ''
                    const dep = shouldShowDeposit(e, fee)
                      ? depositGuide(e, { fee, myName: myDepositName, partnerName: pn })
                      : null
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

                        {/* ── 입금 안내 (참가비 있는 미입금 신청) ─────────────── */}
                        {dep && !dep.done && (
                          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-bold text-amber-700 flex items-center gap-1">
                                💳 입금 안내
                              </span>
                              <span className="text-base font-extrabold text-[#C60C30]">
                                {formatWon(dep.amount)}
                              </span>
                            </div>
                            {dep.payerName && (
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(dep.payerName)
                                    setCopiedName(e.id)
                                    setTimeout(() => setCopiedName(false), 1500)
                                  } catch { /* 클립보드 미지원 무시 */ }
                                }}
                                className="mt-2 w-full flex items-center justify-between gap-2 rounded-lg
                                  bg-white border border-amber-200 px-3 py-2 text-left active:scale-[0.99]"
                              >
                                <span className="text-xs text-gray-500">
                                  입금자명 <strong className="text-gray-800 text-sm">{dep.payerName}</strong>
                                </span>
                                <span className="text-xs font-semibold text-[#003478] shrink-0">
                                  {copiedName === e.id ? '복사됨 ✓' : '복사'}
                                </span>
                              </button>
                            )}
                            <ol className="mt-2 space-y-1">
                              {dep.steps.map((s, i) => (
                                <li key={i} className="text-xs text-amber-800 flex gap-1.5">
                                  <span className="font-bold shrink-0">{i + 1}.</span>
                                  <span>{s}</span>
                                </li>
                              ))}
                            </ol>
                            {dep.note && (
                              <p className="mt-2 text-[11px] text-amber-600 leading-snug">{dep.note}</p>
                            )}
                          </div>
                        )}
                        {dep && dep.done && dep.status === 'confirmed' && (
                          <p className="mt-2 text-xs text-emerald-600 flex items-center gap-1">
                            <Check size={13} /> {dep.message}
                          </p>
                        )}

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

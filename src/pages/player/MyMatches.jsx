import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import BottomNav from '../../components/BottomNav'
import MatchCard from '../../components/MatchCard'
import Spinner from '../../components/Spinner'
import { CalendarDays, Mail, Check, X, Clock } from 'lucide-react'

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
  const [loading, setLoading]   = useState(true)
  const [acting, setActing]     = useState(null) // 처리 중인 entry id

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

    // ── 경기 일정 (기존 로직 유지) ───────────────────────────────
    const entryIds = (es ?? []).map(e => e.id)
    if (entryIds.length) {
      const { data: ms } = await supabase
        .from('tournament_matches')
        .select(`
          *,
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
    } else {
      setMatches([])
    }

    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

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

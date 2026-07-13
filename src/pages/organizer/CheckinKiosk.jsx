import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Search, CheckCircle2, UserCheck, X, ArrowLeft, AlertTriangle, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  buildKioskRoster, filterKioskRoster, kioskStats, getCheckinWindow, selfCheckin,
} from '../../lib/checkin'

/* ══════════════════════════════════════════════════════════════
   셀프 체크인 키오스크 (C4)
   - 입구 공용 태블릿 한 대를 두고 선수가 스스로 이름을 찾아 체크인
   - 주최자가 명단을 한 명씩 눌러 주던 수작업 → 선수 셀프로 이관
   - 새 RLS/마이그레이션 없음(005 tournament_checkins 전체 허용, verified_method='self')
   - 체크인 테이블 미적용 시 graceful 안내
══════════════════════════════════════════════════════════════ */

const REFRESH_MS = 15_000

export default function CheckinKiosk() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [loading, setLoading]     = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [retryTick, setRetryTick] = useState(0)
  const [tournament, setTournament] = useState(null)
  const [entries, setEntries]     = useState([])
  const [checkins, setCheckins]   = useState([])
  const [query, setQuery]         = useState('')
  const [confirmRow, setConfirmRow] = useState(null) // 체크인 확인 중인 선수
  const [saving, setSaving]       = useState(false)
  const [flash, setFlash]         = useState(null)    // { name } 방금 체크인한 선수
  const [saveError, setSaveError] = useState(false)

  const searchRef = useRef(null)
  const flashTimer = useRef(null)

  // 체크인 행만 다시 로드(실시간·폴링 갱신용) — 테이블 미존재 시 조용히 degrade
  const loadCheckins = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('tournament_checkins')
        .select('player_id, checked_in_at, flagged, verified_method')
        .eq('tournament_id', id)
      if (error) return
      setCheckins(data ?? [])
    } catch { /* degrade */ }
  }, [id])

  useEffect(() => {
    let alive = true
    async function load() {
      setLoading(true)
      try {
        const { data: t, error: te } = await supabase
          .from('tournaments')
          .select('id, name, date, status, court_count')
          .eq('id', id)
          .single()
        if (te) throw te

        const { data: cats } = await supabase
          .from('tournament_categories')
          .select('id, sport_type')
          .eq('tournament_id', id)
        const catIds = (cats ?? []).map(c => c.id)
        const catName = new Map((cats ?? []).map(c => [c.id, c.sport_type]))

        let ents = []
        if (catIds.length) {
          const { data: es } = await supabase
            .from('tournament_entries')
            .select(`
              id, category_id, entry_status,
              player1:profiles!player1_id(id, name, identity_verified),
              player2:profiles!player2_id(id, name, identity_verified)
            `)
            .in('category_id', catIds)
            .eq('entry_status', 'approved')
          ents = (es ?? []).map(e => ({ ...e, categoryName: catName.get(e.category_id) || '' }))
        }

        // 체크인은 테이블 미적용이어도 페이지가 떠야 하므로 별도 try
        let chk = []
        try {
          const { data: cs, error: ce } = await supabase
            .from('tournament_checkins')
            .select('player_id, checked_in_at, flagged, verified_method')
            .eq('tournament_id', id)
          if (!ce) chk = cs ?? []
        } catch { /* degrade */ }

        if (!alive) return
        setTournament(t)
        setEntries(ents)
        setCheckins(chk)
        setLoading(false)
      } catch {
        if (!alive) return
        setLoadError(true)
        setLoading(false)
      }
    }
    load()
    return () => { alive = false }
  }, [id, retryTick])

  // 실시간 + 폴링 폴백 — 다른 기기(선수 폰)·주최자 화면에서 들어온 체크인도 반영
  useEffect(() => {
    if (!id || loading || loadError) return
    const poll = setInterval(loadCheckins, REFRESH_MS)
    const ch = supabase
      .channel(`kiosk-${id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'tournament_checkins', filter: `tournament_id=eq.${id}` },
        () => loadCheckins())
      .subscribe()
    return () => { clearInterval(poll); supabase.removeChannel(ch) }
  }, [id, loading, loadError, loadCheckins])

  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current) }, [])

  const roster = buildKioskRoster(entries, checkins)
  const stats = kioskStats(roster)
  const shown = filterKioskRoster(roster, query)
  const win = getCheckinWindow(tournament)

  function retryLoad() {
    setLoadError(false)
    setLoading(true)
    setRetryTick(t => t + 1)
  }

  async function confirmCheckin() {
    if (!confirmRow || saving) return
    setSaving(true)
    setSaveError(false)
    try {
      const { error } = await selfCheckin(supabase, { tournamentId: id, playerId: confirmRow.playerId })
      if (error) throw error
      // 낙관적 반영 + 서버 재조회
      setCheckins(prev => {
        const rest = prev.filter(c => c.player_id !== confirmRow.playerId)
        return [...rest, {
          player_id: confirmRow.playerId,
          checked_in_at: new Date().toISOString(),
          flagged: false,
          verified_method: 'self',
        }]
      })
      const name = confirmRow.name
      setConfirmRow(null)
      setQuery('')
      setFlash({ name })
      if (flashTimer.current) clearTimeout(flashTimer.current)
      flashTimer.current = setTimeout(() => setFlash(null), 2600)
      loadCheckins()
      if (searchRef.current) searchRef.current.focus()
    } catch {
      setSaveError(true)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#003478]">
      <div className="w-12 h-12 rounded-full border-4 border-white/30 border-t-white animate-spin" />
    </div>
  )

  if (loadError) return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center bg-[#003478] text-white">
      <AlertTriangle size={44} className="mb-3" />
      <p className="text-lg font-bold mb-1">체크인 정보를 불러오지 못했어요</p>
      <p className="text-sm text-white/70 mb-6">인터넷 연결을 확인한 뒤 다시 시도해 주세요.</p>
      <button onClick={retryLoad}
        className="flex items-center gap-2 bg-white text-[#003478] font-bold px-5 py-2.5 rounded-xl">
        <RefreshCw size={16} /> 다시 시도
      </button>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* 헤더 */}
      <div className="bg-[#003478] text-white px-5 pt-4 pb-5 shadow-lg">
        <div className="flex items-center justify-between mb-3">
          <button onClick={() => navigate(`/organizer/${id}/live`)}
            className="flex items-center gap-1 text-white/80 text-sm font-semibold">
            <ArrowLeft size={16} /> 진행 화면
          </button>
          <span className="text-xs font-bold bg-white/15 px-2.5 py-1 rounded-full">🖥️ 셀프 체크인</span>
        </div>
        <h1 className="text-xl font-black leading-tight">{tournament?.name || '대회'}</h1>
        <p className="text-sm text-white/75 mt-0.5">이름을 찾아 <strong className="text-white">체크인</strong>을 눌러 주세요</p>
        <div className="mt-4 flex items-end gap-2">
          <span className="text-3xl font-black tabular-nums">{stats.done}</span>
          <span className="text-base text-white/70 font-bold mb-0.5">/ {stats.total}명 체크인 완료</span>
          {stats.remaining > 0 && (
            <span className="ml-auto text-xs font-bold bg-amber-400 text-amber-900 px-2.5 py-1 rounded-full mb-0.5">
              대기 {stats.remaining}명
            </span>
          )}
        </div>
      </div>

      {/* 체크인 창 안내(당일 아님 등) */}
      {win.phase !== 'open' && (
        <div className="mx-4 mt-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex gap-2.5">
          <span className="text-lg shrink-0">🕑</span>
          <p className="text-sm text-amber-800 leading-relaxed">
            {win.label}. {win.sub || '대회 당일에 체크인이 열려요.'} 필요하면 지금도 체크인할 수 있어요.
          </p>
        </div>
      )}

      {/* 검색 */}
      <div className="px-4 pt-4 pb-2 sticky top-0 z-10 bg-gray-50">
        <div className="flex items-center gap-2 bg-white rounded-2xl border border-gray-200 px-4 py-3 shadow-sm">
          <Search size={20} className="text-gray-400 shrink-0" />
          <input
            ref={searchRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="이름 검색 (예: 김민수)"
            className="flex-1 text-lg font-semibold outline-none bg-transparent"
            autoFocus
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-gray-400 p-1"><X size={18} /></button>
          )}
        </div>
      </div>

      {/* 명단 */}
      <div className="flex-1 px-4 pb-8 space-y-2">
        {roster.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <UserCheck size={40} className="mx-auto mb-3 opacity-40" />
            <p className="text-sm">참가 확정된 선수가 아직 없어요.</p>
          </div>
        )}
        {roster.length > 0 && shown.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">
            '{query}' 이름을 찾지 못했어요. 다시 확인해 주세요.
          </div>
        )}
        {shown.map(r => {
          const cats = r.entries.map(e => e.category).filter(Boolean)
          const catText = [...new Set(cats)].join(' · ')
          const partner = r.entries.map(e => e.partner).find(Boolean)
          return (
            <div key={r.playerId}
              className={`rounded-2xl border p-4 flex items-center gap-3 transition
                ${r.checkedIn ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-gray-200'}`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-lg font-black text-gray-800 truncate">{r.name}</p>
                <p className="text-xs text-gray-500 truncate">
                  {catText || '종목 미정'}{partner ? ` · 파트너 ${partner}` : ''}
                </p>
              </div>
              {r.checkedIn ? (
                <span className="flex items-center gap-1.5 text-emerald-700 font-bold text-sm shrink-0">
                  <CheckCircle2 size={20} /> 완료
                </span>
              ) : (
                <button
                  onClick={() => { setSaveError(false); setConfirmRow(r) }}
                  className="shrink-0 bg-[#C60C30] text-white font-black text-base px-6 py-3 rounded-xl active:scale-95 transition"
                >
                  체크인
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* 체크인 확인 오버레이 */}
      {confirmRow && (
        <div className="fixed inset-0 z-30 bg-black/50 flex items-end sm:items-center justify-center p-4"
          onClick={() => !saving && setConfirmRow(null)}>
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 text-center" onClick={e => e.stopPropagation()}>
            <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-4">
              <UserCheck size={32} className="text-[#003478]" />
            </div>
            <p className="text-sm text-gray-500 mb-1">아래 선수가 맞나요?</p>
            <p className="text-2xl font-black text-gray-800 mb-1">{confirmRow.name}</p>
            <p className="text-sm text-gray-500 mb-5">
              {[...new Set(confirmRow.entries.map(e => e.category).filter(Boolean))].join(' · ') || '종목 미정'}
            </p>
            {saveError && (
              <p className="text-sm text-[#C60C30] mb-3">체크인에 실패했어요. 다시 시도해 주세요.</p>
            )}
            <div className="flex gap-2">
              <button onClick={() => setConfirmRow(null)} disabled={saving}
                className="flex-1 py-3.5 rounded-xl bg-gray-100 text-gray-600 font-bold disabled:opacity-50">
                취소
              </button>
              <button onClick={confirmCheckin} disabled={saving}
                className="flex-1 py-3.5 rounded-xl bg-[#C60C30] text-white font-black disabled:opacity-60">
                {saving ? '처리 중…' : '네, 체크인'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 체크인 완료 플래시 */}
      {flash && (
        <div className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-4 pointer-events-none">
          <div className="bg-emerald-600 text-white font-bold px-5 py-3.5 rounded-2xl shadow-xl flex items-center gap-2">
            <CheckCircle2 size={22} />
            <span><strong>{flash.name}</strong>님 체크인 완료! 즐거운 경기 되세요 🏸</span>
          </div>
        </div>
      )}
    </div>
  )
}

import { useEffect, useState, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { seededShuffle, makeSeed, scheduleMatches, buildRoundRobin, buildSingleElimination } from '../../lib/scheduler'
import TopBar from '../../components/TopBar'
import Spinner from '../../components/Spinner'
import { Shuffle, ChevronRight, RotateCcw, Check, Copy, Clock, MapPin } from 'lucide-react'

function fmt(dt) {
  if (!dt) return ''
  const d = new Date(dt)
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

export default function BracketGenerator() {
  const { id } = useParams()
  const [tournament, setTournament] = useState(null)
  const [categories, setCategories] = useState([])
  const [activeCat, setActiveCat]   = useState(null)
  const [allEntries, setAllEntries] = useState([])
  const [mode, setMode]             = useState('round_robin')
  const [loading, setLoading]       = useState(true)

  // 추첨 상태
  const [phase, setPhase]         = useState('idle')    // idle | drawing | done
  const [seed, setSeed]           = useState('')
  const [drawQueue, setDrawQueue] = useState([])        // 씨드로 셔플된 전체 순서
  const [drawnCount, setDrawnCount] = useState(0)       // 지금까지 뽑힌 수
  const [animating, setAnimating] = useState(false)
  const [justDrawn, setJustDrawn] = useState(null)      // 방금 뽑힌 항목 (애니메이션)
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)
  const [seedCopied, setSeedCopied] = useState(false)
  const drawInterval = useRef(null)

  useEffect(() => {
    async function load() {
      const [{ data: t }, { data: cats }] = await Promise.all([
        supabase.from('tournaments').select('*').eq('id', id).single(),
        supabase.from('tournament_categories').select('*').eq('tournament_id', id),
      ])
      setTournament(t)
      setCategories(cats ?? [])
      setActiveCat(cats?.[0]?.id ?? null)
      setLoading(false)
    }
    load()
  }, [id])

  useEffect(() => {
    if (!activeCat) return
    loadEntries()
    resetDraw()
  }, [activeCat])

  async function loadEntries() {
    const { data } = await supabase
      .from('tournament_entries')
      .select('id, player1:profiles!player1_id(id,name), player2:profiles!player2_id(id,name)')
      .eq('category_id', activeCat)
      .eq('entry_status', 'approved')
    const enriched = (data ?? []).map(e => ({
      ...e,
      label: [e.player1?.name, e.player2?.name].filter(Boolean).join(' / '),
    }))
    setAllEntries(enriched)
  }

  function resetDraw() {
    setPhase('idle')
    setSeed('')
    setDrawQueue([])
    setDrawnCount(0)
    setJustDrawn(null)
    setSaved(false)
    if (drawInterval.current) { clearInterval(drawInterval.current); drawInterval.current = null }
  }

  function startDraw() {
    const s = makeSeed()
    const shuffled = seededShuffle(allEntries, s)
    setSeed(s)
    setDrawQueue(shuffled)
    setDrawnCount(0)
    setJustDrawn(null)
    setPhase('drawing')
    setSaved(false)
  }

  function drawNext() {
    if (animating || drawnCount >= drawQueue.length) return
    setAnimating(true)
    const next = drawQueue[drawnCount]
    setJustDrawn(next)
    setTimeout(() => {
      setDrawnCount(c => c + 1)
      setJustDrawn(null)
      setAnimating(false)
      if (drawnCount + 1 >= drawQueue.length) setPhase('done')
    }, 500)
  }

  function autoDrawAll() {
    if (drawInterval.current) return
    let count = drawnCount
    drawInterval.current = setInterval(() => {
      count++
      setDrawnCount(count)
      if (count >= drawQueue.length) {
        clearInterval(drawInterval.current)
        drawInterval.current = null
        setPhase('done')
      }
    }, 350)
  }

  async function saveSchedule() {
    if (phase !== 'done' || !activeCat) return
    setSaving(true)

    const alreadyDrawn = drawQueue.slice(0, drawnCount)
    const rawMatches = mode === 'round_robin'
      ? buildRoundRobin(alreadyDrawn)
      : buildSingleElimination(alreadyDrawn)

    const courts = Array.from({ length: tournament?.court_count ?? 4 }, (_, i) => i + 1)
    const startDate = new Date(`${tournament.date}T${tournament?.start_time ?? '09:00'}`)
    const scheduled = scheduleMatches({ matches: rawMatches, courts, startTime: startDate, matchMinutes: 30, breakMinutes: 5 })

    await supabase.from('tournament_matches').delete().eq('category_id', activeCat)
    const rows = scheduled.filter(m => !m.bye).map((m, i) => ({
      category_id: activeCat,
      round_type: mode === 'round_robin' ? 'group' : roundLabel(m.round),
      match_number: i + 1,
      team1_entry_id: m.entryA?.id ?? null,
      team2_entry_id: m.entryB?.id ?? null,
      court_number: m.court,
      scheduled_time: m.scheduledTime?.toISOString() ?? null,
      status: 'scheduled',
      draw_seed: seed,
    }))
    await supabase.from('tournament_matches').insert(rows)
    setSaved(true)
    setSaving(false)
  }

  function copySeed() {
    navigator.clipboard.writeText(seed).then(() => {
      setSeedCopied(true)
      setTimeout(() => setSeedCopied(false), 1500)
    })
  }

  function roundLabel(r) {
    const map = { 1: 'final', 2: 'semi', 3: 'quarter' }
    return map[r] ?? 'group'
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>

  const drawn    = drawQueue.slice(0, drawnCount)
  const pool     = drawQueue.slice(drawnCount)
  const nextCard = pool[0]

  // drawn → 대진 쌍
  const pairs = []
  for (let i = 0; i < drawn.length; i += 2) {
    pairs.push({ a: drawn[i], b: drawn[i + 1] ?? null, n: Math.floor(i / 2) + 1 })
  }

  return (
    <div className="safe-bottom">
      <TopBar
        title="공개 추첨 대진표"
        right={phase === 'done' && !saved && (
          <button
            onClick={saveSchedule}
            disabled={saving}
            className="text-sm font-bold px-3 py-1.5 rounded-lg bg-[#003478] text-white disabled:opacity-60"
          >
            {saving ? '저장 중...' : '일정 확정'}
          </button>
        )}
      />

      {/* 종목 탭 */}
      <div className="flex gap-2 px-4 py-3 bg-white border-b border-gray-100 overflow-x-auto">
        {categories.map(cat => (
          <button key={cat.id} onClick={() => setActiveCat(cat.id)}
            className={`px-3 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap transition
                        ${activeCat === cat.id ? 'bg-[#003478] text-white' : 'bg-gray-100 text-gray-600'}`}
          >{cat.sport_type}</button>
        ))}
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* 대기 — 방식 선택 + 추첨 시작 */}
        {phase === 'idle' && (
          <>
            <div className="bg-white rounded-2xl border border-gray-100 p-4">
              <h2 className="font-bold mb-3">대진 방식</h2>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: 'round_robin',        label: '리그전',     desc: '모두와 한 번씩' },
                  { key: 'single_elimination', label: '토너먼트',   desc: '지면 탈락' },
                ].map(m => (
                  <button key={m.key} onClick={() => setMode(m.key)}
                    className={`p-3 rounded-xl border-2 text-left transition
                                ${mode === m.key ? 'border-[#003478] bg-blue-50' : 'border-gray-100'}`}
                  >
                    <p className="font-bold text-sm">{m.label}</p>
                    <p className="text-xs text-gray-400">{m.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* 참가팀 풀 */}
            {allEntries.length > 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-bold">참가팀 ({allEntries.length}팀)</h2>
                  <span className="text-xs text-gray-400">승인된 팀만 추첨 대상</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {allEntries.map((e, i) => (
                    <span key={e.id}
                      className="bg-gray-50 border border-gray-200 text-sm font-semibold px-3 py-1.5 rounded-xl"
                    >
                      {e.label}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-amber-50 rounded-2xl border border-amber-100 p-4 text-sm text-amber-700">
                ⚠️ 승인된 팀이 없습니다. 참가 신청 관리에서 먼저 팀을 승인해주세요.
              </div>
            )}

            <button
              onClick={startDraw}
              disabled={allEntries.length < 2}
              className="w-full py-4 rounded-2xl font-bold text-white text-base
                         flex items-center justify-center gap-2 active:scale-[.97] transition
                         disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #C60C30, #003478)' }}
            >
              <Shuffle size={20} />
              공개 추첨 시작
            </button>
            <p className="text-xs text-center text-gray-400">
              추첨 결과는 누구나 같은 씨드 코드로 검증 가능합니다
            </p>
          </>
        )}

        {/* 추첨 중 + 완료 */}
        {(phase === 'drawing' || phase === 'done') && (
          <>
            {/* 씨드 코드 */}
            <div className="bg-white rounded-2xl border border-gray-100 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">추첨 코드 (공개 검증용)</p>
                  <p className="font-mono text-sm font-bold text-gray-700">{seed}</p>
                </div>
                <button onClick={copySeed}
                  className="flex items-center gap-1 text-xs text-[#003478] font-semibold px-2.5 py-1.5 bg-blue-50 rounded-lg">
                  {seedCopied ? <><Check size={12} /> 복사됨</> : <><Copy size={12} /> 복사</>}
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-2 leading-relaxed">
                이 코드와 팀 목록을 가진 누구나 동일한 결과를 재현할 수 있습니다.
              </p>
            </div>

            {/* 진행 상황 */}
            <div className="flex items-center justify-between text-sm font-semibold">
              <span>{drawnCount} / {drawQueue.length} 팀 추첨됨</span>
              <button onClick={resetDraw}
                className="flex items-center gap-1 text-xs text-gray-400 underline">
                <RotateCcw size={12} /> 다시 추첨
              </button>
            </div>

            {/* 풀 + 대진 2분할 */}
            <div className="grid grid-cols-2 gap-3">
              {/* 남은 풀 */}
              <div>
                <p className="text-xs font-bold text-gray-500 mb-2">🎱 추첨 대기 ({pool.length})</p>
                <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
                  {pool.map((e, i) => (
                    <div key={e.id}
                      className={`text-xs font-semibold px-2.5 py-2 rounded-xl border transition-all
                        ${i === 0 && phase === 'drawing'
                          ? 'bg-[#C60C30] text-white border-[#C60C30] scale-105 shadow-md'
                          : 'bg-white border-gray-200 text-gray-700'}`}
                    >
                      {i === 0 && phase === 'drawing' && <span className="mr-1">👉</span>}
                      {e.label}
                    </div>
                  ))}
                  {pool.length === 0 && <p className="text-xs text-gray-300 italic">모두 추첨됨</p>}
                </div>
              </div>

              {/* 대진 결과 */}
              <div>
                <p className="text-xs font-bold text-gray-500 mb-2">🏸 대진표 ({pairs.length}경기)</p>
                <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
                  {pairs.map(p => (
                    <div key={p.n}
                      className={`text-xs px-2.5 py-2 rounded-xl border
                        ${!p.b ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white'}`}
                    >
                      <span className="text-gray-400 mr-1">{p.n}.</span>
                      <span className="font-bold">{p.a.label}</span>
                      {p.b
                        ? <><span className="text-gray-300 mx-1">vs</span><span className="font-bold">{p.b.label}</span></>
                        : <span className="text-amber-600 ml-1 text-[10px]">← 다음 팀 대기중</span>
                      }
                    </div>
                  ))}
                  {pairs.length === 0 && <p className="text-xs text-gray-300 italic">추첨 후 표시</p>}
                </div>
              </div>
            </div>

            {/* 뽑기 버튼 */}
            {phase === 'drawing' && (
              <div className="flex gap-2">
                <button
                  onClick={drawNext}
                  disabled={animating || pool.length === 0}
                  className="flex-1 py-4 rounded-2xl font-black text-white text-lg
                             active:scale-[.97] transition disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #C60C30, #a00a28)' }}
                >
                  {animating ? '...' : pool.length === 0 ? '완료!' : '🎱 뽑기!'}
                </button>
                <button
                  onClick={autoDrawAll}
                  className="px-4 rounded-2xl bg-gray-100 text-gray-500 text-sm font-bold active:opacity-80"
                >
                  전체<br/>자동
                </button>
              </div>
            )}

            {/* 완료 상태 */}
            {phase === 'done' && (
              <div className="space-y-3">
                <div className="bg-emerald-50 rounded-2xl border border-emerald-200 p-4 text-center">
                  <p className="text-2xl mb-1">🎉</p>
                  <p className="font-black text-emerald-700">추첨 완료!</p>
                  <p className="text-xs text-emerald-600 mt-1">총 {pairs.length}경기 생성 예정</p>
                </div>

                {saved ? (
                  <div className="w-full py-4 rounded-2xl bg-emerald-500 text-white font-bold text-center">
                    ✅ 일정 저장 완료!
                  </div>
                ) : (
                  <button
                    onClick={saveSchedule}
                    disabled={saving}
                    className="w-full py-4 rounded-2xl font-bold text-white text-base
                               active:scale-[.97] transition disabled:opacity-60"
                    style={{ background: 'linear-gradient(135deg, #003478, #C60C30)' }}
                  >
                    {saving ? '저장 중...' : '대진표 확정 + 일정 생성'}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

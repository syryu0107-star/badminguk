import { useEffect, useState, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { makeSeed } from '../../lib/scheduler'
import { knockoutSkeletonSize } from '../../lib/tournament'
import { poolMeanMmr } from '../../lib/drawOptimizer'
import { buildDrawPlan, persistDrawPlan, enrichEntries } from '../../lib/autoDraw'
import TopBar from '../../components/TopBar'
import Spinner from '../../components/Spinner'
import { Shuffle, RotateCcw, Check, Copy, Trophy, Sparkles, Scale } from 'lucide-react'

// ── 유틸 ─────────────────────────────────────────────────────────
// 대진 생성 글루(uuid·makeMatchRow·buildKnockoutRows·buildDrawPlan·persistDrawPlan)는
// lib/autoDraw.js 로 승격해 공개 추첨(이 화면)과 자동 추첨(TournamentManage)이 공유한다.

const FORMAT_INFO = {
  round_robin:   { name: '리그전',          desc: '참가팀 모두와 한 번씩 경기해요' },
  single_elim:   { name: '토너먼트',        desc: '지면 탈락하는 방식이에요' },
  pool_knockout: { name: '조별리그 + 본선', desc: '조에서 좋은 성적을 내면 본선 토너먼트에 올라가요' },
  pool_only:     { name: '조별리그만',      desc: '조 안에서 경기해 순위를 정해요' },
}

export default function BracketGenerator() {
  const { id } = useParams()
  const [tournament, setTournament] = useState(null)
  const [categories, setCategories] = useState([])
  const [activeCat, setActiveCat]   = useState(null)
  const [allEntries, setAllEntries] = useState([])
  const [loading, setLoading]       = useState(true)

  // 추첨 상태
  const [phase, setPhase]           = useState('idle')  // idle | drawing | done
  const [plan, setPlan]             = useState(null)    // { format, seed, pools, round1, size, sequence }
  const [drawnCount, setDrawnCount] = useState(0)
  const [animating, setAnimating]   = useState(false)
  const [justDrawn, setJustDrawn]   = useState(null)    // 방금 뽑힌 항목 (애니메이션)
  const [saving, setSaving]         = useState(false)
  const [saved, setSaved]           = useState(false)
  const [seedCopied, setSeedCopied] = useState(false)
  const [aiBalance, setAiBalance]   = useState(true)  // AI 균형 추첨 (조 편성 최적화)
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
      .select('id, team_name, player1:profiles!player1_id(id,name,mmr), player2:profiles!player2_id(id,name,mmr)')
      .eq('category_id', activeCat)
      .eq('entry_status', 'approved')
    setAllEntries(enrichEntries(data))
  }

  function resetDraw() {
    setPhase('idle')
    setPlan(null)
    setDrawnCount(0)
    setJustDrawn(null)
    setSaved(false)
    if (drawInterval.current) { clearInterval(drawInterval.current); drawInterval.current = null }
  }

  const activeCategory = categories.find(c => c.id === activeCat)
  const format = activeCategory?.tournament_format ?? 'round_robin'
  const formatInfo = FORMAT_INFO[format] ?? FORMAT_INFO.round_robin
  const seedingOn = !!activeCategory?.seeding_enabled

  // AI 균형 추첨 적용 여부 판정 (조별 포맷 · 2개 이상 조 · MMR 데이터 있음)
  const isPoolFormat = format === 'pool_only' || format === 'pool_knockout'
  const poolSizeCfg = format === 'round_robin'
    ? Math.max(allEntries.length, 1)
    : Math.max(activeCategory?.pool_size ?? 4, 1)
  const numPools = poolSizeCfg > 0 ? Math.ceil(allEntries.length / poolSizeCfg) : 1
  const hasMmrData = allEntries.some(e => e.mmr != null)
  // 토글 노출: 무작위 편성일 때만(시드 켜짐이면 이미 MMR 스네이크로 균형 배정)
  const canToggleBalance = isPoolFormat && numPools >= 2 && hasMmrData && !seedingOn
  // 최적화 실행: 조별 포맷·2개 이상 조·MMR 있음 + (시드 켜짐 or AI 균형 켜짐)
  const useOptimizer = isPoolFormat && numPools >= 2 && hasMmrData && (seedingOn || aiBalance)

  // ── 추첨 계획 수립 (씨드 고정 → 저장 시 그대로 사용, 재현 가능) ──
  // 계획 로직은 lib/autoDraw.buildDrawPlan 공용(공개 추첨·자동 추첨 단일 소스).
  function startDraw() {
    if (allEntries.length < 2) return
    const s = makeSeed()
    setPlan(buildDrawPlan({
      format, entries: allEntries, category: activeCategory,
      seed: s, useOptimizer, seedingOn,
    }))

    setDrawnCount(0)
    setJustDrawn(null)
    setPhase('drawing')
    setSaved(false)
  }

  function drawNext() {
    if (!plan || animating || drawnCount >= plan.sequence.length) return
    setAnimating(true)
    const next = plan.sequence[drawnCount]
    setJustDrawn(next)
    setTimeout(() => {
      setDrawnCount(c => c + 1)
      setJustDrawn(null)
      setAnimating(false)
      if (drawnCount + 1 >= plan.sequence.length) setPhase('done')
    }, 500)
  }

  function autoDrawAll() {
    if (!plan || drawInterval.current) return
    let count = drawnCount
    drawInterval.current = setInterval(() => {
      count++
      setDrawnCount(count)
      if (count >= plan.sequence.length) {
        clearInterval(drawInterval.current)
        drawInterval.current = null
        setPhase('done')
      }
    }, 350)
  }

  // ── 저장: 조 + 조별 경기 + 녹아웃 전 라운드(진출 링크 포함) ──
  // 저장 로직은 lib/autoDraw.persistDrawPlan 공용(공개 추첨·자동 추첨 단일 소스).
  async function saveSchedule() {
    if (phase !== 'done' || !activeCat || !plan) return
    setSaving(true)
    const res = await persistDrawPlan(supabase, {
      plan, categoryId: activeCat, tournament, category: activeCategory, entries: allEntries,
    })
    if (res.ok) {
      setSaved(true)
    } else {
      console.error('대진 저장 실패:', res.error)
      alert('저장에 실패했어요. 잠시 후 다시 시도해주세요.\n' + (res.error?.message ?? ''))
    }
    setSaving(false)
  }

  function copySeed() {
    navigator.clipboard.writeText(plan?.seed ?? '').then(() => {
      setSeedCopied(true)
      setTimeout(() => setSeedCopied(false), 1500)
    })
  }

  // ── 요약 문구 ──
  function planSummary() {
    if (!plan) return ''
    if (plan.format === 'single_elim') {
      const byes = plan.round1.filter(m => m.isBye).length
      const real = plan.size - 1 - byes
      return `본선 ${plan.size}강 · 총 ${real}경기` + (byes > 0 ? ` (부전승 ${byes}팀 자동 진출)` : '')
    }
    const poolMatches = plan.pools.reduce((s, p) => s + (p.entries.length * (p.entries.length - 1)) / 2, 0)
    if (plan.format === 'pool_knockout') {
      const poolSizes = plan.pools.map(p => p.entries.length)
      const size = knockoutSkeletonSize(
        poolSizes, activeCategory?.advancement_per_pool ?? 2, activeCategory?.wildcard_count ?? 0
      )
      return `조별 ${poolMatches}경기 + 본선 ${size}강 자리 예약`
    }
    return `총 ${poolMatches}경기`
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>

  const sequence  = plan?.sequence ?? []
  const drawnSeq  = sequence.slice(0, drawnCount)
  const remaining = sequence.slice(drawnCount)

  // single_elim: 뽑힌 순서 → 대진 쌍
  const pairs = []
  if (plan?.format === 'single_elim') {
    for (let i = 0; i < drawnSeq.length; i += 2) {
      pairs.push({ a: drawnSeq[i], b: drawnSeq[i + 1] ?? null, n: Math.floor(i / 2) + 1 })
    }
  }

  const minTeams = activeCategory?.min_teams ?? 4

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
        {/* 대기 — 종목 설정 요약 + 추첨 시작 */}
        {phase === 'idle' && (
          <>
            <div className="bg-white rounded-2xl border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-1">
                <Trophy size={16} className="text-[#003478]" />
                <h2 className="font-bold">{formatInfo.name}</h2>
                {seedingOn && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-[#003478]">
                    MMR 시드 배정
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 mb-3">{formatInfo.desc}</p>
              <div className="flex flex-wrap gap-1.5">
                {format !== 'round_robin' && format !== 'single_elim' && (
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-200 text-gray-600">
                    {activeCategory?.pool_size ?? 4}팀씩 조 편성
                  </span>
                )}
                {format === 'pool_knockout' && (
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-200 text-gray-600">
                    조별 {activeCategory?.advancement_per_pool ?? 2}위까지 본선 진출
                  </span>
                )}
                {format === 'pool_knockout' && (activeCategory?.wildcard_count ?? 0) > 0 && (
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-200 text-gray-600">
                    와일드카드 {activeCategory.wildcard_count}팀
                  </span>
                )}
                <span className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-200 text-gray-600">
                  {activeCategory?.games_per_match ?? 3}게임 {activeCategory?.points_per_game ?? 21}점제
                </span>
              </div>
              {seedingOn && (
                <p className="text-[11px] text-gray-400 mt-2">
                  실력(MMR) 상위 팀은 서로 다른 조 또는 대진 반대편에 배치돼요.
                </p>
              )}
            </div>

            {/* AI 균형 추첨 토글 (무작위 편성 + 조 2개 이상 + MMR 있음) */}
            {canToggleBalance && (
              <button
                onClick={() => setAiBalance(v => !v)}
                className={`w-full text-left rounded-2xl border p-4 transition
                  ${aiBalance ? 'border-[#003478] bg-blue-50/60' : 'border-gray-200 bg-white'}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 shrink-0 w-11 h-6 rounded-full flex items-center px-0.5 transition
                    ${aiBalance ? 'bg-[#003478] justify-end' : 'bg-gray-200 justify-start'}`}>
                    <span className="w-5 h-5 rounded-full bg-white shadow" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Sparkles size={15} className="text-[#003478]" />
                      <span className="font-bold text-sm">AI 균형 추첨</span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#003478] text-white">추천</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                      {aiBalance
                        ? '후보 대진 16개를 비교해 조별 실력이 가장 고른 대진을 자동으로 골라요. 한 조에 강팀이 몰리는 쏠림을 막아줘요. (씨드는 공개돼 재현 가능)'
                        : '꺼짐 — 그냥 무작위로 한 번 뽑아요. 운에 따라 조별 실력이 기울 수 있어요.'}
                    </p>
                  </div>
                </div>
              </button>
            )}

            {/* 참가팀 풀 */}
            {allEntries.length > 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-bold">참가팀 ({allEntries.length}팀)</h2>
                  <span className="text-xs text-gray-400">승인된 팀만 추첨 대상</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {allEntries.map(e => (
                    <span key={e.id}
                      className="bg-gray-50 border border-gray-200 text-sm font-semibold px-3 py-1.5 rounded-xl"
                    >
                      {e.label}
                      {seedingOn && e.mmr != null && (
                        <span className="text-[10px] text-gray-400 ml-1">MMR {Math.round(e.mmr)}</span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-amber-50 rounded-2xl border border-amber-100 p-4 text-sm text-amber-700">
                ⚠️ 승인된 팀이 없습니다. 참가 신청 관리에서 먼저 팀을 승인해주세요.
              </div>
            )}

            {allEntries.length > 0 && allEntries.length < minTeams && (
              <div className="bg-amber-50 rounded-2xl border border-amber-100 p-3 text-xs text-amber-700">
                ⚠️ 최소 참가 팀 수({minTeams}팀)보다 적어요. 그래도 추첨은 진행할 수 있어요.
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
        {(phase === 'drawing' || phase === 'done') && plan && (
          <>
            {/* 씨드 코드 */}
            <div className="bg-white rounded-2xl border border-gray-100 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">추첨 코드 (공개 검증용)</p>
                  <p className="font-mono text-sm font-bold text-gray-700">{plan.seed}</p>
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
              <span>{drawnCount} / {sequence.length} 추첨됨</span>
              <button onClick={resetDraw}
                className="flex items-center gap-1 text-xs text-gray-400 underline">
                <RotateCcw size={12} /> 다시 추첨
              </button>
            </div>

            {/* 방금 뽑힌 팀 배너 */}
            {justDrawn && (
              <div className="bg-[#C60C30] text-white rounded-2xl p-4 text-center font-black text-lg animate-pulse">
                {justDrawn.bye
                  ? '🎫 부전승 자리!'
                  : justDrawn.type === 'pool' && plan.format !== 'round_robin'
                    ? `🎉 ${justDrawn.poolName}에 ${justDrawn.label}!`
                    : `🎉 ${justDrawn.label}!`}
              </div>
            )}

            {/* 조 편성 보드 (리그전·조별리그) */}
            {plan.pools && (
              <div className={`grid gap-3 ${plan.pools.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                {plan.pools.map(p => {
                  const members = drawnSeq.filter(it => it.poolIndex === p.poolIndex)
                  return (
                    <div key={p.poolIndex} className="bg-white rounded-2xl border border-gray-100 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-bold text-gray-500">
                          🏸 {plan.format === 'round_robin' ? '참가팀' : p.poolName} ({members.length}/{p.entries.length})
                        </p>
                        {phase === 'done' && plan.optimization?.explanation?.hasMmr && poolMeanMmr(p) != null && (
                          <span className="text-[10px] font-bold text-[#003478] bg-blue-50 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                            평균 {Math.round(poolMeanMmr(p))}
                          </span>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        {members.map(it => (
                          <div key={it.entryId}
                            className="text-xs font-semibold px-2.5 py-2 rounded-xl border bg-white border-gray-200 text-gray-700">
                            {it.label}
                          </div>
                        ))}
                        {members.length === 0 && <p className="text-xs text-gray-300 italic">추첨 대기</p>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* 토너먼트 대진 보드 (single_elim) */}
            {plan.format === 'single_elim' && (
              <div className="grid grid-cols-2 gap-3">
                {/* 남은 풀 */}
                <div>
                  <p className="text-xs font-bold text-gray-500 mb-2">🎱 추첨 대기 ({remaining.filter(it => !it.bye).length})</p>
                  <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
                    {remaining.map((it, i) => (
                      <div key={`${it.entryId ?? 'bye'}-${drawnCount + i}`}
                        className={`text-xs font-semibold px-2.5 py-2 rounded-xl border transition-all
                          ${i === 0 && phase === 'drawing'
                            ? 'bg-[#C60C30] text-white border-[#C60C30] scale-105 shadow-md'
                            : it.bye
                              ? 'bg-amber-50 border-amber-200 text-amber-600'
                              : 'bg-white border-gray-200 text-gray-700'}`}
                      >
                        {i === 0 && phase === 'drawing' && <span className="mr-1">👉</span>}
                        {it.label}
                      </div>
                    ))}
                    {remaining.length === 0 && <p className="text-xs text-gray-300 italic">모두 추첨됨</p>}
                  </div>
                </div>

                {/* 대진 결과 */}
                <div>
                  <p className="text-xs font-bold text-gray-500 mb-2">🏸 1라운드 ({pairs.length}경기)</p>
                  <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
                    {pairs.map(p => (
                      <div key={p.n}
                        className={`text-xs px-2.5 py-2 rounded-xl border
                          ${p.a?.bye || p.b?.bye ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white'}`}
                      >
                        <span className="text-gray-400 mr-1">{p.n}.</span>
                        <span className={`font-bold ${p.a?.bye ? 'text-amber-600' : ''}`}>{p.a?.label}</span>
                        {p.b
                          ? <><span className="text-gray-300 mx-1">vs</span>
                              <span className={`font-bold ${p.b.bye ? 'text-amber-600' : ''}`}>{p.b.label}</span></>
                          : <span className="text-amber-600 ml-1 text-[10px]">← 다음 추첨 대기중</span>
                        }
                      </div>
                    ))}
                    {pairs.length === 0 && <p className="text-xs text-gray-300 italic">추첨 후 표시</p>}
                  </div>
                </div>
              </div>
            )}

            {/* 뽑기 버튼 */}
            {phase === 'drawing' && (
              <div className="flex gap-2">
                <button
                  onClick={drawNext}
                  disabled={animating || remaining.length === 0}
                  className="flex-1 py-4 rounded-2xl font-black text-white text-lg
                             active:scale-[.97] transition disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #C60C30, #a00a28)' }}
                >
                  {animating ? '...' : remaining.length === 0 ? '완료!' : '🎱 뽑기!'}
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
                  <p className="text-xs text-emerald-600 mt-1">{planSummary()}</p>
                  {plan.format === 'pool_knockout' && (
                    <p className="text-[11px] text-emerald-600 mt-1">
                      본선 대진은 조별리그가 끝나면 자동으로 채워져요.
                    </p>
                  )}
                  {plan.format === 'single_elim' && (
                    <p className="text-[11px] text-emerald-600 mt-1">
                      부전승 팀은 다음 라운드로 자동 진출 처리돼요.
                    </p>
                  )}
                </div>

                {/* AI 대진 최적화 — 왜 이 대진이 균형적인지 설명 */}
                {plan.optimization?.explanation?.hasMmr && (
                  <div className="bg-white rounded-2xl border border-[#003478]/20 p-4">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Scale size={15} className="text-[#003478]" />
                      <h3 className="font-bold text-sm text-[#003478]">
                        {plan.optimization.explanation.headline}
                      </h3>
                    </div>
                    <p className="text-xs text-gray-500 leading-relaxed">
                      {plan.optimization.explanation.detail}
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {plan.optimization.explanation.poolLines.map(pl => (
                        <span key={pl.name}
                          className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-gray-50 border border-gray-200 text-gray-600">
                          {pl.name} {pl.mean != null ? `평균 ${pl.mean}` : ''}
                        </span>
                      ))}
                    </div>
                    {plan.optimization.method === 'balanced' && plan.optimization.avgSpread > plan.optimization.bestSpread && (
                      <p className="text-[11px] text-gray-400 mt-2">
                        조별 평균 실력 차이 {Math.round(plan.optimization.bestSpread)}
                        <span className="text-gray-300"> (무작위 평균 {Math.round(plan.optimization.avgSpread)})</span>
                      </p>
                    )}
                  </div>
                )}

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

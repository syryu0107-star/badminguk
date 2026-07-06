import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { buildRoundRobin, buildSingleElimination, scheduleMatches } from '../../lib/scheduler'
import TopBar from '../../components/TopBar'
import Spinner from '../../components/Spinner'
import { Zap, Clock, MapPin } from 'lucide-react'

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
  const [schedule, setSchedule]     = useState([])
  const [mode, setMode]             = useState('round_robin')
  const [loading, setLoading]       = useState(true)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving]         = useState(false)
  const [saved, setSaved]           = useState(false)

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

  async function generate() {
    if (!activeCat) return
    setGenerating(true)

    // 해당 종목의 승인된 팀 조회
    const { data: entries } = await supabase
      .from('tournament_entries')
      .select('id, player1:profiles!player1_id(id,name), player2:profiles!player2_id(id,name)')
      .eq('category_id', activeCat)
      .eq('entry_status', 'approved')

    if (!entries?.length) { setGenerating(false); return }

    const enriched = entries.map(e => ({
      ...e,
      playerIds: [e.player1?.id, e.player2?.id].filter(Boolean),
      label: [e.player1?.name, e.player2?.name].filter(Boolean).join(' / '),
    }))

    const rawMatches = mode === 'round_robin'
      ? buildRoundRobin(enriched)
      : buildSingleElimination(enriched)

    const courts = Array.from({ length: tournament.court_count ?? 4 }, (_, i) => i + 1)
    const startDate = new Date(`${tournament.date}T${tournament.start_time ?? '09:00'}`)

    const scheduled = scheduleMatches({
      matches: rawMatches,
      courts,
      startTime: startDate,
      matchMinutes: 30,
      breakMinutes: 5,
      restMinutes: 20,
    })

    setSchedule(scheduled)
    setGenerating(false)
    setSaved(false)
  }

  async function saveSchedule() {
    if (!schedule.length || !activeCat) return
    setSaving(true)

    // 기존 경기 삭제 후 재생성
    await supabase
      .from('tournament_matches')
      .delete()
      .eq('category_id', activeCat)

    const rows = schedule.filter(m => !m.bye).map((m, i) => ({
      category_id: activeCat,
      round_type: mode === 'round_robin' ? 'group' : roundLabel(m.round),
      match_number: i + 1,
      team1_entry_id: m.entryA?.id ?? null,
      team2_entry_id: m.entryB?.id ?? null,
      court_number: m.court,
      scheduled_time: m.scheduledTime?.toISOString() ?? null,
      status: 'scheduled',
    }))

    await supabase.from('tournament_matches').insert(rows)
    setSaved(true)
    setSaving(false)
  }

  function roundLabel(r) {
    const map = { 1:'final', 2:'semi', 3:'quarter' }
    return map[r] ?? 'group'
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>

  const activeCatInfo = categories.find(c => c.id === activeCat)

  return (
    <div className="safe-bottom">
      <TopBar
        title="AI 대진표 생성"
        right={schedule.length > 0 && (
          <button
            onClick={saveSchedule}
            disabled={saving || saved}
            className={`text-sm font-bold px-3 py-1.5 rounded-lg
                        ${saved ? 'bg-emerald-100 text-emerald-700' : 'bg-[#003478] text-white'}
                        disabled:opacity-60`}
          >
            {saved ? '저장됨 ✓' : saving ? '저장 중...' : '일정 저장'}
          </button>
        )}
      />

      {/* 종목 탭 */}
      <div className="flex gap-2 px-4 py-3 bg-white border-b border-gray-100 overflow-x-auto">
        {categories.map(cat => (
          <button
            key={cat.id}
            onClick={() => { setActiveCat(cat.id); setSchedule([]) }}
            className={`px-3 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap transition
                        ${activeCat === cat.id ? 'bg-[#003478] text-white' : 'bg-gray-100 text-gray-600'}`}
          >
            {cat.sport_type}
          </button>
        ))}
      </div>

      <div className="px-4 py-5 space-y-4">
        {/* 방식 선택 */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <h2 className="font-bold mb-3">대진 방식</h2>
          <div className="grid grid-cols-2 gap-2">
            {[
              { key: 'round_robin',       label: '리그전', desc: '모두와 한 번씩' },
              { key: 'single_elimination', label: '토너먼트', desc: '지면 탈락' },
            ].map(m => (
              <button
                key={m.key}
                onClick={() => { setMode(m.key); setSchedule([]) }}
                className={`p-3 rounded-xl border-2 text-left transition
                            ${mode === m.key ? 'border-[#003478] bg-blue-50' : 'border-gray-100'}`}
              >
                <p className="font-bold text-sm">{m.label}</p>
                <p className="text-xs text-gray-400">{m.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* 생성 버튼 */}
        <button
          onClick={generate}
          disabled={generating}
          className="w-full py-4 rounded-2xl font-bold text-white text-base
                     flex items-center justify-center gap-2 active:scale-[.97] transition
                     disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, #C60C30, #003478)' }}
        >
          <Zap size={18} />
          {generating ? 'AI 생성 중...' : 'AI 대진표 생성'}
        </button>

        {/* 결과 */}
        {schedule.length > 0 && (
          <div>
            <h2 className="font-bold mb-3">
              생성된 경기 일정 ({schedule.filter(m => !m.bye).length}경기)
            </h2>
            <div className="space-y-2">
              {schedule.filter(m => !m.bye).map((m, i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-100 p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <Clock size={11} /> {fmt(m.scheduledTime)}
                      {m.court && <><MapPin size={11} /> 코트 {m.court}</>}
                    </div>
                    <span className="text-xs text-gray-300">R{m.round}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <span className="flex-1 truncate">{m.entryA?.label ?? '팀 A'}</span>
                    <span className="text-gray-300 text-xs font-normal">vs</span>
                    <span className="flex-1 truncate text-right">{m.entryB?.label ?? '팀 B'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

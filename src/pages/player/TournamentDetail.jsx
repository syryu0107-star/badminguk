import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import TopBar from '../../components/TopBar'
import GradeChip from '../../components/GradeChip'
import Spinner from '../../components/Spinner'
import { MapPin, Calendar, Users, ChevronDown, ChevronUp } from 'lucide-react'

export default function TournamentDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [tournament, setTournament] = useState(null)
  const [categories, setCategories] = useState([])
  const [myEntries, setMyEntries]   = useState([])
  const [loading, setLoading]       = useState(true)
  const [selectedCat, setSelectedCat] = useState(null)
  const [partner, setPartner]       = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess]       = useState(false)
  const [profile, setProfile]       = useState(null)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      const [{ data: t }, { data: c }, { data: p }] = await Promise.all([
        supabase.from('tournaments').select('*').eq('id', id).single(),
        supabase.from('tournament_categories').select('*').eq('tournament_id', id),
        supabase.from('profiles').select('*').eq('id', user.id).single(),
      ])
      // 내 기신청 내역
      const { data: entries } = await supabase
        .from('tournament_entries')
        .select('*, category:tournament_categories(*)')
        .in('category_id', c?.map(x => x.id) ?? [])
        .eq('player1_id', user.id)

      setTournament(t)
      setCategories(c ?? [])
      setMyEntries(entries ?? [])
      setProfile(p)
      setLoading(false)
    }
    load()
  }, [id])

  async function submitEntry() {
    if (!selectedCat) return
    setSubmitting(true)
    const { data: { user } } = await supabase.auth.getUser()

    // 파트너 ID 조회 (이름으로 검색)
    let p2id = null
    if (partner.trim()) {
      const { data: pm } = await supabase
        .from('profiles')
        .select('id')
        .ilike('name', partner.trim())
        .single()
      p2id = pm?.id
    }

    await supabase.from('tournament_entries').insert({
      category_id: selectedCat,
      player1_id: user.id,
      player2_id: p2id,
      entry_status: 'applied',
    })

    setSuccess(true)
    setSubmitting(false)
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner size={36} /></div>
  if (!tournament) return <div className="text-center py-20 text-gray-400">대회를 찾을 수 없습니다.</div>

  const canApply = tournament.status === 'open'

  return (
    <div className="safe-bottom">
      <TopBar title={tournament.title} />

      {/* 배너 */}
      <div
        className="h-40 flex items-end px-5 pb-5"
        style={{ background: 'linear-gradient(135deg, #C60C30, #003478)' }}
      >
        <div className="text-white">
          <h1 className="text-xl font-black">{tournament.title}</h1>
          <div className="flex items-center gap-3 text-white/80 text-sm mt-1">
            <span className="flex items-center gap-1"><Calendar size={12} /> {tournament.date}</span>
            <span className="flex items-center gap-1"><MapPin size={12} /> {tournament.venue}</span>
          </div>
        </div>
      </div>

      {/* 정보 */}
      <div className="px-4 py-5 space-y-5">
        {/* 설명 */}
        {tournament.description && (
          <div className="bg-white rounded-2xl p-4 border border-gray-100">
            <p className="text-sm text-gray-600 leading-relaxed">{tournament.description}</p>
          </div>
        )}

        {/* 종목/조 목록 */}
        <div>
          <h2 className="font-bold mb-3">참가 종목</h2>
          <div className="space-y-2">
            {categories.map(cat => {
              const alreadyApplied = myEntries.some(e => e.category_id === cat.id)
              return (
                <div key={cat.id} className="bg-white rounded-2xl p-4 border border-gray-100">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold">{cat.sport_type}</span>
                      {cat.grade_max && <GradeChip grade={cat.grade_max} size="sm" />}
                      <span className="text-xs text-gray-400">이하</span>
                    </div>
                    <span className="text-sm font-bold text-[#C60C30]">
                      {cat.entry_fee === 0 ? '무료' : `${cat.entry_fee.toLocaleString()}원`}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400 flex items-center gap-1">
                      <Users size={11} /> 최대 {cat.max_teams}팀
                    </span>
                    {alreadyApplied ? (
                      <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                        신청 완료
                      </span>
                    ) : canApply && (
                      <button
                        onClick={() => setSelectedCat(cat.id === selectedCat ? null : cat.id)}
                        className="text-xs font-bold text-white bg-[#C60C30] px-3 py-1 rounded-full
                                   flex items-center gap-1 active:opacity-80"
                      >
                        신청 {cat.id === selectedCat ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                    )}
                  </div>

                  {/* 신청 폼 */}
                  {selectedCat === cat.id && !alreadyApplied && (
                    <div className="mt-3 pt-3 border-t border-gray-100 space-y-3 fade-up">
                      <div>
                        <label className="text-xs font-semibold text-gray-600 block mb-1">파트너 이름</label>
                        <input
                          value={partner}
                          onChange={e => setPartner(e.target.value)}
                          placeholder="파트너 이름 (없으면 비워두세요)"
                          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#C60C30]"
                        />
                      </div>
                      {success ? (
                        <p className="text-emerald-600 font-semibold text-sm text-center">✅ 신청 완료!</p>
                      ) : (
                        <button
                          onClick={submitEntry}
                          disabled={submitting}
                          className="w-full py-2.5 rounded-xl text-white font-bold text-sm
                                     transition active:scale-[.97] disabled:opacity-60"
                          style={{ background: 'linear-gradient(135deg, #C60C30, #003478)' }}
                        >
                          {submitting ? '신청 중...' : '참가 신청'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

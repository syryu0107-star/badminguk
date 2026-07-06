import { Clock, MapPin } from 'lucide-react'

function fmt(dt) {
  if (!dt) return '--:--'
  const d = new Date(dt)
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

const STATUS = {
  scheduled:   { text: '예정',   cls: 'bg-gray-100 text-gray-500' },
  in_progress: { text: '진행중', cls: 'bg-red-100 text-red-600 animate-pulse' },
  completed:   { text: '완료',   cls: 'bg-emerald-100 text-emerald-700' },
  forfeited:   { text: '기권',   cls: 'bg-yellow-100 text-yellow-700' },
}

export default function MatchCard({ match, onTap }) {
  const s = STATUS[match.status] ?? STATUS.scheduled
  const isWon  = match.myTeam && match.winner_entry_id === match.myTeamEntryId
  const isLost = match.myTeam && match.winner_entry_id && match.winner_entry_id !== match.myTeamEntryId

  return (
    <button
      onClick={onTap}
      className="w-full bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-left
                 active:scale-[.98] transition-transform"
    >
      {/* header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Clock size={12} />
          {fmt(match.scheduledTime ?? match.scheduled_time)}
          {match.court && (
            <span className="flex items-center gap-0.5">
              <MapPin size={12} /> 코트 {match.court}
            </span>
          )}
        </div>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.cls}`}>{s.text}</span>
      </div>

      {/* teams */}
      <div className="flex items-center gap-3">
        <div className={`flex-1 text-sm font-semibold ${isWon ? 'text-emerald-600' : ''}`}>
          {match.team1Name ?? '팀 A'}
        </div>
        <div className="text-xs font-bold text-gray-300">VS</div>
        <div className={`flex-1 text-sm font-semibold text-right ${isLost ? 'text-red-500' : ''}`}>
          {match.team2Name ?? '팀 B'}
        </div>
      </div>

      {/* score */}
      {match.sets?.length > 0 && (
        <div className="flex justify-center gap-4 mt-2 text-xs text-gray-400">
          {match.sets.map((s, i) => (
            <span key={i}>{s.a} : {s.b}</span>
          ))}
        </div>
      )}
    </button>
  )
}

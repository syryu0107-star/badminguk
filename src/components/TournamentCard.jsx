import { useNavigate } from 'react-router-dom'
import { MapPin, Calendar, Users } from 'lucide-react'
import GradeChip from './GradeChip'

const STATUS_LABEL = {
  draft:       { text: '준비중',   cls: 'bg-gray-100 text-gray-600' },
  open:        { text: '접수중',   cls: 'bg-emerald-100 text-emerald-700' },
  closed:      { text: '접수마감', cls: 'bg-orange-100 text-orange-700' },
  in_progress: { text: '진행중',   cls: 'bg-red-100 text-red-600' },
  completed:   { text: '종료',     cls: 'bg-gray-100 text-gray-500' },
}

export default function TournamentCard({ tournament, href }) {
  const navigate = useNavigate()
  const s = STATUS_LABEL[tournament.status] ?? STATUS_LABEL.draft

  return (
    <button
      onClick={() => navigate(href ?? `/tournaments/${tournament.id}`)}
      className="w-full bg-white rounded-2xl p-4 text-left border border-gray-100
                 shadow-sm active:scale-[.98] transition-transform"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="font-bold text-base leading-tight">{tournament.title}</p>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${s.cls}`}>
          {s.text}
        </span>
      </div>

      <div className="flex flex-col gap-1 text-sm text-gray-500">
        <div className="flex items-center gap-1.5">
          <Calendar size={13} />
          {tournament.date}
        </div>
        <div className="flex items-center gap-1.5">
          <MapPin size={13} />
          {tournament.venue}
        </div>
      </div>

      {tournament.categories?.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {tournament.categories.map(c => (
            <span key={c.id} className="text-xs bg-gray-50 border border-gray-200 rounded px-2 py-0.5">
              {c.sport_type}
              {c.grade_max && <> · {c.grade_max} 이하</>}
            </span>
          ))}
        </div>
      )}
    </button>
  )
}

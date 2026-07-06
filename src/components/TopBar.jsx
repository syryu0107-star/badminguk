import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'

export default function TopBar({ title, back, right, className = '' }) {
  const navigate = useNavigate()

  return (
    <header
      className={`sticky top-0 z-40 bg-white border-b border-gray-100
                  flex items-center h-14 px-4 gap-2 ${className}`}
    >
      {back !== false && (
        <button
          onClick={() => (typeof back === 'function' ? back() : navigate(-1))}
          className="p-1 -ml-1 rounded-full active:bg-gray-100"
        >
          <ChevronLeft size={24} />
        </button>
      )}

      <span className="flex-1 text-base font-semibold truncate">{title}</span>

      {right && <div className="flex items-center gap-1">{right}</div>}
    </header>
  )
}

import { getMMRPercentile } from '../lib/grades'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

export default function MMRBadge({ mmr, delta, showPercentile = false }) {
  const pct = getMMRPercentile(mmr)

  return (
    <div className="flex items-center gap-2">
      <span className="text-2xl font-black tabular-nums">{mmr.toLocaleString()}</span>
      {delta != null && delta !== 0 && (
        <span className={`flex items-center text-sm font-bold ${delta > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
          {delta > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          {delta > 0 ? '+' : ''}{delta}
        </span>
      )}
      {delta === 0 && <Minus size={14} className="text-gray-400" />}
      {showPercentile && (
        <span className="text-xs text-gray-400">{pct}</span>
      )}
    </div>
  )
}

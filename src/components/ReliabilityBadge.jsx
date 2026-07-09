import { TIER_CLASSES } from '../lib/reliability'
import { ShieldCheck } from 'lucide-react'

// 레이팅 신뢰도 배지 — 리스트/프로필 공용
// size: 'sm' (칩) | 'md' (아이콘+수치)
export default function ReliabilityBadge({ result, size = 'sm', showLabel = true }) {
  if (!result) return null
  const { score, tier } = result
  const c = TIER_CLASSES[tier.color] ?? TIER_CLASSES.gray

  if (size === 'sm') {
    return (
      <span
        className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${c.bg} ${c.text}`}
        title={`레이팅 신뢰도 ${score}% · ${tier.desc}`}
      >
        <ShieldCheck size={10} />
        {score}%
      </span>
    )
  }

  return (
    <div className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 ${c.bg}`}>
      <ShieldCheck size={14} className={c.text} />
      <span className={`text-sm font-black tabular-nums ${c.text}`}>{score}%</span>
      {showLabel && <span className="text-xs font-semibold text-gray-500">신뢰도 {tier.label}</span>}
    </div>
  )
}

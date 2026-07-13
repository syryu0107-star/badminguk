import { reliabilityLabel } from '../lib/rating'
import { ShieldCheck } from 'lucide-react'

// ── 신뢰도 배지 (초보자용) ─────────────────────────────────────────
// 원점수(MMR·RD)를 절대 노출하지 않고 "측정 중 / 검증완료" 상태로만 보여준다.
// rating.js.reliabilityLabel(rd, games, relScore) 브리지 하나만 호출 →
//   선험 RD(온보딩 밴드) ↔ 사후 신뢰도(경기 누적)를 한 곳에서 통합한다.
//
// props:
//   rd       : profiles.mmr_rd / singles_mmr_rd (없으면 신규로 간주 → '측정 중')
//   games    : 해당 종목 경기 수 (mmr_games_played 등)
//   relScore : reliability.js calcReliability().score (성숙 구간이면 이 값을 우선)
//   result   : (하위호환) calcReliability 결과 통째 — 그 .score만 relScore로 사용
//   size     : 'sm'(리스트 칩) | 'md'(카드)
//   showPct  : 신뢰도 %를 함께 노출할지 (기본 false — 숫자 최소화)
const TONE = {
  verified:    { bg: 'bg-emerald-50', text: 'text-emerald-600', dot: 'bg-emerald-500' },
  provisional: { bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-500' },
}

export default function ReliabilityBadge({
  rd, games = 0, relScore = null, result = null, size = 'sm', showPct = false,
}) {
  const rs = relScore ?? result?.score ?? null
  const { text, pct } = reliabilityLabel(rd, games, rs)
  const verified = text === '검증완료'
  const c = verified ? TONE.verified : TONE.provisional
  const title = verified ? `실력 검증완료 · 신뢰도 ${pct}%` : `실력 측정 중 · 신뢰도 ${pct}%`

  if (size === 'sm') {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${c.bg} ${c.text}`}
        title={title}
      >
        {verified
          ? <ShieldCheck size={10} />
          : <span className={`w-1.5 h-1.5 rounded-full ${c.dot} animate-pulse`} />}
        {text}
        {showPct && <span className="font-semibold opacity-70">· {pct}%</span>}
      </span>
    )
  }

  return (
    <div className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 ${c.bg}`} title={title}>
      {verified
        ? <ShieldCheck size={14} className={c.text} />
        : <span className={`w-2 h-2 rounded-full ${c.dot} animate-pulse`} />}
      <span className={`text-sm font-black ${c.text}`}>{text}</span>
      {showPct && <span className="text-xs font-semibold text-gray-500 tabular-nums">신뢰도 {pct}%</span>}
    </div>
  )
}

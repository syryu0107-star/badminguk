import { getGradeInfo } from '../lib/grades'

export default function GradeChip({ grade, size = 'sm', className = '' }) {
  const info = getGradeInfo(grade)
  const sizeClass = size === 'lg'
    ? 'text-sm px-3 py-1'
    : size === 'md'
    ? 'text-xs px-2.5 py-0.5'
    : 'text-xs px-2 py-0.5'

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap
                  chip-${grade} ${sizeClass} ${className}`}
    >
      <span>{info?.flair}</span>
      <span>{grade}</span>
    </span>
  )
}

export default function Spinner({ size = 24, className = '' }) {
  return (
    <div
      className={`spinner border-2 border-gray-200 border-t-[#C60C30] rounded-full ${className}`}
      style={{ width: size, height: size }}
    />
  )
}

export function FullPageSpinner() {
  return (
    <div className="flex items-center justify-center h-full min-h-screen">
      <Spinner size={36} />
    </div>
  )
}

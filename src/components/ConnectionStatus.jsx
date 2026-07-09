import { Wifi, WifiOff, RefreshCw } from 'lucide-react'

// 동기화 상태 표시기 (로드맵 7-6)
// 심판/관제/공개 화면 상단에 "실시간 연결됨 / 재연결 중 / 오프라인"을 상시 표시해
// '내 입력·화면이 서버와 연결돼 있는가'를 눈으로 확인시켜 준다.
//
// props
//  - online   : boolean          — 브라우저 네트워크 연결 여부
//  - live     : boolean | null   — 실시간 채널 상태. true=연결, false=재연결 중,
//                                  null=실시간 미사용(쓰기 전용 화면: 온라인/오프라인만 표시)
//  - lastSync : Date | null      — 마지막으로 서버 데이터를 받은 시각
//  - dark     : boolean          — 어두운 배경(관제·점수판·전광판)용 색상
function fmtClock(d) {
  if (!d) return null
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export default function ConnectionStatus({ online = true, live = null, lastSync = null, dark = false }) {
  let icon, label, color, spin = false
  if (!online) {
    icon = WifiOff
    label = '오프라인 · 전송 대기'
    color = dark ? '#fca5a5' : '#dc2626'
  } else if (live === false) {
    icon = RefreshCw
    label = '재연결 중…'
    color = '#f59e0b'
    spin = true
  } else if (live === true) {
    icon = Wifi
    label = '실시간 연결됨'
    color = dark ? '#4ade80' : '#16a34a'
  } else {
    icon = Wifi
    label = '온라인'
    color = dark ? '#4ade80' : '#16a34a'
  }
  const Icon = icon
  const clock = fmtClock(lastSync)

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap"
      style={{ color, background: dark ? 'rgba(255,255,255,0.1)' : `${color}14` }}
      title={clock ? `마지막 갱신 ${clock}` : label}
    >
      <Icon size={12} className={spin ? 'spinner' : undefined} />
      {label}
      {clock && (
        <span className="font-medium opacity-60 tabular-nums hidden sm:inline">· {clock}</span>
      )}
    </span>
  )
}

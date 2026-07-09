import { useEffect, useRef, useState } from 'react'

// 브라우저 온라인 여부 추적 + 재연결 콜백 (7-6 동기화 상태 표시 / 7-3 재연결 보강 기반)
// onReconnect 는 오프라인→온라인 전환 시에만 호출 (최초 마운트에는 호출 안 함)
export function useOnline(onReconnect) {
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  const cbRef = useRef(onReconnect)
  cbRef.current = onReconnect

  useEffect(() => {
    const handleOnline = () => { setOnline(true); cbRef.current?.() }
    const handleOffline = () => setOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return online
}

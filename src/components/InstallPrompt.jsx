import { useEffect, useState } from 'react'
import { Download, Share, X, Plus } from 'lucide-react'

// PWA 설치 유도 (로드맵 7-7)
// - Android/Chrome: beforeinstallprompt 를 가로채 '앱 설치' 버튼 노출
// - iOS Safari: beforeinstallprompt 미지원 → 공유→'홈 화면에 추가' 안내 오버레이
// - 이미 설치(standalone)됐거나 사용자가 닫은 경우 30일간 다시 띄우지 않음
const DISMISS_KEY = 'badminguk_install_dismissed'
const DISMISS_DAYS = 30

function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.navigator.standalone === true
  )
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !window.MSStream
}

function recentlyDismissed() {
  const raw = localStorage.getItem(DISMISS_KEY)
  if (!raw) return false
  const ts = Number(raw)
  if (!ts) return false
  return Date.now() - ts < DISMISS_DAYS * 24 * 60 * 60 * 1000
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState(null) // Android beforeinstallprompt 이벤트
  const [showIOS, setShowIOS] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (isStandalone() || recentlyDismissed()) return

    // Android/Chrome — 설치 프롬프트 이벤트 가로채기
    const onBeforeInstall = (e) => {
      e.preventDefault()
      setDeferred(e)
      setVisible(true)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)

    // iOS — 이벤트가 없으므로 사파리 여부로 판별해 안내 배너 노출
    let iosTimer = null
    if (isIOS()) {
      iosTimer = setTimeout(() => { setShowIOS(true); setVisible(true) }, 2500)
    }

    const onInstalled = () => dismiss()
    window.addEventListener('appinstalled', onInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
      if (iosTimer) clearTimeout(iosTimer)
    }
  }, [])

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
    setVisible(false)
    setDeferred(null)
    setShowIOS(false)
  }

  async function install() {
    if (!deferred) return
    deferred.prompt()
    try { await deferred.userChoice } catch { /* 무시 */ }
    dismiss()
  }

  if (!visible) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 px-4" style={{ paddingBottom: 'calc(4.5rem + env(safe-area-inset-bottom, 0px))' }}>
      <div className="mx-auto max-w-[448px] rounded-2xl bg-white shadow-2xl border border-gray-100 p-4 fade-up">
        <div className="flex items-start gap-3">
          <div
            className="shrink-0 w-11 h-11 rounded-xl flex items-center justify-center text-white text-xl"
            style={{ background: 'linear-gradient(135deg, #C60C30, #003478)' }}
          >
            🏸
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm text-gray-900">배드민국 앱으로 설치</p>
            {showIOS ? (
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                하단 <Share size={12} className="inline mb-0.5 text-blue-500" /> 공유 버튼을 누른 뒤
                <span className="font-semibold text-gray-700"> ‘홈 화면에 추가’</span>
                <Plus size={11} className="inline mb-0.5" /> 를 선택하면 앱처럼 열 수 있어요.
              </p>
            ) : (
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                홈 화면에 추가하면 경기 호출·점수 알림을 더 빠르게 받을 수 있어요.
              </p>
            )}
          </div>
          <button onClick={dismiss} className="shrink-0 p-1 -m-1 text-gray-400 active:text-gray-600" aria-label="닫기">
            <X size={18} />
          </button>
        </div>

        {!showIOS && (
          <button
            onClick={install}
            className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-white text-sm font-bold active:opacity-80"
            style={{ background: 'linear-gradient(135deg, #C60C30, #003478)' }}
          >
            <Download size={16} /> 앱 설치하기
          </button>
        )}
      </div>
    </div>
  )
}

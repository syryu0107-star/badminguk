// 로컬 브라우저 알림 (C1) — 앱이 살아 있는 동안 탭 밖으로 호출을 띄운다.
// ──────────────────────────────────────────────────────────────────────
// 왜 이 파일이 있는가:
//   경기 호출은 notify.js 의 인앱 실시간 방송으로 도달하고 MyMatches 가 화면 배너 +
//   navigator.vibrate 로 알린다. 그런데 선수는 대개 코트 근처에서 기다리며 폰 화면을
//   끄거나 다른 앱(카톡 등)을 보고 있다 → 그 순간 탭이 백그라운드라 배너는 안 보이고
//   vibrate 는 브라우저가 "숨김 페이지"에서 무시한다. 그러면 호출을 놓쳐 부전승 위험.
//   realtime 방송은 탭이 백그라운드여도 (연결이 살아 있는 동안) 계속 도착하므로,
//   그 순간 OS 알림(Notification)을 띄우면 화면 밖에서도 호출이 닿는다.
//
// 서버 푸시(웹푸시/VAPID/FCM)와의 차이 — 이건 human-gated 가 아니다:
//   · 서버 웹푸시는 "앱이 완전히 닫혔을 때" 서버가 밀어 넣는 것이라 VAPID 서버키가
//     필요하다(notify.js dispatchExternal · 원장 '사람이 해야 할 일'에 남아 있음).
//   · 이 모듈은 "앱이 열려 있고(탭이 살아 있고) 방송을 받은 순간" 페이지가 직접 띄우는
//     로컬 알림이라 Notification.requestPermission() 외에는 어떤 키·서버도 필요 없다.
//   따라서 지금 바로 발화하며, 서버키가 발급되면 그 위에 서버 푸시가 얹힌다.

export function notificationsSupported() {
  return typeof window !== 'undefined' && typeof window.Notification === 'function'
}

export function notificationPermission() {
  if (!notificationsSupported()) return 'unsupported'
  try { return window.Notification.permission } catch { return 'unsupported' }
}

// 순수 판정(테스트 가능) — OS 알림을 띄울지.
//   탭이 보이면(포커스) 화면 배너 + 진동으로 충분하므로 OS 알림은 탭이 "숨김"일 때만
//   띄운다(중복 알림 방지). 권한이 granted 이고 브라우저가 지원할 때만.
export function shouldShowLocalNotification({ supported, permission, hidden }) {
  return !!supported && permission === 'granted' && !!hidden
}

// 사용자 제스처(버튼 탭)에서만 호출 — 권한 요청. Promise/콜백 두 API 모두 지원.
export async function requestNotifyPermission() {
  if (!notificationsSupported()) return 'unsupported'
  try {
    const r = window.Notification.requestPermission()
    if (r && typeof r.then === 'function') return await r
    // 구형 사파리: 콜백형
    return await new Promise(res => window.Notification.requestPermission(res))
  } catch {
    return 'denied'
  }
}

// 현재 탭 상태. document 없거나 visibilityState 미지원이면 "보임"으로 간주(알림 안 띄움).
function tabHidden() {
  if (typeof document === 'undefined') return false
  const vs = document.visibilityState
  return typeof vs === 'string' ? vs !== 'visible' : false
}

// OS 알림을 띄운다(조건 충족 시). 실패·미지원·미허용·포커스 중이면 조용히 false.
export function showLocalNotification({ title, body, tag, onClick } = {}) {
  if (!shouldShowLocalNotification({
    supported: notificationsSupported(),
    permission: notificationPermission(),
    hidden: tabHidden(),
  })) return false
  try {
    const n = new window.Notification(title || '배드민국', {
      body: body || '',
      tag: tag || 'badminguk-call',
      renotify: true,        // 같은 tag 라도 다시 울린다(재호출·경고)
      icon: '/favicon.svg',
      lang: 'ko',
    })
    n.onclick = () => {
      try { window.focus() } catch { /* noop */ }
      try { if (typeof onClick === 'function') onClick() } catch { /* noop */ }
      try { n.close() } catch { /* noop */ }
    }
    return true
  } catch {
    return false // 일부 브라우저는 페이지 컨텍스트 new Notification 을 막음 → degrade
  }
}

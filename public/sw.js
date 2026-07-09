const CACHE = 'badminguk-v2'
const STATIC = ['/', '/index.html', '/manifest.json']

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  const req = e.request
  // Supabase API·비 GET 요청은 캐시하지 않음
  if (req.method !== 'GET' || req.url.includes('supabase.co')) return

  // 페이지 이동(HTML)은 네트워크 우선 → 배포 직후 최신 화면 보장, 오프라인 시 캐시 폴백
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(res => {
        caches.open(CACHE).then(c => c.put('/index.html', res.clone()))
        return res
      }).catch(() => caches.match(req).then(c => c || caches.match('/index.html')))
    )
    return
  }

  // 정적 자산은 stale-while-revalidate → 캐시 즉시 응답 + 백그라운드 갱신
  e.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()))
        return res
      }).catch(() => cached)
      return cached || network
    })
  )
})

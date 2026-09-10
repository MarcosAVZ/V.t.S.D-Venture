const CACHE_NAME = 'vtsd-v1'
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Never cache API calls
  if (request.url.includes('/api/')) {
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      // Network-first for navigation, cache-first for assets
      if (request.mode === 'navigate') {
        return fetch(request).catch(() => cached || new Response('Offline', { status: 503 }))
      }
      return cached || fetch(request).then((response) => {
        const clone = response.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
        return response
      })
    })
  )
})

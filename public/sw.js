const CACHE_NAME = 'gestao-entregas-v1'
const STATIC_ASSETS = ['/', '/index.html', '/manifest.json', '/icons/icon.svg']

// Install event - Cache core application shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('SW addAll asset warning:', err)
      })
    }),
  )
  self.skipWaiting()
})

// Activate event - Clean up obsolete caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name)
          }
        }),
      )
    }),
  )
  self.clients.claim()
})

// Fetch event - Network first with fallback to cache for static assets & offline mode
self.addEventListener('fetch', (event) => {
  const request = event.request

  // Skip non-GET requests or backend/external API calls (PocketBase / Google Maps / ViaCEP)
  if (
    request.method !== 'GET' ||
    request.url.includes('/api/') ||
    request.url.includes('maps.googleapis.com') ||
    request.url.includes('viacep.com.br') ||
    request.url.includes('openstreetmap.org') ||
    request.url.includes('goskip.dev')
  ) {
    return
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Clone and cache valid responses for same-origin static files
        if (response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone()
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache)
          })
        }
        return response
      })
      .catch(() => {
        return caches.match(request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse
          }
          if (request.mode === 'navigate') {
            return caches.match('/') || caches.match('/index.html')
          }
        })
      }),
  )
})

const CACHE_NAME = 'gestao-entregas-v2'
const STATIC_ASSETS = ['/', '/index.html', '/manifest.json', '/icons/icon.svg']

// Install event - Cache core application shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Cache addAll asset warning:', err)
      })
    }),
  )
  self.skipWaiting()
})

// Activate event - Clean up obsolete caches & take control immediately
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

// Fetch event - Stale-while-revalidate for app assets, network-first for navigation, skip external APIs
self.addEventListener('fetch', (event) => {
  const request = event.request

  // Skip non-GET requests or backend/external APIs that require live data
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

  // HTML Navigation requests - Network first with cache fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 200) {
            const copy = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
          }
          return response
        })
        .catch(() => {
          return caches.match('/index.html') || caches.match('/')
        }),
    )
    return
  }

  // Static files: Stale-while-revalidate or Cache First with network update
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone()
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache)
            })
          }
          return networkResponse
        })
        .catch(() => cachedResponse)

      return cachedResponse || fetchPromise
    }),
  )
})

// Native Push Notifications event handler
self.addEventListener('push', (event) => {
  let data = {
    title: 'Gestão de Entregas',
    body: 'Nova atualização de entrega disponível!',
    icon: '/icons/icon.svg',
    badge: '/icons/icon.svg',
    url: '/',
  }

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() }
    } catch {
      data.body = event.data.text()
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/icons/icon.svg',
    badge: data.badge || '/icons/icon.svg',
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/',
    },
    actions: [
      { action: 'open', title: 'Abrir App' },
      { action: 'close', title: 'Fechar' },
    ],
  }

  event.waitUntil(self.registration.showNotification(data.title, options))
})

// Notification Click event handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  if (event.action === 'close') return

  const targetUrl = event.notification.data?.url || '/'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl)
          return client.focus()
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl)
      }
    }),
  )
})

// Background Sync event handler
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-orders') {
    event.waitUntil(
      self.clients.matchAll().then((clientsList) => {
        clientsList.forEach((client) => {
          client.postMessage({ type: 'SYNC_ORDERS_TRIGGER' })
        })
      }),
    )
  }
})

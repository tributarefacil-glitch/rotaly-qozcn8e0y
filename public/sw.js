/**
 * Rotaly PWA Service Worker (v4)
 *
 * Estratégia de Cache e Resiliência Offline:
 * - Recursos estáticos base da aplicação em Cache-First (assets com hash imutáveis).
 * - Navegação HTML e raiz (/ e /index.html) SEMPRE em Network-First com fallback gracioso para cache offline.
 *   Isso garante que qualquer deploy/atualização de bundle seja imediatamente refletido no navegador com conexão.
 * - Dados dinâmicos de rota e fila de telemetria são gerenciados via IndexedDB no cliente (não interceptados pelo SW),
 *   evitando dados defasados na API e garantindo que requisições ao backend /api/ trafeguem em tempo real.
 * - Background Sync para notificar o cliente via postMessage sobre retomada de conexão.
 */

const CACHE_NAME = 'rotaly-pwa-v4'
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/favicon.ico',
  '/placeholder.svg',
]

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

// Fetch event - Cache-First para recursos estáticos da aplicação; Network-First para navegação e HTML; skip APIs
self.addEventListener('fetch', (event) => {
  const request = event.request

  const url = new URL(request.url)

  // 1. Pular requisições não-GET, version.json (bypass direto para rede sem cache) e APIs externas/backend
  if (
    request.method !== 'GET' ||
    url.pathname === '/version.json' ||
    request.url.includes('/version.json') ||
    request.url.includes('/api/') ||
    request.url.includes('maps.googleapis.com') ||
    request.url.includes('viacep.com.br') ||
    request.url.includes('openstreetmap.org') ||
    request.url.includes('goskip.dev') ||
    request.url.includes('usecurling.com')
  ) {
    return
  }
  const isHtmlNavigation =
    request.mode === 'navigate' ||
    request.headers.get('accept')?.includes('text/html') ||
    url.pathname === '/' ||
    url.pathname === '/index.html'

  // 2. Requisições de navegação HTML ou /index.html: SEMPRE Network-First
  // Havendo rede, serve a versão mais recente do servidor e atualiza o cache para modo offline.
  if (isHtmlNavigation) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone()
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, copy)
              // Também atualiza / e /index.html para sincronizar o app shell offline
              if (url.pathname === '/' || url.pathname === '/index.html') {
                cache.put('/index.html', response.clone())
                cache.put('/', response.clone())
              }
            })
          }
          return response
        })
        .catch(async () => {
          // Quando sem conexão, serve o index.html em cache permitindo o React Router assumir offline
          const cached = await caches.match(request)
          if (cached) return cached
          const indexCached = await caches.match('/index.html')
          if (indexCached) return indexCached
          return caches.match('/')
        }),
    )
    return
  }

  // 3. Recursos estáticos construídos (JS, CSS, fontes, imagens locais, ícones)
  // Estratégia: Cache-First com atualização em background (stale-while-revalidate / cache-first para assets imutáveis)
  const isStaticAsset =
    url.pathname.startsWith('/assets/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.woff') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.ico')

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          // Atualiza em background para a próxima carga
          fetch(request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                caches.open(CACHE_NAME).then((cache) => cache.put(request, networkResponse))
              }
            })
            .catch(() => {
              /* offline no problem */
            })
          return cachedResponse
        }

        // Não estava no cache ainda, busca na rede e guarda
        return fetch(request).then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            networkResponse.type === 'basic'
          ) {
            const copy = networkResponse.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
          }
          return networkResponse
        })
      }),
    )
    return
  }

  // 4. Default: busca na rede com fallback de cache se falhar
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const copy = networkResponse.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        }
        return networkResponse
      })
      .catch(() => caches.match(request)),
  )
})

// Native Push Notifications event handler
self.addEventListener('push', (event) => {
  let data = {
    title: 'Rotaly Entregas',
    body: 'Nova atualização de rota disponível!',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    url: '/courier',
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
    icon: data.icon || '/favicon.svg',
    badge: data.badge || '/favicon.svg',
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/courier',
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

  const targetUrl = event.notification.data?.url || '/courier'

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
  if (event.tag === 'sync-telemetry' || event.tag === 'sync-orders') {
    event.waitUntil(
      self.clients.matchAll().then((clientsList) => {
        clientsList.forEach((client) => {
          client.postMessage({ type: 'SYNC_TRIGGER', tag: event.tag })
        })
      }),
    )
  }
})

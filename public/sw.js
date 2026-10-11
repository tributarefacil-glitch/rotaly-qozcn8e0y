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

// Versão/Build injetada e dinâmica do cache.
// Base padrão sincronizada com public/version.json.
// Em runtime, o SW tenta resolver dinamicamente a versão/build atual via /version.json
// para que qualquer deploy gere um cache novo automaticamente e purgue o anterior.
const DEFAULT_BUILD = '2026-10-11.01'
const CACHE_PREFIX = 'rotaly-cache-'
let CURRENT_CACHE_NAME = `${CACHE_PREFIX}${DEFAULT_BUILD}`

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/favicon.ico',
  '/placeholder.svg',
]

// Função auxiliar para obter o nome do cache atualizado a partir de /version.json
async function resolveCurrentCacheName() {
  try {
    const res = await fetch('/version.json', { cache: 'no-store' })
    if (res.ok) {
      const data = await res.json()
      const build = (data?.build || data?.version || DEFAULT_BUILD).toString().trim()
      if (build) {
        CURRENT_CACHE_NAME = `${CACHE_PREFIX}${build}`
      }
    }
  } catch {
    // Se estiver offline ou rede instável, mantém CURRENT_CACHE_NAME atual
  }
  return CURRENT_CACHE_NAME
}

// Install event - Força ativação imediata (skipWaiting) e pré-cacheia o app shell
self.addEventListener('install', (event) => {
  // Regra 1: Sempre pular espera imediatamente, sem aguardar fechamento de abas antigas
  self.skipWaiting()

  event.waitUntil(
    (async () => {
      try {
        const cacheName = await resolveCurrentCacheName()
        const cache = await caches.open(cacheName)
        await cache.addAll(STATIC_ASSETS).catch((err) => {
          console.warn('[SW] Cache addAll asset warning:', err)
        })
      } catch (err) {
        console.warn('[SW] Falha no install pre-cache:', err)
      }
    })(),
  )
})

// Activate event - Reivindica clientes imediatamente (claim) e limpa TODOS os caches obsoletos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheName = await resolveCurrentCacheName()
      const keys = await caches.keys()
      await Promise.all(
        keys.map((key) => {
          // Deleta qualquer cache que não seja exatamente o cache da versão/build atual
          if (key !== cacheName) {
            console.log(`[SW] Deletando cache obsoleto de build anterior: ${key}`)
            return caches.delete(key)
          }
        }),
      )
      // Regra 2: Reivindica controle imediato de todos os clientes abertos
      await self.clients.claim()
    })(),
  )
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
        .then(async (response) => {
          if (response && response.status === 200) {
            const copy = response.clone()
            const cacheName = await resolveCurrentCacheName()
            const cache = await caches.open(cacheName)
            cache.put(request, copy)
            // Também atualiza / e /index.html para sincronizar o app shell offline
            if (url.pathname === '/' || url.pathname === '/index.html') {
              cache.put('/index.html', response.clone())
              cache.put('/', response.clone())
            }
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
      caches.match(request).then(async (cachedResponse) => {
        if (cachedResponse) {
          // Atualiza em background para a próxima carga
          fetch(request)
            .then(async (networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                const cacheName = await resolveCurrentCacheName()
                const cache = await caches.open(cacheName)
                cache.put(request, networkResponse)
              }
            })
            .catch(() => {
              /* offline no problem */
            })
          return cachedResponse
        }

        // Não estava no cache ainda, busca na rede e guarda
        return fetch(request).then(async (networkResponse) => {
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            networkResponse.type === 'basic'
          ) {
            const copy = networkResponse.clone()
            const cacheName = await resolveCurrentCacheName()
            const cache = await caches.open(cacheName)
            cache.put(request, copy)
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
      .then(async (networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const copy = networkResponse.clone()
          const cacheName = await resolveCurrentCacheName()
          const cache = await caches.open(cacheName)
          cache.put(request, copy)
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

/* Main entry point for the application - renders the root React component */
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './main.css'
import { toast } from 'sonner'
import { APP_VERSION, APP_BUILD_ID } from './lib/version'

// Blindagem defensiva anti-crash para extensões de tradução (ex: Google Translate)
// Extensões envolvem nós de texto em <font> e alteram a hierarquia do DOM; quando o React tenta
// desmontar esses nós com removeChild/insertBefore, lança "NotFoundError: The node to be removed is not a child of this node".
if (typeof window !== 'undefined' && typeof Node !== 'undefined' && Node.prototype) {
  try {
    const originalRemoveChild = Node.prototype.removeChild
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(Node.prototype as any).removeChild = function <T extends Node>(child: T): T {
      try {
        return originalRemoveChild.call(this, child) as T
      } catch (err: any) {
        if (
          err instanceof DOMException ||
          err?.name === 'NotFoundError' ||
          err?.message?.includes('not a child of this node')
        ) {
          console.warn(
            '[DOM Safe Patch] removeChild ignorou remoção de nó não-filho alterado por extensão:',
            child,
          )
          if (child && typeof (child as any).remove === 'function') {
            try {
              ;(child as any).remove()
            } catch {
              /* noop */
            }
          }
          return child
        }
        throw err
      }
    }

    const originalInsertBefore = Node.prototype.insertBefore
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(Node.prototype as any).insertBefore = function <T extends Node>(
      newNode: T,
      referenceNode: Node | null,
    ): T {
      try {
        return originalInsertBefore.call(this, newNode, referenceNode) as T
      } catch (err: any) {
        if (
          err instanceof DOMException ||
          err?.name === 'NotFoundError' ||
          err?.message?.includes('not a child of this node')
        ) {
          console.warn(
            '[DOM Safe Patch] insertBefore contornado para nó alterado por extensão:',
            newNode,
          )
          try {
            return this.appendChild(newNode) as T
          } catch {
            return newNode
          }
        }
        throw err
      }
    }
  } catch (patchErr) {
    console.warn(
      '[DOM Safe Patch] Não foi possível aplicar monkey-patch defensivo de Node:',
      patchErr,
    )
  }
}

// Invalidação de cache legado de empresa ativa entre versões
const APP_BUILD_VERSION = '2026-09-14.02'
if (typeof window !== 'undefined') {
  try {
    const currentStoredVersion = localStorage.getItem('rotaly_app_build_version')
    if (currentStoredVersion !== APP_BUILD_VERSION) {
      localStorage.removeItem('rotaly_active_empresa_id')
      localStorage.removeItem('rotaly_active_company')
      localStorage.removeItem('rotaly_empresa_id')
      localStorage.setItem('rotaly_app_build_version', APP_BUILD_VERSION)
    }
  } catch {
    /* intentionally ignored */
  }
}

// Bloquear / remover dinamicamente qualquer selo ou floating badge "Criado com o Skip"
if (typeof window !== 'undefined') {
  const purgePlatformBadges = () => {
    try {
      // 1. Elementos por links de plataforma
      const platformLinks = document.querySelectorAll<HTMLElement>(
        'a[href*="goskip.dev"], a[href*="skip.dev"], [data-skip-badge], [id*="skip-badge"], [class*="skip-badge"]',
      )
      platformLinks.forEach((el) => {
        // Remove o elemento ou o container flutuante direto dele
        const container = el.closest<HTMLElement>(
          'div.fixed, div[style*="fixed"], div[style*="z-index"], aside',
        )
        if (container && container !== document.body && container.id !== 'root') {
          container.remove()
        } else {
          el.remove()
        }
      })

      // 2. Elementos com texto característico do badge
      const candidateFloatingElements = document.querySelectorAll<HTMLElement>(
        'div.fixed, div[style*="fixed"], div[style*="z-index"], aside',
      )
      candidateFloatingElements.forEach((el) => {
        if (el.id === 'root' || el.contains(document.getElementById('root'))) return
        const text = (el.innerText || el.textContent || '').trim().toLowerCase()
        if (
          text.includes('criado com o skip') ||
          text.includes('criado com skip') ||
          text.includes('criado na skip') ||
          text.includes('made with skip')
        ) {
          el.remove()
        }
      })
    } catch {
      /* noop */
    }
  }

  // Executa imediatamente e em intervalos iniciais
  purgePlatformBadges()
  window.addEventListener('DOMContentLoaded', purgePlatformBadges)
  window.addEventListener('load', purgePlatformBadges)
  setTimeout(purgePlatformBadges, 500)
  setTimeout(purgePlatformBadges, 1500)
  setTimeout(purgePlatformBadges, 3000)

  // Observador de mutações para impedir injeção tardia
  try {
    const observer = new MutationObserver(() => {
      purgePlatformBadges()
    })
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    })
  } catch {
    /* noop */
  }
}

// Gestão de atualização do Service Worker e verificação de nova versão do bundle
if (typeof window !== 'undefined') {
  const RELOAD_GUARD_KEY = 'rotaly_version_reload_guard'

  const triggerAppReload = (reason: string) => {
    try {
      const alreadyReloaded = sessionStorage.getItem(RELOAD_GUARD_KEY)
      if (alreadyReloaded) {
        console.log(`[VersionManager] Recarga prevenida pelo guard para evitar loop (${reason})`)
        return
      }
      sessionStorage.setItem(RELOAD_GUARD_KEY, 'true')
    } catch {
      /* noop */
    }

    try {
      toast.info('Nova versão disponível — atualizando...', {
        duration: 3000,
      })
    } catch {
      /* noop */
    }

    setTimeout(() => {
      window.location.reload()
    }, 600)
  }

  // 1. Verificação no boot via /version.json (com bypass de cache e tolerância offline)
  const checkVersionJson = async () => {
    try {
      const res = await fetch(`/version.json?_t=${Date.now()}`, { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      if (data) {
        const remoteVersion = (data.version || '').toString().trim()
        const localVersion = (APP_VERSION || '').trim()
        const remoteBuild = (data.build || '').toString().trim()
        const localBuild = (APP_BUILD_ID || '').trim()

        const versionDiffers = remoteVersion && localVersion && remoteVersion !== localVersion
        const buildDiffers = remoteBuild && localBuild && remoteBuild !== localBuild

        if (versionDiffers || buildDiffers) {
          console.log(
            `[VersionManager] Nova versão/build detectada via version.json: servidor=${remoteVersion} (build ${remoteBuild}) vs local=${localVersion} (build ${localBuild})`,
          )
          triggerAppReload(
            `remote v=${remoteVersion}/b=${remoteBuild} != local v=${localVersion}/b=${localBuild}`,
          )
        }
      }
    } catch {
      // Offline ou erro transitório: segue graciosamente sem reload
    }
  }

  // Executar checagem de version.json após carregamento inicial
  if (document.readyState === 'complete') {
    checkVersionJson()
  } else {
    window.addEventListener('load', () => {
      checkVersionJson()
    })
  }

  // 2. Registro do Service Worker com listener de updatefound + controllerchange e reg.update() periódico a cada 60s
  if ('serviceWorker' in navigator) {
    let isRefreshing = false

    // Quando o novo worker assume o controle (controllerchange), recarrega UMA única vez
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (isRefreshing) return
      isRefreshing = true
      console.log(
        '[PWA] Service Worker controllerchange acionado — recarregando para o novo bundle',
      )
      triggerAppReload('controllerchange')
    })

    // Listener global para capturar rejeições não tratadas de scripts ou workers de terceiros/preview
    // impedindo que erros do tipo "Failed to update a ServiceWorker" estourem em overlays de erro de runtime
    window.addEventListener('unhandledrejection', (event) => {
      const reasonStr = String(event.reason || '')
      const reasonMsg = String(event.reason?.message || '')
      if (
        reasonStr.includes('ServiceWorker') ||
        reasonStr.includes('sw.js') ||
        reasonMsg.includes('ServiceWorker') ||
        reasonMsg.includes('sw.js')
      ) {
        console.warn('[PWA Safe Guard] Rejeição de ServiceWorker suprimida:', event.reason)
        event.preventDefault()
      }
    })

    window.addEventListener('load', () => {
      try {
        navigator.serviceWorker
          .register('/sw.js', { updateViaCache: 'none' })
          .then((reg) => {
            console.log('[PWA] Service Worker registrado com sucesso no escopo:', reg.scope)

            // Escuta atualizações encontradas
            reg.addEventListener('updatefound', () => {
              const newWorker = reg.installing
              if (!newWorker) return
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  console.log('[PWA] Nova versão do Service Worker instalada!')
                  triggerAppReload('updatefound_installed')
                }
              })
            })

            // Safe wrapper para atualizar o Service Worker sem lançar erro não tratado (ex: HTTP 503)
            const safeUpdateRegistration = () => {
              try {
                reg.update().catch((updateErr) => {
                  console.warn(
                    '[PWA] Falha de rede ao verificar atualização do Service Worker (ignorado):',
                    updateErr,
                  )
                })
              } catch (syncErr) {
                console.warn(
                  '[PWA] Erro síncrono ao chamar update do Service Worker (ignorado):',
                  syncErr,
                )
              }
            }

            // Força verificação imediata no boot (garante que reload simples F5 já cheque o servidor)
            safeUpdateRegistration()

            // Verificação periódica leve (a cada 30 segundos) e no retorno de visibilidade/foco da aba
            const performPeriodicCheck = () => {
              safeUpdateRegistration()
              checkVersionJson()
            }

            setInterval(performPeriodicCheck, 30000)

            // Sempre que o usuário voltar para a aba ou recuperar conexão, verifica imediatamente
            window.addEventListener('focus', performPeriodicCheck)
            window.addEventListener('online', performPeriodicCheck)
            document.addEventListener('visibilitychange', () => {
              if (document.visibilityState === 'visible') {
                performPeriodicCheck()
              }
            })
          })
          .catch((err) => {
            console.warn(
              '[PWA] Falha ao registrar Service Worker (ignorado para não afetar UI):',
              err,
            )
          })
      } catch (regSyncErr) {
        console.warn('[PWA] Erro síncrono ao registrar Service Worker (ignorado):', regSyncErr)
      }
    })
  }
}

// @skip-protected: Do not remove. Required for React rendering.
createRoot(document.getElementById('root')!).render(<App />)

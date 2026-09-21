/* Main entry point for the application - renders the root React component */
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './main.css'

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

// Register Service Worker for PWA Offline Caching
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        console.log('[PWA] Service Worker registrado com sucesso no escopo:', reg.scope)
      })
      .catch((err) => {
        console.warn('[PWA] Falha ao registrar Service Worker:', err)
      })
  })
}

// @skip-protected: Do not remove. Required for React rendering.
createRoot(document.getElementById('root')!).render(<App />)

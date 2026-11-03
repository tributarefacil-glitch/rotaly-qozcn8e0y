import pb from '@/lib/pocketbase/client'
import { APP_VERSION } from '@/lib/version'
import { compareSemver } from '@/services/appVersionService'

export interface OtaCheckResult {
  hasUpdate: boolean
  currentVersion: string
  targetVersion: string
  bundleUrl?: string
  bundleHash?: string
  releaseNotes?: string
}

export type OtaUpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'updated' | 'error'

/**
 * Serviço de Atualização Automática de Telas / OTA (Live Updates) do Rotaly APK
 * Padrão Capacitor:
 * - O APK em runtime consulta o backend PocketBase ao abrir.
 * - Compara a versão atual das telas/assets (public/version.json / APP_VERSION) com o backend.
 * - Se houver nova versão de telas/lógica, baixa e sincroniza via Service Worker / Cache Storage
 *   ou recarrega com a versão fresca do backend sem exigir reinstalação manual do APK.
 */
class OtaUpdaterService {
  private status: OtaUpdateStatus = 'idle'
  private lastCheckTs = 0
  private lastResult: OtaCheckResult | null = null

  public getStatus(): OtaUpdateStatus {
    return this.status
  }

  /**
   * Verifica se o ambiente é o aplicativo APK nativo (Capacitor/WebView)
   */
  public isNativeApk(): boolean {
    if (typeof window === 'undefined') return false
    if ((window as any).RotalyNativeGps) return true
    if ((window as any).Capacitor?.isNativePlatform?.()) return true
    if (navigator.userAgent.includes('RotalyNativeApp')) return true
    return false
  }

  /**
   * Consulta se existe atualização OTA de telas disponível no backend
   */
  public async checkForUpdate(force = false): Promise<OtaCheckResult> {
    const now = Date.now()
    if (!force && this.lastResult && now - this.lastCheckTs < 30 * 1000) {
      return this.lastResult
    }

    this.status = 'checking'
    try {
      const baseUrl = pb.baseUrl || window.location.origin
      const res = await fetch(`${baseUrl}/backend/v1/app-version`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      })

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }

      const data = await res.json()
      const targetVersion = data.latest_version || APP_VERSION
      const hasUpdate = compareSemver(APP_VERSION, targetVersion) < 0

      const result: OtaCheckResult = {
        hasUpdate,
        currentVersion: APP_VERSION,
        targetVersion,
        bundleUrl: data.ota?.bundle_url || '',
        bundleHash: data.ota?.bundle_hash || '',
        releaseNotes: data.release_notes || '',
      }

      this.lastResult = result
      this.lastCheckTs = now
      this.status = hasUpdate ? 'ready' : 'idle'
      return result
    } catch (err) {
      console.warn('[OtaUpdater] Falha ao verificar OTA:', err)
      this.status = 'idle'
      return {
        hasUpdate: false,
        currentVersion: APP_VERSION,
        targetVersion: APP_VERSION,
      }
    }
  }

  /**
   * Aplica a atualização de telas (Live Update) sem reinstalação:
   * 1. Limpa Service Worker e caches antigos do navegador/WebView
   * 2. Recarrega a aplicação com cache bypass (location.reload(true) / window.location.href)
   */
  public async applyUpdate(): Promise<boolean> {
    try {
      this.status = 'downloading'

      // 1. Limpar caches do CacheStorage
      if (typeof window !== 'undefined' && 'caches' in window) {
        try {
          const cacheKeys = await window.caches.keys()
          await Promise.all(cacheKeys.map((key) => window.caches.delete(key)))
        } catch (cErr) {
          console.warn('[OtaUpdater] Aviso ao limpar caches:', cErr)
        }
      }

      // 2. Desregistrar Service Worker antigo para puxar assets mais recentes do backend
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        try {
          const registrations = await navigator.serviceWorker.getRegistrations()
          for (const reg of registrations) {
            await reg.update().catch(() => {})
          }
        } catch (swErr) {
          console.warn('[OtaUpdater] Aviso ao atualizar service worker:', swErr)
        }
      }

      this.status = 'updated'

      // 3. Recarregar WebView sem cache
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href)
        url.searchParams.set('v_ota', String(Date.now()))
        window.location.replace(url.toString())
      }

      return true
    } catch (e) {
      console.error('[OtaUpdater] Erro ao aplicar atualização OTA:', e)
      this.status = 'error'
      return false
    }
  }
}

export const otaUpdaterService = new OtaUpdaterService()

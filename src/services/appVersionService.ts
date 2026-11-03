import pb from '@/lib/pocketbase/client'
import { APP_VERSION } from '@/lib/version'

export interface AppVersionInfo {
  min_version: string
  latest_version: string
  apk_download_url: string
  release_notes?: string
  force_update?: boolean
  server_time?: string
  ota?: {
    enabled: boolean
    bundle_url?: string
    bundle_hash?: string
    target_version?: string
  }
}

export interface VersionCheckResult {
  isOutdated: boolean
  isBelowMinimum: boolean
  currentVersion: string
  minVersion: string
  latestVersion: string
  downloadUrl: string
  releaseNotes: string
}

/**
 * Compara duas versões em formato semver simples (ex: "0.0.533" vs "0.0.530").
 * Retorna:
 *  -1 se v1 < v2
 *   0 se v1 == v2
 *   1 se v1 > v2
 */
export function compareSemver(v1: string, v2: string): number {
  const clean1 = (v1 || '').replace(/^[^\d]*/, '').trim()
  const clean2 = (v2 || '').replace(/^[^\d]*/, '').trim()

  const parts1 = clean1.split('.').map((p) => parseInt(p, 10) || 0)
  const parts2 = clean2.split('.').map((p) => parseInt(p, 10) || 0)

  const maxLen = Math.max(parts1.length, parts2.length)
  for (let i = 0; i < maxLen; i++) {
    const num1 = parts1[i] ?? 0
    const num2 = parts2[i] ?? 0
    if (num1 < num2) return -1
    if (num1 > num2) return 1
  }
  return 0
}

class AppVersionService {
  private cachedInfo: AppVersionInfo | null = null
  private lastCheckTs = 0
  private readonly CACHE_TTL_MS = 60 * 1000 // 1 minuto de cache

  /**
   * Consulta o endpoint de versão mínima e OTA no backend PocketBase
   */
  public async fetchVersionInfo(forceFresh = false): Promise<AppVersionInfo> {
    const now = Date.now()
    if (!forceFresh && this.cachedInfo && now - this.lastCheckTs < this.CACHE_TTL_MS) {
      return this.cachedInfo
    }

    try {
      const baseUrl = pb.baseUrl || window.location.origin
      const res = await fetch(`${baseUrl}/backend/v1/app-version`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      })

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: falha ao consultar versão`)
      }

      const data: AppVersionInfo = await res.json()
      this.cachedInfo = data
      this.lastCheckTs = now
      return data
    } catch (err) {
      console.warn('[AppVersionService] Falha ao consultar /backend/v1/app-version:', err)
      // Fallback seguro usando link estável oficial do APK
      const fallback: AppVersionInfo = {
        min_version: '0.0.530',
        latest_version: APP_VERSION,
        apk_download_url:
          'https://github.com/tributarefacil-glitch/rotaly-qozcn8e0y/releases/download/apk-latest/Rotaly.apk',
        release_notes: 'Atualização de segurança e telemetria disponível.',
        force_update: false,
        ota: {
          enabled: true,
          target_version: APP_VERSION,
        },
      }
      return fallback
    }
  }

  /**
   * Valida se a versão instalada localmente cumpre a guarda de versão mínima exigida
   */
  public async checkVersion(current = APP_VERSION): Promise<VersionCheckResult> {
    const info = await this.fetchVersionInfo()
    const isBelowMinimum = compareSemver(current, info.min_version) < 0
    const isOutdated = compareSemver(current, info.latest_version) < 0

    return {
      isOutdated,
      isBelowMinimum,
      currentVersion: current,
      minVersion: info.min_version,
      latestVersion: info.latest_version,
      downloadUrl: info.apk_download_url,
      releaseNotes: info.release_notes || 'Nova versão com melhorias e correções.',
    }
  }
}

export const appVersionService = new AppVersionService()

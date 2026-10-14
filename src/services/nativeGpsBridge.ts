/**
 * nativeGpsBridge.ts
 *
 * Ponte híbrida Web / Capacitor Android:
 * - Em ambiente nativo (Android Capacitor): interage com a interface nativa
 *   Android (`window.RotalyNativeGps` ou plugin Capacitor) para iniciar/parar
 *   o Foreground Service com notificação contínua ("Rotaly está rastreando"),
 *   solicitar permissões ACCESS_BACKGROUND_LOCATION / FOREGROUND_SERVICE_LOCATION,
 *   e escutar eventos contínuos de coordenadas mesmo com a tela apagada ou Waze em cima.
 * - Em ambiente Web (navegador/PWA): fallback transparente e resiliente para
 *   navigator.geolocation.watchPosition / getCurrentPosition com WakeLock mantido.
 */

export interface NativeGpsCoordinate {
  latitude: number
  longitude: number
  accuracy?: number
  speed?: number | null
  heading?: number | null
  altitude?: number | null
  batteryLevel?: number | null
  timestamp?: number
}

export type NativeGpsCallback = (coords: NativeGpsCoordinate) => void
export type NativeGpsErrorCallback = (error: { code: string; message: string }) => void

export interface NativeGpsServiceStatus {
  isNative: boolean
  isServiceRunning: boolean
  hasFinePermission: boolean
  hasBackgroundPermission: boolean
  hasNotificationPermission: boolean
}

// Declaração da interface exposta pelo Android WebView JavascriptInterface ou Plugin
declare global {
  interface Window {
    Capacitor?: {
      isNativePlatform?: () => boolean
      getPlatform?: () => string
      Plugins?: Record<string, any>
    }
    RotalyNativeGps?: {
      startForegroundTracking: (optionsJson: string) => boolean | string
      stopForegroundTracking: () => boolean | string
      isTrackingActive: () => boolean | string
      requestAllPermissions: () => void
      checkPermissions: () => string // JSON com permissões
      openBatteryOptimizationSettings: () => void
      openAppSettings: () => void
      openNavigationApp: (
        lat: number,
        lng: number,
        appName: 'waze' | 'google_maps',
        label?: string,
      ) => boolean
    }
    // Callback invocado pelo Android nativo a cada ponto de GPS coletado em segundo plano
    onRotalyNativeLocationReceived?: (payloadJson: string | NativeGpsCoordinate) => void
  }
}

class NativeGpsBridgeService {
  private listeners = new Set<NativeGpsCallback>()
  private errorListeners = new Set<NativeGpsErrorCallback>()
  private isTracking = false
  private webWatchId: number | null = null
  private isInitialized = false

  constructor() {
    this.initNativeListener()
  }

  private initNativeListener() {
    if (typeof window === 'undefined') return
    if (this.isInitialized) return
    this.isInitialized = true

    // Registra listener global para receber coordenadas da camada nativa Android
    window.onRotalyNativeLocationReceived = (payload) => {
      try {
        let coord: NativeGpsCoordinate
        if (typeof payload === 'string') {
          coord = JSON.parse(payload)
        } else {
          coord = payload
        }
        if (coord && typeof coord.latitude === 'number' && typeof coord.longitude === 'number') {
          this.emitCoordinate(coord)
        }
      } catch (err) {
        console.error('[NativeGpsBridge] Erro ao parsear ponto nativo:', err)
      }
    }
  }

  /**
   * Verifica se o app está rodando dentro do wrapper nativo Android (Capacitor/WebView)
   */
  public isNativeEnvironment(): boolean {
    if (typeof window === 'undefined') return false

    // 1. JavascriptInterface direta do Android
    if (window.RotalyNativeGps) return true

    // 2. Capacitor native platform
    if (window.Capacitor?.isNativePlatform?.()) return true

    // 3. User agent ou injeção customizada
    if (navigator.userAgent.includes('RotalyNativeApp')) return true

    return false
  }

  /**
   * Status das permissões e do Foreground Service
   */
  public getRealTrackingState(): {
    isTracking: boolean
    lastPingTimestamp: number
    lastPingAgeSeconds: number
    isDegraded: boolean
  } {
    if (this.isNativeEnvironment() && window.RotalyNativeGps?.isTrackingActive) {
      try {
        const raw = window.RotalyNativeGps.isTrackingActive()
        if (typeof raw === 'string') {
          const parsed = JSON.parse(raw)
          return {
            isTracking: Boolean(parsed.isTracking),
            lastPingTimestamp: Number(parsed.lastPingTimestamp) || 0,
            lastPingAgeSeconds: Number(parsed.lastPingAgeSeconds) || -1,
            isDegraded: Boolean(parsed.isDegraded),
          }
        }
        const active = Boolean(raw)
        return {
          isTracking: active,
          lastPingTimestamp: 0,
          lastPingAgeSeconds: -1,
          isDegraded: false,
        }
      } catch (err) {
        console.warn('[NativeGpsBridge] Erro ao obter estado real de rastreio:', err)
      }
    }
    return {
      isTracking: this.isTracking,
      lastPingTimestamp: 0,
      lastPingAgeSeconds: -1,
      isDegraded: false,
    }
  }

  public async getServiceStatus(): Promise<NativeGpsServiceStatus> {
    const isNative = this.isNativeEnvironment()

    if (isNative && window.RotalyNativeGps) {
      try {
        const raw = window.RotalyNativeGps.checkPermissions?.()
        const trackState = this.getRealTrackingState()
        if (raw) {
          const parsed = JSON.parse(raw)
          return {
            isNative: true,
            isServiceRunning: trackState.isTracking,
            hasFinePermission: parsed.fineLocation ?? true,
            hasBackgroundPermission: parsed.backgroundLocation ?? true,
            hasNotificationPermission: parsed.notifications ?? true,
          }
        }
      } catch (e) {
        console.warn('[NativeGpsBridge] Erro ao ler permissões nativas:', e)
      }
    }

    return {
      isNative,
      isServiceRunning: this.isTracking,
      hasFinePermission: true,
      hasBackgroundPermission: true,
      hasNotificationPermission: true,
    }
  }

  /**
   * Solicita o fluxo completo de permissões no Android:
   * 1. ACCESS_FINE_LOCATION
   * 2. POST_NOTIFICATIONS (Android 13+)
   * 3. ACCESS_BACKGROUND_LOCATION ("Permitir o tempo todo")
   */
  public async requestBackgroundPermissions(): Promise<boolean> {
    if (this.isNativeEnvironment() && window.RotalyNativeGps?.requestAllPermissions) {
      try {
        window.RotalyNativeGps.requestAllPermissions()
        return true
      } catch (err) {
        console.warn('[NativeGpsBridge] Erro ao solicitar permissões nativas:', err)
      }
    }
    return false
  }

  /**
   * Abre as configurações de otimização de bateria do Android para que o sistema
   * não suspenda o Rotaly mesmo após muitas horas de entrega.
   */
  public openBatteryOptimizationSettings() {
    if (this.isNativeEnvironment() && window.RotalyNativeGps?.openBatteryOptimizationSettings) {
      window.RotalyNativeGps.openBatteryOptimizationSettings()
    }
  }

  /**
   * Abre a tela de permissões do app no Android
   */
  public openAppSettings() {
    if (this.isNativeEnvironment() && window.RotalyNativeGps?.openAppSettings) {
      window.RotalyNativeGps.openAppSettings()
    }
  }

  /**
   * Inicia o rastreamento contínuo:
   * - Em nativo: dispara o Android Foreground Service com notificação fixa
   * - Em web: fallback para navigator.geolocation.watchPosition
   */
  public async startTracking(options: {
    userId: string
    baseUrl?: string
    token?: string
    notificationTitle?: string
    notificationText?: string
    minIntervalMs?: number
    minDistanceMeters?: number
  }): Promise<boolean> {
    this.isTracking = true

    if (this.isNativeEnvironment() && window.RotalyNativeGps?.startForegroundTracking) {
      try {
        const effectiveBaseUrl =
          options.baseUrl ||
          (typeof window !== 'undefined'
            ? (window as any).rotalyConfig?.baseUrl || window.location.origin
            : '')
        const effectiveToken = options.token || ''

        const payload = JSON.stringify({
          userId: options.userId,
          baseUrl: effectiveBaseUrl,
          token: effectiveToken,
          title: options.notificationTitle || 'Rastreamento de Entregas Rotaly',
          text:
            options.notificationText ||
            'GPS em segundo plano ativo para cômputo da rota e segurança',
          minIntervalMs: options.minIntervalMs || 30000,
          minDistanceMeters: options.minDistanceMeters || 18,
        })
        window.RotalyNativeGps.startForegroundTracking(payload)
        console.info('[NativeGpsBridge] Foreground service nativo iniciado!')
        return true
      } catch (err) {
        console.error('[NativeGpsBridge] Falha ao iniciar foreground nativo:', err)
      }
    }

    // Fallback Web: se não estiver em nativo, o CourierApp já gerencia watchPosition
    return true
  }

  /**
   * Obtém a posição atual com alta precisão e timeout configurado (~15s)
   */
  public async getCurrentPosition(options?: {
    enableHighAccuracy?: boolean
    timeout?: number
    maximumAge?: number
  }): Promise<NativeGpsCoordinate | null> {
    const opts = {
      enableHighAccuracy: options?.enableHighAccuracy ?? true,
      timeout: options?.timeout ?? 15000,
      maximumAge: options?.maximumAge ?? 0,
    }

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      return null
    }

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            speed: pos.coords.speed,
            heading: pos.coords.heading,
            altitude: pos.coords.altitude,
            timestamp: pos.timestamp,
          })
        },
        (err) => {
          console.warn('[nativeGpsBridge] getCurrentPosition falhou:', err?.message)
          resolve(null)
        },
        opts,
      )
    })
  }

  /**
   * Para o rastreamento contínuo e remove a notificação fixa
   */
  public stopTracking(): void {
    this.isTracking = false

    if (this.isNativeEnvironment() && window.RotalyNativeGps?.stopForegroundTracking) {
      try {
        window.RotalyNativeGps.stopForegroundTracking()
        console.info('[NativeGpsBridge] Foreground service nativo pausado.')
      } catch (err) {
        console.warn('[NativeGpsBridge] Falha ao parar foreground nativo:', err)
      }
    }

    if (this.webWatchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(this.webWatchId)
      this.webWatchId = null
    }
  }

  /**
   * Registra listener de coordenadas
   */
  public onLocation(callback: NativeGpsCallback): () => void {
    this.listeners.add(callback)
    return () => {
      this.listeners.delete(callback)
    }
  }

  /**
   * Registra listener de erros
   */
  public onError(callback: NativeGpsErrorCallback): () => void {
    this.errorListeners.add(callback)
    return () => {
      this.errorListeners.delete(callback)
    }
  }

  /**
   * Emite uma coordenada para todos os ouvintes registrados
   */
  public emitCoordinate(coord: NativeGpsCoordinate) {
    for (const listener of this.listeners) {
      try {
        listener(coord)
      } catch (e) {
        console.error('[NativeGpsBridge] Erro no listener:', e)
      }
    }
  }

  /**
   * Verifica se o runtime do Capacitor está disponível no navegador / WebView.
   */
  public isCapacitorAvailable(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof (window as any).Capacitor !== 'undefined' &&
      typeof (window as any).Capacitor.isNativePlatform === 'function' &&
      (window as any).Capacitor.isNativePlatform()
    )
  }

  /**
   * Dispara o intent ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS (via plugin Capacitor ou nativo)
   */
  public async requestIgnoreBatteryOptimizations(): Promise<boolean> {
    if (this.isCapacitorAvailable()) {
      const cap = (window as any).Capacitor
      try {
        if (cap.Plugins && cap.Plugins.BatteryOptimization) {
          await cap.Plugins.BatteryOptimization.requestIgnoreBatteryOptimization()
          return true
        }
        if (cap.Plugins && cap.Plugins.App) {
          await cap.Plugins.App.openUrl({ url: 'package:' + (cap.appId || 'com.rotaly.app') })
          return true
        }
      } catch (e) {
        console.warn('[nativeGpsBridge] Falha ao disparar requestIgnoreBatteryOptimizations:', e)
      }
    }
    return false
  }

  public openNavigation(params: {
    lat?: number | string | null
    lng?: number | string | null
    address?: string | null
    label?: string | null
    app: 'waze' | 'google_maps'
  }) {
    const { address, label, app } = params

    // Sanitização e validação das coordenadas
    const numLat =
      params.lat !== undefined && params.lat !== null && params.lat !== ''
        ? Number(params.lat)
        : NaN
    const numLng =
      params.lng !== undefined && params.lng !== null && params.lng !== ''
        ? Number(params.lng)
        : NaN

    const hasValidCoords =
      !isNaN(numLat) &&
      !isNaN(numLng) &&
      (Math.abs(numLat) > 0.000001 || Math.abs(numLng) > 0.000001)

    const finalLat = hasValidCoords ? numLat : 0
    const finalLng = hasValidCoords ? numLng : 0

    // Destino textual prioritário: address se houver, senão label
    const trimmedAddress = (address || '').trim()
    const trimmedLabel = (label || '').trim()
    const destinationQuery = trimmedAddress || trimmedLabel || ''

    // 1. Em ambiente nativo Android: SEMPRE usar a ponte nativa RotalyNativeGps se presente
    if (this.isNativeEnvironment()) {
      if (window.RotalyNativeGps?.openNavigationApp) {
        try {
          const handled = window.RotalyNativeGps.openNavigationApp(
            finalLat,
            finalLng,
            app,
            destinationQuery,
          )
          if (handled) return
        } catch (err) {
          console.error('[NativeGpsBridge] Erro ao chamar openNavigationApp nativo:', err)
        }
      }

      // Em ambiente nativo, NUNCA usar window.open (WebView bloqueia links externos).
      // Se a ponte direta falhar ou window.open for ineficaz, tentar redirecionar por location.href
      // com os esquemas diretos de intent/app como proteção adicional dentro do WebView:
      try {
        if (app === 'waze') {
          const nativeUrl = hasValidCoords
            ? `waze://?ll=${finalLat},${finalLng}&navigate=yes`
            : `waze://?q=${encodeURIComponent(destinationQuery)}&navigate=yes`
          window.location.href = nativeUrl
          return
        } else {
          const nativeUrl = hasValidCoords
            ? `google.navigation:q=${finalLat},${finalLng}`
            : `geo:0,0?q=${encodeURIComponent(destinationQuery)}`
          window.location.href = nativeUrl
          return
        }
      } catch (redirErr) {
        console.warn('[NativeGpsBridge] Falha ao despachar scheme nativo:', redirErr)
      }
      return
    }

    // 2. Ambiente Web (navegador/PWA sem ponte nativa): mantém comportamento com window.open
    if (app === 'waze') {
      const wazeUrl = hasValidCoords
        ? `https://waze.com/ul?ll=${finalLat},${finalLng}&navigate=yes`
        : `https://waze.com/ul?q=${encodeURIComponent(destinationQuery)}`
      window.open(wazeUrl, '_blank')
    } else {
      const destination = hasValidCoords
        ? `${finalLat},${finalLng}`
        : encodeURIComponent(destinationQuery)
      const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${destination}`
      window.open(mapsUrl, '_blank')
    }
  }
}

export const nativeGpsBridge = new NativeGpsBridgeService()

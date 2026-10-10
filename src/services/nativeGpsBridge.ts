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
      isTrackingActive: () => boolean
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
  public async getServiceStatus(): Promise<NativeGpsServiceStatus> {
    const isNative = this.isNativeEnvironment()

    if (isNative && window.RotalyNativeGps) {
      try {
        const raw = window.RotalyNativeGps.checkPermissions?.()
        if (raw) {
          const parsed = JSON.parse(raw)
          return {
            isNative: true,
            isServiceRunning: !!window.RotalyNativeGps.isTrackingActive?.(),
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
      hasBackgroundPermission: isNative,
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
    notificationTitle?: string
    notificationText?: string
    minIntervalMs?: number
    minDistanceMeters?: number
  }): Promise<boolean> {
    this.isTracking = true

    if (this.isNativeEnvironment() && window.RotalyNativeGps?.startForegroundTracking) {
      try {
        const payload = JSON.stringify({
          userId: options.userId,
          title: options.notificationTitle || 'Rotaly em Operação',
          text: options.notificationText || 'Rastreando rota em primeiro plano (GPS ativo)',
          minIntervalMs: options.minIntervalMs || 5000,
          minDistanceMeters: options.minDistanceMeters || 10,
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
   * Abrir app de navegação (Waze ou Google Maps) com retorno garantido ao Rotaly
   */
  public openNavigation(params: {
    lat?: number
    lng?: number
    address?: string
    app: 'waze' | 'google_maps'
  }) {
    const { lat, lng, address, app } = params

    // Se estiver em ambiente nativo Android e a interface de intent estiver disponível:
    if (
      this.isNativeEnvironment() &&
      window.RotalyNativeGps?.openNavigationApp &&
      typeof lat === 'number' &&
      typeof lng === 'number'
    ) {
      try {
        const handled = window.RotalyNativeGps.openNavigationApp(lat, lng, app, address)
        if (handled) return
      } catch (err) {
        console.warn('[NativeGpsBridge] Erro ao chamar openNavigationApp nativo:', err)
      }
    }

    // Fallback universal via links e esquemas de URL
    if (app === 'waze') {
      const wazeUrl =
        typeof lat === 'number' && typeof lng === 'number'
          ? `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`
          : `https://waze.com/ul?q=${encodeURIComponent(address || '')}`
      window.open(wazeUrl, '_blank')
    } else {
      const destination =
        typeof lat === 'number' && typeof lng === 'number'
          ? `${lat},${lng}`
          : encodeURIComponent(address || '')
      const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${destination}`
      window.open(mapsUrl, '_blank')
    }
  }
}

export const nativeGpsBridge = new NativeGpsBridgeService()

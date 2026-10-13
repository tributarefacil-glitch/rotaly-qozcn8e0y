/**
 * offlineTelemetryBuffer.ts
 *
 * Buffer offline e sincronização em ordem cronológica de telemetria GPS para o app do entregador (Rotaly).
 *
 * Requisitos e Arquitetura:
 * 1. Enquanto a rota está ativa (route_started e ainda não finalizada na base), se o envio falhar
 *    (sem rede/sem sinal) OU o GPS estiver com erro/desligado, armazena no buffer persistente em IndexedDB
 *    (com fallback para localStorage).
 * 2. Quando o sinal/GPS voltar (evento 'online', 'visibilitychange' ou 'SYNC_TRIGGER' do SW):
 *    envia TODOS os pontos do buffer à coleção de telemetria ('locations') em ordem cronológica estrita,
 *    marcando e enviando o timestamp original de cada ponto (não o momento do reenvio), para que
 *    a auditoria de telemetria e análise de desvios da Torre de Controle continuem precisas.
 * 3. O cálculo oficial de km viário do Rotaly continua desacoplado da telemetria bruta.
 * 4. Notifica ouvintes/UI sobre o número de pontos pendentes para badge/aviso discreto no app do entregador.
 */

import { haversineDistanceMeters } from '@/lib/geo'
import { deliveryService } from './deliveryService'
import { offlineRouteStorage, type OfflineLocationPoint } from './offlineRouteStorage'

export type OfflineTelemetryPoint = OfflineLocationPoint

const STORAGE_PREFIX = 'rotaly_offline_telemetry_buffer_v2_'
const LEGACY_STORAGE_PREFIX = 'rotaly_offline_telemetry_'
const MAX_BUFFER_POINTS = 500

const DEDUPLICATION_MAX_DISTANCE_METERS = 10
const DEDUPLICATION_MIN_INTERVAL_MS = 30 * 1000

class OfflineTelemetryBufferService {
  private syncInProgress = false
  private listeners = new Set<(count: number) => void>()
  private lastSuccessfulOnlinePingTimes = new Map<string, number>()
  private inMemoryCache = new Map<string, OfflineTelemetryPoint[]>()
  private initializedUsers = new Set<string>()

  private getStorageKey(userId: string): string {
    return `${STORAGE_PREFIX}${userId}`
  }

  /**
   * Inicializa o cache em memória lendo do IndexedDB e localStorage na inicialização
   */
  async initUserBuffer(userId: string): Promise<OfflineTelemetryPoint[]> {
    if (!userId) return []
    if (this.initializedUsers.has(userId) && this.inMemoryCache.has(userId)) {
      return this.inMemoryCache.get(userId) || []
    }

    try {
      // Lê do IndexedDB
      const points = await offlineRouteStorage.getTelemetryPoints(userId)
      // Mescla com legado do localStorage caso exista migração
      const legacy = this.getLegacyBuffer(userId)
      const mergedMap = new Map<string, OfflineTelemetryPoint>()

      for (const p of legacy) {
        mergedMap.set(p.id, p)
      }
      for (const p of points) {
        mergedMap.set(p.id, p)
      }

      const merged = Array.from(mergedMap.values())
      merged.sort((a, b) => a.timestamp - b.timestamp)

      this.inMemoryCache.set(userId, merged)
      this.initializedUsers.add(userId)
      this.notify(userId)
      return merged
    } catch {
      const fallback = this.getLegacyBuffer(userId)
      this.inMemoryCache.set(userId, fallback)
      this.initializedUsers.add(userId)
      return fallback
    }
  }

  /**
   * Registra que um ping online foi enviado com sucesso no timestamp fornecido.
   */
  recordSuccessfulOnlinePing(userId: string, timestamp: number = Date.now()): void {
    if (!userId) return
    this.lastSuccessfulOnlinePingTimes.set(userId, timestamp)
  }

  /**
   * Leitura rápida síncrona do buffer local do usuário.
   */
  getBuffer(userId: string): OfflineTelemetryPoint[] {
    if (typeof window === 'undefined' || !userId) return []

    if (this.inMemoryCache.has(userId)) {
      return [...(this.inMemoryCache.get(userId) || [])]
    }

    // Se ainda não inicializou, lê de imediato do localStorage
    const legacy = this.getLegacyBuffer(userId)
    this.inMemoryCache.set(userId, legacy)
    // Dispara init assíncrono em background
    this.initUserBuffer(userId).catch(() => {})
    return legacy
  }

  private getLegacyBuffer(userId: string): OfflineTelemetryPoint[] {
    try {
      const raw = localStorage.getItem(this.getStorageKey(userId))
      if (raw) {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed : []
      }
      // Tentar chave legada se não existir na v2
      const legacyRaw = localStorage.getItem(`${LEGACY_STORAGE_PREFIX}${userId}`)
      if (legacyRaw) {
        const parsedLegacy = JSON.parse(legacyRaw)
        localStorage.removeItem(`${LEGACY_STORAGE_PREFIX}${userId}`)
        if (Array.isArray(parsedLegacy) && parsedLegacy.length > 0) {
          localStorage.setItem(this.getStorageKey(userId), JSON.stringify(parsedLegacy))
          return parsedLegacy
        }
      }
      return []
    } catch {
      return []
    }
  }

  /**
   * Salva os pontos no buffer local (em memória, localStorage e IndexedDB).
   */
  private setBuffer(userId: string, points: OfflineTelemetryPoint[]): void {
    if (typeof window === 'undefined' || !userId) return
    try {
      const trimmed = points.slice(-MAX_BUFFER_POINTS)
      trimmed.sort((a, b) => a.timestamp - b.timestamp)
      this.inMemoryCache.set(userId, trimmed)

      // Salva de imediato no localStorage
      try {
        localStorage.setItem(this.getStorageKey(userId), JSON.stringify(trimmed))
      } catch {
        /* ignore */
      }

      this.notify(userId)
    } catch (err) {
      console.error('Erro ao gravar buffer offline de telemetria:', err)
    }
  }

  /**
   * Adiciona um ponto ao buffer offline (se a rota estiver ativa). Alias enqueuePoint para compatibilidade.
   */
  enqueuePoint(point: Omit<OfflineTelemetryPoint, 'id' | 'synced'>): OfflineTelemetryPoint {
    return this.enqueue(point)
  }

  // Mapa de controle de taxa de retry: no máximo 1 tentativa por ponto por minuto (60s)
  private pointLastRetryAttemptMap = new Map<string, number>()

  enqueue(point: Omit<OfflineTelemetryPoint, 'id' | 'synced'>): OfflineTelemetryPoint {
    // Regra: Bloquear enfileiramento quando o navegador está online E um ping recente já foi transmitido
    // EXCETO quando se trata de ponto rejeitado com 400 ou falha explícita, que NUNCA deve ser descartado.
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true
    const lastOnlinePing = this.lastSuccessfulOnlinePingTimes.get(point.userId) || 0
    const timeSinceOnlinePing = Date.now() - lastOnlinePing
    const isFailureReason = point.reason === 'rejected_400' || point.reason === 'send_failed'
    if (isOnline && timeSinceOnlinePing < 30 * 1000 && !isFailureReason) {
      return {
        ...point,
        id: `discarded_${point.timestamp}`,
        synced: true,
      }
    }

    const current = this.getBuffer(point.userId)
    current.sort((a, b) => a.timestamp - b.timestamp)

    if (current.length > 0) {
      const last = current[current.length - 1]
      const timeDiff = Math.abs(point.timestamp - last.timestamp)
      const distMeters = haversineDistanceMeters(last.lat, last.lng, point.lat, point.lng)
      const isWeak = (point.accuracy ?? 2000) >= 500 || (last.accuracy ?? 2000) >= 500

      // Deduplicação defensiva no enfileiramento:
      // Se a coordenada mudou menos de 10m OU o fix continua fraco/sem-fix (>=500m) em intervalo < 30s:
      // Apenas atualiza o último ponto ao invés de empilhar duplicatas.
      if (
        (distMeters < DEDUPLICATION_MAX_DISTANCE_METERS &&
          timeDiff < DEDUPLICATION_MIN_INTERVAL_MS) ||
        (isWeak && distMeters < 30 && timeDiff < 60 * 1000)
      ) {
        last.timestamp = Math.max(last.timestamp, point.timestamp)
        if (typeof point.speed === 'number' && !isNaN(point.speed)) {
          last.speed = point.speed
        }
        if (typeof point.batteryLevel === 'number') {
          last.batteryLevel = point.batteryLevel
        }
        if (typeof point.accuracy === 'number') {
          last.accuracy = point.accuracy
        }
        last.reason = point.reason
        this.setBuffer(point.userId, current)

        // Persiste no IndexedDB
        offlineRouteStorage.enqueueTelemetryPoint(last).catch(() => {})
        return last
      }
    }

    const id = `pt_${point.timestamp}_${Math.random().toString(36).slice(2, 7)}`
    const fullPoint: OfflineTelemetryPoint = {
      ...point,
      id,
      synced: false,
    }

    current.push(fullPoint)
    current.sort((a, b) => a.timestamp - b.timestamp)
    this.setBuffer(point.userId, current)

    // Persiste no IndexedDB em background
    offlineRouteStorage.enqueueTelemetryPoint(fullPoint).catch(() => {})

    return fullPoint
  }

  /**
   * Quantidade de pontos pendentes no buffer.
   */
  getPendingCount(userId: string): number {
    return this.getBuffer(userId).filter((p) => !p.synced).length
  }

  /**
   * Quantidade total de pontos no buffer (alias de conveniência).
   */
  size(userId?: string): number {
    if (!userId) return 0
    return this.getPendingCount(userId)
  }

  /**
   * Limpa todo o buffer de um usuário.
   */
  clear(userId: string): void {
    if (typeof window === 'undefined' || !userId) return
    try {
      this.inMemoryCache.set(userId, [])
      localStorage.removeItem(this.getStorageKey(userId))
      offlineRouteStorage
        .getTelemetryPoints(userId)
        .then((pts) => {
          return offlineRouteStorage.removeTelemetryPoints(
            userId,
            pts.map((p) => p.id),
          )
        })
        .catch(() => {})
      this.notify(userId)
    } catch (err) {
      console.warn('Erro ao limpar buffer offline:', err)
    }
  }

  /**
   * Inscreve um callback para ser notificado de alterações na contagem de pontos pendentes.
   */
  subscribe(
    userIdOrListener: string | ((count: number) => void),
    maybeListener?: (count: number) => void,
  ): () => void {
    const listener = typeof userIdOrListener === 'function' ? userIdOrListener : maybeListener
    const userId = typeof userIdOrListener === 'string' ? userIdOrListener : ''

    if (!listener) return () => {}

    this.listeners.add(listener)
    if (userId) {
      // Dispara contagem atual imediatamente
      listener(this.getPendingCount(userId))
      // Inicializa IndexedDB em background
      this.initUserBuffer(userId)
        .then(() => {
          listener(this.getPendingCount(userId))
        })
        .catch(() => {})
    }

    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(userId: string): void {
    const count = this.getPendingCount(userId)
    this.listeners.forEach((fn) => {
      try {
        fn(count)
      } catch {
        /* ignore */
      }
    })
  }

  /**
   * Sincroniza todos os pontos do buffer com o banco PocketBase em ordem cronológica estrita.
   * Preserva e marca o timestamp original de cada ponto na auditoria.
   * Retorna o número de pontos enviados com sucesso e quantos restaram.
   */
  async flush(userId: string): Promise<{ sent: number; remaining: number }> {
    if (this.syncInProgress || !userId) {
      return { sent: 0, remaining: this.getPendingCount(userId) }
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { sent: 0, remaining: this.getPendingCount(userId) }
    }

    // Garante que o buffer foi sincronizado com IndexedDB antes de descarregar
    await this.initUserBuffer(userId)

    const points = this.getBuffer(userId)
    if (points.length === 0) {
      return { sent: 0, remaining: 0 }
    }

    this.syncInProgress = true
    let sentCount = 0
    const sentIds: string[] = []
    const remainingPoints: OfflineTelemetryPoint[] = []

    try {
      // 1. Ordenação cronológica estrita: do mais antigo para o mais recente
      points.sort((a, b) => a.timestamp - b.timestamp)

      // 2. Deduplicação defensiva no envio
      const deduplicatedPoints: OfflineTelemetryPoint[] = []
      for (const pt of points) {
        if (deduplicatedPoints.length === 0) {
          deduplicatedPoints.push(pt)
          continue
        }
        const lastSentOrQueued = deduplicatedPoints[deduplicatedPoints.length - 1]
        const dt = Math.abs(pt.timestamp - lastSentOrQueued.timestamp)
        const dist = haversineDistanceMeters(
          lastSentOrQueued.lat,
          lastSentOrQueued.lng,
          pt.lat,
          pt.lng,
        )

        if (dist < DEDUPLICATION_MAX_DISTANCE_METERS && dt < DEDUPLICATION_MIN_INTERVAL_MS) {
          lastSentOrQueued.timestamp = Math.max(lastSentOrQueued.timestamp, pt.timestamp)
          continue
        }
        deduplicatedPoints.push(pt)
      }

      const lastOnlinePingTime = this.lastSuccessfulOnlinePingTimes.get(userId) || 0

      for (let i = 0; i < deduplicatedPoints.length; i++) {
        const pt = deduplicatedPoints[i]

        // Se o ponto coincidir exatamente (<30s) com um ping que já foi enviado online, não reenviar
        if (lastOnlinePingTime > 0 && Math.abs(pt.timestamp - lastOnlinePingTime) < 30 * 1000) {
          sentIds.push(pt.id)
          continue
        }

        const speedToSend = typeof pt.speed === 'number' && pt.speed < 2 ? 0 : (pt.speed ?? 0)

        // Taxa de retry por ponto: no máximo 1 tentativa por ponto por minuto (60s)
        const lastAttemptTime = this.pointLastRetryAttemptMap.get(pt.id) || 0
        const nowMs = Date.now()
        if (nowMs - lastAttemptTime < 60 * 1000) {
          // Ponto já tentado há menos de 1 minuto; aguarda próxima janela sem descartar
          remainingPoints.push(pt)
          continue
        }
        this.pointLastRetryAttemptMap.set(pt.id, nowMs)

        // Converter timestamp original em formato legível ISO para o log de auditoria
        const originalTimeIso = new Date(pt.timestamp).toISOString()

        // PATCH 1: Usar sanitizador em TODO envio a locations (flush do buffer)
        let sanitizedPayload: ReturnType<typeof deliveryService.sanitizeLocationPayload>
        try {
          sanitizedPayload = deliveryService.sanitizeLocationPayload({
            userId: pt.userId,
            lat: pt.lat,
            lng: pt.lng,
            speed: speedToSend,
            heading: pt.heading ?? 0,
            batteryLevel: pt.batteryLevel,
            accuracy: pt.accuracy,
            gpsStatus:
              pt.reason === 'permission_denied' || pt.reason.startsWith('gps')
                ? 'disabled'
                : 'offline',
            gpsReason: `${pt.reason} (coletado em ${originalTimeIso})`,
            offlineBuffered: true,
          })
        } catch (sanitizationErr: any) {
          console.warn('[TELEMETRIA POCKETBASE 400/FAIL] Erro de sanitização no buffer:', {
            error: sanitizationErr?.message,
            point: pt,
          })
          // Se as coordenadas estiverem irremediavelmente corrompidas fora das faixas mundiais,
          // mantém no buffer para inspeção sem travar o flush dos demais
          remainingPoints.push({
            ...pt,
            error: sanitizationErr?.message || 'Erro de sanitização',
          })
          continue
        }

        try {
          await deliveryService.updateCourierLocation(
            sanitizedPayload.user_id!,
            sanitizedPayload.lat!,
            sanitizedPayload.lng!,
            sanitizedPayload.speed,
            sanitizedPayload.heading,
            sanitizedPayload.battery_level,
            {
              gps_status: sanitizedPayload.gps_status,
              gps_reason: sanitizedPayload.gps_reason,
              offline_buffered: true,
              accuracy: sanitizedPayload.accuracy,
            },
          )
          sentCount++
          sentIds.push(pt.id)
          this.pointLastRetryAttemptMap.delete(pt.id)
        } catch (err: any) {
          // PATCH 2: Log de falha padronizado com status, message, fieldErrors e payload tentado
          console.warn('[TELEMETRIA POCKETBASE 400/FAIL]', {
            status: err?.status,
            message: err?.message,
            fieldErrors: err?.data?.data || err?.data,
            payload: sanitizedPayload,
            pointId: pt.id,
          })

          // REQUISITO: Aceitar 400 descartando o payload rejeitado (evita loop infinito de rejeição do backend)
          // Falha de rede / 5xx / timeout permanece no buffer para retry (1 tentativa por minuto)
          if (err?.status === 400) {
            console.warn(
              '[TELEMETRIA] Payload rejeitado com 400 pelo backend — descartando do buffer para evitar loop:',
              pt.id,
            )
            sentIds.push(pt.id)
            this.pointLastRetryAttemptMap.delete(pt.id)
          } else {
            remainingPoints.push({
              ...pt,
              error: err?.message || 'Falha de rede/5xx',
            })
          }
        }
      }

      // Remover do IndexedDB os que foram enviados
      if (sentIds.length > 0) {
        await offlineRouteStorage.removeTelemetryPoints(userId, sentIds).catch(() => {})
      }

      // Se alguns falharam ou aguardam retry, preservamos no buffer
      if (remainingPoints.length > 0) {
        this.setBuffer(userId, remainingPoints)
      } else {
        this.clear(userId)
      }
    } finally {
      this.syncInProgress = false
      this.notify(userId)
    }

    return { sent: sentCount, remaining: this.getPendingCount(userId) }
  }
}

export const offlineTelemetryBuffer = new OfflineTelemetryBufferService()

/**
 * offlineTelemetryBuffer.ts
 *
 * Buffer offline e sincronização em ordem cronológica de telemetria GPS para o app do entregador (Rotaly).
 *
 * Requisitos:
 * 1. Enquanto a rota está ativa (route_started e ainda não finalizada na base), se o envio falhar
 *    (sem rede/sem sinal) OU o GPS estiver com erro/desligado, armazena no buffer local:
 *    { id, userId, lat, lng, accuracy, speed, heading, batteryLevel, timestamp, reason, synced }
 * 2. Quando o sinal/GPS voltar: envia TODOS os pontos do buffer à coleção de telemetria ('locations')
 *    em ordem cronológica estrita, marcando-os como sincronizados e limpando o buffer após envio bem-sucedido.
 * 3. Notifica ouvintes/UI sobre o número de pontos pendentes para aviso discreto no app do entregador.
 */

import { haversineDistanceMeters } from '@/lib/geo'
import { deliveryService } from './deliveryService'

export interface OfflineTelemetryPoint {
  id: string
  userId: string
  lat: number
  lng: number
  accuracy?: number
  speed?: number
  heading?: number
  batteryLevel?: number | null
  timestamp: number
  reason:
    | 'network_offline'
    | 'send_failed'
    | 'gps_disabled'
    | 'gps_unavailable'
    | 'permission_denied'
    | 'weak_signal'
    | 'cached_while_offline'
    | 'sem-fix'
  synced?: boolean
  error?: string
}

const STORAGE_PREFIX = 'rotaly_offline_telemetry_'
const MAX_BUFFER_POINTS = 500

// Limiares de deduplicação no buffer offline
// Se o novo ponto tiver distância < 5 metros E intervalo de tempo < 10 segundos,
// não adiciona uma nova cópia duplicada (atualiza timestamp e mantém o buffer enxuto).
const DEDUPLICATION_MAX_DISTANCE_METERS = 10
const DEDUPLICATION_MIN_INTERVAL_MS = 30 * 1000

class OfflineTelemetryBufferService {
  private syncInProgress = false
  private listeners = new Set<(count: number) => void>()
  private lastSuccessfulOnlinePingTimes = new Map<string, number>()

  private getStorageKey(userId: string): string {
    return `${STORAGE_PREFIX}${userId}`
  }

  /**
   * Registra que um ping online foi enviado com sucesso no timestamp fornecido.
   */
  recordSuccessfulOnlinePing(userId: string, timestamp: number = Date.now()): void {
    if (!userId) return
    this.lastSuccessfulOnlinePingTimes.set(userId, timestamp)
  }

  /**
   * Obtém os pontos atualmente armazenados no buffer local para este entregador.
   */
  getBuffer(userId: string): OfflineTelemetryPoint[] {
    if (typeof window === 'undefined' || !userId) return []
    try {
      const raw = localStorage.getItem(this.getStorageKey(userId))
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch (err) {
      console.warn('Erro ao ler buffer offline de telemetria:', err)
      return []
    }
  }

  /**
   * Salva os pontos no buffer local.
   */
  private setBuffer(userId: string, points: OfflineTelemetryPoint[]): void {
    if (typeof window === 'undefined' || !userId) return
    try {
      // Limita ao número máximo para proteção de armazenamento
      const trimmed = points.slice(-MAX_BUFFER_POINTS)
      localStorage.setItem(this.getStorageKey(userId), JSON.stringify(trimmed))
      this.notify(userId)
    } catch (err) {
      console.error('Erro ao gravar buffer offline de telemetria:', err)
    }
  }

  /**
   * Adiciona um ponto ao buffer offline (se a rota estiver ativa).
   */
  /**
   * Adiciona um ponto ao buffer offline (se a rota estiver ativa). Alias enqueuePoint para compatibilidade.
   */
  enqueuePoint(point: Omit<OfflineTelemetryPoint, 'id' | 'synced'>): OfflineTelemetryPoint {
    return this.enqueue(point)
  }

  enqueue(point: Omit<OfflineTelemetryPoint, 'id' | 'synced'>): OfflineTelemetryPoint {
    // Regra: Bloquear enfileiramento quando o navegador está online E um ping recente já foi transmitido
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true
    const lastOnlinePing = this.lastSuccessfulOnlinePingTimes.get(point.userId) || 0
    const timeSinceOnlinePing = Date.now() - lastOnlinePing
    if (isOnline && timeSinceOnlinePing < 30 * 1000) {
      // Já transmitido com sucesso no mesmo ciclo (<30s): não polui o buffer offline
      return {
        ...point,
        id: `discarded_${point.timestamp}`,
        synced: true,
      }
    }

    const current = this.getBuffer(point.userId)

    // Ordenar cronologicamente para avaliar o último ponto registrado
    current.sort((a, b) => a.timestamp - b.timestamp)

    if (current.length > 0) {
      const last = current[current.length - 1]
      const timeDiff = Math.abs(point.timestamp - last.timestamp)
      const distMeters = haversineDistanceMeters(last.lat, last.lng, point.lat, point.lng)
      const isWeak = (point.accuracy ?? 2000) >= 500 || (last.accuracy ?? 2000) >= 500

      // Regra 1: Deduplicação defensiva no enfileiramento:
      // Se a coordenada mudou menos de 10m OU o fix continua fraco/sem-fix (>=500m) em intervalo < 30s:
      // NÃO enfileirar mais uma cópia repetida. Apenas atualizamos o ponto existente em vez de empilhar,
      // evitando inflar o banco e trajetos.
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
    // Garantir ordenação cronológica rigorosa
    current.sort((a, b) => a.timestamp - b.timestamp)
    this.setBuffer(point.userId, current)
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
      localStorage.removeItem(this.getStorageKey(userId))
      this.notify(userId)
    } catch (err) {
      console.warn('Erro ao limpar buffer offline:', err)
    }
  }

  /**
   * Inscreve um callback para ser notificado de alterações na contagem de pontos pendentes.
   * Suporta chamada com userId ou callback direto.
   */
  subscribe(
    userIdOrListener: string | ((count: number) => void),
    maybeListener?: (count: number) => void,
  ): () => void {
    const listener = typeof userIdOrListener === 'function' ? userIdOrListener : maybeListener
    const userId = typeof userIdOrListener === 'string' ? userIdOrListener : ''

    if (!listener) return () => {}

    this.listeners.add(listener)
    // Dispara contagem atual imediatamente se tiver userId
    if (userId) {
      listener(this.getPendingCount(userId))
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
   * Retorna o número de pontos enviados com sucesso.
   */
  async flush(userId: string): Promise<{ sent: number; remaining: number }> {
    if (this.syncInProgress || !userId) {
      return { sent: 0, remaining: this.getPendingCount(userId) }
    }

    // Se estiver explicitamente offline pelo navegador, não tentar agora
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return { sent: 0, remaining: this.getPendingCount(userId) }
    }

    const points = this.getBuffer(userId)
    if (points.length === 0) {
      return { sent: 0, remaining: 0 }
    }

    this.syncInProgress = true
    let sentCount = 0
    const remainingPoints: OfflineTelemetryPoint[] = []

    try {
      // Ordenação cronológica rigorosa: do mais antigo para o mais recente
      points.sort((a, b) => a.timestamp - b.timestamp)

      // Regra 2: Deduplicação defensiva no envio ao sincronizar o buffer.
      // Caso existam cópias acumuladas anteriormente na fila (ex.: mesma coordenada em janela <10s),
      // filtra e envia apenas uma cópia representativa em ordem cronológica.
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

        // Se for o mesmo ponto (<5m e <10s), descarta a cópia redundante
        if (dist < DEDUPLICATION_MAX_DISTANCE_METERS && dt < DEDUPLICATION_MIN_INTERVAL_MS) {
          // Atualiza timestamp para o mais recente do grupo
          lastSentOrQueued.timestamp = Math.max(lastSentOrQueued.timestamp, pt.timestamp)
          continue
        }
        deduplicatedPoints.push(pt)
      }

      // Descartar envio de pontos do buffer se um ping online foi transmitido com sucesso no mesmo ciclo (<30s)
      const lastOnlinePingTime = this.lastSuccessfulOnlinePingTimes.get(userId) || 0
      const now = Date.now()

      for (let i = 0; i < deduplicatedPoints.length; i++) {
        const pt = deduplicatedPoints[i]

        // Se o ponto do buffer for muito recente e estiver dentro da janela (<30s) de um ping online já aceito,
        // descarta para evitar duplicidade na coleção locations.
        if (lastOnlinePingTime > 0 && Math.abs(pt.timestamp - lastOnlinePingTime) < 30 * 1000) {
          continue
        }

        // Se o ponto tiver timestamp antigo e velocidade espúria, sanitiza a velocidade para 0 se delta não justificar
        const speedToSend = typeof pt.speed === 'number' && pt.speed < 2 ? 0 : (pt.speed ?? 0)

        try {
          await deliveryService.updateCourierLocation(
            pt.userId,
            pt.lat,
            pt.lng,
            speedToSend,
            pt.heading ?? 0,
            pt.batteryLevel,
            {
              gps_status:
                pt.reason === 'permission_denied' || pt.reason.startsWith('gps')
                  ? 'disabled'
                  : 'offline',
              gps_reason: pt.reason,
              offline_buffered: true,
              accuracy: pt.accuracy,
            },
          )
          sentCount++
        } catch (err: any) {
          console.warn('Falha ao enviar ponto offline para PocketBase:', err?.message || err)
          // Se falhou o envio de rede, para a sincronização mantendo este e os seguintes no buffer
          remainingPoints.push({
            ...pt,
            error: err?.message || 'Falha de rede ao descarregar buffer',
          })
          // Interrompe o loop para não inundar o servidor se perdeu a rede novamente
          const unattempted = deduplicatedPoints.slice(i)
          this.setBuffer(userId, unattempted)
          break
        }
      }

      // Se alguns falharam, preservamos os restantes no buffer
      if (remainingPoints.length > 0) {
        // Encontra o índice a partir do qual parou e mantém os não enviados
        const stopIndex = points.findIndex((p) => p.id === remainingPoints[0].id)
        const unattempted = stopIndex >= 0 ? points.slice(stopIndex) : remainingPoints
        this.setBuffer(userId, unattempted)
      } else {
        // Todos foram enviados com sucesso! Limpar buffer completamente
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

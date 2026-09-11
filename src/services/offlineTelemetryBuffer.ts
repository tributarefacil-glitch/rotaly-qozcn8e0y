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
    | 'cached_while_offline'
  synced?: boolean
  error?: string
}

const STORAGE_PREFIX = 'rotaly_offline_telemetry_'
const MAX_BUFFER_POINTS = 500

class OfflineTelemetryBufferService {
  private syncInProgress = false
  private listeners = new Set<(count: number) => void>()

  private getStorageKey(userId: string): string {
    return `${STORAGE_PREFIX}${userId}`
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
    const id = `pt_${point.timestamp}_${Math.random().toString(36).slice(2, 7)}`
    const fullPoint: OfflineTelemetryPoint = {
      ...point,
      id,
      synced: false,
    }

    const current = this.getBuffer(point.userId)
    current.push(fullPoint)
    // Garantir ordenação cronológica
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
   */
  subscribe(userId: string, listener: (count: number) => void): () => void {
    this.listeners.add(listener)
    // Dispara contagem atual imediatamente
    listener(this.getPendingCount(userId))
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

      for (const pt of points) {
        try {
          await deliveryService.updateCourierLocation(
            pt.userId,
            pt.lat,
            pt.lng,
            pt.speed ?? 0,
            pt.heading ?? 0,
            pt.batteryLevel,
            {
              gps_status: pt.reason.startsWith('gps') ? 'disabled' : 'offline',
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

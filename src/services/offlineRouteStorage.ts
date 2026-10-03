/**
 * offlineRouteStorage.ts
 *
 * Módulo de armazenamento persistente em IndexedDB para o App do Entregador (Rotaly).
 *
 * Requisitos:
 * 1. Cache local robusto da Rota do Dia (pedidos da rota, dados dos clientes: nome, endereço, telefone, coordenadas)
 *    a cada carregamento bem-sucedido via rede.
 * 2. Disponibilização dos dados cacheados quando offline (sem rede), permitindo ao entregador
 *    consultar os dados dos clientes e navegar sem internet.
 * 3. Fila persistente de telemetria GPS em IndexedDB com preservação estrita do timestamp original,
 *    garantindo que auditoria de desvios e telemetria funcionem corretamente após o retorno de conexão.
 * 4. Fallback automático para localStorage caso o navegador/ambiente restrinja IndexedDB (ex: modo anônimo restritivo).
 */

import type { OrderRecord } from '@/types/delivery'

const DB_NAME = 'rotaly_offline_db'
const DB_VERSION = 1

const STORE_ROUTE_CACHE = 'route_cache'
const STORE_TELEMETRY_QUEUE = 'telemetry_queue'
const STORE_DELIVERY_QUEUE = 'delivery_queue'

export interface CachedRoutePayload {
  courierId: string
  savedAt: number
  orders: OrderRecord[]
  source: 'online_cache' | 'offline_snapshot'
}

export interface OfflineRedirectionAction {
  id: string
  orderId: string
  courierId: string
  action: 'initiate' | 'confirm'
  pointA?: { lat: number; lng: number; at: string }
  pointB?: { lat: number; lng: number; at: string }
  newAddress?: string
  updateCustomerAddress?: boolean
  notes?: string
  receiverName?: string
  timestamp: number
  synced?: boolean
}

export interface OfflineLocationPoint {
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

class OfflineRouteStorageService {
  private dbPromise: Promise<IDBDatabase | null> | null = null

  private getDB(): Promise<IDBDatabase | null> {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      return Promise.resolve(null)
    }

    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve) => {
        try {
          const req = window.indexedDB.open(DB_NAME, DB_VERSION)

          req.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result

            if (!db.objectStoreNames.contains(STORE_ROUTE_CACHE)) {
              db.createObjectStore(STORE_ROUTE_CACHE, { keyPath: 'courierId' })
            }

            if (!db.objectStoreNames.contains(STORE_TELEMETRY_QUEUE)) {
              const telemetryStore = db.createObjectStore(STORE_TELEMETRY_QUEUE, {
                keyPath: 'id',
              })
              telemetryStore.createIndex('by_user_time', ['userId', 'timestamp'], {
                unique: false,
              })
              telemetryStore.createIndex('by_timestamp', 'timestamp', { unique: false })
            }

            if (!db.objectStoreNames.contains(STORE_DELIVERY_QUEUE)) {
              db.createObjectStore(STORE_DELIVERY_QUEUE, { keyPath: 'id' })
            }
          }

          req.onsuccess = () => {
            resolve(req.result)
          }

          req.onerror = (err) => {
            console.warn('[OfflineStorage] IndexedDB falhou ao abrir, usando fallback:', err)
            resolve(null)
          }

          req.onblocked = () => {
            console.warn('[OfflineStorage] IndexedDB bloqueado por outra aba aberta.')
            resolve(null)
          }
        } catch (e) {
          console.warn('[OfflineStorage] Exceção ao abrir IndexedDB:', e)
          resolve(null)
        }
      })
    }

    return this.dbPromise
  }

  // -------------------------------------------------------------
  // CACHE DA ROTA ATIVA DO DIA
  // -------------------------------------------------------------

  /**
   * Salva os pedidos da rota ativa no IndexedDB (e localStorage de segurança).
   */
  async saveRouteOrders(courierId: string, orders: OrderRecord[]): Promise<void> {
    if (!courierId) return

    const payload: CachedRoutePayload = {
      courierId,
      savedAt: Date.now(),
      orders,
      source: 'online_cache',
    }

    // 1. Sempre salvar também no localStorage como redundância imediata síncrona
    try {
      localStorage.setItem(`rotaly_cache_route_${courierId}`, JSON.stringify(payload))
    } catch {
      /* ignore quota errors */
    }

    // 2. Salvar no IndexedDB
    try {
      const db = await this.getDB()
      if (!db) return

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_ROUTE_CACHE, 'readwrite')
        const store = tx.objectStore(STORE_ROUTE_CACHE)
        const putReq = store.put(payload)
        putReq.onsuccess = () => resolve()
        putReq.onerror = () => reject(putReq.error)
      })
    } catch (err) {
      console.warn('[OfflineStorage] Falha ao gravar rota no IndexedDB:', err)
    }
  }

  /**
   * Obtém a última rota salva em cache local para o entregador.
   */
  async getCachedRouteOrders(courierId: string): Promise<CachedRoutePayload | null> {
    if (!courierId) return null

    // 1. Tenta IndexedDB primeiro
    try {
      const db = await this.getDB()
      if (db) {
        const result = await new Promise<CachedRoutePayload | null>((resolve) => {
          const tx = db.transaction(STORE_ROUTE_CACHE, 'readonly')
          const store = tx.objectStore(STORE_ROUTE_CACHE)
          const getReq = store.get(courierId)
          getReq.onsuccess = () => resolve(getReq.result || null)
          getReq.onerror = () => resolve(null)
        })

        if (result && Array.isArray(result.orders)) {
          return result
        }
      }
    } catch (err) {
      console.warn('[OfflineStorage] Falha ao ler rota no IndexedDB, tentando fallback:', err)
    }

    // 2. Fallback para localStorage
    try {
      const raw = localStorage.getItem(`rotaly_cache_route_${courierId}`)
      if (raw) {
        const parsed = JSON.parse(raw) as CachedRoutePayload
        if (parsed && Array.isArray(parsed.orders)) {
          return parsed
        }
      }
    } catch {
      /* ignore */
    }

    return null
  }

  // -------------------------------------------------------------
  // FILA PERSISTENTE DE TELEMETRIA GPS (Com timestamp original estrito)
  // -------------------------------------------------------------

  /**
   * Adiciona um ponto à fila offline do IndexedDB.
   */
  async enqueueTelemetryPoint(point: OfflineLocationPoint): Promise<void> {
    try {
      const db = await this.getDB()
      if (db) {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_TELEMETRY_QUEUE, 'readwrite')
          const store = tx.objectStore(STORE_TELEMETRY_QUEUE)
          const req = store.put(point)
          req.onsuccess = () => resolve()
          req.onerror = () => reject(req.error)
        })
        return
      }
    } catch (err) {
      console.warn('[OfflineStorage] Falha ao enfileirar no IndexedDB, usando localStorage:', err)
    }

    // Fallback localStorage
    try {
      const key = `rotaly_offline_telem_idb_fb_${point.userId}`
      const existingRaw = localStorage.getItem(key)
      const list: OfflineLocationPoint[] = existingRaw ? JSON.parse(existingRaw) : []
      list.push(point)
      // Mantém últimos 500
      localStorage.setItem(key, JSON.stringify(list.slice(-500)))
    } catch {
      /* ignore */
    }
  }

  /**
   * Retorna todos os pontos de telemetria pendentes em ordem cronológica estrita (timestamp asc).
   */
  async getTelemetryPoints(userId: string): Promise<OfflineLocationPoint[]> {
    if (!userId) return []

    let points: OfflineLocationPoint[] = []

    try {
      const db = await this.getDB()
      if (db) {
        points = await new Promise<OfflineLocationPoint[]>((resolve) => {
          const tx = db.transaction(STORE_TELEMETRY_QUEUE, 'readonly')
          const store = tx.objectStore(STORE_TELEMETRY_QUEUE)
          const req = store.getAll()
          req.onsuccess = () => {
            const all = (req.result || []) as OfflineLocationPoint[]
            const filtered = all.filter((p) => p.userId === userId)
            filtered.sort((a, b) => a.timestamp - b.timestamp)
            resolve(filtered)
          }
          req.onerror = () => resolve([])
        })
      }
    } catch (err) {
      console.warn('[OfflineStorage] Falha ao buscar pontos no IndexedDB:', err)
    }

    // Unir com fallback se houver
    try {
      const fbKey = `rotaly_offline_telem_idb_fb_${userId}`
      const raw = localStorage.getItem(fbKey)
      if (raw) {
        const fbList: OfflineLocationPoint[] = JSON.parse(raw)
        if (Array.isArray(fbList) && fbList.length > 0) {
          const existingIds = new Set(points.map((p) => p.id))
          for (const item of fbList) {
            if (!existingIds.has(item.id)) {
              points.push(item)
            }
          }
        }
      }
    } catch {
      /* ignore */
    }

    points.sort((a, b) => a.timestamp - b.timestamp)
    return points
  }

  /**
   * Remove pontos específicos enviados com sucesso.
   */
  async removeTelemetryPoints(userId: string, idsToRemove: string[]): Promise<void> {
    if (idsToRemove.length === 0) return

    const idSet = new Set(idsToRemove)

    try {
      const db = await this.getDB()
      if (db) {
        await new Promise<void>((resolve) => {
          const tx = db.transaction(STORE_TELEMETRY_QUEUE, 'readwrite')
          const store = tx.objectStore(STORE_TELEMETRY_QUEUE)
          for (const id of idsToRemove) {
            store.delete(id)
          }
          tx.oncomplete = () => resolve()
          tx.onerror = () => resolve()
        })
      }
    } catch (err) {
      console.warn('[OfflineStorage] Falha ao deletar pontos no IndexedDB:', err)
    }

    // Limpar também do fallback
    try {
      const fbKey = `rotaly_offline_telem_idb_fb_${userId}`
      const raw = localStorage.getItem(fbKey)
      if (raw) {
        const fbList: OfflineLocationPoint[] = JSON.parse(raw)
        const updated = fbList.filter((p) => !idSet.has(p.id))
        localStorage.setItem(fbKey, JSON.stringify(updated))
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * Conta quantos pontos estão pendentes.
   */
  async countTelemetryPoints(userId: string): Promise<number> {
    const points = await this.getTelemetryPoints(userId)
    return points.length
  }

  // -------------------------------------------------------------
  // FILA PERSISTENTE DE AÇÕES OFFLINE DE REDIRECIONAMENTO
  // -------------------------------------------------------------

  async enqueueRedirectionAction(action: OfflineRedirectionAction): Promise<void> {
    try {
      const db = await this.getDB()
      if (db) {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_DELIVERY_QUEUE, 'readwrite')
          const store = tx.objectStore(STORE_DELIVERY_QUEUE)
          const req = store.put(action)
          req.onsuccess = () => resolve()
          req.onerror = () => reject(req.error)
        })
        return
      }
    } catch (err) {
      console.warn('[OfflineStorage] Falha ao enfileirar redirecionamento no IndexedDB:', err)
    }

    try {
      const key = `rotaly_offline_redir_${action.courierId}`
      const existingRaw = localStorage.getItem(key)
      const list: OfflineRedirectionAction[] = existingRaw ? JSON.parse(existingRaw) : []
      list.push(action)
      localStorage.setItem(key, JSON.stringify(list))
    } catch {
      /* ignore */
    }
  }

  async getPendingRedirectionActions(courierId: string): Promise<OfflineRedirectionAction[]> {
    if (!courierId) return []
    let actions: OfflineRedirectionAction[] = []
    try {
      const db = await this.getDB()
      if (db) {
        actions = await new Promise<OfflineRedirectionAction[]>((resolve) => {
          const tx = db.transaction(STORE_DELIVERY_QUEUE, 'readonly')
          const store = tx.objectStore(STORE_DELIVERY_QUEUE)
          const req = store.getAll()
          req.onsuccess = () => {
            const all = (req.result || []) as OfflineRedirectionAction[]
            const filtered = all.filter((a) => a.courierId === courierId)
            filtered.sort((a, b) => a.timestamp - b.timestamp)
            resolve(filtered)
          }
          req.onerror = () => resolve([])
        })
      }
    } catch (err) {
      console.warn('[OfflineStorage] Falha ao buscar ações de redirecionamento no IndexedDB:', err)
    }

    try {
      const fbKey = `rotaly_offline_redir_${courierId}`
      const raw = localStorage.getItem(fbKey)
      if (raw) {
        const fbList: OfflineRedirectionAction[] = JSON.parse(raw)
        if (Array.isArray(fbList) && fbList.length > 0) {
          const existingIds = new Set(actions.map((a) => a.id))
          for (const item of fbList) {
            if (!existingIds.has(item.id)) actions.push(item)
          }
        }
      }
    } catch {
      /* ignore */
    }

    actions.sort((a, b) => a.timestamp - b.timestamp)
    return actions
  }

  async removeRedirectionActions(courierId: string, idsToRemove: string[]): Promise<void> {
    if (idsToRemove.length === 0) return
    const idSet = new Set(idsToRemove)
    try {
      const db = await this.getDB()
      if (db) {
        await new Promise<void>((resolve) => {
          const tx = db.transaction(STORE_DELIVERY_QUEUE, 'readwrite')
          const store = tx.objectStore(STORE_DELIVERY_QUEUE)
          for (const id of idsToRemove) {
            store.delete(id)
          }
          tx.oncomplete = () => resolve()
          tx.onerror = () => resolve()
        })
      }
    } catch (err) {
      console.warn('[OfflineStorage] Falha ao deletar ações de redirecionamento no IndexedDB:', err)
    }

    try {
      const fbKey = `rotaly_offline_redir_${courierId}`
      const raw = localStorage.getItem(fbKey)
      if (raw) {
        const fbList: OfflineRedirectionAction[] = JSON.parse(raw)
        const updated = fbList.filter((a) => !idSet.has(a.id))
        localStorage.setItem(fbKey, JSON.stringify(updated))
      }
    } catch {
      /* ignore */
    }
  }
}

export const offlineRouteStorage = new OfflineRouteStorageService()

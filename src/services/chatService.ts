/**
 * chatService.ts
 *
 * Serviço de Chat Rápido Entregador ↔ Vendedor/Base no Rotaly.
 *
 * Funcionalidades:
 * 1. Envio de mensagens em tempo real (PocketBase collection 'chat_messages').
 * 2. Suporte aos tipos kind: 'text' | 'quick_reply'.
 * 3. Envio seguro com fila offline (IndexedDB via offlineRouteStorage) caso sem conexão ou falha na rede.
 * 4. Sincronização automática (flush) quando a conexão retornar.
 * 5. Gerenciamento de status de leitura (marcar lidas ao abrir conversa).
 * 6. Contagem de mensagens não lidas reativa por usuário e por interlocutor.
 */

import pb from '@/lib/pocketbase/client'
import type {
  ChatMessageKind,
  ChatMessageRecord,
  PendingOfflineChatMessage,
  UserRecord,
} from '@/types/delivery'
import { offlineRouteStorage } from './offlineRouteStorage'

export interface SendChatMessageInput {
  senderId: string
  recipientId: string
  text: string
  kind?: ChatMessageKind
  routeBatchKey?: string
  orderId?: string
  orderCode?: string
}

export interface ConversationSummary {
  courier: UserRecord
  lastMessage: ChatMessageRecord | null
  unreadCount: number
  activeBatchKey?: string
  activeOrderCode?: string
}

class ChatService {
  private flushInProgress = false
  private unreadListeners = new Set<(totalUnread: number) => void>()

  /**
   * Identifica o destinatário padrão da base (Vendedor ou Admin da empresa).
   * O entregador conversa com a base (vendedor/admin).
   */
  async resolveBaseRecipient(courierUser: UserRecord | null): Promise<UserRecord | null> {
    try {
      // 1. Tentar achar vendedores ativos da empresa
      const sellers = await pb.collection<UserRecord>('users').getFullList({
        filter: "role = 'seller' && status = 'active'",
        sort: '-created',
        requestKey: null,
      })
      if (sellers.length > 0) {
        return sellers[0]
      }

      // 2. Se não houver seller ativo, buscar admin ou master
      const admins = await pb.collection<UserRecord>('users').getFullList({
        filter: "(role = 'admin' || role = 'master') && status = 'active'",
        sort: '-created',
        requestKey: null,
      })
      if (admins.length > 0) {
        return admins[0]
      }

      // 3. Qualquer seller cadastrado
      const anySeller = await pb.collection<UserRecord>('users').getFullList({
        filter: "role = 'seller'",
        sort: '-created',
        requestKey: null,
      })
      if (anySeller.length > 0) {
        return anySeller[0]
      }
    } catch (err) {
      console.warn('[ChatService] Erro ao resolver destinatário da base:', err)
    }
    return null
  }

  /**
   * Envia uma mensagem para o PocketBase ou enfileira no IndexedDB se offline.
   */
  async sendMessage(input: SendChatMessageInput): Promise<{
    message?: ChatMessageRecord
    queued?: PendingOfflineChatMessage
    isOffline: boolean
  }> {
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true
    const cleanText = (input.text || '').trim()
    if (!cleanText) {
      throw new Error('A mensagem não pode estar vazia.')
    }

    const payload: Partial<ChatMessageRecord> = {
      sender_id: input.senderId,
      recipient_id: input.recipientId,
      text: cleanText,
      kind: input.kind || 'text',
      route_batch_key: input.routeBatchKey || '',
      order_id: input.orderId || undefined,
      order_code: input.orderCode || '',
    }

    if (!isOnline) {
      const queuedItem: PendingOfflineChatMessage = {
        localId: `chat_off_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        sender_id: input.senderId,
        recipient_id: input.recipientId,
        text: cleanText,
        kind: input.kind || 'text',
        route_batch_key: input.routeBatchKey || '',
        order_id: input.orderId || undefined,
        order_code: input.orderCode || '',
        timestamp: Date.now(),
        status: 'queued',
      }
      await offlineRouteStorage.enqueueChatMessage(queuedItem)
      return { queued: queuedItem, isOffline: true }
    }

    try {
      const created = await pb.collection<ChatMessageRecord>('chat_messages').create(payload)
      return { message: created, isOffline: false }
    } catch (err) {
      console.warn('[ChatService] Falha ao enviar online, guardando em fila offline:', err)
      const queuedItem: PendingOfflineChatMessage = {
        localId: `chat_off_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        sender_id: input.senderId,
        recipient_id: input.recipientId,
        text: cleanText,
        kind: input.kind || 'text',
        route_batch_key: input.routeBatchKey || '',
        order_id: input.orderId || undefined,
        order_code: input.orderCode || '',
        timestamp: Date.now(),
        status: 'queued',
      }
      await offlineRouteStorage.enqueueChatMessage(queuedItem)
      return { queued: queuedItem, isOffline: true }
    }
  }

  /**
   * Sincroniza todas as mensagens offline pendentes do remetente com o servidor.
   */
  async flushOfflineQueue(senderId: string): Promise<{ sent: number; remaining: number }> {
    if (this.flushInProgress || !senderId) {
      return { sent: 0, remaining: 0 }
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      const pending = await offlineRouteStorage.getPendingChatMessages(senderId)
      return { sent: 0, remaining: pending.length }
    }

    this.flushInProgress = true
    let sentCount = 0
    const sentIds: string[] = []

    try {
      const pending = await offlineRouteStorage.getPendingChatMessages(senderId)
      if (pending.length === 0) {
        return { sent: 0, remaining: 0 }
      }

      for (const msg of pending) {
        try {
          await pb.collection<ChatMessageRecord>('chat_messages').create({
            sender_id: msg.sender_id,
            recipient_id: msg.recipient_id,
            text: msg.text,
            kind: msg.kind,
            route_batch_key: msg.route_batch_key || '',
            order_id: msg.order_id || undefined,
            order_code: msg.order_code || '',
          })
          sentIds.push(msg.localId)
          sentCount++
        } catch (e) {
          console.warn('[ChatService] Erro ao descarregar mensagem offline:', msg.localId, e)
        }
      }

      if (sentIds.length > 0) {
        await offlineRouteStorage.removeChatMessages(senderId, sentIds)
      }

      const remaining = await offlineRouteStorage.getPendingChatMessages(senderId)
      return { sent: sentCount, remaining: remaining.length }
    } finally {
      this.flushInProgress = false
    }
  }

  /**
   * Carrega histórico de conversa entre dois usuários (ou mensagens onde o usuário participa).
   */
  async getConversation(
    userId: string,
    partnerId: string,
    limit: number = 100,
  ): Promise<ChatMessageRecord[]> {
    if (!userId || !partnerId) return []

    const filter = `(sender_id = '${userId}' && recipient_id = '${partnerId}') || (sender_id = '${partnerId}' && recipient_id = '${userId}')`

    try {
      return await pb.collection<ChatMessageRecord>('chat_messages').getFullList({
        filter,
        sort: '+created',
        expand: 'sender_id,recipient_id,order_id',
        requestKey: null,
      })
    } catch (err) {
      console.warn('[ChatService] Erro ao carregar conversa:', err)
      return []
    }
  }

  /**
   * Retorna contagem de mensagens não lidas para o usuário autenticado.
   */
  async getUnreadCount(userId: string, partnerId?: string): Promise<number> {
    if (!userId) return 0
    let filter = `recipient_id = '${userId}' && (read_at = '' || read_at = null)`
    if (partnerId) {
      filter += ` && sender_id = '${partnerId}'`
    }
    try {
      const res = await pb.collection<ChatMessageRecord>('chat_messages').getList(1, 1, {
        filter,
        fields: 'id',
        requestKey: null,
      })
      return res.totalItems
    } catch (err) {
      console.warn('[ChatService] Erro ao buscar contagem de não lidas:', err)
      return 0
    }
  }

  /**
   * Marca como lidas todas as mensagens recebidas de um determinado remetente.
   */
  async markAsRead(recipientId: string, senderId: string): Promise<number> {
    if (!recipientId || !senderId) return 0
    const filter = `recipient_id = '${recipientId}' && sender_id = '${senderId}' && (read_at = '' || read_at = null)`
    try {
      const unreadList = await pb.collection<ChatMessageRecord>('chat_messages').getFullList({
        filter,
        fields: 'id',
        requestKey: null,
      })

      if (unreadList.length === 0) return 0

      const nowIso = new Date().toISOString()
      await Promise.all(
        unreadList.map((m) =>
          pb.collection('chat_messages').update(m.id, {
            read_at: nowIso,
          }),
        ),
      )

      return unreadList.length
    } catch (err) {
      console.warn('[ChatService] Erro ao marcar mensagens como lidas:', err)
      return 0
    }
  }

  /**
   * Carrega resumo de conversas ativas para o Painel do Vendedor/Admin.
   * Lista todos os entregadores com suas últimas mensagens e badges de não lidas.
   */
  async getActiveConversationsForSeller(sellerId: string): Promise<ConversationSummary[]> {
    try {
      // 1. Buscar entregadores ativos
      const couriers = await pb.collection<UserRecord>('users').getFullList({
        filter: "role = 'courier'",
        sort: 'name',
        requestKey: null,
      })

      // 2. Buscar todas as mensagens que envolvem o vendedor ou qualquer entregador
      const messages = await pb.collection<ChatMessageRecord>('chat_messages').getFullList({
        sort: '-created',
        expand: 'sender_id,recipient_id,order_id',
        requestKey: null,
      })

      const summaries: ConversationSummary[] = []

      for (const courier of couriers) {
        const courierMessages = messages.filter(
          (m) =>
            (m.sender_id === courier.id && m.recipient_id === sellerId) ||
            (m.sender_id === sellerId && m.recipient_id === courier.id) ||
            m.sender_id === courier.id, // Fallback se enviou para outro admin
        )

        const unreadCount = courierMessages.filter(
          (m) => m.sender_id === courier.id && (!m.read_at || m.read_at === ''),
        ).length

        const lastMsg = courierMessages.length > 0 ? courierMessages[0] : null
        const activeBatch = courierMessages.find((m) => !!m.route_batch_key)?.route_batch_key
        const activeOrderCode = courierMessages.find((m) => !!m.order_code)?.order_code

        summaries.push({
          courier,
          lastMessage: lastMsg,
          unreadCount,
          activeBatchKey: activeBatch,
          activeOrderCode,
        })
      }

      // Ordenar: primeiro os que têm mensagens não lidas, depois pelo timestamp da última mensagem
      summaries.sort((a, b) => {
        if (a.unreadCount > 0 && b.unreadCount === 0) return -1
        if (a.unreadCount === 0 && b.unreadCount > 0) return 1
        const timeA = a.lastMessage?.created ? new Date(a.lastMessage.created).getTime() : 0
        const timeB = b.lastMessage?.created ? new Date(b.lastMessage.created).getTime() : 0
        return timeB - timeA
      })

      return summaries
    } catch (err) {
      console.warn('[ChatService] Erro ao carregar conversas do vendedor:', err)
      return []
    }
  }
}

export const chatService = new ChatService()

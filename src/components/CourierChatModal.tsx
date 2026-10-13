import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  X,
  Send,
  MessageCircle,
  Phone,
  UserX,
  AlertOctagon,
  PhoneCall,
  PhoneOff,
  Clock,
  WifiOff,
  Check,
  CheckCheck,
  Info,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { chatService } from '@/services/chatService'
import { offlineRouteStorage } from '@/services/offlineRouteStorage'
import { useRealtime } from '@/hooks/use-realtime'
import type {
  ChatMessageRecord,
  OrderRecord,
  PendingOfflineChatMessage,
  UserRecord,
} from '@/types/delivery'
import { toast } from 'sonner'

export interface CourierChatModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentUser: UserRecord
  currentActiveDelivery?: OrderRecord | null
  currentRouteBatchKey?: string
}

export const CourierChatModal: React.FC<CourierChatModalProps> = ({
  open,
  onOpenChange,
  currentUser,
  currentActiveDelivery,
  currentRouteBatchKey,
}) => {
  const [messages, setMessages] = useState<ChatMessageRecord[]>([])
  const [offlinePending, setOfflinePending] = useState<PendingOfflineChatMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [baseRecipient, setBaseRecipient] = useState<UserRecord | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Cliente atual para ligação telefônica de 1 clique
  const customerPhone = currentActiveDelivery?.expand?.customer_id?.phone
  const customerName = currentActiveDelivery?.expand?.customer_id?.name || 'Cliente'

  // Resolver a base (vendedor/admin)
  useEffect(() => {
    if (open && currentUser?.id) {
      chatService.resolveBaseRecipient(currentUser).then((res) => {
        setBaseRecipient(res)
      })
    }
  }, [open, currentUser])

  // Carregar histórico de mensagens e pendências offline
  const loadConversation = async () => {
    if (!currentUser?.id || !baseRecipient?.id) return
    setIsLoading(true)
    try {
      const list = await chatService.getConversation(currentUser.id, baseRecipient.id)
      setMessages(list)

      const pending = await offlineRouteStorage.getPendingChatMessages(currentUser.id)
      setOfflinePending(pending)

      // Marcar como lida
      await chatService.markAsRead(currentUser.id, baseRecipient.id)
    } catch (err) {
      console.warn('[CourierChatModal] Erro ao carregar conversa:', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (open && baseRecipient?.id) {
      loadConversation()
    }
  }, [open, baseRecipient?.id])

  // Realtime hook nas mensagens
  useRealtime<ChatMessageRecord>(
    'chat_messages',
    (e) => {
      if (!open || !currentUser?.id) return
      if (e.action === 'create') {
        const rec = e.record
        if (
          (rec.sender_id === currentUser.id && rec.recipient_id === baseRecipient?.id) ||
          (rec.sender_id === baseRecipient?.id && rec.recipient_id === currentUser.id)
        ) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === rec.id)) return prev
            return [...prev, rec]
          })
          // Se recebida da base enquanto o modal está aberto, marcar como lida imediatamente
          if (rec.recipient_id === currentUser.id) {
            chatService.markAsRead(currentUser.id, rec.sender_id).catch(() => {})
          }
        }
      }
    },
    open && !!baseRecipient?.id,
  )

  // Rolar para o final ao receber mensagens
  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, offlinePending, open])

  // Ouvir volta da conexão para dar flush
  useEffect(() => {
    const handleOnline = async () => {
      if (currentUser?.id) {
        const res = await chatService.flushOfflineQueue(currentUser.id)
        if (res.sent > 0) {
          toast.success(`📶 Conexão restabelecida! ${res.sent} mensagem(ns) enviada(s).`)
          loadConversation()
        }
      }
    }

    window.addEventListener('online', handleOnline)
    return () => {
      window.removeEventListener('online', handleOnline)
    }
  }, [currentUser?.id, baseRecipient?.id])

  // Enviar mensagem
  const handleSend = async (textToSend: string, kind: 'text' | 'quick_reply' = 'text') => {
    const cleanText = textToSend.trim()
    if (!cleanText || !currentUser?.id) return

    // Se baseRecipient ainda não carregou, buscar fallback de emergência
    let recipientId = baseRecipient?.id
    if (!recipientId) {
      const found = await chatService.resolveBaseRecipient(currentUser)
      if (found) {
        setBaseRecipient(found)
        recipientId = found.id
      }
    }

    if (!recipientId) {
      toast.error('Base ou vendedor de suporte não disponível no momento.')
      return
    }

    setIsSending(true)
    try {
      const res = await chatService.sendMessage({
        senderId: currentUser.id,
        recipientId,
        text: cleanText,
        kind,
        routeBatchKey: currentRouteBatchKey || undefined,
        orderId: currentActiveDelivery?.id,
        orderCode: currentActiveDelivery?.tracking_code,
      })

      if (res.isOffline && res.queued) {
        setOfflinePending((prev) => [...prev, res.queued!])
        toast.info('Mensagem guardada na fila offline. Será enviada ao restabelecer sinal.')
      } else if (res.message) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === res.message!.id)) return prev
          return [...prev, res.message!]
        })
      }
      setInputText('')
    } catch (err) {
      console.warn('Erro ao enviar mensagem:', err)
      toast.error('Não foi possível enviar a mensagem agora.')
    } finally {
      setIsSending(false)
    }
  }

  // Ação especial para "Ligar para o cliente"
  const handleCallCustomerAction = () => {
    // 1. Grava no chat como quick_reply
    handleSend('Ligar para o cliente', 'quick_reply')

    // 2. Oferece ação de ligar para o telefone do cliente do pedido atual
    if (customerPhone) {
      toast.info(`Discando para ${customerName} (${customerPhone})...`, {
        description: 'Toque para confirmar a chamada caso o discador não abra automaticamente.',
        action: {
          label: 'Ligar Agora',
          onClick: () => {
            window.location.href = `tel:${customerPhone}`
          },
        },
        duration: 8000,
      })
      // Disparo do protocolo tel:
      setTimeout(() => {
        window.location.href = `tel:${customerPhone}`
      }, 200)
    } else {
      toast.warning('O pedido atual não possui telefone de cliente cadastrado.')
    }
  }

  // Lista unificada ordenada para exibição
  const allDisplayMessages = useMemo(() => {
    const list: Array<
      | { type: 'online'; data: ChatMessageRecord }
      | { type: 'offline'; data: PendingOfflineChatMessage }
    > = []

    for (const m of messages) {
      list.push({ type: 'online', data: m })
    }
    for (const off of offlinePending) {
      list.push({ type: 'offline', data: off })
    }

    list.sort((a, b) => {
      const timeA = a.type === 'online' ? new Date(a.data.created || 0).getTime() : a.data.timestamp
      const timeB = b.type === 'online' ? new Date(b.data.created || 0).getTime() : b.data.timestamp
      return timeA - timeB
    })

    return list
  }, [messages, offlinePending])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-[95vw] p-0 gap-0 bg-[#0A1128] border-[#1E2B58] text-white flex flex-col h-[85vh] max-h-[720px] rounded-2xl overflow-hidden shadow-2xl">
        {/* Header do Chat */}
        <DialogHeader className="p-3.5 bg-gradient-to-r from-[#002855] to-[#0A1128] border-b border-[#1E2B58] flex flex-row items-center justify-between space-y-0 text-left">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="relative">
              <div className="h-10 w-10 rounded-full bg-[#00A3FF]/20 border border-[#00A3FF]/40 flex items-center justify-center text-[#00A3FF]">
                <MessageCircle className="h-5 w-5" />
              </div>
              <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-[#0A1128]" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-sm font-black font-heading text-white truncate flex items-center gap-1.5">
                <span>Chat Rápido com a Base</span>
                <span className="text-[10px] font-mono font-normal px-1.5 py-0.2 rounded bg-[#00A3FF]/20 text-[#00A3FF] border border-[#00A3FF]/30">
                  Rotaly
                </span>
              </DialogTitle>
              <DialogDescription className="text-[11px] text-slate-300 truncate">
                {baseRecipient?.name
                  ? `Suporte: ${baseRecipient.name} (${baseRecipient.role === 'admin' ? 'Admin' : 'Vendedor'})`
                  : 'Central da Loja / Vendedor'}
              </DialogDescription>
            </div>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            className="h-8 w-8 text-slate-400 hover:text-white hover:bg-white/10 rounded-full"
          >
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>

        {/* Contexto da Parada Atual (fixo no topo) */}
        {currentActiveDelivery && (
          <div className="bg-[#0E1738] border-b border-[#1E2B58] px-3.5 py-2 flex items-center justify-between text-xs text-slate-300">
            <div className="flex items-center gap-2 min-w-0">
              <span className="h-5 px-1.5 rounded bg-blue-500/20 text-[#60A5FA] border border-blue-500/30 font-bold text-[10px] flex items-center shrink-0">
                Parada #{currentActiveDelivery.sequence || 1}
              </span>
              <span className="truncate font-medium text-slate-200">
                {currentActiveDelivery.expand?.customer_id?.name || 'Cliente da Parada'}
              </span>
              <span className="text-[10px] font-mono text-slate-400 shrink-0">
                ({currentActiveDelivery.tracking_code})
              </span>
            </div>

            {customerPhone && (
              <a
                href={`tel:${customerPhone}`}
                className="shrink-0 flex items-center gap-1 text-[11px] font-bold text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 px-2 py-0.5 rounded-md transition"
                title={`Ligar para ${customerPhone}`}
              >
                <Phone className="h-3 w-3" />
                <span className="hidden sm:inline">Ligar</span>
              </a>
            )}
          </div>
        )}

        {/* Área de Mensagens */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-3 bg-[#070D1E]/60">
          {isLoading && messages.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              Carregando conversa com a base...
            </div>
          ) : allDisplayMessages.length === 0 ? (
            <div className="py-10 text-center space-y-2 text-slate-400">
              <div className="h-10 w-10 mx-auto rounded-full bg-[#121E46] flex items-center justify-center text-[#00A3FF]">
                <MessageCircle className="h-5 w-5" />
              </div>
              <p className="text-xs font-semibold text-slate-300">Nenhuma mensagem ainda.</p>
              <p className="text-[11px] max-w-[260px] mx-auto text-slate-400">
                Use os botões de resposta rápida abaixo para avisar a base em 1 toque ou digite uma
                mensagem livre.
              </p>
            </div>
          ) : (
            allDisplayMessages.map((item, idx) => {
              const isMine =
                item.type === 'offline'
                  ? item.data.sender_id === currentUser.id
                  : item.data.sender_id === currentUser.id

              const isOfflineQueued = item.type === 'offline'
              const isQuick =
                item.type === 'offline'
                  ? item.data.kind === 'quick_reply'
                  : item.data.kind === 'quick_reply'

              const text = item.data.text
              const orderCode =
                item.type === 'offline' ? item.data.order_code : item.data.order_code

              const timeStr =
                item.type === 'offline'
                  ? new Intl.DateTimeFormat('pt-BR', {
                      timeZone: 'America/Sao_Paulo',
                      hour: '2-digit',
                      minute: '2-digit',
                    }).format(new Date(item.data.timestamp))
                  : new Intl.DateTimeFormat('pt-BR', {
                      timeZone: 'America/Sao_Paulo',
                      hour: '2-digit',
                      minute: '2-digit',
                    }).format(new Date(item.data.created || 0))

              const isRead =
                item.type === 'online' && item.data.read_at && item.data.read_at.trim() !== ''

              return (
                <div
                  key={item.type === 'offline' ? item.data.localId : item.data.id}
                  className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs shadow-md transition-all ${
                      isMine
                        ? isQuick
                          ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-br-xs border border-cyan-400/30'
                          : 'bg-gradient-to-r from-[#0052CC] to-[#0066FF] text-white rounded-br-xs border border-blue-400/20'
                        : 'bg-[#121E46] text-slate-100 rounded-bl-xs border border-[#1E2B58]'
                    }`}
                  >
                    {/* Badge de Resposta Rápida */}
                    {isQuick && (
                      <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-cyan-200 mb-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
                        <span>Resposta Rápida</span>
                      </div>
                    )}

                    {/* Contexto do pedido na bolha se houver */}
                    {orderCode && (
                      <div className="text-[10px] font-mono text-cyan-100/80 mb-1 bg-black/20 px-1.5 py-0.5 rounded w-fit">
                        Ref: {orderCode}
                      </div>
                    )}

                    <p className="text-xs leading-relaxed whitespace-pre-wrap break-words">
                      {text}
                    </p>

                    {/* Rodapé da bolha: hora e status de entrega / fila */}
                    <div className="flex items-center justify-end gap-1.5 mt-1 pt-0.5 text-[10px] text-white/70 font-mono">
                      <span>{timeStr}</span>

                      {isMine && (
                        <>
                          {isOfflineQueued ? (
                            <span
                              className="inline-flex items-center gap-0.5 text-amber-300 font-sans font-bold"
                              title="Sem sinal: guardado em fila offline"
                            >
                              <WifiOff className="h-3 w-3" />
                              <span>Fila offline</span>
                            </span>
                          ) : isRead ? (
                            <span title="Lida pela base">
                              <CheckCheck className="h-3 w-3 text-cyan-300" />
                            </span>
                          ) : (
                            <span title="Enviada à base">
                              <Check className="h-3 w-3 text-white/70" />
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* BARRA DE RESPOSTAS RÁPIDAS (EXATAMENTE OS 4 BOTÕES DE 1 CLIQUE) */}
        <div className="bg-[#0E1738] border-t border-[#1E2B58] p-2.5">
          <div className="flex items-center justify-between mb-1.5 px-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#00A3FF] flex items-center gap-1 font-heading">
              <span>⚡ Respostas Rápidas (1 Toque)</span>
            </span>
            <span className="text-[10px] text-slate-400 hidden sm:inline">
              Envia imediatamente com o contexto da parada
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {/* 1. Cliente ausente */}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isSending}
              onClick={() => handleSend('Cliente ausente', 'quick_reply')}
              className="h-10 text-[11px] font-bold bg-[#121E46] hover:bg-[#1A2C66] text-amber-300 border-amber-500/30 rounded-xl justify-start px-2.5 gap-2 shadow-xs"
            >
              <UserX className="h-4 w-4 text-amber-400 shrink-0" />
              <span className="truncate">Cliente ausente</span>
            </Button>

            {/* 2. Pedido errado */}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isSending}
              onClick={() => handleSend('Pedido errado', 'quick_reply')}
              className="h-10 text-[11px] font-bold bg-[#121E46] hover:bg-[#1A2C66] text-rose-300 border-rose-500/30 rounded-xl justify-start px-2.5 gap-2 shadow-xs"
            >
              <AlertOctagon className="h-4 w-4 text-rose-400 shrink-0" />
              <span className="truncate">Pedido errado</span>
            </Button>

            {/* 3. Ligar para o cliente (Grava quick_reply + aciona chamada telefônica do cliente do pedido atual) */}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isSending}
              onClick={handleCallCustomerAction}
              className="h-10 text-[11px] font-bold bg-gradient-to-r from-emerald-950/70 to-[#121E46] hover:bg-emerald-900/50 text-emerald-300 border-emerald-500/40 rounded-xl justify-start px-2.5 gap-2 shadow-xs"
            >
              <PhoneCall className="h-4 w-4 text-emerald-400 shrink-0 animate-pulse" />
              <span className="truncate">Ligar para o cliente</span>
            </Button>

            {/* 4. Não consigo falar com cliente */}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isSending}
              onClick={() => handleSend('Não consigo falar com cliente', 'quick_reply')}
              className="h-10 text-[11px] font-bold bg-[#121E46] hover:bg-[#1A2C66] text-orange-300 border-orange-500/30 rounded-xl justify-start px-2.5 gap-2 shadow-xs"
            >
              <PhoneOff className="h-4 w-4 text-orange-400 shrink-0" />
              <span className="truncate">Não consigo falar com cliente</span>
            </Button>
          </div>
        </div>

        {/* CAMPO DE TEXTO LIVRE */}
        <div className="p-3 bg-[#0A1128] border-t border-[#1E2B58]">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleSend(inputText, 'text')
            }}
            className="flex items-center gap-2"
          >
            <Input
              type="text"
              placeholder="Digite sua mensagem para a base..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={isSending}
              className="h-11 text-xs bg-[#0E1738] border-[#1E2B58] text-white placeholder:text-slate-500 rounded-xl focus:border-[#00A3FF]"
            />
            <Button
              type="submit"
              disabled={isSending || !inputText.trim()}
              className="h-11 w-11 shrink-0 bg-[#00A3FF] hover:bg-[#008CE0] text-white rounded-xl shadow-md flex items-center justify-center p-0 disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}

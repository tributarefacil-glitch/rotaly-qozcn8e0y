import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  MessageCircle,
  X,
  Send,
  Search,
  User,
  Truck,
  Check,
  CheckCheck,
  Phone,
  Clock,
  Sparkles,
  MapPin,
  RefreshCw,
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
import { chatService, type ConversationSummary } from '@/services/chatService'
import { useRealtime } from '@/hooks/use-realtime'
import type { ChatMessageRecord, UserRecord } from '@/types/delivery'
import { toast } from 'sonner'

export interface SellerChatPanelModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentSeller: UserRecord
  initialCourierId?: string
}

export const SellerChatPanelModal: React.FC<SellerChatPanelModalProps> = ({
  open,
  onOpenChange,
  currentSeller,
  initialCourierId,
}) => {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [selectedCourier, setSelectedCourier] = useState<UserRecord | null>(null)
  const [messages, setMessages] = useState<ChatMessageRecord[]>([])
  const [inputText, setInputText] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [isLoadingList, setIsLoadingList] = useState(false)
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Carregar lista de conversas
  const loadConversations = async () => {
    if (!currentSeller?.id) return
    setIsLoadingList(true)
    try {
      const data = await chatService.getActiveConversationsForSeller(currentSeller.id)
      setConversations(data)

      // Se há initialCourierId ou nenhum selecionado ainda
      if (initialCourierId) {
        const found = data.find((c) => c.courier.id === initialCourierId)
        if (found) {
          setSelectedCourier(found.courier)
        }
      } else if (!selectedCourier && data.length > 0) {
        setSelectedCourier(data[0].courier)
      }
    } catch (err) {
      console.warn('[SellerChatPanelModal] Erro ao carregar conversas:', err)
    } finally {
      setIsLoadingList(false)
    }
  }

  // Carregar mensagens da conversa selecionada
  const loadMessages = async (courierId: string) => {
    if (!currentSeller?.id || !courierId) return
    setIsLoadingMessages(true)
    try {
      const msgs = await chatService.getConversation(currentSeller.id, courierId)
      setMessages(msgs)

      // Marcar como lida
      await chatService.markAsRead(currentSeller.id, courierId)

      // Atualizar badge local na lista
      setConversations((prev) =>
        prev.map((c) => (c.courier.id === courierId ? { ...c, unreadCount: 0 } : c)),
      )
    } catch (err) {
      console.warn('[SellerChatPanelModal] Erro ao carregar mensagens:', err)
    } finally {
      setIsLoadingMessages(false)
    }
  }

  useEffect(() => {
    if (open && currentSeller?.id) {
      loadConversations()
    }
  }, [open, currentSeller?.id])

  useEffect(() => {
    if (open && selectedCourier?.id) {
      loadMessages(selectedCourier.id)
    }
  }, [open, selectedCourier?.id])

  // Realtime subscription para atualizar em tempo real
  useRealtime<ChatMessageRecord>(
    'chat_messages',
    (e) => {
      if (!open || !currentSeller?.id) return
      if (e.action === 'create') {
        const rec = e.record
        // Se a mensagem pertence à conversa atual
        if (
          selectedCourier &&
          ((rec.sender_id === selectedCourier.id && rec.recipient_id === currentSeller.id) ||
            (rec.sender_id === currentSeller.id && rec.recipient_id === selectedCourier.id))
        ) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === rec.id)) return prev
            return [...prev, rec]
          })
          if (rec.recipient_id === currentSeller.id) {
            chatService.markAsRead(currentSeller.id, rec.sender_id).catch(() => {})
          }
        }

        // Atualizar lista de conversas
        loadConversations()
      }
    },
    open && !!currentSeller?.id,
  )

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Enviar mensagem como vendedor/admin para o entregador selecionado
  const handleSend = async () => {
    const cleanText = inputText.trim()
    if (!cleanText || !currentSeller?.id || !selectedCourier?.id) return

    setIsSending(true)
    try {
      const res = await chatService.sendMessage({
        senderId: currentSeller.id,
        recipientId: selectedCourier.id,
        text: cleanText,
        kind: 'text',
      })

      if (res.message) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === res.message!.id)) return prev
          return [...prev, res.message!]
        })
      }
      setInputText('')
      loadConversations()
    } catch (err) {
      console.warn('Erro ao enviar resposta do vendedor:', err)
      toast.error('Não foi possível enviar a resposta agora.')
    } finally {
      setIsSending(false)
    }
  }

  // Filtragem de entregadores por busca
  const filteredConversations = useMemo(() => {
    if (!searchTerm.trim()) return conversations
    const term = searchTerm.toLowerCase()
    return conversations.filter(
      (c) =>
        c.courier.name?.toLowerCase().includes(term) ||
        c.courier.email?.toLowerCase().includes(term) ||
        c.courier.phone?.includes(term),
    )
  }, [conversations, searchTerm])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw] p-0 gap-0 bg-[#0A1128] border-[#1E2B58] text-white flex flex-col h-[85vh] max-h-[780px] rounded-2xl overflow-hidden shadow-2xl">
        {/* Header Geral do Painel de Chat */}
        <DialogHeader className="p-3.5 sm:p-4 bg-gradient-to-r from-[#002855] to-[#0A1128] border-b border-[#1E2B58] flex flex-row items-center justify-between space-y-0 text-left">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-[#00A3FF]/20 border border-[#00A3FF]/30 flex items-center justify-center text-[#00A3FF]">
              <MessageCircle className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-black font-heading text-white flex items-center gap-2">
                <span>Central de Chat Rápido: Base ↔ Entregadores</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Tempo Real
                </span>
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-300">
                Respostas rápidas recebidas, contexto de parada da rota e envio direto de mensagens
              </DialogDescription>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={loadConversations}
              className="h-8 text-xs bg-[#121E46] border-[#1E2B58] text-slate-300 hover:text-white"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              className="h-8 w-8 text-slate-400 hover:text-white hover:bg-white/10 rounded-full"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        {/* Layout Dividido: Lista à Esquerda | Conversa Ativa à Direita */}
        <div className="flex-1 flex flex-col sm:flex-row min-h-0 overflow-hidden">
          {/* Lado Esquerdo: Lista de Entregadores */}
          <aside className="w-full sm:w-80 border-b sm:border-b-0 sm:border-r border-[#1E2B58] bg-[#070D1E]/90 flex flex-col shrink-0 max-h-[35%] sm:max-h-full">
            <div className="p-2.5 border-b border-[#1E2B58]">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <Input
                  type="text"
                  placeholder="Buscar entregador..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-8 pl-8 text-xs bg-[#0E1738] border-[#1E2B58] text-white placeholder:text-slate-500 rounded-lg"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-[#1E2B58]/40">
              {isLoadingList && conversations.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-400">Carregando frotas...</div>
              ) : filteredConversations.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-400">
                  Nenhum entregador encontrado.
                </div>
              ) : (
                filteredConversations.map((item) => {
                  const isSelected = selectedCourier?.id === item.courier.id
                  const hasUnread = item.unreadCount > 0
                  const isQuick = item.lastMessage?.kind === 'quick_reply'

                  return (
                    <button
                      key={item.courier.id}
                      type="button"
                      onClick={() => {
                        setSelectedCourier(item.courier)
                      }}
                      className={`w-full text-left p-3 transition flex items-start gap-2.5 cursor-pointer ${
                        isSelected
                          ? 'bg-[#121E46] border-l-4 border-l-[#00A3FF]'
                          : 'hover:bg-[#0E1738]'
                      }`}
                    >
                      <div className="relative shrink-0">
                        <div className="h-9 w-9 rounded-full bg-[#002855] border border-[#1E2B58] flex items-center justify-center text-xs font-bold text-white">
                          {item.courier.name ? item.courier.name.slice(0, 2).toUpperCase() : 'EN'}
                        </div>
                        {hasUnread && (
                          <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 text-[9px] font-black text-white px-1 shadow-sm">
                            {item.unreadCount}
                          </span>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <p className="text-xs font-bold text-white truncate">
                            {item.courier.name || 'Entregador'}
                          </p>
                          {item.lastMessage?.created && (
                            <span className="text-[10px] text-slate-400 font-mono shrink-0">
                              {new Intl.DateTimeFormat('pt-BR', {
                                timeZone: 'America/Sao_Paulo',
                                hour: '2-digit',
                                minute: '2-digit',
                              }).format(new Date(item.lastMessage.created))}
                            </span>
                          )}
                        </div>

                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-300 truncate">
                          {isQuick && (
                            <span className="inline-block px-1 rounded bg-cyan-500/20 text-cyan-300 font-bold text-[9px]">
                              Rápida
                            </span>
                          )}
                          <span className="truncate">
                            {item.lastMessage?.text || 'Sem mensagens'}
                          </span>
                        </div>

                        {/* Indicador de parada/lote ativo */}
                        {(item.activeOrderCode || item.activeBatchKey) && (
                          <div className="mt-1 flex items-center gap-1 text-[10px] font-mono text-blue-300">
                            <MapPin className="h-3 w-3 text-[#00A3FF] shrink-0" />
                            <span className="truncate">
                              {item.activeOrderCode ? `Ref: ${item.activeOrderCode}` : ''}
                              {item.activeBatchKey ? ` • Lote: ${item.activeBatchKey}` : ''}
                            </span>
                          </div>
                        )}
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </aside>

          {/* Lado Direito: Conversa do Entregador Selecionado */}
          <main className="flex-1 flex flex-col min-h-0 bg-[#0A1128]">
            {selectedCourier ? (
              <>
                {/* Header da conversa selecionada */}
                <div className="p-3 bg-[#0E1738] border-b border-[#1E2B58] flex items-center justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="h-9 w-9 rounded-full bg-[#0052CC] text-white flex items-center justify-center font-bold text-xs shrink-0">
                      {selectedCourier.name ? selectedCourier.name.slice(0, 2).toUpperCase() : 'EN'}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate flex items-center gap-2">
                        <span>{selectedCourier.name || 'Entregador'}</span>
                        <span className="text-[10px] font-normal text-slate-400">
                          ({selectedCourier.vehicle_type || 'Moto'} •{' '}
                          {selectedCourier.vehicle_plate || 'Sem placa'})
                        </span>
                      </p>
                      {selectedCourier.phone && (
                        <p className="text-[11px] text-slate-400 font-mono flex items-center gap-1 mt-0.5">
                          <Phone className="h-3 w-3 text-emerald-400" />
                          <a href={`tel:${selectedCourier.phone}`} className="hover:underline">
                            {selectedCourier.phone}
                          </a>
                        </p>
                      )}
                    </div>
                  </div>

                  <Badge
                    variant="outline"
                    className="border-blue-400/30 text-[#60A5FA] bg-blue-500/10 text-[10px]"
                  >
                    Canal Direto
                  </Badge>
                </div>

                {/* Área de mensagens */}
                <div className="flex-1 overflow-y-auto p-3.5 space-y-3 bg-[#070D1E]/40">
                  {isLoadingMessages && messages.length === 0 ? (
                    <div className="py-12 text-center text-xs text-slate-400">
                      Carregando conversa...
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="py-12 text-center text-xs text-slate-400 space-y-2">
                      <p className="font-semibold text-slate-300">
                        Nenhuma mensagem com este entregador.
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Envie uma mensagem abaixo para abrir o canal direto com o entregador.
                      </p>
                    </div>
                  ) : (
                    messages.map((m) => {
                      const isFromSeller = m.sender_id === currentSeller.id
                      const isQuick = m.kind === 'quick_reply'
                      const isRead = !!m.read_at && m.read_at.trim() !== ''
                      const timeStr = new Intl.DateTimeFormat('pt-BR', {
                        timeZone: 'America/Sao_Paulo',
                        hour: '2-digit',
                        minute: '2-digit',
                      }).format(new Date(m.created || 0))

                      return (
                        <div
                          key={m.id}
                          className={`flex flex-col ${isFromSeller ? 'items-end' : 'items-start'}`}
                        >
                          <div
                            className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs shadow-md ${
                              isFromSeller
                                ? 'bg-gradient-to-r from-[#0052CC] to-[#0066FF] text-white rounded-br-xs border border-blue-400/20'
                                : isQuick
                                  ? 'bg-[#121E46] text-white rounded-bl-xs border border-cyan-500/40 shadow-cyan-950/40'
                                  : 'bg-[#121E46] text-slate-100 rounded-bl-xs border border-[#1E2B58]'
                            }`}
                          >
                            {/* Destaque contextual de Resposta Rápida do Entregador */}
                            {!isFromSeller && isQuick && (
                              <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-cyan-300 mb-1">
                                <Sparkles className="h-3 w-3" />
                                <span>Resposta Rápida do Entregador</span>
                              </div>
                            )}

                            {/* Contexto da parada anexado na mensagem do entregador */}
                            {!isFromSeller && (m.order_code || m.route_batch_key) && (
                              <div className="text-[10px] font-mono text-cyan-200/90 mb-1.5 bg-[#070D1E] px-2 py-0.5 rounded border border-cyan-500/20 flex items-center gap-2">
                                <MapPin className="h-3 w-3 text-cyan-400" />
                                <span>
                                  {m.order_code ? `Pedido: ${m.order_code}` : ''}
                                  {m.route_batch_key ? ` • Lote: ${m.route_batch_key}` : ''}
                                </span>
                              </div>
                            )}

                            <p className="text-xs leading-relaxed whitespace-pre-wrap break-words">
                              {m.text}
                            </p>

                            <div className="flex items-center justify-end gap-1.5 mt-1 pt-0.5 text-[10px] text-white/70 font-mono">
                              <span>{timeStr}</span>
                              {isFromSeller && (
                                <>
                                  {isRead ? (
                                    <span title="Lida pelo entregador">
                                      <CheckCheck className="h-3 w-3 text-cyan-300" />
                                    </span>
                                  ) : (
                                    <span title="Enviada ao entregador">
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

                {/* Input de envio da resposta */}
                <div className="p-3 bg-[#0A1128] border-t border-[#1E2B58]">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      handleSend()
                    }}
                    className="flex items-center gap-2"
                  >
                    <Input
                      type="text"
                      placeholder={`Responder a ${selectedCourier.name || 'entregador'}...`}
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      disabled={isSending}
                      className="h-11 text-xs bg-[#0E1738] border-[#1E2B58] text-white placeholder:text-slate-500 rounded-xl focus:border-[#00A3FF]"
                    />
                    <Button
                      type="submit"
                      disabled={isSending || !inputText.trim()}
                      className="h-11 px-4 bg-[#00A3FF] hover:bg-[#008CE0] text-white font-bold text-xs rounded-xl shadow-md flex items-center gap-1.5 disabled:opacity-40"
                    >
                      <Send className="h-4 w-4" />
                      <span className="hidden sm:inline">Responder</span>
                    </Button>
                  </form>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-400 space-y-2">
                <Truck className="h-10 w-10 text-slate-600" />
                <p className="text-xs font-semibold text-slate-300">
                  Selecione um entregador à esquerda
                </p>
                <p className="text-[11px] text-slate-500">
                  Veja as mensagens da rota e envie respostas em tempo real.
                </p>
              </div>
            )}
          </main>
        </div>
      </DialogContent>
    </Dialog>
  )
}

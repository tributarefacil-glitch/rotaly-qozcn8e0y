import React, { useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  MessageSquare,
  Clock,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { OrderRecord } from '@/types/delivery'
import { normalizeWhatsAppPhone, buildTrackingWhatsAppUrl } from '@/lib/whatsappTracking'
import { WhatsAppTrackingPromptModal } from '@/components/WhatsAppTrackingPromptModal'
import { deliveryService } from '@/services/deliveryService'
import { toast } from '@/hooks/use-toast'

export interface PendingTrackingOrdersSectionProps {
  orders: OrderRecord[]
  title?: string
  description?: string
  onOrderUpdated?: () => void
  currentUserId?: string
  isAdminView?: boolean
}

export const PendingTrackingOrdersSection: React.FC<PendingTrackingOrdersSectionProps> = ({
  orders,
  title = 'Rastreamentos Pendentes de Envio',
  description = 'Pedidos recentes aguardando envio do link de rastreamento ao cliente via WhatsApp.',
  onOrderUpdated,
  currentUserId,
  isAdminView = false,
}) => {
  const [selectedOrderForWa, setSelectedOrderForWa] = useState<{
    order: OrderRecord
    customerName: string
    customerPhone: string | null
  } | null>(null)
  const [isExpanded, setIsExpanded] = useState(true)
  const [markingId, setMarkingId] = useState<string | null>(null)

  // Filtrar pedidos pendentes:
  // 1. Não cancelados
  // 2. Sem tracking_link_sent_at
  // 3. Dos últimos 30 dias (corte sensato da regra do usuário)
  // 4. Se não for admin, filtrar pelo vendedor atual se currentUserId fornecido
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000

  const pendingOrders = orders.filter((o) => {
    if (o.status === 'cancelled') return false
    if (o.tracking_link_sent_at) return false

    // Corte temporal: últimos 30 dias
    const orderDate = o.created ? new Date(o.created).getTime() : 0
    if (orderDate && orderDate < thirtyDaysAgo) return false

    if (!isAdminView && currentUserId && o.seller_id && o.seller_id !== currentUserId) {
      return false
    }

    return true
  })

  const handleQuickMarkSent = async (order: OrderRecord, e: React.MouseEvent) => {
    e.stopPropagation()
    setMarkingId(order.id)
    try {
      await deliveryService.markTrackingLinkSent(order.id)
      toast({
        title: 'Envio registrado!',
        description: `Link do pedido ${order.tracking_code} marcado como enviado.`,
      })
      onOrderUpdated?.()
    } catch (err) {
      console.error('[PendingTrackingOrdersSection] Erro ao registrar envio:', err)
      toast({
        title: 'Erro ao registrar envio',
        description: 'Tente novamente.',
        variant: 'destructive',
      })
    } finally {
      setMarkingId(null)
    }
  }

  const handleOpenPrompt = (order: OrderRecord) => {
    const cust = order.expand?.customer_id
    const customerName = cust?.name || order.end_address_name || 'Cliente'
    const customerPhone = cust?.phone || cust?.phone2 || null

    setSelectedOrderForWa({
      order,
      customerName,
      customerPhone,
    })
  }

  const handleDirectWhatsApp = (order: OrderRecord, e: React.MouseEvent) => {
    e.stopPropagation()
    const cust = order.expand?.customer_id
    const customerName = cust?.name || order.end_address_name || 'Cliente'
    const customerPhone = cust?.phone || cust?.phone2 || null

    const waUrl = buildTrackingWhatsAppUrl(customerPhone, {
      customerName,
      trackingCode: order.tracking_code,
      estimatedArrival: order.estimated_arrival,
      includeEta: Boolean(order.estimated_arrival),
    })

    if (waUrl) {
      window.open(waUrl, '_blank', 'noopener,noreferrer')
      handleOpenPrompt(order)
    } else {
      handleOpenPrompt(order)
    }
  }

  if (pendingOrders.length === 0) {
    return null
  }

  return (
    <>
      <Card className="border-amber-200 bg-amber-50/40 text-slate-900 shadow-sm rounded-2xl overflow-hidden mb-6">
        <CardHeader className="p-4 sm:p-5 pb-2 sm:pb-3 bg-gradient-to-r from-amber-50 to-orange-50 border-b border-amber-100/80">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-sm">
                <MessageSquare className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-sm sm:text-base font-bold text-slate-900 font-heading flex items-center gap-2">
                  <span>{title}</span>
                  <Badge
                    variant="outline"
                    className="bg-amber-100 text-amber-800 border-amber-300 font-bold text-xs px-2 py-0.5"
                  >
                    {pendingOrders.length}
                  </Badge>
                </CardTitle>
                <p className="text-xs text-slate-600 mt-0.5">{description}</p>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded((prev) => !prev)}
              className="text-slate-600 hover:text-slate-900 hover:bg-amber-100/60 h-8 px-2"
            >
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </CardHeader>

        {isExpanded && (
          <CardContent className="p-4 sm:p-5 pt-3 space-y-2.5">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {pendingOrders.map((order) => {
                const cust = order.expand?.customer_id
                const customerName = cust?.name || order.end_address_name || 'Cliente'
                const rawPhone = cust?.phone || cust?.phone2 || null
                const normalizedPhone = normalizeWhatsAppPhone(rawPhone)
                const hasValidPhone = Boolean(normalizedPhone)

                const isRouteReleased = Boolean(order.route_released)
                const isDelivered = order.status === 'delivered'

                return (
                  <div
                    key={order.id}
                    onClick={() => handleOpenPrompt(order)}
                    className="p-3.5 rounded-xl bg-white border border-amber-200/90 hover:border-amber-300 hover:shadow-sm transition cursor-pointer flex flex-col justify-between space-y-2.5"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-mono font-bold text-xs text-slate-900 bg-slate-100 px-2 py-0.5 rounded-md">
                          {order.tracking_code}
                        </span>
                        <div className="flex items-center gap-1">
                          {isRouteReleased ? (
                            <Badge
                              variant="outline"
                              className="bg-blue-50 text-blue-700 border-blue-200 text-[10px] font-semibold"
                            >
                              Rota Liberada
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="bg-slate-50 text-slate-600 border-slate-200 text-[10px]"
                            >
                              Aguardando Rota
                            </Badge>
                          )}
                          {isDelivered && (
                            <Badge
                              variant="outline"
                              className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]"
                            >
                              Entregue
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="mt-2 space-y-1">
                        <p className="font-semibold text-xs text-slate-900 truncate">
                          {customerName}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate">
                          {order.end_address_text || cust?.address || 'Sem endereço'}
                        </p>
                      </div>

                      <div className="mt-2 flex items-center justify-between text-[11px]">
                        <span className="text-slate-500">WhatsApp:</span>
                        {hasValidPhone ? (
                          <span className="font-mono text-emerald-700 font-medium">
                            +{normalizedPhone}
                          </span>
                        ) : (
                          <span className="text-amber-700 font-medium flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            Sem telefone válido
                          </span>
                        )}
                      </div>

                      {order.estimated_arrival && (
                        <div className="mt-1 flex items-center justify-between text-[11px]">
                          <span className="text-slate-500">Previsão:</span>
                          <span className="font-bold text-[#0052CC] flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {new Intl.DateTimeFormat('pt-BR', {
                              timeZone: 'America/Sao_Paulo',
                              hour: '2-digit',
                              minute: '2-digit',
                            }).format(new Date(order.estimated_arrival))}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="pt-2 border-t border-slate-100 flex items-center gap-2">
                      {hasValidPhone ? (
                        <Button
                          type="button"
                          size="sm"
                          onClick={(e) => handleDirectWhatsApp(order, e)}
                          className="flex-1 h-8 text-[11px] font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                          <MessageSquare className="h-3 w-3 mr-1" />
                          Enviar wa.me
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpenPrompt(order)}
                          className="flex-1 h-8 text-[11px] font-semibold rounded-lg text-slate-700 border-slate-300"
                        >
                          Ver detalhes
                        </Button>
                      )}

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={markingId === order.id}
                        onClick={(e) => handleQuickMarkSent(order, e)}
                        title="Marcar como já enviado"
                        className="h-8 px-2 text-[11px] text-slate-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        )}
      </Card>

      {selectedOrderForWa && (
        <WhatsAppTrackingPromptModal
          open={Boolean(selectedOrderForWa)}
          onOpenChange={(isOpen) => {
            if (!isOpen) setSelectedOrderForWa(null)
          }}
          order={{
            id: selectedOrderForWa.order.id,
            tracking_code: selectedOrderForWa.order.tracking_code,
            estimated_arrival: selectedOrderForWa.order.estimated_arrival,
            tracking_link_sent_at: selectedOrderForWa.order.tracking_link_sent_at,
          }}
          customerName={selectedOrderForWa.customerName}
          customerPhone={selectedOrderForWa.customerPhone}
          onSent={() => {
            setSelectedOrderForWa(null)
            onOrderUpdated?.()
          }}
          onSkip={() => setSelectedOrderForWa(null)}
        />
      )}
    </>
  )
}

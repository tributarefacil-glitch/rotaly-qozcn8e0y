import React, { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { MessageSquare, ExternalLink, CheckCircle2, Clock, AlertCircle } from 'lucide-react'
import {
  normalizeWhatsAppPhone,
  buildTrackingWhatsAppText,
  buildTrackingWhatsAppUrl,
} from '@/lib/whatsappTracking'
import { deliveryService } from '@/services/deliveryService'
import { toast } from '@/hooks/use-toast'

export interface WhatsAppTrackingPromptModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  order: {
    id: string
    tracking_code: string
    estimated_arrival?: string | null
    tracking_link_sent_at?: string | null
  }
  customerName?: string
  customerPhone?: string | null
  onSent?: (orderId: string) => void
  onSkip?: (orderId: string) => void
}

export const WhatsAppTrackingPromptModal: React.FC<WhatsAppTrackingPromptModalProps> = ({
  open,
  onOpenChange,
  order,
  customerName,
  customerPhone,
  onSent,
  onSkip,
}) => {
  const [isMarking, setIsMarking] = useState(false)
  const normalizedPhone = normalizeWhatsAppPhone(customerPhone)
  const hasValidPhone = Boolean(normalizedPhone)

  const trackingUrl = `https://www.rotaly.com.br/track/${order.tracking_code}`
  const waUrl = buildTrackingWhatsAppUrl(customerPhone, {
    customerName,
    trackingCode: order.tracking_code,
    estimatedArrival: order.estimated_arrival,
    includeEta: Boolean(order.estimated_arrival),
  })

  const previewText = buildTrackingWhatsAppText({
    customerName,
    trackingCode: order.tracking_code,
    estimatedArrival: order.estimated_arrival,
    includeEta: Boolean(order.estimated_arrival),
  })

  const handleOpenWhatsApp = () => {
    if (!waUrl) return
    window.open(waUrl, '_blank', 'noopener,noreferrer')
  }

  const handleConfirmSent = async () => {
    setIsMarking(true)
    try {
      await deliveryService.markTrackingLinkSent(order.id)
      toast({
        title: 'Envio registrado!',
        description: `Link de rastreamento do pedido ${order.tracking_code} marcado como enviado.`,
      })
      onSent?.(order.id)
      onOpenChange(false)
    } catch (err) {
      console.error('[WhatsAppTrackingPromptModal] Erro ao registrar envio:', err)
      toast({
        title: 'Erro ao registrar envio',
        description: 'Tente novamente ou envie mais tarde.',
        variant: 'destructive',
      })
    } finally {
      setIsMarking(false)
    }
  }

  const handleSendLater = () => {
    toast({
      title: 'Envio pendente registrado',
      description: `O pedido ${order.tracking_code} permanecerá na lista de rastreamentos pendentes.`,
    })
    onSkip?.(order.id)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl p-6 bg-white text-slate-900 border-slate-200">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <div className="h-9 w-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <MessageSquare className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-slate-900 font-heading">
                Enviar Rastreamento via WhatsApp
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Pedido{' '}
                <span className="font-mono font-bold text-slate-800">{order.tracking_code}</span>{' '}
                salvo com sucesso!
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3 py-2 text-xs">
          {/* Informações do cliente e telefone */}
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium">Cliente:</span>
              <span className="font-bold text-slate-900">{customerName || 'Cliente'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-medium">WhatsApp:</span>
              {hasValidPhone ? (
                <Badge
                  variant="outline"
                  className="bg-emerald-50 text-emerald-700 border-emerald-200 font-mono text-[11px]"
                >
                  +{normalizedPhone}
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="bg-amber-50 text-amber-700 border-amber-200 text-[11px]"
                >
                  Sem telefone válido com DDD
                </Badge>
              )}
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-slate-200/60">
              <span className="text-slate-500 font-medium">Link público:</span>
              <a
                href={trackingUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[#0052CC] hover:underline font-mono text-[11px] truncate max-w-[210px] flex items-center gap-1"
              >
                /track/{order.tracking_code}
                <ExternalLink className="h-3 w-3 inline" />
              </a>
            </div>
          </div>

          {!hasValidPhone && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
              <div className="text-[11px] leading-relaxed">
                <strong>Atenção:</strong> O cliente não possui telefone com DDD cadastrado. O pedido
                entrará na lista de pendências como <em>cliente sem telefone válido</em> para você
                atualizar o cadastro ou compartilhar manualmente.
              </div>
            </div>
          )}

          {/* Prévia da mensagem */}
          {hasValidPhone && (
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider block">
                Mensagem pronta (WhatsApp pessoal):
              </label>
              <div className="p-3 rounded-xl bg-emerald-50/50 border border-emerald-200/80 text-[11px] text-slate-700 whitespace-pre-wrap leading-relaxed font-sans max-h-36 overflow-y-auto">
                {previewText}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-slate-100">
          <Button
            type="button"
            variant="outline"
            onClick={handleSendLater}
            disabled={isMarking}
            className="w-full sm:w-auto text-xs text-slate-600 hover:text-slate-900 border-slate-200 rounded-xl"
          >
            <Clock className="h-3.5 w-3.5 mr-1 text-slate-400" />
            Enviar depois
          </Button>

          {hasValidPhone ? (
            <div className="flex gap-2 w-full sm:w-auto sm:ml-auto">
              <Button
                type="button"
                onClick={handleOpenWhatsApp}
                className="flex-1 sm:flex-initial text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
              >
                <MessageSquare className="h-3.5 w-3.5 mr-1" />
                Abrir WhatsApp
              </Button>
              <Button
                type="button"
                onClick={handleConfirmSent}
                disabled={isMarking}
                className="flex-1 sm:flex-initial text-xs font-bold rounded-xl bg-[#0052CC] hover:bg-blue-700 text-white shadow-sm"
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                {isMarking ? 'Gravando...' : 'Já enviei'}
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              onClick={handleSendLater}
              className="w-full sm:w-auto sm:ml-auto text-xs font-bold rounded-xl bg-slate-900 hover:bg-slate-800 text-white"
            >
              Entendido
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import React, { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  XCircle,
  UserX,
  UserMinus,
  AlertTriangle,
  MapPinOff,
  AlertCircle,
  Check,
} from 'lucide-react'
import { deliveryService } from '@/services/deliveryService'
import type { OrderRecord, OrderStatus, CompletionReason } from '@/types/delivery'
import { toast } from 'sonner'

export type CancelDeliveryReasonKey =
  | 'cliente_ausente'
  | 'desistencia_cliente'
  | 'erro_vendedor'
  | 'rota_errada'

export interface CancelOption {
  key: CancelDeliveryReasonKey
  label: 'Cliente Ausente' | 'Desistência do Cliente' | 'Erro do Vendedor' | 'Rota Errada'
  description: string
  icon: React.ComponentType<{ className?: string }>
  status: OrderStatus
  completionReason: CompletionReason
}

export const CANCEL_DELIVERY_OPTIONS: CancelOption[] = [
  {
    key: 'cliente_ausente',
    label: 'Cliente Ausente',
    description: 'Ninguém atendeu ou respondeu no endereço de entrega.',
    icon: UserX,
    status: 'client_absent',
    completionReason: 'client_absent',
  },
  {
    key: 'desistencia_cliente',
    label: 'Desistência do Cliente',
    description: 'O cliente recusou o pedido ou cancelou na hora.',
    icon: UserMinus,
    status: 'cancelled',
    completionReason: 'other',
  },
  {
    key: 'erro_vendedor',
    label: 'Erro do Vendedor',
    description: 'Pedido trocado, valor divergente ou erro operacional da loja.',
    icon: AlertTriangle,
    status: 'cancelled',
    completionReason: 'other',
  },
  {
    key: 'rota_errada',
    label: 'Rota Errada',
    description: 'Endereço inconsistente, fora de alcance ou rota incorreta.',
    icon: MapPinOff,
    status: 'address_error',
    completionReason: 'address_error',
  },
]

interface CancelDeliveryModalProps {
  order: OrderRecord | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onCancelled: () => void
}

export const CancelDeliveryModal: React.FC<CancelDeliveryModalProps> = ({
  order,
  open,
  onOpenChange,
  onCancelled,
}) => {
  const [selectedKey, setSelectedKey] = useState<CancelDeliveryReasonKey>('cliente_ausente')
  const [notes, setNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleConfirmCancel = async () => {
    if (!order) return

    const selectedOption = CANCEL_DELIVERY_OPTIONS.find((opt) => opt.key === selectedKey)
    if (!selectedOption) return

    setIsSubmitting(true)
    try {
      const now = new Date().toISOString()
      const notePrefix = order.notes ? `${order.notes} | ` : ''
      const cancelDetail = `Cancelamento: [${selectedOption.label}]`
      const finalNotes = `${notePrefix}${cancelDetail}${notes.trim() ? ` - ${notes.trim()}` : ''}`

      // Atualizar status e motivo no pedido
      await deliveryService.updateOrder(order.id, {
        status: selectedOption.status,
        completion_reason: selectedOption.completionReason,
        actual_arrival: now,
        notes: finalNotes,
        route_finished: true,
        route_finished_at: now,
      })

      // Gerar notificação interna
      try {
        await deliveryService.createNotification({
          title: `Entrega Cancelada: ${order.tracking_code}`,
          message: `Motivo: "${selectedOption.label}". Cliente: ${order.expand?.customer_id?.name || 'Cliente'}. ${notes.trim() ? `Obs: ${notes.trim()}` : ''}`,
          type: 'warning',
          read: false,
          order_id: order.id,
        })
      } catch {
        /* silent catch */
      }

      toast.warning(`Entrega ${order.tracking_code} cancelada: ${selectedOption.label}`)
      setNotes('')
      onOpenChange(false)
      onCancelled()
    } catch (err) {
      console.error('Erro ao cancelar entrega:', err)
      toast.error('Erro ao registrar cancelamento da entrega. Tente novamente.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!order) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-[#0E1738] border border-[#1E2B58] text-white p-5 rounded-2xl shadow-2xl">
        <DialogHeader className="space-y-1">
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-rose-400 font-heading">
            <XCircle className="h-5 w-5 text-rose-500" />
            Cancelar Entrega
          </DialogTitle>
          <p className="text-xs text-slate-400">
            Cliente:{' '}
            <strong className="text-white">
              {order.expand?.customer_id?.name || 'Não identificado'}
            </strong>{' '}
            • <span className="font-mono text-[#60A5FA]">{order.tracking_code}</span>
          </p>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <Label className="text-xs font-bold text-slate-300 uppercase tracking-wide">
            Selecione o Motivo do Cancelamento *
          </Label>

          {/* EXATAMENTE AS 4 OPÇÕES PEDIDAS */}
          <div className="space-y-2">
            {CANCEL_DELIVERY_OPTIONS.map((option) => {
              const Icon = option.icon
              const isSelected = selectedKey === option.key

              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setSelectedKey(option.key)}
                  className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${
                    isSelected
                      ? 'border-rose-500 bg-rose-500/10 shadow-sm shadow-rose-950/40 ring-1 ring-rose-500'
                      : 'border-[#1E2B58] bg-[#0A1128] hover:border-slate-600 text-slate-300'
                  }`}
                >
                  <div
                    className={`p-2 rounded-lg shrink-0 mt-0.5 ${
                      isSelected ? 'bg-rose-500 text-white' : 'bg-[#121E46] text-slate-400'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p
                        className={`text-xs font-bold ${
                          isSelected ? 'text-white' : 'text-slate-200'
                        }`}
                      >
                        {option.label}
                      </p>
                      {isSelected && <Check className="h-4 w-4 text-rose-400 shrink-0" />}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">
                      {option.description}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Observações adicionais */}
          <div className="space-y-1.5 pt-1">
            <Label htmlFor="cancel-notes" className="text-xs text-slate-300">
              Observação Adicional (Opcional)
            </Label>
            <Textarea
              id="cancel-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex.: Tentado contato às 14h20, portão trancado sem resposta..."
              className="text-xs bg-[#0A1128] border-[#1E2B58] text-white placeholder:text-slate-500 resize-none rounded-xl"
              rows={2}
            />
          </div>

          <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-start gap-2 text-[11px] text-amber-300">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
            <span>
              Ao cancelar, esta entrega sairá da sua fila ativa e o próximo cliente da rota será
              desbloqueado automaticamente.
            </span>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
            className="border-[#1E2B58] bg-[#0A1128] hover:bg-[#121E46] text-slate-300 text-xs h-10 rounded-xl"
          >
            Voltar
          </Button>
          <Button
            type="button"
            onClick={handleConfirmCancel}
            disabled={isSubmitting}
            className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs h-10 px-4 rounded-xl shadow-lg shadow-rose-950/50"
          >
            {isSubmitting ? 'Cancelando...' : 'Confirmar Cancelamento'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

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
import { CheckCircle, Camera, PenTool, Upload } from 'lucide-react'
import { deliveryService } from '@/services/deliveryService'
import type { OrderRecord, CompletionReason, OrderStatus } from '@/types/delivery'
import { toast } from 'sonner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AlertTriangle, MapPinOff, UserX, CheckCircle2 } from 'lucide-react'

interface DeliveryConfirmationModalProps {
  order: OrderRecord | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirmed: () => void
}

export const DeliveryConfirmationModal: React.FC<DeliveryConfirmationModalProps> = ({
  order,
  open,
  onOpenChange,
  onConfirmed,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [reason, setReason] = useState<CompletionReason>('delivered')
  const [receiverName, setReceiverName] = useState('')
  const [receiverDoc, setReceiverDoc] = useState('')
  const [notes, setNotes] = useState('')
  const [hasSignature, setHasSignature] = useState(false)
  const [photoSelected, setPhotoSelected] = useState<string | null>(null)

  const handleSimulatedSignature = () => {
    setHasSignature(true)
    toast.success('Assinatura digital capturada no touchscreen.')
  }

  const handleSimulatePhoto = () => {
    // Simulated proof photo base64/url
    setPhotoSelected('https://img.usecurling.com/p/600/400?q=delivery+receipt')
    toast.success('Foto do comprovante capturada.')
  }

  const handleConfirmDelivery = async () => {
    if (!order) return

    if (reason === 'delivered' && !receiverName.trim()) {
      toast.error('Informe o nome de quem recebeu a entrega.')
      return
    }

    setIsSubmitting(true)
    try {
      const now = new Date().toISOString()
      let finalStatus: OrderStatus = 'delivered'
      let reasonLabel = 'Finalizada com Sucesso'

      if (reason === 'address_error') {
        finalStatus = 'address_error'
        reasonLabel = 'Erro de Endereço'
      } else if (reason === 'client_absent') {
        finalStatus = 'client_absent'
        reasonLabel = 'Cliente Ausente'
      }

      const notePrefix = order.notes ? `${order.notes} | ` : ''
      const reasonDetail =
        reason === 'delivered'
          ? `Recebido por: ${receiverName} (Doc: ${receiverDoc || 'N/A'})`
          : `Motivo de não conclusão: ${reasonLabel}`

      const updateData: Partial<OrderRecord> = {
        status: finalStatus,
        completion_reason: reason,
        actual_arrival: now,
        notes: `${notePrefix}${reasonDetail}${notes ? ` - ${notes}` : ''}`,
      }

      await deliveryService.updateOrder(order.id, updateData)

      // In-app Notification for seller/admin
      await deliveryService.createNotification({
        title: `Entrega ${reason === 'delivered' ? 'Concluída' : 'Não Finalizada'}: ${order.tracking_code}`,
        message:
          reason === 'delivered'
            ? `Pedido entregue com sucesso para ${receiverName}.`
            : `Entrega finalizada com status: "${reasonLabel}". Obs: ${notes || 'Sem observações'}.`,
        type: reason === 'delivered' ? 'order' : 'warning',
        read: false,
        order_id: order.id,
      })

      if (reason === 'delivered') {
        toast.success(`Pedido ${order.tracking_code} marcado como ENTREGUE!`)
      } else if (reason === 'address_error') {
        toast.warning(`Pedido ${order.tracking_code} finalizado: Erro de Endereço.`)
      } else {
        toast.warning(`Pedido ${order.tracking_code} finalizado: Cliente Ausente.`)
      }

      onConfirmed()
      onOpenChange(false)
      // Reset form state
      setReason('delivered')
      setReceiverName('')
      setReceiverDoc('')
      setNotes('')
      setHasSignature(false)
      setPhotoSelected(null)
    } catch (err: unknown) {
      console.error('Error confirming delivery:', err)
      toast.error('Erro ao registrar status da entrega.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!order) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold text-emerald-600 dark:text-emerald-400">
            <CheckCircle className="h-6 w-6" />
            Confirmar Entrega de Pedido
          </DialogTitle>
          <p className="text-xs text-slate-500">
            Código:{' '}
            <span className="font-semibold text-slate-900 dark:text-white">
              {order.tracking_code}
            </span>
          </p>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Order Details Brief */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-900/50">
            <p className="font-semibold text-slate-800 dark:text-slate-200">
              Cliente: {order.expand?.customer_id?.name || 'Cliente'}
            </p>
            <p className="text-slate-500 mt-0.5">Endereço: {order.expand?.customer_id?.address}</p>
            <p className="text-slate-700 dark:text-slate-300 font-bold mt-1">
              Valor Total: R$ {Number(order.total_price || 0).toFixed(2)}
            </p>
          </div>

          {/* Motivo Obrigatório de Finalização */}
          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Selecione o Motivo de Finalização *
            </Label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setReason('delivered')}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 text-center transition ${
                  reason === 'delivered'
                    ? 'border-emerald-500 bg-emerald-50/80 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 ring-2 ring-emerald-500/20 font-bold'
                    : 'border-slate-200 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                }`}
              >
                <CheckCircle2 className="h-5 w-5 mb-1 text-emerald-500" />
                <span className="text-xs">Finalizada</span>
                <span className="text-[10px] text-slate-400">Entrega efetuada</span>
              </button>

              <button
                type="button"
                onClick={() => setReason('address_error')}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 text-center transition ${
                  reason === 'address_error'
                    ? 'border-amber-500 bg-amber-50/80 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 ring-2 ring-amber-500/20 font-bold'
                    : 'border-slate-200 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                }`}
              >
                <MapPinOff className="h-5 w-5 mb-1 text-amber-500" />
                <span className="text-xs">Erro de Endereço</span>
                <span className="text-[10px] text-slate-400">Não localizado / incorreto</span>
              </button>

              <button
                type="button"
                onClick={() => setReason('client_absent')}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 text-center transition ${
                  reason === 'client_absent'
                    ? 'border-rose-500 bg-rose-50/80 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 ring-2 ring-rose-500/20 font-bold'
                    : 'border-slate-200 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                }`}
              >
                <UserX className="h-5 w-5 mb-1 text-rose-500" />
                <span className="text-xs">Cliente Ausente</span>
                <span className="text-[10px] text-slate-400">Ninguém no local</span>
              </button>
            </div>
          </div>

          {/* Condicional: Recebedor e Comprovante (quando finalizada com sucesso) */}
          {reason === 'delivered' ? (
            <>
              {/* Receiver Info */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs font-semibold">Nome do Recebedor *</Label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: João da Silva"
                    value={receiverName}
                    onChange={(e) => setReceiverName(e.target.value)}
                    className="mt-1 flex h-9 w-full rounded-md border border-slate-300 bg-transparent px-3 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-950 dark:border-slate-800"
                  />
                </div>
                <div>
                  <Label className="text-xs font-semibold">RG / CPF do Recebedor</Label>
                  <input
                    type="text"
                    placeholder="000.000.000-00"
                    value={receiverDoc}
                    onChange={(e) => setReceiverDoc(e.target.value)}
                    className="mt-1 flex h-9 w-full rounded-md border border-slate-300 bg-transparent px-3 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-950 dark:border-slate-800"
                  />
                </div>
              </div>

              {/* Proof Options: Digital Signature & Photo */}
              <div className="space-y-3">
                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Comprovante de Entrega
                </Label>

                <div className="grid grid-cols-2 gap-3">
                  {/* Signature trigger */}
                  <button
                    type="button"
                    onClick={handleSimulatedSignature}
                    className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 border-dashed transition-all ${
                      hasSignature
                        ? 'border-emerald-500 bg-emerald-50/50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                        : 'border-slate-300 hover:border-purple-400 text-slate-600 dark:border-slate-700 dark:text-slate-400'
                    }`}
                  >
                    <PenTool className="h-6 w-6 mb-1.5" />
                    <span className="text-xs font-bold">
                      {hasSignature ? '✓ Assinatura Gravada' : 'Assinar na Tela'}
                    </span>
                    <span className="text-[10px] text-slate-400 mt-0.5">Captura digital</span>
                  </button>

                  {/* Photo upload trigger */}
                  <button
                    type="button"
                    onClick={handleSimulatePhoto}
                    className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 border-dashed transition-all ${
                      photoSelected
                        ? 'border-emerald-500 bg-emerald-50/50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                        : 'border-slate-300 hover:border-purple-400 text-slate-600 dark:border-slate-700 dark:text-slate-400'
                    }`}
                  >
                    <Camera className="h-6 w-6 mb-1.5" />
                    <span className="text-xs font-bold">
                      {photoSelected ? '✓ Foto Anexada' : 'Tirar Foto do Recibo'}
                    </span>
                    <span className="text-[10px] text-slate-400 mt-0.5">Câmera / Arquivo</span>
                  </button>
                </div>

                {hasSignature && (
                  <div className="p-2 border rounded-lg bg-white dark:bg-slate-900 flex items-center justify-center h-16 border-emerald-300 font-serif italic text-slate-800 dark:text-slate-200">
                    ✍️ {receiverName || 'Assinatura Registrada Digitalmente'}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs flex items-center gap-2.5">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <span>
                {reason === 'address_error'
                  ? 'O pedido será marcado com pendência de endereço e notificado ao vendedor para correção.'
                  : 'O pedido será registrado como tentativa sem sucesso por ausência do cliente.'}
              </span>
            </div>
          )}

          {/* Observations */}
          <div>
            <Label className="text-xs font-semibold">Observações / Detalhes</Label>
            <Textarea
              placeholder={
                reason === 'delivered'
                  ? 'Ex: Entregue na portaria com o porteiro Silva.'
                  : 'Ex: Número não localizado na rua / Interfone não atendeu.'
              }
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 text-xs resize-none"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleConfirmDelivery}
            disabled={isSubmitting || (reason === 'delivered' && !receiverName.trim())}
            className={`font-bold ${
              reason === 'delivered'
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                : reason === 'address_error'
                  ? 'bg-amber-600 hover:bg-amber-700 text-white'
                  : 'bg-rose-600 hover:bg-rose-700 text-white'
            }`}
          >
            {isSubmitting
              ? 'Finalizando...'
              : reason === 'delivered'
                ? 'Confirmar Entrega (OK)'
                : 'Salvar Motivo & Finalizar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

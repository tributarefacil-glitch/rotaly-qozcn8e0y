import React, { useState, useRef, useEffect } from 'react'
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
  CheckCircle,
  Camera,
  Trash2,
  Image as ImageIcon,
  AlertTriangle,
  MapPinOff,
  UserX,
  CheckCircle2,
  RotateCcw,
  PenLine,
  Upload,
} from 'lucide-react'
import { deliveryService } from '@/services/deliveryService'
import type { OrderRecord, CompletionReason, OrderStatus } from '@/types/delivery'
import { toast } from 'sonner'

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

  // Módulo 2: Comprovante Digital com Foto e Assinatura
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null)
  const [hasSignature, setHasSignature] = useState(false)
  const [isDrawing, setIsDrawing] = useState(false)
  const [lastPos, setLastPos] = useState<{ x: number; y: number } | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Initialize or reset form whenever modal opens with customer info
  useEffect(() => {
    if (open && order) {
      setReason('delivered')
      setReceiverName(order.expand?.customer_id?.name || '')
      setReceiverDoc('')
      setNotes('')
      setHasSignature(false)
      setSignatureDataUrl(null)
      setPhotoFile(null)
      setPhotoPreview(null)
      setIsDrawing(false)
      setLastPos(null)

      // Initialize canvas context after render
      setTimeout(() => {
        clearCanvas()
      }, 100)
    }
  }, [open, order])

  // Canvas drawing handlers
  const clearCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    // Draw subtle guide line
    ctx.beginPath()
    ctx.strokeStyle = '#e2e8f0'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.moveTo(20, canvas.height - 25)
    ctx.lineTo(canvas.width - 20, canvas.height - 25)
    ctx.stroke()
    ctx.setLineDash([])

    setHasSignature(false)
    setSignatureDataUrl(null)
  }

  const getCanvasCoords = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
  ) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    }
  }

  const startDrawing = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
  ) => {
    if (e.cancelable) e.preventDefault()
    setIsDrawing(true)
    const pos = getCanvasCoords(e)
    setLastPos(pos)
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
  }

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (e.cancelable) e.preventDefault()
    if (!isDrawing) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const pos = getCanvasCoords(e)

    ctx.lineWidth = 2.8
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#0f172a'

    if (lastPos) {
      ctx.beginPath()
      ctx.moveTo(lastPos.x, lastPos.y)
      ctx.lineTo(pos.x, pos.y)
      ctx.stroke()
    }

    setLastPos(pos)
    setHasSignature(true)
  }

  const stopDrawing = (
    e?: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
  ) => {
    if (e && e.cancelable) e.preventDefault()
    if (!isDrawing) return
    setIsDrawing(false)
    setLastPos(null)
    const canvas = canvasRef.current
    if (canvas && hasSignature) {
      setSignatureDataUrl(canvas.toDataURL('image/png'))
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setPhotoFile(file)
      const previewUrl = URL.createObjectURL(file)
      setPhotoPreview(previewUrl)
      toast.success('Foto capturada com sucesso!')
    }
  }

  const handleClearPhoto = (e: React.MouseEvent) => {
    e.stopPropagation()
    setPhotoFile(null)
    setPhotoPreview(null)
    if (cameraInputRef.current) cameraInputRef.current.value = ''
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleConfirmDelivery = async () => {
    if (!order) return

    const isDelivered = reason === 'delivered'

    // VALIDAÇÕES OBRIGATÓRIAS DO MÓDULO 2
    // Se o motivo for "Finalizada" (delivered), foto e assinatura são OBRIGATÓRIAS
    if (isDelivered) {
      if (!photoFile && !photoPreview) {
        toast.error('Foto obrigatória! Por favor, tire a foto do cliente recebendo o produto.')
        return
      }

      if (!hasSignature && !signatureDataUrl) {
        toast.error('Assinatura obrigatória! O cliente deve assinar no quadro antes de confirmar.')
        return
      }
    }

    const effectiveReceiverName =
      receiverName.trim() || order.expand?.customer_id?.name || 'Cliente'

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
          ? `Recebido por: ${effectiveReceiverName} (Doc: ${receiverDoc || 'N/A'})`
          : `Motivo de não conclusão: ${reasonLabel}`

      const finalNotes = `${notePrefix}${reasonDetail}${notes ? ` - ${notes}` : ''}`

      // Final signature Data URL
      let finalSignature = signatureDataUrl
      if (!finalSignature && hasSignature && canvasRef.current) {
        finalSignature = canvasRef.current.toDataURL('image/png')
      }

      // Preparar envio (foto + assinatura + hora + observações)
      if (photoFile) {
        const formData = new FormData()
        formData.append('status', finalStatus)
        formData.append('completion_reason', reason)
        formData.append('actual_arrival', now)
        formData.append('notes', finalNotes)
        formData.append('proof_photo', photoFile)
        formData.append('receiver_name', effectiveReceiverName)
        if (finalSignature) {
          formData.append('signature', finalSignature)
        }

        await deliveryService.updateOrder(order.id, formData)
      } else {
        const updateData: Partial<OrderRecord> = {
          status: finalStatus,
          completion_reason: reason,
          actual_arrival: now,
          notes: finalNotes,
          receiver_name: effectiveReceiverName,
          signature: finalSignature || undefined,
        }
        await deliveryService.updateOrder(order.id, updateData)
      }

      // In-app Notification
      await deliveryService.createNotification({
        title: `Entrega ${reason === 'delivered' ? 'Concluída com Comprovante' : 'Não Finalizada'}: ${order.tracking_code}`,
        message:
          reason === 'delivered'
            ? `Pedido entregue com foto e assinatura coletadas para ${effectiveReceiverName}.`
            : `Entrega registrada com motivo: "${reasonLabel}". Obs: ${notes || 'Sem observações'}.`,
        type: reason === 'delivered' ? 'order' : 'warning',
        read: false,
        order_id: order.id,
      })

      if (reason === 'delivered') {
        toast.success(`Pedido ${order.tracking_code} confirmado com foto e assinatura!`)
      } else if (reason === 'address_error') {
        toast.warning(`Pedido ${order.tracking_code} finalizado: Erro de Endereço.`)
      } else {
        toast.warning(`Pedido ${order.tracking_code} finalizado: Cliente Ausente.`)
      }

      onConfirmed()
      onOpenChange(false)
    } catch (err: unknown) {
      console.error('Error confirming delivery:', err)
      toast.error('Erro ao registrar status da entrega. Tente novamente.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!order) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
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

        {/* Inputs de Câmera e Arquivo (Suporte Mobile com capture="environment" e Desktop) */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileChange}
          className="hidden"
          id="camera-capture-input"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
          id="gallery-file-input"
        />

        <div className="space-y-4 py-2">
          {/* Resumo da entrega */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-900/50">
            <p className="font-semibold text-slate-800 dark:text-slate-200">
              Cliente: {order.expand?.customer_id?.name || 'Cliente'}
            </p>
            <p className="text-slate-500 mt-0.5">Endereço: {order.expand?.customer_id?.address}</p>
            <p className="text-slate-700 dark:text-slate-300 font-bold mt-1">
              Valor Total: R$ {Number(order.total_price || 0).toFixed(2)}
            </p>
          </div>

          {/* Motivos de Finalização (Preservando Finalizada, Erro de Endereço, Cliente Ausente) */}
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
                <span className="text-[10px] text-slate-400">Comprovante obrigatório</span>
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
                <span className="text-[10px] text-slate-400">Não localizado</span>
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

          {/* FLUXO MÓDULO 2: COMPROVANTE DIGITAL (FOTO + ASSINATURA OBRIGATÓRIAS QUANDO FINALIZADA) */}
          {reason === 'delivered' ? (
            <div className="space-y-4 pt-1">
              {/* Nome e Documento do Recebedor */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs font-semibold">Nome de Quem Recebeu *</Label>
                  <input
                    type="text"
                    placeholder="Nome da pessoa"
                    value={receiverName}
                    onChange={(e) => setReceiverName(e.target.value)}
                    className="mt-1 flex h-9 w-full rounded-md border border-slate-300 bg-transparent px-3 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-950 dark:border-slate-800"
                  />
                </div>
                <div>
                  <Label className="text-xs font-semibold">RG / CPF (Opcional)</Label>
                  <input
                    type="text"
                    placeholder="Documento"
                    value={receiverDoc}
                    onChange={(e) => setReceiverDoc(e.target.value)}
                    className="mt-1 flex h-9 w-full rounded-md border border-slate-300 bg-transparent px-3 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-950 dark:border-slate-800"
                  />
                </div>
              </div>

              {/* 1. CAMPO: CÂMERA / FOTO DO CLIENTE RECEBENDO O PRODUTO (OBRIGATÓRIA) */}
              <div className="space-y-2 p-3 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Camera className="h-4 w-4 text-purple-600" />
                    1. Foto do Cliente Recebendo o Produto <span className="text-rose-500">*</span>
                  </Label>
                  {photoPreview && (
                    <span className="text-[10px] font-medium text-emerald-600 flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Foto capturada
                    </span>
                  )}
                </div>

                {!photoPreview ? (
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-14 flex flex-col items-center justify-center gap-1 border-purple-200 hover:bg-purple-50 text-purple-700 dark:border-purple-800 dark:hover:bg-purple-950/30"
                      onClick={() => cameraInputRef.current?.click()}
                    >
                      <Camera className="h-5 w-5" />
                      <span className="text-xs font-bold">Tirar Foto</span>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-14 flex flex-col items-center justify-center gap-1 border-slate-200 hover:bg-slate-100 text-slate-700 dark:border-slate-700"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <ImageIcon className="h-5 w-5 text-blue-500" />
                      <span className="text-xs font-bold">Galeria / Arquivo</span>
                    </Button>
                  </div>
                ) : (
                  <div className="relative rounded-lg border border-emerald-300 dark:border-emerald-800 bg-slate-950 p-2 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <img
                        src={photoPreview}
                        alt="Comprovante de entrega"
                        className="h-14 w-20 object-cover rounded border border-slate-700"
                      />
                      <div className="text-xs">
                        <p className="font-bold text-white flex items-center gap-1">
                          <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
                          Foto Anexada
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {photoFile?.name || 'foto_comprovante.jpg'}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => cameraInputRef.current?.click()}
                        className="text-slate-300 hover:text-white hover:bg-slate-800 h-8 px-2 text-xs"
                      >
                        Trocar
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleClearPhoto}
                        className="text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 h-8 px-2 text-xs"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* 2. CAMPO: ASSINATURA DIGITAL CANVAS (OBRIGATÓRIA) */}
              <div className="space-y-2 p-3 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <PenLine className="h-4 w-4 text-indigo-600" />
                    2. Assinatura Digital do Cliente <span className="text-rose-500">*</span>
                  </Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={clearCanvas}
                    className="h-6 text-[11px] text-slate-500 hover:text-slate-900 px-2"
                  >
                    <RotateCcw className="h-3 w-3 mr-1" />
                    Limpar
                  </Button>
                </div>

                <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 overflow-hidden relative touch-none">
                  <canvas
                    ref={canvasRef}
                    width={440}
                    height={140}
                    className="w-full h-28 cursor-crosshair bg-white"
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={stopDrawing}
                  />
                  {!hasSignature && (
                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center text-slate-400 text-xs font-medium">
                      ✍️ Desenhe ou assine com o dedo / mouse aqui
                    </div>
                  )}
                </div>
              </div>
            </div>
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

          {/* 4. CAMPO DE OBSERVAÇÕES (OPCIONAL) */}
          <div>
            <Label className="text-xs font-semibold">Observações (Opcional)</Label>
            <Textarea
              placeholder={
                reason === 'delivered'
                  ? 'Ex: Entregue na portaria com o porteiro Silva.'
                  : 'Ex: Cliente não estava no local, interfone não atendeu, endereço com número errado...'
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
            disabled={isSubmitting}
            className={`font-bold ${
              reason === 'delivered'
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                : reason === 'address_error'
                  ? 'bg-amber-600 hover:bg-amber-700 text-white'
                  : 'bg-rose-600 hover:bg-rose-700 text-white'
            }`}
          >
            {isSubmitting
              ? 'Salvando comprovante...'
              : reason === 'delivered'
                ? 'Confirmar Entrega com Comprovante'
                : 'Salvar Ocorrência'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

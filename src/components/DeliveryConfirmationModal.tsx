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
import { compressImageFile, dataUrlToFile } from '@/lib/imageCompression'
import { getErrorMessage } from '@/lib/pocketbase/errors'

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
  const [isCompressingPhoto, setIsCompressingPhoto] = useState(false)
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null)
  const [hasSignature, setHasSignature] = useState(false)
  const [isDrawing, setIsDrawing] = useState(false)
  const [lastPos, setLastPos] = useState<{ x: number; y: number } | null>(null)
  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true

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

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setIsCompressingPhoto(true)
      try {
        // Redimensionar no cliente para máx ~1600px no lado maior e qualidade ~0.8 JPEG
        const compressed = await compressImageFile(file, {
          maxSide: 1600,
          quality: 0.8,
          mimeType: 'image/jpeg',
        })
        setPhotoFile(compressed)
        const previewUrl = URL.createObjectURL(compressed)
        setPhotoPreview(previewUrl)
        toast.success('Foto capturada e otimizada com sucesso!')
      } catch (err) {
        console.warn('Erro ao comprimir foto, mantendo arquivo original:', err)
        setPhotoFile(file)
        const previewUrl = URL.createObjectURL(file)
        setPhotoPreview(previewUrl)
        toast.success('Foto anexada.')
      } finally {
        setIsCompressingPhoto(false)
      }
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

    // VALIDAÇÕES DO MÓDULO 2:
    // A foto da entrega é OPCIONAL a pedido da operação (entregador pode concluir sem foto).
    // A assinatura digital permanece recomendada/obrigatória quando entregue ao cliente.
    if (isDelivered) {
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

      // Converter dataURL da assinatura em File se existir
      let signatureFile: File | null = null
      if (finalSignature && finalSignature.startsWith('data:image')) {
        signatureFile = await dataUrlToFile(
          finalSignature,
          `signature_${order.id || 'sig'}_${Date.now()}.png`,
        )
      }

      // Garantir que a foto anexada esteja devidamente comprimida antes de subir
      let finalPhotoFile: File | null = photoFile
      if (finalPhotoFile && finalPhotoFile.size > 2 * 1024 * 1024) {
        try {
          finalPhotoFile = await compressImageFile(finalPhotoFile, {
            maxSide: 1600,
            quality: 0.8,
            mimeType: 'image/jpeg',
          })
        } catch (e) {
          console.warn('Compressão pré-envio falhou, usando arquivo atual:', e)
        }
      }

      // Preservar rota iniciada (route_started: true)
      // Se distance_km estiver zerado e for rota parcial (address_error ou client_absent),
      // calcular a distância percorrida até o local via Haversine e estimar retorno até a base
      const calcHaversineKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
        const R = 6371
        const φ1 = (lat1 * Math.PI) / 180
        const φ2 = (lat2 * Math.PI) / 180
        const Δφ = ((lat2 - lat1) * Math.PI) / 180
        const Δλ = ((lon2 - lon1) * Math.PI) / 180
        const a =
          Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
          Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        return R * c
      }

      let distanceKm =
        typeof order.distance_km === 'number' && order.distance_km > 0 ? order.distance_km : 0
      let returnTripKm =
        typeof order.return_trip_km === 'number' && order.return_trip_km > 0
          ? order.return_trip_km
          : 0

      if ((reason === 'address_error' || reason === 'client_absent') && distanceKm === 0) {
        const custLat = order.expand?.customer_id?.lat
        const custLng = order.expand?.customer_id?.lng
        const baseLat = order.start_base_lat || -22.906847
        const baseLng = order.start_base_lng || -43.172896

        if (custLat && custLng) {
          const directKm = calcHaversineKm(baseLat, baseLng, custLat, custLng)
          // Adicionar fator de rota urbana (~1.3x linha reta)
          distanceKm = parseFloat((directKm * 1.3).toFixed(2))
        } else {
          // Valor fallback razoável para perímetro urbano
          distanceKm = 4.5
        }

        if (returnTripKm === 0) {
          const endLat = order.end_address_lat || baseLat
          const endLng = order.end_address_lng || baseLng
          if (custLat && custLng) {
            const retDirectKm = calcHaversineKm(custLat, custLng, endLat, endLng)
            returnTripKm = parseFloat((retDirectKm * 1.3).toFixed(2))
          } else {
            returnTripKm = distanceKm
          }
        }
      }

      // Preparar envio (FormData caso haja arquivos como proof_photo ou signature)
      if (finalPhotoFile || signatureFile) {
        const formData = new FormData()
        formData.append('status', finalStatus)
        formData.append('completion_reason', reason)
        formData.append('actual_arrival', now)
        formData.append('notes', finalNotes)
        formData.append('receiver_name', effectiveReceiverName)
        formData.append('route_started', 'true')
        if (distanceKm > 0) formData.append('distance_km', String(distanceKm))
        if (returnTripKm > 0) formData.append('return_trip_km', String(returnTripKm))
        if (finalPhotoFile) {
          formData.append('proof_photo', finalPhotoFile)
        }
        if (signatureFile) {
          formData.append('signature', signatureFile)
        }

        await deliveryService.updateOrder(order.id, formData)
      } else {
        const updateData: Partial<OrderRecord> = {
          status: finalStatus,
          completion_reason: reason,
          actual_arrival: now,
          notes: finalNotes,
          receiver_name: effectiveReceiverName,
          route_started: true,
          ...(distanceKm > 0 ? { distance_km: distanceKm } : {}),
          ...(returnTripKm > 0 ? { return_trip_km: returnTripKm } : {}),
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
        toast.success(`Pedido ${order.tracking_code} confirmado com sucesso!`)
      } else if (reason === 'address_error') {
        toast.warning(`Pedido ${order.tracking_code} finalizado: Erro de Endereço.`)
      } else {
        toast.warning(`Pedido ${order.tracking_code} finalizado: Cliente Ausente.`)
      }

      onConfirmed()
      onOpenChange(false)
    } catch (err: unknown) {
      console.error('Error confirming delivery:', err)
      const errorMsg = getErrorMessage(err)
      toast.error(errorMsg || 'Erro ao registrar status da entrega. Tente novamente.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!order) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto rounded-modal shadow-brand bg-white text-[#1a1a1a]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-heading font-bold text-[#00AA44]">
            <CheckCircle className="h-6 w-6 animate-checkmark-bounce text-[#00AA44]" />
            Confirmar Entrega de Pedido
          </DialogTitle>
          <p className="text-xs text-slate-500 font-sans">
            Código: <span className="font-bold text-[#0052CC]">{order.tracking_code}</span>
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

        {/* Banner informativo de conectividade para confirmação com upload */}
        {!isOnline && (
          <div className="p-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 text-xs flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Aparelho sem conexão de internet</p>
              <p className="text-[11px] text-amber-800 mt-0.5 leading-relaxed">
                A confirmação com foto e assinatura exige upload de arquivo na nuvem. Você pode
                preencher os dados do cliente e salvar a ocorrência quando o sinal voltar, ou se
                aproximar de uma área com sinal para concluir.
              </p>
            </div>
          </div>
        )}

        <div className="space-y-4 py-2">
          {/* Resumo da entrega */}
          <div className="rounded-card border border-slate-200 bg-[#F5F5F5] p-3 text-xs">
            <p className="font-heading font-bold text-[#1a1a1a]">
              Cliente: {order.expand?.customer_id?.name || 'Cliente'}
            </p>
            <p className="font-sans text-slate-600 mt-0.5">
              Endereço: {order.expand?.customer_id?.address}
            </p>
            <p className="font-heading text-[#0052CC] font-bold mt-1">
              Valor Total: R$ {Number(order.total_price || 0).toFixed(2)}
            </p>
          </div>

          {/* Motivos de Finalização (Preservando Finalizada, Erro de Endereço, Cliente Ausente) */}
          <div className="space-y-2">
            <Label className="font-heading text-xs font-bold uppercase tracking-wider text-[#1a1a1a]">
              Selecione o Motivo de Finalização *
            </Label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setReason('delivered')}
                className={`flex flex-col items-center justify-center p-3 rounded-card border-2 text-center transition duration-200 ${
                  reason === 'delivered'
                    ? 'border-[#00AA44] bg-emerald-50 text-[#00AA44] ring-2 ring-[#00AA44]/20 font-bold'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                <CheckCircle2 className="h-5 w-5 mb-1 text-[#00AA44] animate-checkmark-bounce" />
                <span className="text-xs font-heading">Finalizada</span>
                <span className="text-[10px] text-slate-500 font-sans">Assinatura coletada</span>
              </button>

              <button
                type="button"
                onClick={() => setReason('address_error')}
                className={`flex flex-col items-center justify-center p-3 rounded-card border-2 text-center transition duration-200 ${
                  reason === 'address_error'
                    ? 'border-[#FF6B35] bg-orange-50 text-[#FF6B35] ring-2 ring-[#FF6B35]/20 font-bold'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                <MapPinOff className="h-5 w-5 mb-1 text-[#FF6B35]" />
                <span className="text-xs font-heading">Erro de Endereço</span>
                <span className="text-[10px] text-slate-500 font-sans">Não localizado</span>
              </button>

              <button
                type="button"
                onClick={() => setReason('client_absent')}
                className={`flex flex-col items-center justify-center p-3 rounded-card border-2 text-center transition duration-200 ${
                  reason === 'client_absent'
                    ? 'border-[#E74C3C] bg-red-50 text-[#E74C3C] ring-2 ring-[#E74C3C]/20 font-bold'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                <UserX className="h-5 w-5 mb-1 text-[#E74C3C]" />
                <span className="text-xs font-heading">Cliente Ausente</span>
                <span className="text-[10px] text-slate-500 font-sans">Ninguém no local</span>
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
              <div className="space-y-2 p-3 bg-[#F5F5F5] rounded-card border border-slate-200">
                <div className="flex items-center justify-between">
                  <Label className="font-heading text-xs font-bold text-[#1a1a1a] flex items-center gap-1.5">
                    <Camera className="h-4 w-4 text-[#0052CC]" />
                    1. Foto do Cliente Recebendo o Produto{' '}
                    <span className="text-slate-400 font-normal">(Opcional)</span>
                  </Label>
                  {photoPreview && (
                    <span className="text-[10px] font-bold text-[#00AA44] flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Foto anexada
                    </span>
                  )}
                </div>

                {isCompressingPhoto ? (
                  <div className="p-4 rounded-md border border-blue-200 bg-blue-50/50 flex items-center justify-center gap-2 text-xs text-[#0052CC] font-semibold">
                    <span className="inline-block w-4 h-4 border-2 border-[#0052CC] border-t-transparent rounded-full animate-spin" />
                    Otimizando tamanho da foto para envio...
                  </div>
                ) : !photoPreview ? (
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-14 flex flex-col items-center justify-center gap-1 border-blue-200 bg-white hover:bg-blue-50 text-[#0052CC] rounded-input"
                      onClick={() => cameraInputRef.current?.click()}
                    >
                      <Camera className="h-5 w-5 text-[#FF6B35]" />
                      <span className="text-xs font-bold">Tirar Foto</span>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-14 flex flex-col items-center justify-center gap-1 border-slate-200 bg-white hover:bg-slate-50 text-slate-700 rounded-input"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <ImageIcon className="h-5 w-5 text-[#0052CC]" />
                      <span className="text-xs font-bold">Galeria / Arquivo</span>
                    </Button>
                  </div>
                ) : (
                  <div className="relative rounded-md border border-emerald-300 bg-white p-2 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <img
                        src={photoPreview}
                        alt="Comprovante de entrega"
                        className="h-14 w-20 object-cover rounded border border-slate-200"
                      />
                      <div className="text-xs">
                        <p className="font-bold text-[#1a1a1a] flex items-center gap-1">
                          <CheckCircle className="h-3.5 w-3.5 text-[#00AA44]" />
                          Foto Anexada
                        </p>
                        <p className="text-[10px] text-slate-500">
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
                        className="text-slate-600 hover:text-[#0052CC] h-8 px-2 text-xs"
                      >
                        Trocar
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleClearPhoto}
                        className="text-[#E74C3C] hover:bg-red-50 h-8 px-2 text-xs"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* 2. CAMPO: ASSINATURA DIGITAL CANVAS (OBRIGATÓRIA) */}
              <div className="space-y-2 p-3 bg-[#F5F5F5] rounded-card border border-slate-200">
                <div className="flex items-center justify-between">
                  <Label className="font-heading text-xs font-bold text-[#1a1a1a] flex items-center gap-1.5">
                    <PenLine className="h-4 w-4 text-[#0052CC]" />
                    2. Assinatura Digital do Cliente <span className="text-[#E74C3C]">*</span>
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

                <div className="border-2 border-dashed border-slate-300 rounded-md bg-white overflow-hidden relative touch-none">
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
            <div className="p-3 rounded-card bg-orange-50 border border-orange-200 text-[#FF6B35] text-xs flex items-center gap-2.5 font-sans">
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
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="rounded-input text-xs"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleConfirmDelivery}
            disabled={isSubmitting}
            className={`font-bold text-xs rounded-input transition duration-100 shadow-brand ${
              reason === 'delivered'
                ? 'bg-[#00AA44] hover:bg-[#008836] text-white'
                : reason === 'address_error'
                  ? 'bg-[#FF6B35] hover:bg-[#E5531E] text-white'
                  : 'bg-[#E74C3C] hover:bg-[#C0392B] text-white'
            }`}
          >
            {isSubmitting
              ? 'Salvando comprovante...'
              : reason === 'delivered'
                ? 'Entrega confirmada!'
                : 'Salvar Ocorrência'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import React, { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { MapPin, Navigation, ArrowRight, Compass, AlertCircle, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { deliveryService } from '@/services/deliveryService'
import { offlineRouteStorage } from '@/services/offlineRouteStorage'
import { nativeGpsBridge } from '@/services/nativeGpsBridge'
import type { OrderRecord } from '@/types/delivery'

interface RedirectDeliveryModalProps {
  order: OrderRecord | null
  courierId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onRedirectionStarted: (updatedOrder: OrderRecord) => void
}

export const RedirectDeliveryModal: React.FC<RedirectDeliveryModalProps> = ({
  order,
  courierId,
  open,
  onOpenChange,
  onRedirectionStarted,
}) => {
  const [newAddressInput, setNewAddressInput] = useState('')
  const [isCapturingGps, setIsCapturingGps] = useState(false)
  const [capturedPointA, setCapturedPointA] = useState<{
    lat: number
    lng: number
    at: string
  } | null>(null)

  // Reset or initialize when modal opens
  useEffect(() => {
    if (open && order) {
      if (order.redirection_point_a_lat && order.redirection_point_a_lng) {
        setCapturedPointA({
          lat: order.redirection_point_a_lat,
          lng: order.redirection_point_a_lng,
          at: order.redirection_point_a_at || new Date().toISOString(),
        })
      } else {
        setCapturedPointA(null)
      }
      setNewAddressInput(order.redirection_new_address || '')
    }
  }, [open, order])

  // Capturar GPS no Ponto A (endereço planejado original do sistema)
  const captureCurrentGpsPointA = async (): Promise<{ lat: number; lng: number; at: string }> => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      throw new Error('GPS não disponível neste aparelho/navegador.')
    }

    return new Promise<{ lat: number; lng: number; at: string }>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            at: new Date(pos.timestamp || Date.now()).toISOString(),
          })
        },
        (err) => {
          reject(err)
        },
        {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 0,
        },
      )
    })
  }

  // Ação 1: Iniciar redirecionamento gravando o Ponto A
  const handleInitiateRedirection = async (openNavigation = false) => {
    if (!order) return
    const addressTrimmed = newAddressInput.trim()
    if (!addressTrimmed) {
      toast.error('Informe o novo endereço ou descrição do local.')
      return
    }

    setIsCapturingGps(true)
    const toastId = toast.loading('Capturando coordenada GPS do Ponto A no local original...')

    let coords = capturedPointA
    try {
      if (!coords) {
        coords = await captureCurrentGpsPointA()
        setCapturedPointA(coords)
      }
    } catch (gpsErr: any) {
      console.warn(
        '[RedirectDeliveryModal] Falha ao capturar GPS online, usando fallback do endereço:',
        gpsErr,
      )
      // Fallback gracioso: usar coordenadas planejadas do pedido se o hardware falhar
      const fallbackLat = order.end_address_lat || order.expand?.customer_id?.lat || -22.699
      const fallbackLng = order.end_address_lng || order.expand?.customer_id?.lng || -43.296
      coords = {
        lat: fallbackLat,
        lng: fallbackLng,
        at: new Date().toISOString(),
      }
      setCapturedPointA(coords)
    }

    try {
      const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true

      let updatedOrder: OrderRecord = {
        ...order,
        redirection_status: 'initiated',
        is_redirected: true,
        redirection_point_a_lat: coords.lat,
        redirection_point_a_lng: coords.lng,
        redirection_point_a_at: coords.at,
        redirection_new_address: addressTrimmed,
      }

      if (isOnline) {
        try {
          updatedOrder = await deliveryService.initiateDeliveryRedirection({
            orderId: order.id,
            courierId: courierId || order.courier_id,
            pointALat: coords.lat,
            pointALng: coords.lng,
            pointAAt: coords.at,
            newAddressText: addressTrimmed,
          })
        } catch (serverErr) {
          console.warn(
            '[RedirectDeliveryModal] Servidor offline ou indisponível, guardando offline:',
            serverErr,
          )
          // Salvar na fila offline
          await offlineRouteStorage.enqueueRedirectionAction({
            id: `redir_init_${order.id}_${Date.now()}`,
            orderId: order.id,
            courierId: courierId || order.courier_id,
            action: 'initiate',
            pointA: coords,
            newAddress: addressTrimmed,
            timestamp: Date.now(),
          })
        }
      } else {
        // Enfileirar offline
        await offlineRouteStorage.enqueueRedirectionAction({
          id: `redir_init_${order.id}_${Date.now()}`,
          orderId: order.id,
          courierId: courierId || order.courier_id,
          action: 'initiate',
          pointA: coords,
          newAddress: addressTrimmed,
          timestamp: Date.now(),
        })
      }

      toast.dismiss(toastId)
      toast.success('Ponto A registrado! Redireção iniciada.', {
        description: `Posição inicial gravada. Navegue até o novo endereço informado.`,
      })

      onRedirectionStarted(updatedOrder)

      if (openNavigation) {
        // Abrir navegação para o novo endereço usando a ponte nativa (ou Maps/Waze no web)
        nativeGpsBridge.openNavigation({
          address: addressTrimmed,
          label: `Novo endereço (${customerName})`,
          app: 'google_maps',
        })
      }

      onOpenChange(false)
    } catch (err: any) {
      toast.dismiss(toastId)
      toast.error('Não foi possível gravar o redirecionamento. Tente novamente.')
    } finally {
      setIsCapturingGps(false)
    }
  }

  if (!order) return null

  const customerName = order.expand?.customer_id?.name || 'Cliente'
  const originalAddress =
    order.expand?.customer_id?.address ||
    order.end_address_text ||
    'Endereço original cadastrado no sistema'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-[#0E1738] border border-[#1E2B58] text-white p-5 rounded-2xl shadow-2xl">
        <DialogHeader className="space-y-1.5 text-left">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-amber-500/20 text-amber-400">
              <Compass className="h-5 w-5" />
            </span>
            <div>
              <DialogTitle className="text-base font-bold text-white flex items-center gap-2">
                Cliente em outro endereço
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-300">
                Grave o Ponto A no local atual e informe o novo endereço de entrega.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2 text-xs">
          {/* Card Endereço Original (Ponto A) */}
          <div className="p-3.5 rounded-xl bg-[#0A1128] border border-[#1E2B58] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" /> Ponto A (Local Original)
              </span>
              <Badge
                variant="outline"
                className="border-amber-500/40 text-amber-300 text-[10px] bg-amber-950/40"
              >
                Chegada no sistema
              </Badge>
            </div>
            <div>
              <p className="font-bold text-white text-xs">{customerName}</p>
              <p className="text-[11px] text-slate-300 mt-0.5">{originalAddress}</p>
            </div>
            {capturedPointA ? (
              <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-mono bg-emerald-950/40 p-1.5 rounded-lg border border-emerald-500/30">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                <span>
                  GPS Gravado: {capturedPointA.lat.toFixed(5)}, {capturedPointA.lng.toFixed(5)}
                </span>
              </div>
            ) : (
              <p className="text-[10px] text-slate-400 italic">
                Ao continuar, sua posição GPS atual será registrada como Ponto A da rota.
              </p>
            )}
          </div>

          {/* Campo Novo Endereço */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-200 flex items-center justify-between">
              <span>Novo Endereço ou Ponto de Referência</span>
              <span className="text-[10px] text-slate-400">Texto livre</span>
            </Label>
            <Input
              type="text"
              placeholder="Ex: Rua das Flores, 150 - Casa dos fundos (Trabalho do cliente)"
              value={newAddressInput}
              onChange={(e) => setNewAddressInput(e.target.value)}
              className="bg-[#0A1128] border-[#1E2B58] text-white placeholder:text-slate-500 text-xs h-10 rounded-xl"
            />
            <p className="text-[10px] text-slate-400">
              💡 Você poderá abrir a navegação (Google Maps / Waze) diretamente para este local.
            </p>
          </div>

          {/* Info sobre auditoria de KM */}
          <div className="p-3 rounded-xl bg-blue-950/40 border border-blue-500/30 flex items-start gap-2.5">
            <AlertCircle className="h-4 w-4 text-[#60A5FA] shrink-0 mt-0.5" />
            <p className="text-[11px] text-blue-200 leading-relaxed">
              O desvio real entre o Ponto A e o Ponto B será calculado via trajetória GPS. Desvios
              até <strong>3 km</strong> são aprovados automaticamente no cálculo de combustível.
              Acima disso, passarão por triagem na Central.
            </p>
          </div>
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isCapturingGps}
            className="border-[#1E2B58] text-slate-300 hover:bg-[#1E2B58] text-xs h-10 rounded-xl"
          >
            Voltar
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={() => handleInitiateRedirection(true)}
            disabled={isCapturingGps || !newAddressInput.trim()}
            className="bg-gradient-to-r from-[#0052CC] to-[#0066FF] hover:from-[#0047B3] hover:to-[#0052CC] text-white font-bold text-xs h-10 rounded-xl shadow-lg flex items-center justify-center gap-1.5 border border-blue-400/30 flex-1"
          >
            {isCapturingGps ? (
              <>
                <div className="h-3.5 w-3.5 border-2 border-white border-t-transparent animate-spin rounded-full" />
                <span>Gravando Ponto A...</span>
              </>
            ) : (
              <>
                <Navigation className="h-4 w-4 text-[#60A5FA]" />
                <span>Ir para o novo endereço</span>
                <ArrowRight className="h-3.5 w-3.5 ml-0.5" />
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
export default RedirectDeliveryModal

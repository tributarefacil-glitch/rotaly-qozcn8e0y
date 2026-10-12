import React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Check,
  Copy,
  Truck,
  MessageCircle,
  Phone,
  Clock,
  Navigation,
  MapPin,
  Compass,
  AlertOctagon,
  AlertTriangle,
  Share2,
  Star,
  Route,
  RefreshCw,
  ShieldCheck,
  Layers,
  ExternalLink,
  Sparkles,
} from 'lucide-react'
import pb from '@/lib/pocketbase/client'
import { toast as sonnerToast } from 'sonner'
import { OrderRecord, UserRecord, AppSettingsRecord, LocationRecord } from '@/types/delivery'
import { LatLngPoint, findNearestPointOnRoute } from '@/services/osrmRoutingService'
import { DEVIATION_THRESHOLD_METERS } from '@/lib/geo'
import { formatTimeInTz, formatDateInTz, parseSafeTimestamp } from '@/lib/operationalWindow'
import { getVehicleEmoji } from '@/components/LiveMap'
import { getCourierRouteColor } from '@/lib/courierRouteColors'
import { reverseGeocodeCoordinates } from '@/lib/googleMaps'
import { diagnoseCourierTelemetry } from '@/lib/courierTelemetryDiagnostics'
import {
  ActiveRouteCalculatedItem,
  ActiveRouteCourierData,
  formatVehicle,
  renderVehicleIcon,
  getEtaDisplay,
} from './utils'

interface ControlTowerModalsProps {
  // Drawer props
  isDrawerOpen: boolean
  setIsDrawerOpen: (open: boolean) => void
  selectedOrder: OrderRecord | null
  setSelectedOrder?: (order: OrderRecord | null) => void
  orderCourierInfo?: ActiveRouteCourierData
  copiedCode: string | null
  copyTracking: (code: string) => void
  openWhatsApp: (phone?: string, text?: string) => void
  makePhoneCall: (phone?: string) => void
  activeRoutesData: ActiveRouteCalculatedItem[]
  shareTrackingViaWhatsApp: (order: OrderRecord) => void
  drawerDeviationInfo: { isDeviated: boolean; meters: number } | null
  drawerUnexpectedStop: boolean
  drawerReview: any
  drawerMiniMapRef: React.RefObject<HTMLDivElement | null>
  mapsLoaded: boolean
  mapsError: boolean
  drawerMapFailed: boolean
  drawerTilesLoaded: boolean
  streetRoute: any
  recentDeviations: any[]
  handleRetryMaps: () => void
  isLoadingStreetRoute: boolean
  courierRouteOrders: OrderRecord[]
  handleOpenOrderDetails: (order: OrderRecord) => void
  setOrderToRemoveFromRoute: (order: OrderRecord | null) => void

  // Confirmation modal props
  orderToRemoveFromRoute: OrderRecord | null
  isRemovingOrderFromRoute: boolean
  handleConfirmRemoveOrderFromRoute: () => void

  // Courier modal props
  selectedCourier: UserRecord | null
  setSelectedCourier: (courier: UserRecord | null) => void
  allCourierData: ActiveRouteCourierData[]
  locations?: LocationRecord[]
  appSettings: AppSettingsRecord | null
  fetchData: () => void
  onRefresh?: () => void
  toast: (msg: any) => void
  deliveryService: any
}

export const ControlTowerModals: React.FC<ControlTowerModalsProps> = ({
  isDrawerOpen,
  setIsDrawerOpen,
  selectedOrder,
  setSelectedOrder,
  orderCourierInfo,
  copiedCode,
  copyTracking,
  openWhatsApp,
  makePhoneCall,
  activeRoutesData,
  shareTrackingViaWhatsApp,
  drawerDeviationInfo,
  drawerUnexpectedStop,
  drawerReview,
  drawerMiniMapRef,
  mapsLoaded,
  mapsError,
  drawerMapFailed,
  drawerTilesLoaded,
  streetRoute,
  recentDeviations,
  handleRetryMaps,
  isLoadingStreetRoute,
  courierRouteOrders,
  handleOpenOrderDetails,
  setOrderToRemoveFromRoute,

  orderToRemoveFromRoute,
  isRemovingOrderFromRoute,
  handleConfirmRemoveOrderFromRoute,

  selectedCourier,
  setSelectedCourier,
  allCourierData,
  locations = [],
  appSettings,
  fetchData,
  onRefresh,
  toast,
  deliveryService,
}) => {
  // Estado local para armazenar geocodificação reversa do endereço atual do entregador selecionado
  const [resolvedCourierAddress, setResolvedCourierAddress] = React.useState<string | null>(null)
  const [isLoadingCourierAddress, setIsLoadingCourierAddress] = React.useState<boolean>(false)

  // Disparar geocodificação reversa EXCLUSIVAMENTE da última posição GPS real do entregador
  // (obtida da collection locations daquele courier). Nunca da base de partida nem endereço fictício.
  React.useEffect(() => {
    if (!selectedCourier) {
      setResolvedCourierAddress(null)
      setIsLoadingCourierAddress(false)
      return
    }

    // Busca estritamente a última location real do entregador na collection locations
    const courierLocs = (locations || []).filter(
      (l) =>
        l.user_id === selectedCourier.id && typeof l.lat === 'number' && typeof l.lng === 'number',
    )
    const latestCourierLocation =
      courierLocs.length > 0
        ? [...courierLocs].sort(
            (a, b) =>
              parseSafeTimestamp(b.updated || b.created) -
              parseSafeTimestamp(a.updated || a.created),
          )[0]
        : null

    const realGpsLat =
      latestCourierLocation &&
      typeof latestCourierLocation.lat === 'number' &&
      !isNaN(latestCourierLocation.lat)
        ? latestCourierLocation.lat
        : null
    const realGpsLng =
      latestCourierLocation &&
      typeof latestCourierLocation.lng === 'number' &&
      !isNaN(latestCourierLocation.lng)
        ? latestCourierLocation.lng
        : null

    if (realGpsLat === null || realGpsLng === null) {
      setResolvedCourierAddress(null)
      setIsLoadingCourierAddress(false)
      return
    }

    let isCurrent = true
    setIsLoadingCourierAddress(true)

    reverseGeocodeCoordinates(realGpsLat, realGpsLng, { toleranceMeters: 50 })
      .then((res) => {
        if (!isCurrent) return
        const formatted = res?.streetAndNumber
          ? `${res.streetAndNumber}${res.neighborhood ? ` - ${res.neighborhood}` : ''}${res.city ? `, ${res.city}` : ''}`
          : res?.formattedAddress || `Lat: ${realGpsLat.toFixed(5)}, Lng: ${realGpsLng.toFixed(5)}`
        setResolvedCourierAddress(formatted)
      })
      .catch(() => {
        if (!isCurrent) return
        setResolvedCourierAddress(`Lat: ${realGpsLat.toFixed(5)}, Lng: ${realGpsLng.toFixed(5)}`)
      })
      .finally(() => {
        if (isCurrent) setIsLoadingCourierAddress(false)
      })

    return () => {
      isCurrent = false
    }
  }, [selectedCourier?.id, locations])

  return (
    <>
      {/* 5. DRAWER / SHEET DE DETALHE EM TEMPO REAL AO CLICAR NO CARD DO CLIENTE */}
      <Sheet open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md md:max-w-lg bg-white border-l border-slate-200 text-[#002855] p-0 flex flex-col overflow-hidden"
        >
          {selectedOrder && (
            <>
              {/* Drawer Header */}
              <div className="p-5 border-b border-[#1E2B58] bg-[#070D1E]/80">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-black text-[#60A5FA]">
                        {selectedOrder.tracking_code}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0 text-slate-400 hover:text-white"
                        title="Copiar link de rastreio"
                        onClick={() => copyTracking(selectedOrder.tracking_code)}
                      >
                        {copiedCode === selectedOrder.tracking_code ? (
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                    <SheetTitle className="text-xl font-black text-white font-heading mt-1">
                      {selectedOrder.expand?.customer_id?.name || 'Cliente'}
                    </SheetTitle>
                    <SheetDescription className="text-xs text-slate-400 mt-0.5">
                      Monitoramento em tempo real com GPS e trajeto
                    </SheetDescription>
                  </div>

                  {/* Status Badge */}
                  <div>
                    {selectedOrder.status === 'delivered' ? (
                      <Badge className="bg-emerald-600 text-white font-bold text-xs">
                        {selectedOrder.entrega_geofence_flag === 'pendente_aprovacao_gt_500m'
                          ? '✓ Entregue (Aprovação Pendente)'
                          : '✓ Entregue'}
                      </Badge>
                    ) : selectedOrder.status === 'in_transit' || selectedOrder.route_started ? (
                      <Badge className="bg-blue-600 text-white font-bold text-xs animate-pulse">
                        🛵 Em Trânsito
                      </Badge>
                    ) : selectedOrder.status === 'address_error' ||
                      selectedOrder.status === 'client_absent' ? (
                      <Badge className="bg-rose-600 text-white font-bold text-xs">
                        ⚠️ Ocorrência
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-slate-600 text-slate-300 font-bold text-xs"
                      >
                        Aguardando Início
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* Drawer Body (Scrollable) */}
              <div className="flex-1 overflow-y-auto p-5 space-y-5 scrollbar-thin scrollbar-thumb-slate-800">
                {/* BANNER DE APROVAÇÃO PENDENTE DE GEOFENCE >500M */}
                {selectedOrder.entrega_geofence_flag === 'pendente_aprovacao_gt_500m' && (
                  <div className="rounded-2xl border-2 border-amber-500/70 bg-gradient-to-r from-amber-950/60 via-[#1c1606] to-[#0E1738] p-4 space-y-2.5 shadow-lg">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 text-amber-300">
                        <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" />
                        <div>
                          <h4 className="font-bold text-sm text-white">
                            Aprovação pendente — entregue a{' '}
                            {selectedOrder.entrega_fora_pin_m
                              ? selectedOrder.entrega_fora_pin_m >= 1000
                                ? `${(selectedOrder.entrega_fora_pin_m / 1000).toFixed(1)} km`
                                : `${selectedOrder.entrega_fora_pin_m} m`
                              : '&gt;500m'}{' '}
                            do pin
                          </h4>
                          <p className="text-xs text-amber-200/80 mt-0.5">
                            O entregador concluiu a entrega com assinatura coletada. A central pode
                            aprovar ou auditar a calibração do pin do cliente.
                          </p>
                        </div>
                      </div>
                      <Badge className="bg-amber-500 text-white font-bold text-[10px] uppercase">
                        Aprovação Pendente
                      </Badge>
                    </div>

                    <div className="flex items-center gap-2 pt-1 flex-wrap">
                      <Button
                        type="button"
                        size="sm"
                        onClick={async () => {
                          try {
                            const adminId = pb.authStore.record?.id || ''
                            const adminName = pb.authStore.record?.name || 'Administrador'
                            await deliveryService.updateOrder(selectedOrder.id, {
                              entrega_geofence_flag: 'aprovado_admin',
                              entrega_admin_unlock_by: adminId,
                              entrega_admin_unlock_reason:
                                'Aprovado pelo administrador na Torre de Controle',
                            })
                            await deliveryService.logAuditTrail({
                              action: 'geofence_admin_unlock',
                              user_id: adminId,
                              actor_name: adminName,
                              collection: 'orders',
                              record_id: selectedOrder.id,
                              field: 'entrega_geofence_flag',
                              old_value: 'pendente_aprovacao_gt_500m',
                              new_value: 'aprovado_admin',
                              courier_id: selectedOrder.courier_id,
                              empresa_id: selectedOrder.empresa_id,
                              metadata: {
                                order_id: selectedOrder.id,
                                tracking_code: selectedOrder.tracking_code,
                                admin_user_id: adminId,
                                admin_user_name: adminName,
                                distance_m: selectedOrder.entrega_fora_pin_m || 0,
                                reason: 'Aprovado na Torre de Controle',
                              },
                            })
                            if (setSelectedOrder) {
                              setSelectedOrder({
                                ...selectedOrder,
                                entrega_geofence_flag: 'aprovado_admin',
                              })
                            }
                            fetchData()
                            sonnerToast.success(
                              `Entrega ${selectedOrder.tracking_code} aprovada pelo administrador com sucesso!`,
                            )
                          } catch (errApprove) {
                            console.error('Erro ao aprovar entrega:', errApprove)
                            sonnerToast.error('Não foi possível aprovar a entrega.')
                          }
                        }}
                        className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5 rounded-xl shadow-sm"
                      >
                        <ShieldCheck className="h-4 w-4" />
                        Aprovar Entrega
                      </Button>

                      {selectedOrder.customer_id && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const cust = selectedOrder.expand?.customer_id
                            if (cust?.lat && cust?.lng) {
                              window.open(
                                `https://www.google.com/maps?q=${cust.lat},${cust.lng}`,
                                '_blank',
                              )
                            } else {
                              sonnerToast.info('Cliente sem coordenadas para abrir no mapa.')
                            }
                          }}
                          className="h-8 border-amber-500/40 bg-amber-950/40 hover:bg-amber-900/60 text-amber-200 font-bold text-xs gap-1.5 rounded-xl"
                        >
                          <MapPin className="h-4 w-4 text-amber-400" />
                          Auditar Endereço no Maps
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {/* CARD 1: QUAL ENTREGADOR ESTÁ COM A ENTREGA */}
                <div className="rounded-2xl border border-[#1E2B58] bg-[#0E1738] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Truck className="h-3.5 w-3.5 text-[#60A5FA]" />
                      Entregador Responsável
                    </span>
                    {orderCourierInfo?.hasRouteStarted && (
                      <span className="text-[10px] text-blue-400 font-bold bg-blue-500/10 px-2 py-0.5 rounded-full border border-blue-500/30">
                        GPS Ativo
                      </span>
                    )}
                  </div>

                  {orderCourierInfo ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="h-11 w-11 rounded-full bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-blue-300 font-bold text-sm">
                            {orderCourierInfo.courier.name
                              ? orderCourierInfo.courier.name.slice(0, 2).toUpperCase()
                              : 'EN'}
                          </div>
                          <div>
                            <h4 className="font-bold text-white text-sm">
                              {orderCourierInfo.courier.name || orderCourierInfo.courier.email}
                            </h4>
                            <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                              {renderVehicleIcon(orderCourierInfo.vehicle)}
                              <span>{formatVehicle(orderCourierInfo.vehicle)}</span>
                              <span>
                                • Placa: {orderCourierInfo.courier.vehicle_plate || 'S/N'}
                              </span>
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Botões de Ação Imediata: WhatsApp & Ligação */}
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <Button
                          size="sm"
                          onClick={() =>
                            openWhatsApp(
                              orderCourierInfo.courier.phone,
                              `Olá ${orderCourierInfo.courier.name || ''}, sobre a entrega ${selectedOrder.tracking_code} do cliente ${selectedOrder.expand?.customer_id?.name || ''}:`,
                            )
                          }
                          className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5 rounded-xl shadow-sm"
                        >
                          <MessageCircle className="h-4 w-4" />
                          WhatsApp
                        </Button>

                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => makePhoneCall(orderCourierInfo.courier.phone)}
                          className="h-9 border-blue-500/40 bg-blue-950/40 hover:bg-blue-900/60 text-blue-300 hover:text-white font-bold text-xs gap-1.5 rounded-xl"
                        >
                          <Phone className="h-4 w-4" />
                          Ligar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 text-center text-xs text-slate-400 border border-dashed border-slate-700 rounded-xl bg-[#070D1E]/40">
                      Nenhum entregador atribuído ainda a este pedido.
                    </div>
                  )}
                </div>

                {/* CARD 2: PREVISÃO DE CHEGADA (ETA) & STATUS */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-blue-500/40 bg-[#0E1F47] p-3.5 space-y-1">
                    <span className="text-[11px] font-bold text-blue-300 uppercase tracking-wider flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-blue-400" />
                      Previsão &amp; Volta à Base
                    </span>
                    <p className="text-base sm:text-lg font-black text-white font-mono leading-tight">
                      {(() => {
                        const rInfo = activeRoutesData.find(
                          (r) =>
                            r.orderId === selectedOrder.id ||
                            r.courierId === selectedOrder.courier_id,
                        )
                        if (rInfo?.etaNextDeliveryTime && rInfo?.etaReturnBaseTime) {
                          return `Entrega ~${rInfo.etaNextDeliveryTime}`
                        }
                        if (rInfo?.etaReturnBaseTime && !rInfo?.etaNextDeliveryTime) {
                          return `Chegada Base ~${rInfo.etaReturnBaseTime}`
                        }
                        if (rInfo?.etaNextDeliveryTime) {
                          return `Entrega ~${rInfo.etaNextDeliveryTime}`
                        }
                        return getEtaDisplay(selectedOrder)
                      })()}
                    </p>
                    <p className="text-[10px] text-slate-300">
                      {(() => {
                        const rInfo = activeRoutesData.find(
                          (r) =>
                            r.orderId === selectedOrder.id ||
                            r.courierId === selectedOrder.courier_id,
                        )
                        if (rInfo?.etaReturnBaseTime) {
                          return `🏢 Volta à base ~${rInfo.etaReturnBaseTime}`
                        }
                        return selectedOrder.estimated_duration_minutes
                          ? `Trajeto de aprox. ${selectedOrder.estimated_duration_minutes} min`
                          : 'Calculada com velocidade real do GPS'
                      })()}
                    </p>
                  </div>

                  <div className="rounded-xl border border-[#1E2B58] bg-[#0E1738] p-3.5 space-y-1">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                      <Navigation className="h-3.5 w-3.5 text-orange-400" />
                      Posição na Rota
                    </span>
                    <p className="text-xl font-black text-white font-mono">
                      {selectedOrder.sequence ? `Parada #${selectedOrder.sequence}` : 'Fila Geral'}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      {selectedOrder.distance_km ? `${selectedOrder.distance_km} km` : 'Em rota'}
                    </p>
                  </div>
                </div>

                {/* CARD 3: DADOS DO CLIENTE & ENDEREÇO DE ENTREGA */}
                <div className="rounded-2xl border border-[#1E2B58] bg-[#0E1738] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-[#FF6B35]" />
                      Destino da Entrega
                    </span>
                    {selectedOrder.expand?.customer_id?.phone && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          openWhatsApp(
                            selectedOrder.expand?.customer_id?.phone,
                            `Olá ${selectedOrder.expand?.customer_id?.name || ''}! Somos da Rotaly acompanhando sua entrega cód ${selectedOrder.tracking_code}.`,
                          )
                        }
                        className="h-6 text-[11px] text-emerald-400 hover:bg-emerald-500/10 px-2 font-bold"
                      >
                        <MessageCircle className="h-3 w-3 mr-1" />
                        Falar c/ Cliente
                      </Button>
                    )}
                  </div>

                  <div>
                    <h5 className="font-bold text-white text-sm">
                      {selectedOrder.expand?.customer_id?.name || 'Cliente'}
                    </h5>
                    <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                      {selectedOrder.expand?.customer_id?.address || 'Endereço não informado'}
                    </p>
                    {selectedOrder.expand?.customer_id?.phone && (
                      <p className="text-[11px] text-slate-400 mt-1">
                        Telefone: {selectedOrder.expand?.customer_id?.phone}
                      </p>
                    )}
                  </div>
                </div>

                {/* CARD 4: MINI-MAPA DA ROTA DO ENTREGADOR */}
                <div className="rounded-2xl border border-[#1E2B58] bg-[#0E1738] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Compass className="h-3.5 w-3.5 text-[#60A5FA]" />
                      Posição no Mapa &amp; Trajeto
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {typeof orderCourierInfo?.lat === 'number' &&
                      typeof orderCourierInfo?.lng === 'number'
                        ? `${orderCourierInfo.lat.toFixed(4)}, ${orderCourierInfo.lng.toFixed(4)}`
                        : '—'}
                    </span>
                  </div>

                  {/* Badges de alerta em tempo real no topo do card do mini-mapa */}
                  {(drawerDeviationInfo?.isDeviated || drawerUnexpectedStop) && (
                    <div className="flex flex-wrap items-center gap-2">
                      {drawerDeviationInfo?.isDeviated && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/20 border border-rose-500/60 text-rose-300 text-xs font-bold animate-pulse">
                          <AlertOctagon className="h-3.5 w-3.5 text-rose-400" />
                          <span>
                            DESVIO DETECTADO ({drawerDeviationInfo.meters} metros da rota indicada)
                          </span>
                        </div>
                      )}
                      {drawerUnexpectedStop && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-500/60 text-amber-300 text-xs font-bold">
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                          <span>PARADA FORA DO LOCAL (Entregador parado fora do destino)</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* SEÇÃO DESTACADA: COMPARTILHAMENTO DO LINK DE RASTREIO DO CLIENTE */}
                  <div className="rounded-xl border border-blue-500/30 bg-gradient-to-r from-blue-950/70 via-[#0B1A40] to-slate-900 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-blue-300 uppercase tracking-wider flex items-center gap-1.5">
                        <Share2 className="h-3.5 w-3.5 text-blue-400" />
                        Link de Acompanhamento do Cliente
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        /track/{selectedOrder.tracking_code}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-0.5">
                      <Button
                        size="sm"
                        onClick={() => copyTracking(selectedOrder.tracking_code)}
                        className={`h-8 text-xs font-bold gap-1.5 rounded-lg transition-all ${
                          copiedCode === selectedOrder.tracking_code
                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm'
                            : 'bg-blue-600 hover:bg-blue-700 text-white shadow-brand'
                        }`}
                        title="Copiar URL pública completa para a área de transferência"
                      >
                        {copiedCode === selectedOrder.tracking_code ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-white" />
                            <span>Link Copiado!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            <span>Copiar Link de Acompanhamento</span>
                          </>
                        )}
                      </Button>

                      <Button
                        size="sm"
                        onClick={() => shareTrackingViaWhatsApp(selectedOrder)}
                        className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5 rounded-lg shadow-sm"
                        title="Enviar link formatado diretamente para o WhatsApp do cliente"
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                        <span>Enviar por WhatsApp</span>
                      </Button>
                    </div>
                  </div>

                  {/* AVALIAÇÃO DO CLIENTE (SE HOUVER REGISTRO EM reviews) */}
                  {drawerReview && (
                    <div className="rounded-xl border border-amber-500/40 bg-gradient-to-br from-amber-950/40 via-[#1a1408] to-slate-950 p-3.5 space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                          <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />
                          Avaliação do Cliente
                        </span>
                        {drawerReview.created && (
                          <span className="text-[10px] text-slate-400">
                            {`${formatDateInTz(drawerReview.created)} ${formatTimeInTz(drawerReview.created)}`}
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800">
                          <span className="text-[10px] text-slate-400 block mb-0.5">
                            Nota Entregador:
                          </span>
                          <div className="flex items-center gap-1">
                            <div className="flex">
                              {[1, 2, 3, 4, 5].map((star) => (
                                <Star
                                  key={star}
                                  className={`h-3 w-3 ${
                                    star <= (drawerReview.courier_rating || 0)
                                      ? 'text-amber-400 fill-amber-400'
                                      : 'text-slate-600'
                                  }`}
                                />
                              ))}
                            </div>
                            <span className="font-bold text-white text-xs ml-1 font-mono">
                              {drawerReview.courier_rating}/5
                            </span>
                          </div>
                        </div>

                        <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800">
                          <span className="text-[10px] text-slate-400 block mb-0.5">
                            Nota Loja:
                          </span>
                          <div className="flex items-center gap-1">
                            <div className="flex">
                              {[1, 2, 3, 4, 5].map((star) => (
                                <Star
                                  key={star}
                                  className={`h-3 w-3 ${
                                    star <= (drawerReview.seller_rating || 0)
                                      ? 'text-amber-400 fill-amber-400'
                                      : 'text-slate-600'
                                  }`}
                                />
                              ))}
                            </div>
                            <span className="font-bold text-white text-xs ml-1 font-mono">
                              {drawerReview.seller_rating}/5
                            </span>
                          </div>
                        </div>
                      </div>

                      {drawerReview.comment && (
                        <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 text-slate-200 text-xs italic">
                          &ldquo;{drawerReview.comment}&rdquo;
                          {drawerReview.customer_name && (
                            <span className="block not-italic text-[10px] text-slate-400 mt-1 text-right font-medium">
                              — {drawerReview.customer_name}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="relative w-full h-[250px] rounded-xl overflow-hidden border border-[#1E2B58] bg-[#070D1E]">
                    {/* Google Mini Map Container (visível SOMENTE se mapsLoaded && !mapsError && !drawerMapFailed && drawerTilesLoaded) */}
                    <div
                      ref={drawerMiniMapRef}
                      className={`w-full h-full ${
                        mapsLoaded && !mapsError && !drawerMapFailed && drawerTilesLoaded
                          ? 'block'
                          : 'hidden'
                      }`}
                    />

                    {/* Fallback Vetorial Interativo com Ruas Reais OSRM, Linha da Rota e Linha Vermelha de Desvio: ativo quando Google não renderizou ou falhou */}
                    {(!mapsLoaded || mapsError || drawerMapFailed || !drawerTilesLoaded) &&
                      (() => {
                        const cust = selectedOrder.expand?.customer_id
                        const drawerCourierId =
                          selectedOrder.courier_id || orderCourierInfo?.courier?.id
                        const drawerCourierColor = getCourierRouteColor(drawerCourierId)
                        const baseLat = selectedOrder.start_base_lat
                          ? Number(selectedOrder.start_base_lat)
                          : cust?.lat
                            ? Number(cust.lat)
                            : -22.906847
                        const baseLng = selectedOrder.start_base_lng
                          ? Number(selectedOrder.start_base_lng)
                          : cust?.lng
                            ? Number(cust.lng)
                            : -43.172896
                        const clientLat = cust?.lat ? Number(cust.lat) : baseLat
                        const clientLng = cust?.lng ? Number(cust.lng) : baseLng

                        // Posição do entregador se houver telemetria válida
                        const courierLat =
                          typeof orderCourierInfo?.lat === 'number'
                            ? orderCourierInfo.lat
                            : (baseLat + clientLat) / 2
                        const courierLng =
                          typeof orderCourierInfo?.lng === 'number'
                            ? orderCourierInfo.lng
                            : (baseLng + clientLng) / 2

                        // Coordenadas da rota real (ou pontos interpolados de rua)
                        const routeCoords: LatLngPoint[] =
                          streetRoute && streetRoute.coordinates.length >= 2
                            ? streetRoute.coordinates
                            : [
                                { lat: baseLat, lng: baseLng },
                                { lat: baseLat + 0.008, lng: baseLng + 0.004 },
                                { lat: baseLat + 0.016, lng: baseLng + 0.018 },
                                { lat: clientLat - 0.009, lng: clientLng - 0.012 },
                                { lat: clientLat, lng: clientLng },
                              ]

                        // Cálculo de bounding box para projeção SVG no canvas
                        const allLats = [
                          ...routeCoords.map((c) => c.lat),
                          baseLat,
                          clientLat,
                          courierLat,
                        ]
                        const allLngs = [
                          ...routeCoords.map((c) => c.lng),
                          baseLng,
                          clientLng,
                          courierLng,
                        ]
                        const minLat = Math.min(...allLats)
                        const maxLat = Math.max(...allLats)
                        const minLng = Math.min(...allLngs)
                        const maxLng = Math.max(...allLngs)

                        const latSpan = Math.max(maxLat - minLat, 0.004)
                        const lngSpan = Math.max(maxLng - minLng, 0.004)

                        // Função de projeção lat/lng -> porcentagem (%) no canvas com margem de 10%
                        const padPercent = 12
                        const toCanvas = (lat: number, lng: number) => {
                          const x = padPercent + ((lng - minLng) / lngSpan) * (100 - 2 * padPercent)
                          // Inversão do eixo Y (latitude sobe para o norte / topo do mapa)
                          const y =
                            100 - padPercent - ((lat - minLat) / latSpan) * (100 - 2 * padPercent)
                          return {
                            x: Math.max(4, Math.min(96, x)),
                            y: Math.max(4, Math.min(96, y)),
                          }
                        }

                        // Gerar string SVG Path com o percurso real pelas ruas (LINHA AZUL)
                        const blueSvgPath = routeCoords
                          .map((c, i) => {
                            const p = toCanvas(c.lat, c.lng)
                            return `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`
                          })
                          .join(' ')

                        // Identificar se o entregador está em desvio (coleção off_route_events ou distância > DEVIATION_THRESHOLD_METERS)
                        // REQUISITO: Apenas se selectedOrder.status === 'in_transit' && selectedOrder.route_started === true
                        const isSelectedOrderInActiveRoute =
                          selectedOrder.status === 'in_transit' &&
                          selectedOrder.route_started === true

                        const courierPoint: LatLngPoint = { lat: courierLat, lng: courierLng }
                        const nearest = findNearestPointOnRoute(courierPoint, routeCoords)
                        const selectedRouteStartTime = selectedOrder.route_started_at
                          ? new Date(selectedOrder.route_started_at).getTime()
                          : 0
                        const hasDeviationFlag =
                          isSelectedOrderInActiveRoute &&
                          recentDeviations.some((dev) => {
                            if (dev.courier_id !== orderCourierInfo?.courier?.id) return false
                            if (dev.order_id !== selectedOrder.id) return false
                            if (dev.resolved === true) return false
                            if (selectedRouteStartTime && dev.created) {
                              const devTime = new Date(dev.created).getTime()
                              if (!isNaN(devTime) && devTime < selectedRouteStartTime) return false
                            }
                            return true
                          })
                        const isDeviated =
                          isSelectedOrderInActiveRoute &&
                          orderCourierInfo?.hasRouteStarted &&
                          (hasDeviationFlag || nearest.distanceMeters > DEVIATION_THRESHOLD_METERS)

                        const courierPos = toCanvas(courierLat, courierLng)
                        const nearestPos = toCanvas(
                          nearest.nearestPoint.lat,
                          nearest.nearestPoint.lng,
                        )
                        const basePos = toCanvas(baseLat, baseLng)
                        const clientPos = toCanvas(clientLat, clientLng)

                        return (
                          <div className="relative w-full h-full flex flex-col justify-between p-2.5 bg-gradient-to-br from-slate-950 via-[#071126] to-[#040915] text-white select-none overflow-hidden">
                            {/* Malha de ruas vetorial estilizada (map tile feeling) */}
                            <div className="absolute inset-0 opacity-20 pointer-events-none bg-[radial-gradient(#38bdf8_1px,transparent_1px)] [background-size:16px_16px]" />

                            {/* SVG do Percurso Real com Ruas (LINHA AZUL) + Desvio (LINHA VERMELHA) */}
                            <svg
                              viewBox="0 0 100 100"
                              preserveAspectRatio="none"
                              className="absolute inset-0 w-full h-full pointer-events-none z-0"
                            >
                              <defs>
                                {/* Efeito glow para a linha azul */}
                                <filter id="blue-glow" x="-20%" y="-20%" width="140%" height="140%">
                                  <feDropShadow
                                    dx="0"
                                    dy="0"
                                    stdDeviation="1"
                                    floodColor="#3B82F6"
                                    floodOpacity="0.8"
                                  />
                                </filter>
                                {/* Efeito glow para a linha vermelha */}
                                <filter id="red-glow" x="-20%" y="-20%" width="140%" height="140%">
                                  <feDropShadow
                                    dx="0"
                                    dy="0"
                                    stdDeviation="1.5"
                                    floodColor="#EF4444"
                                    floodOpacity="0.9"
                                  />
                                </filter>
                              </defs>

                              {/* LINHA DA ROTA: Trajeto Viário Indicado pelo Sistema na cor fixa do entregador */}
                              {blueSvgPath && (
                                <>
                                  {/* Traçado de fundo largo para contraste de rua */}
                                  <path
                                    d={blueSvgPath}
                                    fill="none"
                                    stroke="#0f172a"
                                    strokeWidth="4"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    opacity="0.8"
                                  />
                                  {/* Traçado principal na cor do entregador */}
                                  <path
                                    d={blueSvgPath}
                                    fill="none"
                                    stroke={drawerCourierColor.stroke}
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                  {/* Linha interna guia com brilho suave */}
                                  <path
                                    d={blueSvgPath}
                                    fill="none"
                                    stroke={drawerCourierColor.inner}
                                    strokeWidth="0.8"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </>
                              )}

                              {/* LINHA VERMELHA: Caso o entregador faça um desvio de rota */}
                              {isDeviated && (
                                <>
                                  {/* Linha de desvio conectando a posição do entregador até o ponto de retorno na rota */}
                                  <line
                                    x1={courierPos.x}
                                    y1={courierPos.y}
                                    x2={nearestPos.x}
                                    y2={nearestPos.y}
                                    stroke="#EF4444"
                                    strokeWidth="2.5"
                                    strokeDasharray="2,1.5"
                                    strokeLinecap="round"
                                    filter="url(#red-glow)"
                                  />
                                  {/* Marcador circular no ponto onde o entregador saiu da rota */}
                                  <circle
                                    cx={nearestPos.x}
                                    cy={nearestPos.y}
                                    r="1.8"
                                    fill="#EF4444"
                                    stroke="#FFFFFF"
                                    strokeWidth="0.5"
                                  />
                                </>
                              )}
                            </svg>

                            {/* Top bar do mini-mapa com tags de Trajeto Real, Alerta de Desvio e Retry */}
                            <div className="relative z-10 flex items-center justify-between text-[11px] gap-2">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-950/90 border border-blue-500/40 text-blue-300 font-bold text-[10px]">
                                  <Route className="h-3 w-3 text-blue-400" />
                                  {streetRoute?.isRealStreetRoute
                                    ? `Trajeto Viário Real (${streetRoute.coordinates.length} nós)`
                                    : 'Trajeto de Ruas'}
                                </span>

                                {isDeviated ? (
                                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-950/90 border border-rose-500/60 text-rose-300 font-bold text-[10px] animate-pulse">
                                    <AlertOctagon className="h-3 w-3 text-rose-400" />
                                    DESVIO DETECTADO ({Math.round(nearest.distanceMeters)}m)
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-950/80 border border-emerald-500/30 text-emerald-300 text-[10px]">
                                    <ShieldCheck className="h-3 w-3 text-emerald-400" />
                                    Na rota indicada
                                  </span>
                                )}
                              </div>

                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={handleRetryMaps}
                                className="h-6 px-2 text-[10px] bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-slate-700 gap-1 rounded-md shrink-0"
                                title="Tentar carregar Google Maps nativo"
                              >
                                <RefreshCw className="h-3 w-3" />
                                <span>Tentar Google Maps</span>
                              </Button>
                            </div>

                            {/* Pontos Marcadores no Canvas Vetorial */}
                            <div className="relative w-full flex-1 pointer-events-none">
                              {/* 1. Base de Partida 🟢 */}
                              <div
                                style={{ left: `${basePos.x}%`, top: `${basePos.y}%` }}
                                className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-auto"
                              >
                                <div className="h-6 w-6 rounded-full bg-emerald-500/25 border-2 border-emerald-400 text-emerald-300 flex items-center justify-center text-[10px] shadow-lg shadow-emerald-500/30">
                                  🟢
                                </div>
                                <span className="mt-0.5 px-1.5 py-0.2 rounded bg-slate-900/90 border border-slate-800 text-[8px] font-bold text-emerald-300 whitespace-nowrap shadow">
                                  {selectedOrder.start_base_name || 'Partida'}
                                </span>
                              </div>

                              {/* 2. Entregador 🛵 (Com indicador de desvio em vermelho se aplicável) */}
                              {orderCourierInfo && (
                                <div
                                  style={{ left: `${courierPos.x}%`, top: `${courierPos.y}%` }}
                                  className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-auto z-20"
                                >
                                  {isDeviated && (
                                    <span className="absolute -top-3 px-1 py-0.2 rounded bg-rose-600 text-white text-[7px] font-extrabold uppercase tracking-wider animate-bounce shadow">
                                      Desvio
                                    </span>
                                  )}
                                  <span
                                    className={`absolute -inset-1 rounded-full animate-ping ${
                                      isDeviated ? 'bg-rose-500/50' : 'bg-blue-400/40'
                                    }`}
                                  />
                                  <div
                                    className={`h-7 w-7 rounded-full border-2 text-white flex items-center justify-center text-[13px] shadow-lg ${
                                      isDeviated
                                        ? 'bg-rose-600 border-rose-300 shadow-rose-500/50'
                                        : 'border-white/80 shadow-md'
                                    }`}
                                    style={
                                      !isDeviated
                                        ? { backgroundColor: drawerCourierColor.stroke }
                                        : undefined
                                    }
                                  >
                                    {getVehicleEmoji(orderCourierInfo.courier?.vehicle_type)}
                                  </div>
                                  <span
                                    className={`mt-0.5 px-1.5 py-0.2 rounded text-[8px] font-bold whitespace-nowrap shadow border ${
                                      isDeviated
                                        ? 'bg-rose-950/95 border-rose-500 text-rose-200'
                                        : 'bg-slate-950/95 border-slate-700 text-slate-100'
                                    }`}
                                  >
                                    {orderCourierInfo.courier?.name
                                      ? orderCourierInfo.courier.name.split(' ')[0]
                                      : 'Entregador'}
                                    {orderCourierInfo.speed
                                      ? ` • ${orderCourierInfo.speed}km/h`
                                      : ''}
                                  </span>
                                </div>
                              )}

                              {/* 3. Cliente Destino 🏁 com Badge de Ordem de entrega e mesma cor do entregador */}
                              <div
                                style={{ left: `${clientPos.x}%`, top: `${clientPos.y}%` }}
                                className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-auto"
                              >
                                {typeof selectedOrder.sequence === 'number' &&
                                  selectedOrder.sequence > 0 && (
                                    <span
                                      className="absolute -top-2 -right-2 z-10 flex h-3.5 min-w-3.5 px-1 items-center justify-center rounded-full bg-white text-[8px] font-black shadow"
                                      style={{
                                        color: drawerCourierColor.stroke,
                                        borderColor: drawerCourierColor.stroke,
                                        borderWidth: '1px',
                                      }}
                                    >
                                      {selectedOrder.sequence}
                                    </span>
                                  )}
                                <div
                                  className="h-6 w-6 rounded-full border-2 text-white flex items-center justify-center text-[10px] shadow-lg"
                                  style={{
                                    backgroundColor: drawerCourierColor.stroke,
                                    borderColor: '#FFFFFF',
                                  }}
                                >
                                  🏁
                                </div>
                                <span className="mt-0.5 px-1.5 py-0.2 rounded bg-slate-900/95 border border-[#1E2B58] text-[8px] font-bold text-white whitespace-nowrap shadow max-w-[120px] truncate">
                                  {selectedOrder.sequence ? `#${selectedOrder.sequence} ` : ''}
                                  {selectedOrder.expand?.customer_id?.name || 'Cliente'}
                                </span>
                              </div>
                            </div>

                            {/* Barra inferior: dados de trajeto real e legenda explicativa das cores */}
                            <div className="relative z-10 bg-slate-900/95 border border-slate-800/80 rounded-lg p-1.5 px-2 text-[10px] text-slate-300 flex items-center justify-between">
                              <span className="truncate max-w-[210px] text-slate-300">
                                🏁{' '}
                                {selectedOrder.expand?.customer_id?.address || 'Destino da Entrega'}
                              </span>
                              <div className="flex items-center gap-1.5 shrink-0 ml-1">
                                {isLoadingStreetRoute && (
                                  <span className="text-[9px] text-blue-300 flex items-center gap-1">
                                    <RefreshCw className="h-2.5 w-2.5 animate-spin" /> Ruas...
                                  </span>
                                )}
                                <span className="font-mono text-blue-300 font-bold">
                                  {getEtaDisplay(selectedOrder)}
                                </span>
                              </div>
                            </div>
                          </div>
                        )
                      })()}
                  </div>

                  {/* Legenda explicativa com as linhas da ROTA e DESVIO e símbolos no drawer */}
                  <div className="flex flex-wrap items-center justify-between text-[10px] text-slate-300 pt-2 border-t border-[#1E2B58] gap-2 font-sans">
                    <span className="flex items-center gap-1.5 font-medium">
                      <span className="h-1.5 w-4 rounded-full bg-blue-500 shadow-[0_0_8px_#3b82f6] inline-block" />
                      <span className="text-blue-300 font-bold">Rota Indicada</span>
                    </span>
                    <span className="flex items-center gap-1.5 font-medium">
                      <span className="h-1.5 w-4 rounded-full bg-rose-500 shadow-[0_0_8px_#ef4444] inline-block" />
                      <span className="text-rose-400 font-bold">Linha de Desvio</span> (&gt;600m)
                    </span>
                    <span className="flex items-center gap-1 text-slate-300">
                      <span>🛵 🚗 🚛 🚲</span>
                      <span>Entregador</span>
                    </span>
                    <span className="flex items-center gap-1 text-slate-300">
                      <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 text-[8px] font-bold text-white">
                        1
                      </span>
                      <span>Cliente (cor do entregador)</span>
                    </span>
                  </div>
                </div>

                {/* CARD 5: FLUXO DE PARADAS DA ROTA DAQUELE ENTREGADOR */}
                {courierRouteOrders.length > 0 && (
                  <div className="rounded-2xl border border-[#1E2B58] bg-[#0E1738] p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Layers className="h-3.5 w-3.5 text-emerald-400" />
                        Rota do Entregador ({courierRouteOrders.length} paradas)
                      </span>
                    </div>

                    <div className="space-y-2">
                      {/* Partida */}
                      <div className="flex items-center gap-2.5 text-xs text-slate-300">
                        <span className="h-5 w-5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 font-bold flex items-center justify-center text-[10px] shrink-0">
                          🟢
                        </span>
                        <div className="truncate">
                          <p className="font-semibold text-white truncate">
                            {selectedOrder.start_base_name || 'Base de Partida'}
                          </p>
                          <p className="text-[10px] text-slate-400 truncate">
                            {selectedOrder.start_base_address || 'Ponto inicial'}
                          </p>
                        </div>
                      </div>

                      {/* Paradas numeradas */}
                      {courierRouteOrders.map((o, idx) => {
                        const isCurrent = o.id === selectedOrder.id
                        const isDone = o.status === 'delivered'

                        return (
                          <div
                            key={o.id}
                            onClick={() => handleOpenOrderDetails(o)}
                            className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition text-xs ${
                              isCurrent
                                ? 'bg-blue-950/80 border border-blue-500/50 text-white font-bold'
                                : 'bg-[#070D1E]/60 hover:bg-[#121E46]/60 border border-transparent text-slate-300'
                            }`}
                          >
                            <div className="flex items-center gap-2 truncate">
                              <span
                                className={`h-5 w-5 rounded-full font-bold flex items-center justify-center text-[10px] shrink-0 ${
                                  isDone
                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                    : isCurrent
                                      ? 'bg-blue-500 text-white'
                                      : 'bg-slate-800 text-slate-400'
                                }`}
                              >
                                {isDone ? '✓' : idx + 1}
                              </span>
                              <span className="truncate">
                                {o.expand?.customer_id?.name || o.tracking_code}
                              </span>
                            </div>

                            <span className="text-[10px] text-slate-400 font-mono shrink-0 ml-2">
                              {o.status === 'delivered'
                                ? o.actual_arrival
                                  ? formatTimeInTz(o.actual_arrival)
                                  : 'Entregue'
                                : o.estimated_arrival
                                  ? formatTimeInTz(o.estimated_arrival)
                                  : 'Pendente'}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Comprovante Digital se Entregue */}
                {selectedOrder.status === 'delivered' &&
                  (selectedOrder.proof_photo || selectedOrder.signature) && (
                    <div className="rounded-2xl border border-emerald-500/30 bg-[#0b2120]/60 p-4 space-y-3">
                      <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Comprovante Digital de Entrega
                      </span>

                      <div className="grid grid-cols-2 gap-2">
                        {selectedOrder.proof_photo && (
                          <div>
                            <p className="text-[10px] text-slate-400 mb-1">Foto da Entrega:</p>
                            <img
                              src={selectedOrder.proof_photo}
                              alt="Foto da Entrega"
                              className="w-full h-24 object-cover rounded-xl border border-emerald-500/30"
                            />
                          </div>
                        )}
                        {selectedOrder.signature && (
                          <div>
                            <p className="text-[10px] text-slate-400 mb-1">
                              Assinatura do Recebedor:
                            </p>
                            <img
                              src={selectedOrder.signature}
                              alt="Assinatura"
                              className="w-full h-24 object-contain bg-white rounded-xl border border-slate-700"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )}
              </div>

              {/* Drawer Footer Actions */}
              <div className="p-4 border-t border-[#1E2B58] bg-[#070D1E] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsDrawerOpen(false)}
                    className="border-[#1E2B58] text-slate-300 hover:text-white hover:bg-slate-800"
                  >
                    Fechar
                  </Button>

                  {/* REQUISITO: "o vendedor pode excluir o cliente da rota em andamento" */}
                  {selectedOrder.status !== 'delivered' &&
                    selectedOrder.status !== 'cancelled' &&
                    (selectedOrder.route_started ||
                      selectedOrder.status === 'in_transit' ||
                      selectedOrder.status === 'assigned' ||
                      selectedOrder.route_released) && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setOrderToRemoveFromRoute(selectedOrder)}
                        className="border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 font-bold text-xs gap-1.5 rounded-xl transition"
                        title="Remover cliente desta rota e retornar para status Pendente"
                      >
                        <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
                        Remover da Rota
                      </Button>
                    )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      const origin = typeof window !== 'undefined' ? window.location.origin : ''
                      window.open(`${origin}/track/${selectedOrder.tracking_code}`, '_blank')
                    }}
                    className="bg-[#0052CC] hover:bg-[#003E99] text-white font-bold text-xs gap-1.5 rounded-xl"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Abrir Rastreio Público
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* MODAL DE CONFIRMAÇÃO: REMOVER CLIENTE DA ROTA EM ANDAMENTO */}
      <Dialog
        open={Boolean(orderToRemoveFromRoute)}
        onOpenChange={(open) =>
          !open && !isRemovingOrderFromRoute && setOrderToRemoveFromRoute(null)
        }
      >
        <DialogContent className="sm:max-w-md bg-[#0A1128] border border-rose-500/30 text-slate-100">
          <DialogHeader>
            <div className="flex items-center gap-2.5 text-rose-400">
              <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/30">
                <AlertTriangle className="h-5 w-5 text-rose-400" />
              </div>
              <DialogTitle className="text-base font-bold text-white font-heading">
                Remover Cliente da Rota em Andamento?
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-slate-300 pt-2 space-y-2">
              <p>
                Você está prestes a remover o cliente{' '}
                <strong className="text-white">
                  {orderToRemoveFromRoute?.expand?.customer_id?.name || 'Cliente'}
                </strong>{' '}
                (pedido{' '}
                <span className="font-mono text-[#60A5FA]">
                  {orderToRemoveFromRoute?.tracking_code}
                </span>
                ) da rota do entregador.
              </p>
              <div className="p-3 rounded-xl bg-[#070D1E] border border-slate-800 space-y-1 text-[11px] text-slate-400">
                <p>• O pedido sairá imediatamente do app do entregador em tempo real.</p>
                <p>• A sequência e quilometragem da rota serão recalculadas automaticamente.</p>
                <p>
                  • O pedido retornará para o status <strong>Pendente</strong> no painel de vendas.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#1E2B58]">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isRemovingOrderFromRoute}
              onClick={() => setOrderToRemoveFromRoute(null)}
              className="border-[#1E2B58] text-slate-300 hover:text-white hover:bg-slate-800"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isRemovingOrderFromRoute}
              onClick={handleConfirmRemoveOrderFromRoute}
              className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs gap-1.5 shadow-md shadow-rose-950/40"
            >
              {isRemovingOrderFromRoute ? 'Removendo...' : 'Sim, Remover da Rota'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 6. MODAL DO ENTREGADOR (Ao clicar no entregador na lista lateral ou mapa) */}
      <Dialog open={!!selectedCourier} onOpenChange={(open) => !open && setSelectedCourier(null)}>
        <DialogContent className="sm:max-w-md bg-[#0A1128] border border-[#1E2B58] text-slate-100 max-h-[92vh] overflow-y-auto">
          {selectedCourier &&
            (() => {
              const data = allCourierData.find((c) => c.courier.id === selectedCourier.id)
              const nextCust = data?.nextOrder?.expand?.customer_id
              const courierColor = getCourierRouteColor(selectedCourier.id)

              // Diagnóstico avançado e honesto da telemetria GPS e tempo parado
              const diag = diagnoseCourierTelemetry(
                selectedCourier.id,
                locations,
                data?.lat,
                data?.lng,
                data?.speed,
                data?.gps_status,
                data?.gps_reason,
                data?.location_timestamp,
                data?.accuracy,
                data?.offline_buffered,
              )

              // Endereço display: estritamente da última posição GPS real do entregador
              const addressDisplay = isLoadingCourierAddress
                ? 'Localizando endereço em tempo real via GPS...'
                : resolvedCourierAddress ||
                  (diag.lat !== null && diag.lng !== null
                    ? `${diag.lat.toFixed(5)}, ${diag.lng.toFixed(5)}`
                    : data?.hasValidCoords
                      ? `${data.lat.toFixed(5)}, ${data.lng.toFixed(5)}`
                      : 'Aguardando primeiro sinal GPS do entregador')

              return (
                <>
                  <DialogHeader>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div
                          style={{
                            backgroundColor: `${courierColor.stroke}20`,
                            borderColor: `${courierColor.stroke}60`,
                            color: courierColor.stroke,
                          }}
                          className="p-2.5 border rounded-full relative"
                        >
                          {renderVehicleIcon(selectedCourier.vehicle_type)}
                          <span
                            style={{ backgroundColor: courierColor.stroke }}
                            className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#0A1128]"
                            title={`Cor da rota: ${courierColor.name}`}
                          />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <DialogTitle className="text-lg font-bold text-white font-heading">
                              {selectedCourier.name || selectedCourier.email}
                            </DialogTitle>
                            <span
                              style={{
                                borderColor: `${courierColor.stroke}50`,
                                color: courierColor.stroke,
                              }}
                              className="px-2 py-0.5 text-[10px] font-bold rounded-full border bg-slate-900/60"
                            >
                              Rota {courierColor.name}
                            </span>
                          </div>
                          <DialogDescription className="text-xs text-slate-400 mt-0.5">
                            {formatVehicle(selectedCourier.vehicle_type)} • Placa:{' '}
                            {selectedCourier.vehicle_plate || 'Não informada'}
                            {selectedCourier.vehicle_model
                              ? ` • ${selectedCourier.vehicle_model}`
                              : ''}
                          </DialogDescription>
                        </div>
                      </div>
                    </div>
                  </DialogHeader>

                  <div className="space-y-3.5 py-1 text-xs">
                    {/* CARD 1: DIAGNÓSTICO EM TEMPO REAL (GPS LIGADO/DESLIGADO & TEMPO PARADO / MOVIMENTO) */}
                    <div className="rounded-xl bg-[#070D1E] p-3.5 border border-[#1E2B58] space-y-3">
                      <div className="flex items-center justify-between pb-1 border-b border-slate-800">
                        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                          <Compass className="h-3.5 w-3.5 text-[#60A5FA]" />
                          Situação em Tempo Real
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">
                          Último sinal: {diag.lastSignalFormatted}
                        </span>
                      </div>

                      {/* BADGES DESTACADOS: ESTADO DO GPS E SITUAÇÃO DE MOVIMENTO */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {/* Estado do GPS */}
                        <div
                          className={`p-2.5 rounded-lg border ${diag.gpsBadgeColor.bg} ${diag.gpsBadgeColor.border} flex flex-col justify-between`}
                        >
                          <span className="text-[10px] text-slate-400 block uppercase font-bold">
                            Sinal do GPS
                          </span>
                          <div className="flex items-center gap-2 mt-1">
                            <span
                              className={`h-2.5 w-2.5 rounded-full shrink-0 ${diag.gpsBadgeColor.dot}`}
                            />
                            <span
                              className={`font-bold text-xs leading-snug ${diag.gpsBadgeColor.text}`}
                            >
                              {diag.gpsBadgeLabel}
                            </span>
                          </div>
                        </div>

                        {/* Movimento vs Parado */}
                        <div
                          className={`p-2.5 rounded-lg border flex flex-col justify-between ${
                            diag.movementBadgeVariant === 'stopped'
                              ? diag.stoppedMinutes >= 5
                                ? 'bg-rose-500/20 border-rose-500/50 text-rose-300'
                                : 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                              : diag.movementBadgeVariant === 'moving'
                                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                                : 'bg-slate-800/40 border-slate-700 text-slate-400'
                          }`}
                        >
                          <span className="text-[10px] text-slate-400 block uppercase font-bold">
                            Deslocamento
                          </span>
                          <div className="flex items-center gap-2 mt-1">
                            <span
                              className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                                diag.movementBadgeVariant === 'stopped'
                                  ? diag.stoppedMinutes >= 5
                                    ? 'bg-rose-400 animate-pulse'
                                    : 'bg-amber-400'
                                  : diag.movementBadgeVariant === 'moving'
                                    ? 'bg-emerald-400 animate-pulse'
                                    : 'bg-slate-500'
                              }`}
                            />
                            <span className="font-bold text-xs leading-snug">
                              {diag.movementBadgeLabel}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Informações adicionais do sinal (Velocidade, Bateria, Acurácia) */}
                      <div className="grid grid-cols-3 gap-2 pt-1 font-mono text-[11px]">
                        <div className="p-2 rounded-lg bg-[#0C152F] border border-slate-800">
                          <span className="text-[9.5px] text-slate-400 block font-sans">
                            Velocidade
                          </span>
                          <span className="font-bold text-white text-xs">{diag.speedKmh} km/h</span>
                        </div>
                        <div className="p-2 rounded-lg bg-[#0C152F] border border-slate-800">
                          <span className="text-[9.5px] text-slate-400 block font-sans">
                            Bateria Celular
                          </span>
                          <span className="font-bold text-white text-xs">
                            {typeof data?.battery_level === 'number' && data.battery_level > 0
                              ? `🔋 ${Math.round(data.battery_level)}%`
                              : '🔋 —'}
                          </span>
                        </div>
                        <div className="p-2 rounded-lg bg-[#0C152F] border border-slate-800">
                          <span className="text-[9.5px] text-slate-400 block font-sans">
                            Precisão GPS
                          </span>
                          <span className="font-bold text-white text-xs">
                            {diag.accuracyMeters ? `±${Math.round(diag.accuracyMeters)}m` : 'Alta'}
                          </span>
                        </div>
                      </div>

                      {/* LOCALIZAÇÃO ATUAL: ENDEREÇO REVERSO E COORDENADAS */}
                      <div className="p-2.5 rounded-lg bg-[#0C152F] border border-slate-800 space-y-1">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="font-bold text-[#60A5FA] uppercase tracking-wider flex items-center gap-1 font-sans">
                            <MapPin className="h-3 w-3 text-[#60A5FA]" />
                            Endereço atual em tempo real
                          </span>
                          {diag.lat !== null && diag.lng !== null ? (
                            <span className="font-mono text-slate-400">
                              {diag.lat.toFixed(4)}, {diag.lng.toFixed(4)}
                            </span>
                          ) : data?.hasValidCoords ? (
                            <span className="font-mono text-slate-400">
                              {data.lat.toFixed(4)}, {data.lng.toFixed(4)}
                            </span>
                          ) : null}
                        </div>
                        <p className="text-white text-xs leading-relaxed font-sans font-medium break-words">
                          {addressDisplay}
                        </p>
                      </div>
                    </div>

                    {/* Bloco Detalhado: Tempo Restante da Rota Inteira & Carga Horária */}
                    {(() => {
                      const courierRouteInfo = activeRoutesData.find(
                        (r) => r.courierId === selectedCourier.id,
                      )
                      const shift = courierRouteInfo?.shiftMetrics
                      if (!shift) return null

                      return (
                        <div className="border border-indigo-500/40 rounded-xl p-3 space-y-2 bg-[#0c163b]/70 shadow-sm">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-indigo-300 flex items-center gap-1.5 text-xs">
                              <Clock className="h-3.5 w-3.5 text-indigo-400" />
                              Tempo Estimado da Rota Inteira:
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                                shift.isOvertime
                                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                                  : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                              }`}
                            >
                              {shift.badgeText}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-xs">
                            <div className="p-2 rounded-lg bg-[#070D1E] border border-[#1E2B58]">
                              <span className="text-[10px] text-slate-400 block font-sans">
                                Restante (Trânsito + Paradas):
                              </span>
                              <span className="font-bold text-white text-sm">
                                {shift.remainingFormatted}
                              </span>
                            </div>
                            <div className="p-2 rounded-lg bg-[#070D1E] border border-[#1E2B58]">
                              <span className="text-[10px] text-slate-400 block font-sans">
                                Término Projetado (Base):
                              </span>
                              <span className="font-bold text-blue-300 text-sm">
                                ~{shift.projectedEndTimeFormatted}
                              </span>
                            </div>
                          </div>

                          {shift.isOvertime && (
                            <p className="text-[10.5px] text-amber-300 font-sans leading-tight">
                              ⚠️ Atenção: A conclusão da rota ultrapassará o limite acordado de
                              jornada (+{shift.overtimeMinutes} min). Evite atribuir novas entregas
                              para este entregador hoje.
                            </p>
                          )}
                        </div>
                      )
                    })()}

                    {/* Próxima Entrega e Previsão de Volta à Base */}
                    {(() => {
                      const courierRouteInfo = activeRoutesData.find(
                        (r) => r.courierId === selectedCourier.id,
                      )
                      return (
                        <div className="border border-blue-500/40 rounded-xl p-3 space-y-2 bg-[#0d1b3e]/60">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-blue-300 flex items-center gap-1">
                              <Navigation className="h-3.5 w-3.5 text-blue-400" />
                              Próxima Entrega na Rota:
                            </span>
                            {data?.nextOrder && (
                              <Badge className="bg-blue-600 text-white font-bold text-[10px]">
                                {data.nextOrder.tracking_code}
                              </Badge>
                            )}
                          </div>
                          {data?.nextOrder ? (
                            <div className="text-slate-300 space-y-1">
                              <p className="font-bold text-white">
                                {nextCust?.name || 'Cliente'} ({data.nextOrder.tracking_code})
                              </p>
                              <p className="text-slate-400 text-[11px] truncate">
                                {nextCust?.address || 'Endereço'}
                              </p>
                              <div className="flex flex-wrap items-center gap-2 pt-1 font-mono text-[11px]">
                                <span className="bg-emerald-950/70 border border-emerald-500/40 text-emerald-300 px-2 py-0.5 rounded">
                                  {courierRouteInfo?.etaNextDeliveryTime &&
                                  courierRouteInfo?.etaReturnBaseTime
                                    ? `⏱️ Entrega ~${courierRouteInfo.etaNextDeliveryTime} • Volta à base ~${courierRouteInfo.etaReturnBaseTime}`
                                    : courierRouteInfo?.etaNextDeliveryTime
                                      ? `⏱️ Previsão Entrega: ${courierRouteInfo.etaNextDeliveryTime}`
                                      : courierRouteInfo?.etaReturnBaseTime
                                        ? `🏢 Retornando à base • Chegada ~${courierRouteInfo.etaReturnBaseTime}`
                                        : `Previsão: ${getEtaDisplay(data.nextOrder)}`}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <p className="text-slate-400 italic text-[11px]">
                                {data?.statusLabel === 'Retornando à Base'
                                  ? 'Todas as entregas concluídas — em trânsito de volta à base.'
                                  : 'Nenhuma entrega na fila atual'}
                              </p>
                              {courierRouteInfo?.etaReturnBaseTime && (
                                <p className="text-blue-300 font-bold font-mono text-xs">
                                  🏢 Retornando à base • Chegada ~
                                  {courierRouteInfo.etaReturnBaseTime}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })()}

                    {/* Botão de Resequenciamento Instantâneo da Rota Ativa */}
                    <div className="pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          try {
                            toast({
                              title: '🔄 Otimizando Rota Viária...',
                              description: `Recalculando menor trajeto para ${selectedCourier.name || 'Entregador'}...`,
                            })
                            const res = await deliveryService.resequenceActiveRouteForCourier(
                              selectedCourier.id,
                              appSettings,
                              false,
                              'manual_command',
                            )
                            if (res.success) {
                              toast({
                                title: '✨ Rota Otimizada com Sucesso!',
                                description: `${res.sequencedCount} paradas reordenadas viariamente (${res.totalDistanceKm} km total com retorno à base).`,
                              })
                              fetchData()
                              if (onRefresh) onRefresh()
                            } else if (res.reason === 'prejuizo_km') {
                              toast({
                                title: 'Aviso',
                                description: 'Nova sequência não melhora a rota — mantida a atual',
                              })
                            } else {
                              toast({
                                title: 'Aviso',
                                description: 'Nenhuma parada ativa pendente para resequenciar.',
                              })
                            }
                          } catch (err) {
                            console.error('Erro ao resequenciar rota na Torre:', err)
                            toast({
                              title: 'Erro na Otimização',
                              description: 'Não foi possível resequenciar a rota agora.',
                              variant: 'destructive',
                            })
                          }
                        }}
                        className="w-full bg-gradient-to-r from-indigo-900/60 to-purple-900/60 hover:from-indigo-800 hover:to-purple-800 text-indigo-200 border-indigo-500/40 font-bold text-xs gap-1.5 rounded-xl h-8 shadow-sm"
                      >
                        <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                        Otimizar e Resequenciar Rota Agora (Menor Trajeto)
                      </Button>
                    </div>

                    {/* Contato Direto */}
                    <div className="pt-2 flex gap-2">
                      <Button
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs"
                        size="sm"
                        onClick={() => openWhatsApp(selectedCourier.phone)}
                      >
                        <MessageCircle className="h-4 w-4 mr-1.5" />
                        Conversar no WhatsApp
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 border-[#1E2B58] bg-[#070D1E] hover:bg-[#121E46] text-slate-200 text-xs"
                        onClick={() => makePhoneCall(selectedCourier.phone)}
                      >
                        <Phone className="h-4 w-4 mr-1.5" />
                        Ligar para Entregador
                      </Button>
                    </div>
                  </div>
                </>
              )
            })()}
        </DialogContent>
      </Dialog>
    </>
  )
}

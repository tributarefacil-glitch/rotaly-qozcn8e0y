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
import { offlineRouteStorage } from '@/services/offlineRouteStorage'
import { nativeGpsBridge } from '@/services/nativeGpsBridge'
import { calculateRedirectionExtraKm } from '@/lib/redirectionKmEngine'
import { haversineDistanceMeters } from '@/lib/geo'
import pb from '@/lib/pocketbase/client'
import type { OrderRecord, CompletionReason, OrderStatus, LocationRecord } from '@/types/delivery'
import { toast } from 'sonner'
import { compressImageFile, dataUrlToFile } from '@/lib/imageCompression'
import { getErrorMessage } from '@/lib/pocketbase/errors'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { MapPin, Navigation, Info, Lock, ShieldCheck } from 'lucide-react'

interface DeliveryConfirmationModalProps {
  order: OrderRecord | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirmed: () => void
  courierId?: string
  locations?: LocationRecord[]
  allOrders?: OrderRecord[]
}

export const DeliveryConfirmationModal: React.FC<DeliveryConfirmationModalProps> = ({
  order,
  open,
  onOpenChange,
  onConfirmed,
  courierId,
  locations = [],
  allOrders = [],
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

  // BLOCO 1 (v0.0.366 / v0.0.371): Geofence com GPS na confirmação de entrega e Correção Real de Endereço
  // Nova Regra Permanente: confirmação NUNCA mais bloqueia por distância (>500m vai para aprovação central)
  const [capturedGps, setCapturedGps] = useState<{
    lat: number
    lng: number
    accuracy?: number
  } | null>(null)
  const [isCapturingGps, setIsCapturingGps] = useState(false)
  const [proposeAddressCorrection, setProposeAddressCorrection] = useState(false)
  const [addressCorrectionConfirmed, setAddressCorrectionConfirmed] = useState(false)
  const [addressCorrectionDone, setAddressCorrectionDone] = useState(false)

  // Campos específicos de Entrega Redirecionada
  const isRedirectionFlow = Boolean(
    order?.redirection_status === 'initiated' || order?.is_redirected,
  )
  const [updateOfficialCustomerAddress, setUpdateOfficialCustomerAddress] = useState(true)
  const [redirectionPointB, setRedirectionPointB] = useState<{
    lat: number
    lng: number
    at: string
  } | null>(null)
  const [calculatedExtraKm, setCalculatedExtraKm] = useState<number | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Capturar Ponto B no momento da confirmação se for entrega redirecionada
  useEffect(() => {
    if (open && order && isRedirectionFlow) {
      if (typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const pB = {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              at: new Date(pos.timestamp || Date.now()).toISOString(),
            }
            setRedirectionPointB(pB)

            // Pré-calcular KM extra preliminar
            const pALat =
              order.redirection_point_a_lat ??
              order.end_address_lat ??
              order.expand?.customer_id?.lat ??
              0
            const pALng =
              order.redirection_point_a_lng ??
              order.end_address_lng ??
              order.expand?.customer_id?.lng ??
              0
            if (pALat && pALng) {
              const res = calculateRedirectionExtraKm({
                pointALat: pALat,
                pointALng: pALng,
                pointBLat: pB.lat,
                pointBLng: pB.lng,
                timestampA: order.redirection_point_a_at,
                timestampB: pB.at,
                courierLocations: locations,
                pernaJaContadaKm: typeof order.distance_km === 'number' ? order.distance_km : 0,
              })
              setCalculatedExtraKm(res.extraKm)
            }
          },
          (err) => {
            console.warn('[DeliveryConfirmationModal] Não foi possível ler GPS no Ponto B:', err)
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
        )
      }
    }
  }, [open, order, isRedirectionFlow])

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
      setUpdateOfficialCustomerAddress(true)
      setCapturedGps(null)
      setIsCapturingGps(false)
      setProposeAddressCorrection(false)
      setAddressCorrectionConfirmed(false)
      setAddressCorrectionDone(false)

      // Capturar GPS preliminar ao abrir o modal para adiantar precisão
      if (nativeGpsBridge.isNativeEnvironment()) {
        nativeGpsBridge
          .getCurrentPosition({ enableHighAccuracy: true, timeout: 6000, maximumAge: 15000 })
          .then((coord) => {
            if (coord) {
              setCapturedGps({
                lat: coord.latitude,
                lng: coord.longitude,
                accuracy: coord.accuracy,
              })
            }
          })
          .catch((err) => {
            console.warn('[DeliveryConfirmationModal] GPS preliminar nativo indisponível:', err)
          })
      } else if (typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setCapturedGps({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
            })
          },
          (err) => {
            console.warn('[DeliveryConfirmationModal] GPS preliminar indisponível:', err)
          },
          { enableHighAccuracy: true, timeout: 6000, maximumAge: 15000 },
        )
      }

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
      // PONTO 3 — Validação no frontend: tipo de arquivo e tamanho máximo (5MB)
      const allowedMimes = ['image/jpeg', 'image/png', 'image/webp']
      if (!allowedMimes.includes(file.type) && !file.type.startsWith('image/')) {
        toast.error('Formato inválido! Apenas imagens JPEG, PNG ou WEBP são permitidas.')
        if (e.target) e.target.value = ''
        return
      }

      const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 // 5MB
      if (file.size > MAX_UPLOAD_BYTES) {
        toast.error('Arquivo muito grande! O tamanho máximo permitido para foto é de 5MB.')
        if (e.target) e.target.value = ''
        return
      }

      setIsCompressingPhoto(true)
      try {
        // Redimensionar no cliente para máx ~1600px no lado maior e qualidade ~0.8 JPEG
        const compressed = await compressImageFile(file, {
          maxSide: 1600,
          quality: 0.8,
          mimeType: 'image/jpeg',
        })
        if (compressed.size > MAX_UPLOAD_BYTES) {
          toast.error('A foto excedeu o limite máximo de 5MB após processamento.')
          if (e.target) e.target.value = ''
          return
        }
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

  // Captura de GPS precisa sob demanda (promisified) com suporte nativo e retorno de accuracy
  const getFreshLocation = async (): Promise<{
    latitude: number
    longitude: number
    accuracy?: number
    lat: number
    lng: number
  } | null> => {
    // 1. Caminho nativo com nativeGpsBridge
    if (nativeGpsBridge.isNativeEnvironment()) {
      try {
        const nativeCoord = await nativeGpsBridge.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 8000,
          maximumAge: 10000,
        })
        if (nativeCoord) {
          const fresh = {
            latitude: nativeCoord.latitude,
            longitude: nativeCoord.longitude,
            accuracy: nativeCoord.accuracy,
            lat: nativeCoord.latitude,
            lng: nativeCoord.longitude,
          }
          setCapturedGps(fresh)
          return fresh
        }
      } catch (err) {
        console.warn('[DeliveryConfirmationModal] Falha no GPS nativo sob demanda:', err)
      }
    }

    // 2. Fallback do navegador (navigator.geolocation.getCurrentPosition)
    return new Promise((resolve) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        if (capturedGps) {
          resolve({
            latitude: capturedGps.lat,
            longitude: capturedGps.lng,
            accuracy: capturedGps.accuracy,
            lat: capturedGps.lat,
            lng: capturedGps.lng,
          })
          return
        }
        resolve(null)
        return
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const fresh = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          }
          setCapturedGps(fresh)
          resolve(fresh)
        },
        (err) => {
          console.warn('[DeliveryConfirmationModal] Falha na leitura GPS sob demanda:', err)
          if (capturedGps) {
            resolve({
              latitude: capturedGps.lat,
              longitude: capturedGps.lng,
              accuracy: capturedGps.accuracy,
              lat: capturedGps.lat,
              lng: capturedGps.lng,
            })
          } else {
            resolve(null)
          }
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 },
      )
    })
  }

  const handleConfirmDelivery = async () => {
    if (!order || isSubmitting) return

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

    // BLOCO 1 (v0.0.366): Captura de GPS automática no momento do clique em "Confirmar entrega"
    setIsCapturingGps(true)
    const currentLoc = await getFreshLocation()
    setIsCapturingGps(false)

    // Coordenadas canônicas do cliente (REFERÊNCIA ÚNICA: pin cadastrado do cliente)
    // Se order.expand não trouxer ou for 0, buscar o registro direto do cliente
    let clientLat =
      typeof order.expand?.customer_id?.lat === 'number' && order.expand.customer_id.lat !== 0
        ? order.expand.customer_id.lat
        : typeof order.end_address_lat === 'number' && order.end_address_lat !== 0
          ? order.end_address_lat
          : null
    let clientLng =
      typeof order.expand?.customer_id?.lng === 'number' && order.expand.customer_id.lng !== 0
        ? order.expand.customer_id.lng
        : typeof order.end_address_lng === 'number' && order.end_address_lng !== 0
          ? order.end_address_lng
          : null

    // Fallback garantido: consultar customer no banco se lat/lng estiver ausente no expand
    if ((clientLat === null || clientLng === null) && order.customer_id) {
      try {
        const liveCust = await pb
          .collection('customers')
          .getOne(order.customer_id, { requestKey: null })
        if (liveCust && typeof liveCust.lat === 'number' && liveCust.lat !== 0) {
          clientLat = liveCust.lat
          clientLng = liveCust.lng
        }
      } catch (custErr) {
        console.warn(
          '[DeliveryConfirmationModal] Falha ao buscar cliente ao vivo para checar pin:',
          custErr,
        )
      }
    }

    const hasClientCoords = clientLat !== null && clientLng !== null

    let geofenceFlag:
      | 'ok'
      | 'flag_150_500m'
      | 'pendente_aprovacao_gt_500m'
      | 'bloqueado_gt_500m'
      | 'sem_coordenadas'
      | 'liberado_admin'
      | 'aprovado_admin' = 'ok'
    let distanceToPinM = 0

    const isEffectiveRedirection =
      isRedirectionFlow ||
      Boolean(
        order.is_redirected ||
        order.redirection_status === 'completed' ||
        order.redirection_status === 'initiated' ||
        (order as any).redirection_status === 'in_progress' ||
        order.redirection_new_address ||
        order.redirection_point_a_lat,
      )
    if (isDelivered) {
      if (isEffectiveRedirection) {
        // REGRA PERMANENTE: Entrega redirecionada NÃO gera alerta de correção de pin.
        // O ponto B já é aprovado e gravado pelo fluxo próprio de redirecionamento.
        geofenceFlag = 'ok'
      } else if (!hasClientCoords) {
        // CLIENTE SEM COORDENADAS NUNCA BLOQUEIA
        geofenceFlag = 'sem_coordenadas'
        // Criar/atualizar alerta de pin_entregador automaticamente via createAddressAlert com guardas
        if (currentLoc) {
          const oldSnapshot = {
            address: order.expand?.customer_id?.address || order.end_address_text || '',
            street: order.expand?.customer_id?.street || '',
            number: order.expand?.customer_id?.number || '',
            neighborhood: order.expand?.customer_id?.neighborhood || '',
            city: order.expand?.customer_id?.city || '',
            state: order.expand?.customer_id?.state || '',
            postal_code: order.expand?.customer_id?.postal_code || '',
            lat: null,
            lng: null,
          }
          const suggestedObj = {
            address: order.expand?.customer_id?.address || order.end_address_text || '',
            lat: currentLoc.lat,
            lng: currentLoc.lng,
            accuracy: currentLoc.accuracy,
            accuracy_meters: currentLoc.accuracy,
          }
          const noteText = `Pin capturado automaticamente pelo entregador na entrega do pedido ${order.tracking_code}`
          try {
            await deliveryService.createAddressAlert({
              customer: order.customer_id || '',
              company: order.empresa_id || undefined,
              origin: 'pin_entregador',
              current_address: oldSnapshot,
              suggested_address: suggestedObj,
              distance_meters: 0,
              notes: noteText,
              order_id: order.id,
              tracking_code: order.tracking_code,
              is_redirected: false,
            })
          } catch (alertErr) {
            console.warn(
              '[DeliveryConfirmationModal] Aviso ao criar alerta pin_entregador (cliente sem coords):',
              alertErr,
            )
          }
        }
      } else if (currentLoc) {
        // CLIENTE COM COORDENADAS: calcular distância GPS ↔ PIN CADASTRADO DO CLIENTE
        distanceToPinM = Math.round(
          haversineDistanceMeters(currentLoc.lat, currentLoc.lng, clientLat, clientLng),
        )

        // GUARDA DE SANIDADE v0.0.472:
        // Se a posição de entrega (ou end_address do pedido) coincide com o pin do cliente (<= 150m),
        // NUNCA marcar pendente_aprovacao nem disparar alerta. O pin é soberano e já está correto!
        const deliveryCoordLat =
          typeof order.end_address_lat === 'number' && order.end_address_lat !== 0
            ? order.end_address_lat
            : currentLoc.lat
        const deliveryCoordLng =
          typeof order.end_address_lng === 'number' && order.end_address_lng !== 0
            ? order.end_address_lng
            : currentLoc.lng
        const pinToClientDistM = Math.round(
          haversineDistanceMeters(deliveryCoordLat, deliveryCoordLng, clientLat, clientLng),
        )

        if (distanceToPinM <= 150 || pinToClientDistM <= 150) {
          // Dentro da tolerância do pin cadastrado: entrega perfeita
          geofenceFlag = 'ok'
          distanceToPinM = 0
        } else if (distanceToPinM > 150 && distanceToPinM <= 500) {
          geofenceFlag = 'flag_150_500m'
        } else {
          // Distância > 500m: marca pendente_aprovacao_gt_500m e encaminha para aprovação da central
          geofenceFlag = 'pendente_aprovacao_gt_500m'

          // Registrar alerta em address_alerts para a central de auditoria via createAddressAlert com guardas
          try {
            const oldSnapshot = {
              address: order.expand?.customer_id?.address || order.end_address_text || '',
              street: order.expand?.customer_id?.street || '',
              number: order.expand?.customer_id?.number || '',
              neighborhood: order.expand?.customer_id?.neighborhood || '',
              city: order.expand?.customer_id?.city || '',
              state: order.expand?.customer_id?.state || '',
              postal_code: order.expand?.customer_id?.postal_code || '',
              lat: clientLat,
              lng: clientLng,
            }
            let uberAddressResolved = ''
            let uberComponents: any = null
            try {
              const { MapDataService } = await import('@/lib/mapDataService')
              const enriched = await MapDataService.reverseGeocodePin({
                lat: currentLoc.lat,
                lng: currentLoc.lng,
                existingAddress: order.expand?.customer_id?.address || order.end_address_text || '',
                existingComplement: order.expand?.customer_id?.complement || '',
              })
              if (enriched && enriched.fullAddress) {
                uberAddressResolved = enriched.fullAddress
                uberComponents = enriched
              }
            } catch (revErr) {
              console.warn('[DeliveryConfirmationModal] Falha reverse geocode Uber:', revErr)
            }

            const suggestedObj = {
              address:
                uberAddressResolved ||
                order.expand?.customer_id?.address ||
                order.end_address_text ||
                '',
              street: uberComponents?.street || '',
              number: uberComponents?.number || '',
              complement: uberComponents?.complement || order.expand?.customer_id?.complement || '',
              neighborhood: uberComponents?.neighborhood || '',
              city: uberComponents?.city || '',
              state: uberComponents?.state || '',
              postal_code: uberComponents?.postalCode || '',
              uber_resolved: Boolean(uberAddressResolved),
              lat: currentLoc.lat,
              lng: currentLoc.lng,
              accuracy: currentLoc.accuracy,
              accuracy_meters: currentLoc.accuracy,
            }
            const noteText = `Entrega realizada a ${(distanceToPinM / 1000).toFixed(1)} km do pin cadastrado no pedido ${order.tracking_code}. Aguarda conferência da central.`

            await deliveryService.createAddressAlert({
              customer: order.customer_id || '',
              company: order.empresa_id || undefined,
              origin: 'pin_entregador',
              current_address: oldSnapshot,
              suggested_address: suggestedObj,
              distance_meters: distanceToPinM,
              notes: noteText,
              order_id: order.id,
              tracking_code: order.tracking_code,
              is_redirected: false,
            })
          } catch (alertErr) {
            console.warn(
              '[DeliveryConfirmationModal] Aviso ao criar/atualizar address_alerts para >500m via createAddressAlert:',
              alertErr,
            )
          }
        }
      }
    }

    // CORREÇÃO REAL DE ENDEREÇO: Se o pin capturado divergir do cadastrado (>150m) e não foi proposto nem respondido ainda
    if (
      isDelivered &&
      currentLoc &&
      (!hasClientCoords || distanceToPinM > 150) &&
      !addressCorrectionDone
    ) {
      if (!proposeAddressCorrection && !addressCorrectionConfirmed) {
        setProposeAddressCorrection(true)
        // Pausa momentânea para aguardar a decisão do entregador antes de submeter
        return
      }
    }

    // REGRA SOBERANA: Não inventar km_real_perna na baixa da entrega.
    // Gravar vazio/nulo se não houver pings imediatos e deixar o motor da Coluna B apurar depois.
    const kmRealPerna: number | undefined = undefined

    const effectiveReceiverName =
      receiverName.trim() || order.expand?.customer_id?.name || 'Cliente'

    // SE FOR FLUXO DE ENTREGA REDIRECIONADA E STATUS 'DELIVERED':
    // Usar o método dedicado confirmDeliveryRedirection
    if (isDelivered && isRedirectionFlow) {
      setIsSubmitting(true)
      try {
        const now = new Date().toISOString()
        let finalSignature = signatureDataUrl
        if (!finalSignature && hasSignature && canvasRef.current) {
          finalSignature = canvasRef.current.toDataURL('image/png')
        }
        let signatureFile: File | null = null
        if (finalSignature && finalSignature.startsWith('data:image')) {
          signatureFile = await dataUrlToFile(
            finalSignature,
            `signature_redir_${order.id || 'sig'}_${Date.now()}.png`,
          )
        }

        let finalPhotoFile: File | null = photoFile
        if (finalPhotoFile && finalPhotoFile.size > 2 * 1024 * 1024) {
          try {
            finalPhotoFile = await compressImageFile(finalPhotoFile, {
              maxSide: 1600,
              quality: 0.8,
              mimeType: 'image/jpeg',
            })
          } catch {
            /* intentionally ignored */
          }
        }

        // Ponto B: Usar capturado ou posição do cliente
        const pointBLat =
          redirectionPointB?.lat ||
          order.end_address_lat ||
          order.expand?.customer_id?.lat ||
          -22.699
        const pointBLng =
          redirectionPointB?.lng ||
          order.end_address_lng ||
          order.expand?.customer_id?.lng ||
          -43.296
        const pointALat =
          order.redirection_point_a_lat ||
          order.end_address_lat ||
          order.expand?.customer_id?.lat ||
          pointBLat
        const pointALng =
          order.redirection_point_a_lng ||
          order.end_address_lng ||
          order.expand?.customer_id?.lng ||
          pointBLng

        // Cálculo do KM Extra Líquido
        const calcRes = calculateRedirectionExtraKm({
          pointALat,
          pointALng,
          pointBLat,
          pointBLng,
          timestampA: order.redirection_point_a_at,
          timestampB: redirectionPointB?.at || now,
          courierLocations: locations,
          pernaJaContadaKm: typeof order.distance_km === 'number' ? order.distance_km : 0,
        })

        const newAddressText =
          order.redirection_new_address || 'Novo endereço informado pelo cliente'

        if (isOnline) {
          try {
            await deliveryService.confirmDeliveryRedirection({
              order,
              courierId: courierId || order.courier_id,
              pointBLat,
              pointBLng,
              pointBAt: redirectionPointB?.at || now,
              newAddressText,
              updateCustomerAddressOfficial: updateOfficialCustomerAddress,
              proofPhoto: finalPhotoFile,
              signature: signatureFile,
              receiverName: effectiveReceiverName,
              notes,
              extraKmCalculated: calcRes.extraKm,
              calculationMethod: calcRes.method,
            })
          } catch (serverErr) {
            console.warn(
              '[DeliveryConfirmationModal] Falha online, salvando na fila offline:',
              serverErr,
            )
            // Salvar offline
            await offlineRouteStorage.enqueueRedirectionAction({
              id: `redir_conf_${order.id}_${Date.now()}`,
              orderId: order.id,
              courierId: courierId || order.courier_id,
              action: 'confirm',
              pointB: { lat: pointBLat, lng: pointBLng, at: now },
              newAddress: newAddressText,
              updateCustomerAddress: updateOfficialCustomerAddress,
              receiverName: effectiveReceiverName,
              notes,
              timestamp: Date.now(),
            })
          }
        } else {
          // Offline
          await offlineRouteStorage.enqueueRedirectionAction({
            id: `redir_conf_${order.id}_${Date.now()}`,
            orderId: order.id,
            courierId: courierId || order.courier_id,
            action: 'confirm',
            pointB: { lat: pointBLat, lng: pointBLng, at: now },
            newAddress: newAddressText,
            updateCustomerAddress: updateOfficialCustomerAddress,
            receiverName: effectiveReceiverName,
            notes,
            timestamp: Date.now(),
          })
        }

        toast.success(`Entrega redirecionada confirmada!`, {
          description: `+${calcRes.extraKm.toFixed(1)} km extra (${calcRes.isAutoApproved ? 'Aprovado automático ≤3km' : 'Pendente de revisão na Central >3km'}).`,
        })

        onConfirmed()
        onOpenChange(false)
        return
      } catch (err: unknown) {
        console.error('Error confirming redirected delivery:', err)
        const errorMsg = getErrorMessage(err)
        toast.error(errorMsg || 'Erro ao registrar entrega redirecionada.')
      } finally {
        setIsSubmitting(false)
      }
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

        // BLOCO 1: Campos de Geofence e KM Real da Perna
        if (isDelivered) {
          formData.append('entrega_geofence_flag', geofenceFlag)
          if (distanceToPinM > 0) {
            formData.append('entrega_fora_pin_m', String(distanceToPinM))
          }
          if (kmRealPerna !== undefined && kmRealPerna > 0) {
            formData.append('km_real_perna', String(kmRealPerna))
          }
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
          ...(isDelivered
            ? {
                entrega_geofence_flag: geofenceFlag,
                ...(distanceToPinM > 0 ? { entrega_fora_pin_m: distanceToPinM } : {}),
                ...(kmRealPerna !== undefined && kmRealPerna > 0
                  ? { km_real_perna: kmRealPerna }
                  : {}),
              }
            : {}),
        }
        await deliveryService.updateOrder(order.id, updateData)
      }

      // Se entrega com >500m, registrar trilha de auditoria para triagem da central
      if (isDelivered && geofenceFlag === 'pendente_aprovacao_gt_500m') {
        try {
          await deliveryService.logAuditTrail({
            action: 'geofence_pending_approval',
            user_id: '',
            actor_name: 'Sistema',
            collection: 'orders',
            record_id: order.id,
            field: 'entrega_geofence_flag',
            old_value: 'em_transito',
            new_value: 'pendente_aprovacao_gt_500m',
            courier_id: courierId || order.courier_id,
            empresa_id: order.empresa_id,
            metadata: {
              system_trigger: true,
              order_id: order.id,
              tracking_code: order.tracking_code,
              distance_m: distanceToPinM,
              courier_gps: currentLoc,
              reason: `Entrega confirmada a ${distanceToPinM}m do pin cadastrado (>500m). Encaminhado para aprovação da central.`,
            },
          })
        } catch (auditErr) {
          console.warn(
            '[DeliveryConfirmationModal] Erro ao gravar audit_trail de geofence_pending_approval:',
            auditErr,
          )
        }
      }
      // REGRA SOBERANA DE PIN & AUDITORIA:
      // Se a entrega gerou alerta pendente (geofenceFlag === 'pendente_aprovacao_gt_500m'),
      // É PROIBIDO sobrescrever customer e order prematuramente antes da decisão do admin!
      // Apenas atualiza o cadastro do cliente diretamente se o desvio for tolerado (<= 500m ou ok).
      const requiresAdminApproval = geofenceFlag === 'pendente_aprovacao_gt_500m'

      if (isDelivered && currentLoc && order.customer_id && !requiresAdminApproval) {
        try {
          const oldLat = order.expand?.customer_id?.lat
          const oldLng = order.expand?.customer_id?.lng
          const oldAddress = order.expand?.customer_id?.address

          await deliveryService.updateCustomerDeliveryPin({
            customerId: order.customer_id,
            lat: currentLoc.lat,
            lng: currentLoc.lng,
            customerAddressId: order.customer_address_id,
          })

          await deliveryService.logAuditTrail({
            action: 'customer_pin_corrected_by_courier',
            user_id: pb.authStore.record?.id || '',
            actor_name: pb.authStore.record?.name || 'Entregador',
            collection: 'customers',
            record_id: order.customer_id,
            field: 'address,lat,lng',
            old_value: `${oldAddress} (${oldLat},${oldLng})`,
            new_value: `GPS (${currentLoc.lat},${currentLoc.lng})`,
            courier_id: courierId || order.courier_id,
            empresa_id: order.empresa_id,
            metadata: {
              order_id: order.id,
              tracking_code: order.tracking_code,
              address: oldAddress,
              real_gps: currentLoc,
              customer_address_id: order.customer_address_id,
              system_trigger: true,
            },
          })
        } catch (corrErr) {
          console.warn(
            '[DeliveryConfirmationModal] Falha ao atualizar coordenadas do cliente com pin soberano:',
            corrErr,
          )
        }
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
        if (geofenceFlag === 'pendente_aprovacao_gt_500m') {
          toast.success(
            `Entrega confirmada! Encaminhada para verificação de distância com a central (${(distanceToPinM / 1000).toFixed(1)} km do pin).`,
            { duration: 6000 },
          )
        } else {
          toast.success(`Pedido ${order.tracking_code} confirmado com sucesso!`)
        }
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
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          onChange={handleFileChange}
          className="hidden"
          id="camera-capture-input"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
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
            <div className="flex items-center justify-between">
              <p className="font-heading font-bold text-[#1a1a1a]">
                Cliente: {order.expand?.customer_id?.name || 'Cliente'}
              </p>
              {isRedirectionFlow && (
                <Badge className="bg-amber-500/20 text-amber-700 border-amber-300 font-bold text-[10px]">
                  Endereço Redirecionado
                </Badge>
              )}
            </div>
            <p className="font-sans text-slate-600 mt-0.5">
              Endereço Original: {order.expand?.customer_id?.address || order.end_address_text}
            </p>
            {isRedirectionFlow && (
              <div className="mt-2 pt-2 border-t border-slate-200/80">
                <p className="font-bold text-amber-800 flex items-center gap-1">
                  <Navigation className="h-3.5 w-3.5 text-amber-600" />
                  Novo Endereço de Entrega (Ponto B):
                </p>
                <p className="text-slate-800 font-medium mt-0.5">
                  {order.redirection_new_address || 'Endereço alternativo informado'}
                </p>
                {calculatedExtraKm !== null && (
                  <p className="text-[11px] text-[#0052CC] font-bold mt-1">
                    KM Extra Calculado: +{calculatedExtraKm.toFixed(1)} km{' '}
                    <span className="font-normal text-slate-600">
                      (
                      {calculatedExtraKm <= 3.0
                        ? 'Aprovação automática no combustível'
                        : 'Pendente de triagem Central >3km'}
                      )
                    </span>
                  </p>
                )}
              </div>
            )}
            <p className="font-heading text-[#0052CC] font-bold mt-1">
              Valor Total: R$ {Number(order.total_price || 0).toFixed(2)}
            </p>
          </div>

          {/* Opção de atualizar cadastro oficial do cliente (apenas se for redirecionamento) */}
          {isRedirectionFlow && (
            <div className="p-3 rounded-lg border border-blue-200 bg-blue-50/70 text-xs space-y-1.5">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="update-official-address"
                  checked={updateOfficialCustomerAddress}
                  onCheckedChange={(checked) => setUpdateOfficialCustomerAddress(Boolean(checked))}
                  className="mt-0.5"
                />
                <label
                  htmlFor="update-official-address"
                  className="font-bold text-slate-900 leading-snug cursor-pointer select-none"
                >
                  Atualizar o endereço oficial deste cliente?
                  <span className="block text-[11px] font-normal text-slate-600 mt-0.5">
                    Se marcado, o cadastro do cliente será atualizado com o novo endereço e
                    coordenada GPS (Ponto B) para as próximas rotas saírem corretas.
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* BLOCO 1: Proposta de Correção Real de Endereço */}
          {proposeAddressCorrection && !addressCorrectionDone && (
            <div className="p-3.5 rounded-card border border-blue-400 bg-blue-50 text-blue-950 text-xs space-y-2 shadow-sm">
              <div className="flex items-start gap-2">
                <MapPin className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-blue-950">Correção Real de Endereço</p>
                  <p className="text-blue-900 mt-0.5 font-medium">
                    O endereço cadastrado parece diferente daqui. Atualizar para este ponto?
                  </p>
                  {capturedGps && (
                    <p className="text-[11px] font-mono text-blue-700 mt-1">
                      Coordenadas capturadas: {capturedGps.lat.toFixed(6)},{' '}
                      {capturedGps.lng.toFixed(6)}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setAddressCorrectionConfirmed(true)
                    setAddressCorrectionDone(true)
                    setProposeAddressCorrection(false)
                    toast.success('Ponto do cliente será atualizado com a posição real capturada.')
                  }}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs h-8 px-3"
                >
                  Sim, atualizar cadastro
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setAddressCorrectionConfirmed(false)
                    setAddressCorrectionDone(true)
                    setProposeAddressCorrection(false)
                  }}
                  className="border-blue-300 text-blue-900 hover:bg-blue-100 text-xs h-8 px-3"
                >
                  Manter como está
                </Button>
              </div>
            </div>
          )}

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

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  MapPin,
  Navigation,
  Send,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sparkles,
  Building2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { loadGoogleMapsScript } from '@/lib/googleMaps'
import { encodePlusCode } from '@/lib/plusCode'
import { toast } from 'sonner'

interface CustomerPublicData {
  id: string
  name: string
  address: string
  neighborhood?: string
  city?: string
  state?: string
  lat?: number | null
  lng?: number | null
  reference_point?: string
  plus_code?: string
}

export const PublicCustomerPinPage: React.FC = () => {
  const { customerId } = useParams<{ customerId: string }>()
  const [searchParams] = useSearchParams()
  const customerIdParam = customerId || searchParams.get('id') || ''

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [customer, setCustomer] = useState<CustomerPublicData | null>(null)

  const [currentLat, setCurrentLat] = useState<number | null>(null)
  const [currentLng, setCurrentLng] = useState<number | null>(null)
  const [referencePoint, setReferencePoint] = useState('')
  const [clientNote, setClientNote] = useState('')
  const [plusCode, setPlusCode] = useState('')

  const [isLocating, setIsLocating] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submittedSuccess, setSubmittedSuccess] = useState(false)
  const [submissionMessage, setSubmissionMessage] = useState('')

  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerInstanceRef = useRef<any>(null)

  // Carregar dados públicos do cliente
  useEffect(() => {
    if (!customerIdParam) {
      setError('Link de localização inválido. O ID do cliente não foi fornecido.')
      setLoading(false)
      return
    }

    let isMounted = true
    setLoading(true)

    fetch(`/backend/v1/public-client-pin/${customerIdParam}`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error('Não foi possível carregar os dados deste pedido.')
        }
        return res.json()
      })
      .then((data: CustomerPublicData) => {
        if (!isMounted) return
        setCustomer(data)
        if (data.reference_point) setReferencePoint(data.reference_point)

        // Se o cliente já tem coordenadas iniciais
        if (data.lat && data.lng) {
          setCurrentLat(data.lat)
          setCurrentLng(data.lng)
          setPlusCode(data.plus_code || encodePlusCode(data.lat, data.lng))
        } else {
          // Padrão centro RJ se ainda não tem
          setCurrentLat(-22.906847)
          setCurrentLng(-43.172896)
        }
        setLoading(false)
      })
      .catch((err) => {
        if (!isMounted) return
        console.warn('Erro ao carregar dados do cliente:', err)
        setError('Link de localização não encontrado ou expirado. Peça um novo link ao vendedor.')
        setLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [customerIdParam])

  // Inicializar mapa Google quando script carregar e coordenadas existirem
  const initMap = useCallback((lat: number, lng: number) => {
    if (typeof window === 'undefined' || !mapContainerRef.current) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any
    if (!win.google?.maps) return

    const pos = { lat, lng }

    if (!mapInstanceRef.current) {
      const map = new win.google.maps.Map(mapContainerRef.current, {
        center: pos,
        zoom: 17,
        disableDefaultUI: false,
        zoomControl: true,
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
      })
      mapInstanceRef.current = map

      const marker = new win.google.maps.Marker({
        position: pos,
        map,
        draggable: true,
        title: 'Arraste o pino para a sua casa ou portão de entrada',
      })
      markerInstanceRef.current = marker

      // Arraste do marcador
      marker.addListener('dragend', (evt: any) => {
        if (!evt?.latLng) return
        const nLat = typeof evt.latLng.lat === 'function' ? evt.latLng.lat() : evt.latLng.lat
        const nLng = typeof evt.latLng.lng === 'function' ? evt.latLng.lng() : evt.latLng.lng
        setCurrentLat(nLat)
        setCurrentLng(nLng)
        const code = encodePlusCode(nLat, nLng)
        setPlusCode(code)
      })

      // Clique no mapa reposiciona
      map.addListener('click', (evt: any) => {
        if (!evt?.latLng) return
        const nLat = typeof evt.latLng.lat === 'function' ? evt.latLng.lat() : evt.latLng.lat
        const nLng = typeof evt.latLng.lng === 'function' ? evt.latLng.lng() : evt.latLng.lng
        marker.setPosition({ lat: nLat, lng: nLng })
        setCurrentLat(nLat)
        setCurrentLng(nLng)
        const code = encodePlusCode(nLat, nLng)
        setPlusCode(code)
      })
    } else {
      mapInstanceRef.current.setCenter(pos)
      if (markerInstanceRef.current) {
        markerInstanceRef.current.setPosition(pos)
      }
    }
  }, [])

  useEffect(() => {
    if (!loading && currentLat && currentLng) {
      loadGoogleMapsScript().then((ok) => {
        if (ok) {
          initMap(currentLat, currentLng)
        }
      })
    }
  }, [loading, currentLat, currentLng, initMap])

  // Usar GPS do celular do cliente
  const handleUseGps = () => {
    if (!navigator.geolocation) {
      toast.error('Seu celular ou navegador não possui suporte a geolocalização GPS.')
      return
    }

    setIsLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocating(false)
        const userLat = pos.coords.latitude
        const userLng = pos.coords.longitude
        setCurrentLat(userLat)
        setCurrentLng(userLng)
        const code = encodePlusCode(userLat, userLng)
        setPlusCode(code)

        if (mapInstanceRef.current) {
          mapInstanceRef.current.setCenter({ lat: userLat, lng: userLng })
          mapInstanceRef.current.setZoom(18)
        }
        if (markerInstanceRef.current) {
          markerInstanceRef.current.setPosition({ lat: userLat, lng: userLng })
        }
        toast.success('Localização obtida pelo GPS do seu aparelho!')
      },
      (err) => {
        setIsLocating(false)
        console.warn('Erro geolocation:', err)
        toast.error(
          'Não foi possível obter o GPS. Por favor, arraste o pino no mapa até a sua casa.',
        )
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  }

  // Confirmar localização
  const handleConfirmLocation = async () => {
    if (!currentLat || !currentLng) {
      toast.error('Por favor, marque sua localização no mapa.')
      return
    }

    setIsSubmitting(true)
    try {
      const code = plusCode || encodePlusCode(currentLat, currentLng)

      const response = await fetch(`/backend/v1/public-client-pin/${customerIdParam}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          lat: currentLat,
          lng: currentLng,
          plus_code: code,
          reference_point: referencePoint,
          client_note: clientNote,
        }),
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Erro ao enviar localização.')
      }

      setSubmittedSuccess(true)
      setSubmissionMessage(
        result.message || 'Localização enviada com sucesso! O entregador já recebeu o ponto exato.',
      )
      toast.success('Localização confirmada!')
    } catch (err: any) {
      console.error('Erro ao enviar pin:', err)
      toast.error(err.message || 'Erro ao enviar localização. Tente novamente.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4">
        <Loader2 className="h-8 w-8 text-blue-500 animate-spin mb-3" />
        <p className="text-sm text-slate-300">Carregando mapa de localização...</p>
      </div>
    )
  }

  if (error || !customer) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center space-y-4">
          <AlertCircle className="h-12 w-12 text-rose-500 mx-auto" />
          <h1 className="text-lg font-bold">Link de Localização Indisponível</h1>
          <p className="text-xs text-slate-400">{error || 'Não encontramos este cliente.'}</p>
        </div>
      </div>
    )
  }

  if (submittedSuccess) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900 border border-emerald-500/30 rounded-2xl p-6 text-center space-y-4 shadow-xl">
          <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 mx-auto flex items-center justify-center">
            <CheckCircle2 className="h-10 w-10" />
          </div>
          <h1 className="text-xl font-bold text-white">Localização Confirmada!</h1>
          <p className="text-xs text-slate-300 leading-relaxed">{submissionMessage}</p>
          <div className="bg-slate-950/70 rounded-xl p-3 border border-slate-800 text-left text-xs space-y-1.5 font-mono">
            <p className="text-slate-400">
              Cliente: <span className="text-white font-bold">{customer.name}</span>
            </p>
            {plusCode && (
              <p className="text-slate-400">
                Plus Code: <span className="text-blue-400">{plusCode}</span>
              </p>
            )}
            {referencePoint && (
              <p className="text-slate-400">
                Referência: <span className="text-amber-300">{referencePoint}</span>
              </p>
            )}
          </div>
          <p className="text-[11px] text-slate-500">Você já pode fechar esta tela. Obrigado!</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      {/* Header */}
      <header className="p-4 bg-slate-900/90 border-b border-slate-800 backdrop-blur sticky top-0 z-20">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-blue-600/20 text-blue-400">
              <MapPin className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-white leading-tight">
                Marcar Ponto de Entrega
              </h1>
              <p className="text-[11px] text-slate-400">{customer.name}</p>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={handleUseGps}
            disabled={isLocating}
            className="h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white gap-1.5 font-medium"
          >
            {isLocating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Navigation className="h-3.5 w-3.5" />
            )}
            Meu GPS Atual
          </Button>
        </div>
      </header>

      {/* Conteúdo principal */}
      <main className="flex-1 max-w-xl w-full mx-auto p-4 space-y-3 pb-8">
        {/* Banner de instrução */}
        <div className="p-3 rounded-xl bg-blue-950/40 border border-blue-800/50 text-xs text-blue-200 space-y-1">
          <div className="flex items-center gap-1.5 font-semibold text-blue-300">
            <Sparkles className="h-4 w-4 text-blue-400 shrink-0" />
            <span>Ajude o entregador a chegar sem erro!</span>
          </div>
          <p className="text-[11px] text-blue-200/90 leading-relaxed">
            Se sua rua não tem CEP, o número é difícil de achar ou você mora em lote/comunidade,
            <strong> arraste o marcador vermelho 📍 no mapa</strong> exatamente até o seu portão.
          </p>
        </div>

        {/* Informações do endereço */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 text-xs space-y-1">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
            Endereço Informado:
          </span>
          <p className="text-slate-200 font-medium">
            {customer.address}
            {customer.neighborhood ? ` - ${customer.neighborhood}` : ''}
            {customer.city ? `, ${customer.city}` : ''}
          </p>
        </div>

        {/* Mapa interativo */}
        <div className="relative rounded-2xl overflow-hidden border border-slate-800 shadow-xl bg-slate-900">
          <div ref={mapContainerRef} className="w-full h-72 sm:h-80" />
          <div className="absolute bottom-2 left-2 right-2 pointer-events-none flex justify-center">
            <span className="bg-slate-950/80 backdrop-blur-sm text-white px-3 py-1 rounded-full text-[10px] font-medium border border-slate-800 shadow">
              📍 Arraste o pino ou clique no mapa para calibrar
            </span>
          </div>
        </div>

        {/* Coordenadas e Plus Code */}
        {currentLat && currentLng && (
          <div className="flex items-center justify-between text-[11px] text-slate-400 px-1 font-mono">
            <span>
              Lat/Lng: {currentLat.toFixed(6)}, {currentLng.toFixed(6)}
            </span>
            {plusCode && (
              <Badge
                variant="outline"
                className="border-blue-500/40 text-blue-300 bg-blue-500/10 font-mono text-[10px]"
              >
                Plus Code: {plusCode}
              </Badge>
            )}
          </div>
        )}

        {/* Ponto de Referência (Obrigatório em comunidades/sem número) */}
        <div className="space-y-1.5 pt-1">
          <Label className="text-xs font-semibold text-slate-200 flex items-center justify-between">
            <span>Ponto de Referência</span>
            <span className="text-[10px] text-amber-400 font-normal">
              Super importante para a entrega
            </span>
          </Label>
          <Input
            placeholder="Ex: Em frente ao Mercadinho do Zé, portão cinza, fundos do lote 14"
            value={referencePoint}
            onChange={(e) => setReferencePoint(e.target.value)}
            className="h-10 text-xs bg-slate-900 border-slate-800 text-white placeholder:text-slate-500 focus:border-blue-500"
          />
        </div>

        {/* Observação para o entregador */}
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-slate-200">
            Observação para o entregador (Opcional)
          </Label>
          <Input
            placeholder="Ex: Tocar a campainha da casa dos fundos, cachorro manso no quintal"
            value={clientNote}
            onChange={(e) => setClientNote(e.target.value)}
            className="h-10 text-xs bg-slate-900 border-slate-800 text-white placeholder:text-slate-500 focus:border-blue-500"
          />
        </div>

        {/* Botão de confirmação */}
        <div className="pt-2">
          <Button
            type="button"
            onClick={handleConfirmLocation}
            disabled={isSubmitting || !currentLat || !currentLng}
            className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-lg gap-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Salvando Localização...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" /> Confirmar Esta Localização
              </>
            )}
          </Button>
        </div>
      </main>
    </div>
  )
}

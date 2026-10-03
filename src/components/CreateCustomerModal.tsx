import React, { useState, useRef, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { deliveryService } from '@/services/deliveryService'
import {
  BRAZILIAN_STATES,
  normalizeBrazilianUF,
  lookupViaCep,
  geocodeAddressWithValidation,
  parseCoordinatesFromGoogleLink,
  reverseGeocodeCoordinates,
  loadGoogleMapsScript,
} from '@/lib/googleMaps'
import { haversineDistanceMeters } from '@/lib/geo'
import {
  BaseAddressAutocomplete,
  type BaseAddressResult,
} from '@/components/BaseAddressAutocomplete'
import { FormErrorBoundary } from '@/components/FormErrorBoundary'
import type { CustomerRecord } from '@/types/delivery'
import {
  UserPlus,
  Phone,
  Search,
  Loader2,
  Sparkles,
  CheckCircle2,
  Link2,
  Crosshair,
  AlertTriangle,
  AlertCircle,
  MapPin,
  Move,
  RefreshCw,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'

import { useEffect } from 'react'

interface CreateCustomerModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCustomerCreated: (customer: CustomerRecord) => void
  customerToEdit?: CustomerRecord | null
  onOpenSearch?: () => void
}

export function CreateCustomerModal({
  open,
  onOpenChange,
  onCustomerCreated,
  customerToEdit = null,
  onOpenSearch,
}: CreateCustomerModalProps) {
  const [name, setName] = useState('')
  const [document, setDocument] = useState('')
  const [phone, setPhone] = useState('')
  const [phone2, setPhone2] = useState('')
  const [phone3, setPhone3] = useState('')
  const [showExtraPhones, setShowExtraPhones] = useState(false)
  const [email, setEmail] = useState('')
  const [streetAndNumber, setStreetAndNumber] = useState('')
  const [complement, setComplement] = useState('')
  const [neighborhood, setNeighborhood] = useState('')
  const [city, setCity] = useState('')
  const [ufState, setUfState] = useState('SP')
  const [postalCode, setPostalCode] = useState('')
  const [lat, setLat] = useState<number | undefined>(undefined)
  const [lng, setLng] = useState<number | undefined>(undefined)
  const [hasPrecisionWarning, setHasPrecisionWarning] = useState(false)
  const [precisionWarningDismissed, setPrecisionWarningDismissed] = useState(false)
  const [precisionWarningText, setPrecisionWarningText] = useState('')
  const [addressSearchQuery, setAddressSearchQuery] = useState('')
  const [isLoadingViaCep, setIsLoadingViaCep] = useState(false)
  const [isSearchingPhone, setIsSearchingPhone] = useState(false)
  const [isLoadingLocationLink, setIsLoadingLocationLink] = useState(false)
  const [isGeocodingAddress, setIsGeocodingAddress] = useState(false)
  const [googleNormalizedAddress, setGoogleNormalizedAddress] = useState<string>('')
  const [geocodeLocationType, setGeocodeLocationType] = useState<string>('')
  const [initialSavedCoords, setInitialSavedCoords] = useState<{ lat?: number; lng?: number }>({})
  const [initialSavedAddress, setInitialSavedAddress] = useState<string>('')
  const [matchedExistingCustomer, setMatchedExistingCustomer] = useState<CustomerRecord | null>(
    null,
  )
  const [locationLinkInput, setLocationLinkInput] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  // Rastreamento estrito de edição manual vs seleção explícita
  const isAddressManuallyEditedRef = useRef<boolean>(false)
  const isSelectedFromAutocompleteRef = useRef<boolean>(false)
  const phoneDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const addressDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastGeocodedAddressRef = useRef<string>('')
  const isProgrammaticUpdateRef = useRef<boolean>(false)

  // Referências para o mini-mapa com pino interativo e arrastável
  const miniMapContainerRef = useRef<HTMLDivElement | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const miniMapInstanceRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const miniMapMarkerRef = useRef<any>(null)
  const [isPinManuallyAdjusted, setIsPinManuallyAdjusted] = useState(false)

  const isEditMode = Boolean(customerToEdit)

  // Preenche o formulário quando o modal abre em modo de edição
  useEffect(() => {
    if (open && customerToEdit) {
      setName(customerToEdit.name || '')
      setDocument(customerToEdit.document || '')
      setPhone(customerToEdit.phone || '')
      setPhone2(customerToEdit.phone2 || '')
      setPhone3(customerToEdit.phone3 || '')
      setEmail(customerToEdit.email || '')
      if (customerToEdit.phone2 || customerToEdit.phone3) {
        setShowExtraPhones(true)
      } else {
        setShowExtraPhones(false)
      }
      setStreetAndNumber(customerToEdit.street || customerToEdit.address?.split(',')[0] || '')
      setComplement(customerToEdit.complement || '')
      setNeighborhood(customerToEdit.neighborhood || '')
      setCity(customerToEdit.city || '')
      if (customerToEdit.state) {
        const uf = normalizeBrazilianUF(customerToEdit.state)
        if (uf && BRAZILIAN_STATES.includes(uf)) setUfState(uf)
      }
      setPostalCode(customerToEdit.postal_code || '')
      setLat(customerToEdit.lat)
      setLng(customerToEdit.lng)
      setInitialSavedCoords({ lat: customerToEdit.lat, lng: customerToEdit.lng })
      setInitialSavedAddress(customerToEdit.address || customerToEdit.street || '')
      // Se já estava com fallback Centro do RJ ou sem coordenada, alertar
      const isFallback =
        !customerToEdit.lat ||
        !customerToEdit.lng ||
        (Math.abs((customerToEdit.lat || 0) - -22.906847) < 0.0001 &&
          Math.abs((customerToEdit.lng || 0) - -43.172896) < 0.0001)
      setHasPrecisionWarning(isFallback)
      setPrecisionWarningText(
        isFallback
          ? 'Cliente com coordenada padrão de contingência ou ausente. Calibre via Google Maps.'
          : '',
      )
      setPrecisionWarningDismissed(false)
      setGoogleNormalizedAddress(customerToEdit.address || '')
      setAddressSearchQuery(customerToEdit.address || '')
      setMatchedExistingCustomer(customerToEdit)
      setLocationLinkInput('')
    } else if (open && !customerToEdit) {
      resetForm()
    }
  }, [open, customerToEdit])

  const resetForm = () => {
    setName('')
    setDocument('')
    setPhone('')
    setPhone2('')
    setPhone3('')
    setShowExtraPhones(false)
    setEmail('')
    setStreetAndNumber('')
    setComplement('')
    setNeighborhood('')
    setCity('')
    setUfState('RJ')
    setPostalCode('')
    setLat(undefined)
    setLng(undefined)
    setInitialSavedCoords({})
    setInitialSavedAddress('')
    setHasPrecisionWarning(false)
    setPrecisionWarningDismissed(false)
    setPrecisionWarningText('')
    setGoogleNormalizedAddress('')
    setGeocodeLocationType('')
    setIsPinManuallyAdjusted(false)
    isAddressManuallyEditedRef.current = false
    isSelectedFromAutocompleteRef.current = false
    setAddressSearchQuery('')
    setMatchedExistingCustomer(null)
    setLocationLinkInput('')
  }

  // Auto-lookup existing customer by typed phone
  const checkCustomerByPhone = useCallback(async (phoneInput: string) => {
    const cleanDigits = phoneInput.replace(/\D/g, '')
    if (cleanDigits.length < 8) return

    setIsSearchingPhone(true)
    try {
      const found = await deliveryService.findCustomerByPhone(phoneInput)
      if (found) {
        setMatchedExistingCustomer(found)
        setName(found.name || '')
        setDocument(found.document || '')
        setPhone(found.phone || '')
        setPhone2(found.phone2 || '')
        setPhone3(found.phone3 || '')
        setEmail(found.email || '')
        if (found.phone2 || found.phone3) setShowExtraPhones(true)
        setStreetAndNumber(found.street || found.address?.split(',')[0] || '')
        setNeighborhood(found.neighborhood || '')
        setCity(found.city || '')
        if (found.state) {
          const uf = normalizeBrazilianUF(found.state)
          if (uf && BRAZILIAN_STATES.includes(uf)) setUfState(uf)
        }
        setPostalCode(found.postal_code || '')
        setComplement(found.complement || '')
        if (found.lat && found.lng) {
          setLat(found.lat)
          setLng(found.lng)
        }
        toast.info(
          `Cliente "${found.name}" localizado pelo telefone. O cadastro será atualizado sem duplicidade!`,
        )
      } else {
        setMatchedExistingCustomer(null)
      }
    } catch (e) {
      console.warn('Erro ao verificar cliente por telefone:', e)
    } finally {
      setIsSearchingPhone(false)
    }
  }, [])

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setPhone(val)
    if (phoneDebounceRef.current) clearTimeout(phoneDebounceRef.current)
    const digits = val.replace(/\D/g, '')
    if (digits.length >= 8) {
      phoneDebounceRef.current = setTimeout(() => {
        checkCustomerByPhone(val)
      }, 500)
    }
  }

  // Callback disparado ao selecionar um endereço explicitamente no BaseAddressAutocomplete
  const handleAddressSelect = useCallback((result: BaseAddressResult) => {
    isProgrammaticUpdateRef.current = true
    // Marca atomicamente que este endereço veio de uma seleção explícita válida
    isSelectedFromAutocompleteRef.current = true
    isAddressManuallyEditedRef.current = false

    if (result.parsed) {
      const p = result.parsed
      // Proteção: nunca permitir que streetAndNumber receba o valor de city quando houver nome de rua
      const pCityNorm = (p.city || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
      const pStreetNorm = (p.streetAndNumber || p.street || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()

      let finalStreet = ''
      if (p.streetAndNumber && (!pCityNorm || pStreetNorm !== pCityNorm)) {
        finalStreet = p.streetAndNumber
      } else if (p.street && (!pCityNorm || pStreetNorm !== pCityNorm)) {
        finalStreet = p.number ? `${p.street}, ${p.number}` : p.street
      } else if (result.address) {
        const firstSegment = result.address.split(',')[0] || result.address
        const firstNorm = firstSegment
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim()
        if (!pCityNorm || firstNorm !== pCityNorm) {
          finalStreet = firstSegment
        }
      }

      if (finalStreet) {
        setStreetAndNumber(finalStreet)
      }

      if (result.parsed.neighborhood) {
        setNeighborhood(result.parsed.neighborhood)
      }
      if (result.parsed.city) {
        setCity(result.parsed.city)
      }
      if (result.parsed.state) {
        const uf = normalizeBrazilianUF(result.parsed.state)
        if (uf && BRAZILIAN_STATES.includes(uf)) {
          setUfState(uf)
        }
      }
      if (result.parsed.postalCode) {
        const cleanCep = result.parsed.postalCode.replace(/\D/g, '')
        const formattedCep =
          cleanCep.length === 8
            ? `${cleanCep.slice(0, 5)}-${cleanCep.slice(5)}`
            : result.parsed.postalCode
        setPostalCode(formattedCep)
      }
    } else if (result.address) {
      setStreetAndNumber(result.address.split(',')[0] || result.address)
    }

    const fullFormatted = result.parsed?.formattedAddress || result.address || result.name || ''
    setAddressSearchQuery(fullFormatted)
    setGoogleNormalizedAddress(fullFormatted)
    lastGeocodedAddressRef.current = fullFormatted

    if (result.parsed?.locationType) {
      setGeocodeLocationType(result.parsed.locationType)
    }

    if (typeof result.lat === 'number' && typeof result.lng === 'number') {
      const isFallback =
        Math.abs(result.lat - -22.906847) < 0.0001 && Math.abs(result.lng - -43.172896) < 0.0001
      const isApprox = Boolean(result.parsed?.isApproximate)

      if (isFallback) {
        setHasPrecisionWarning(true)
        setPrecisionWarningText(
          'Coordenada genérica de contingência retornada. Ajuste o pino no mapa.',
        )
        setPrecisionWarningDismissed(false)
        toast.warning('Endereço não geocodificado com precisão — revise no mapa antes de salvar')
      } else if (isApprox) {
        setLat(result.lat)
        setLng(result.lng)
        setHasPrecisionWarning(true)
        setPrecisionWarningText(
          'Google Maps localizou com precisão aproximada (centro de via/bairro). Arraste o pino para calibrar exatamente no imóvel.',
        )
        setPrecisionWarningDismissed(false)
        toast.warning('Precisão aproximada detectada no Google Maps — confira o pino no mapa.')
      } else {
        setHasPrecisionWarning(false)
        setPrecisionWarningDismissed(false)
        setPrecisionWarningText('')
        setLat(result.lat)
        setLng(result.lng)
      }
    } else {
      setHasPrecisionWarning(true)
      setPrecisionWarningText('Não foi possível obter coordenadas para este endereço.')
      setPrecisionWarningDismissed(false)
      toast.warning('Endereço não geocodificado com precisão — revise no mapa antes de salvar')
    }

    toast.success('Endereço localizado e campos preenchidos com sucesso!')
  }, [])

  // Inicializa ou atualiza o mini-mapa com pino interativo/arrastável
  const initOrUpdateMiniMap = useCallback((targetLat: number, targetLng: number) => {
    if (typeof window === 'undefined') return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any
    if (!win.google?.maps || !miniMapContainerRef.current) return

    try {
      const position = { lat: targetLat, lng: targetLng }
      if (!miniMapInstanceRef.current) {
        const map = new win.google.maps.Map(miniMapContainerRef.current, {
          center: position,
          zoom: 16,
          disableDefaultUI: false,
          zoomControl: true,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
        })
        miniMapInstanceRef.current = map

        const marker = new win.google.maps.Marker({
          position,
          map,
          draggable: true,
          title: 'Arraste para calibrar a localização exata do cliente',
        })
        miniMapMarkerRef.current = marker

        marker.addListener('dragend', (evt: any) => {
          if (!evt?.latLng) return
          const newLat = typeof evt.latLng.lat === 'function' ? evt.latLng.lat() : evt.latLng.lat
          const newLng = typeof evt.latLng.lng === 'function' ? evt.latLng.lng() : evt.latLng.lng
          // Anti-loop: marca atualização programática antes de atualizar coordenadas pelo arraste
          isProgrammaticUpdateRef.current = true
          setLat(newLat)
          setLng(newLng)
          // Doutrina do Pino Soberano: arraste explícito é soberano e travado
          setIsPinManuallyAdjusted(true)
          isSelectedFromAutocompleteRef.current = true
          setHasPrecisionWarning(false)
          setPrecisionWarningDismissed(true)
          toast.success(`Pino ajustado manualmente (${newLat.toFixed(6)}, ${newLng.toFixed(6)})`)
        })

        map.addListener('click', (evt: any) => {
          if (!evt?.latLng) return
          const clickLat = typeof evt.latLng.lat === 'function' ? evt.latLng.lat() : evt.latLng.lat
          const clickLng = typeof evt.latLng.lng === 'function' ? evt.latLng.lng() : evt.latLng.lng
          marker.setPosition({ lat: clickLat, lng: clickLng })
          setLat(clickLat)
          setLng(clickLng)
          // Doutrina do Pino Soberano: clique explícito no mapa é soberano e travado
          setIsPinManuallyAdjusted(true)
          isSelectedFromAutocompleteRef.current = true
          setHasPrecisionWarning(false)
          setPrecisionWarningDismissed(true)
          toast.success(`Pino reposicionado para (${clickLat.toFixed(6)}, ${clickLng.toFixed(6)})`)
        })

        setTimeout(() => {
          if (win.google?.maps?.event && miniMapInstanceRef.current) {
            win.google.maps.event.trigger(miniMapInstanceRef.current, 'resize')
          }
        }, 150)
      } else {
        miniMapInstanceRef.current.setCenter(position)
        if (miniMapMarkerRef.current) {
          miniMapMarkerRef.current.setPosition(position)
        }
        win.google.maps.event?.trigger(miniMapInstanceRef.current, 'resize')
      }
    } catch (err) {
      console.warn('Erro ao inicializar mini-mapa:', err)
    }
  }, [])

  // Sincroniza mini-mapa quando lat/lng mudam
  useEffect(() => {
    if (open && typeof lat === 'number' && typeof lng === 'number') {
      loadGoogleMapsScript().then((loaded) => {
        if (loaded) {
          initOrUpdateMiniMap(lat, lng)
        }
      })
    }
  }, [open, lat, lng, initOrUpdateMiniMap])

  // Limpeza ao fechar
  useEffect(() => {
    if (!open) {
      miniMapInstanceRef.current = null
      miniMapMarkerRef.current = null
      setIsPinManuallyAdjusted(false)
    }
  }, [open])

  // Executa geocodificação sob demanda ou debounced dos campos estruturados de endereço
  const handleGeocodeFields = useCallback(
    async (manualTrigger = false) => {
      if (isProgrammaticUpdateRef.current) {
        isProgrammaticUpdateRef.current = false
        return
      }

      const full = getFullFormattedAddress() || streetAndNumber.trim()
      if (!full || full.length < 5) return

      if (!manualTrigger && full === lastGeocodedAddressRef.current) {
        return
      }

      // Se estamos em modo edição e o endereço não foi alterado em relação ao original salvo
      // e já temos coordenadas válidas salvas, blindar para não regerar sem necessidade
      if (
        isEditMode &&
        !manualTrigger &&
        initialSavedCoords.lat &&
        initialSavedCoords.lng &&
        initialSavedAddress &&
        initialSavedAddress.trim().toLowerCase() === full.trim().toLowerCase()
      ) {
        return
      }

      setIsGeocodingAddress(true)
      try {
        const expected = {
          city: city.trim(),
          postalCode: postalCode.trim(),
          street: streetAndNumber.trim(),
          neighborhood: neighborhood.trim(),
        }

        const geo = await geocodeAddressWithValidation(full, expected, {
          lat: lat || -22.68,
          lng: lng || -43.3,
        })

        if (geo && typeof geo.lat === 'number' && typeof geo.lng === 'number') {
          const isFallback =
            Math.abs(geo.lat - -22.906847) < 0.0001 && Math.abs(geo.lng - -43.172896) < 0.0001
          const isApprox = Boolean(geo.parsed?.isApproximate)

          if (geo.parsed.formattedAddress) {
            setGoogleNormalizedAddress(geo.parsed.formattedAddress)
          }
          if (geo.parsed.locationType) {
            setGeocodeLocationType(geo.parsed.locationType)
          }

          if (isFallback) {
            setHasPrecisionWarning(true)
            setPrecisionWarningText(
              'O Google Maps retornou uma coordenada genérica. Ajuste o pino no mapa.',
            )
            setPrecisionWarningDismissed(false)
            if (manualTrigger) {
              toast.warning(
                'Endereço não geocodificado com precisão — revise no mapa antes de salvar',
              )
            }
          } else {
            lastGeocodedAddressRef.current = full
            setLat(geo.lat)
            setLng(geo.lng)
            setIsPinManuallyAdjusted(false)

            if (isApprox) {
              setHasPrecisionWarning(true)
              setPrecisionWarningText(
                'Google Maps identificou a via/bairro com precisão aproximada. Arraste o pino para fixar o imóvel exato.',
              )
              setPrecisionWarningDismissed(false)
              if (manualTrigger) {
                toast.warning('Localizado com precisão aproximada no Google Maps. Confira no mapa.')
              }
            } else if (geo.parsed.validationWarning) {
              setHasPrecisionWarning(true)
              setPrecisionWarningText(geo.parsed.validationWarning)
              setPrecisionWarningDismissed(false)
              if (manualTrigger) toast.warning(geo.parsed.validationWarning)
            } else {
              setHasPrecisionWarning(false)
              setPrecisionWarningDismissed(false)
              setPrecisionWarningText('')
              if (manualTrigger) {
                toast.success('Coordenadas calibradas com precisão pelo Google Maps!')
              }
            }
          }
        } else {
          setHasPrecisionWarning(true)
          setPrecisionWarningText(
            'Google Maps não encontrou coordenadas exatas para este endereço.',
          )
          setPrecisionWarningDismissed(false)
          if (manualTrigger) {
            toast.warning('Endereço não localizado pelo Google Maps. Ajuste o pino manualmente.')
          }
        }
      } catch (err) {
        console.warn('Erro ao geocodificar campos estruturados:', err)
        if (manualTrigger) toast.error('Falha de conexão com a API de Geocodificação.')
      } finally {
        setIsGeocodingAddress(false)
      }
    },
    [
      city,
      postalCode,
      streetAndNumber,
      neighborhood,
      ufState,
      lat,
      lng,
      isEditMode,
      initialSavedCoords,
      initialSavedAddress,
    ],
  )

  const getFullFormattedAddress = () => {
    const parts: string[] = []
    if (streetAndNumber.trim()) parts.push(streetAndNumber.trim())
    if (complement.trim()) parts.push(complement.trim())
    if (neighborhood.trim()) parts.push(neighborhood.trim())
    if (city.trim()) {
      parts.push(ufState ? `${city.trim()} - ${ufState}` : city.trim())
    }
    if (postalCode.trim()) parts.push(`CEP: ${postalCode.trim()}`)
    return parts.join(', ')
  }

  // Dispara geocodificação sob demanda no blur dos campos de endereço (rua, número, cidade)
  const handleAddressFieldsBlur = () => {
    if (addressDebounceRef.current) clearTimeout(addressDebounceRef.current)
    handleGeocodeFields(false)
  }

  // Handler unificado para alterações manuais com debounce de 800ms
  // Qualquer edição manual nos campos de endereço invalida vinculação com sugestão anterior
  const handleAddressFieldChange = (setter: (val: string) => void, value: string) => {
    isAddressManuallyEditedRef.current = true
    isSelectedFromAutocompleteRef.current = false
    setter(value)

    if (addressDebounceRef.current) {
      clearTimeout(addressDebounceRef.current)
    }

    addressDebounceRef.current = setTimeout(() => {
      handleGeocodeFields(false)
    }, 800)
  }

  // Verifica se o endereço textual foi modificado em relação ao salvo no cliente
  const isAddressModifiedFromSaved =
    isEditMode &&
    Boolean(initialSavedAddress) &&
    (getFullFormattedAddress() || streetAndNumber.trim()).trim().toLowerCase() !==
      initialSavedAddress.trim().toLowerCase()

  // Lookup CEP via ViaCEP com geocodificação anti-erro
  const handleCepChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value.replace(/\D/g, '')
    if (raw.length > 5) {
      raw = raw.replace(/^(\d{5})(\d)/, '$1-$2')
    }
    setPostalCode(raw)

    const clean = raw.replace(/\D/g, '')
    if (clean.length === 8) {
      setIsLoadingViaCep(true)
      try {
        const res = await lookupViaCep(clean)
        if (res) {
          if (res.street) setStreetAndNumber(res.street)
          if (res.neighborhood) setNeighborhood(res.neighborhood)
          if (res.city) setCity(res.city)
          if (res.state) {
            const uf = normalizeBrazilianUF(res.state)
            if (uf && BRAZILIAN_STATES.includes(uf)) setUfState(uf)
          }
          toast.success('Endereço preenchido automaticamente pelo CEP!')

          // Tentar geocodificar com validação anti-erro (conferindo cidade/CEP)
          const full = `${res.street || ''}, ${res.neighborhood || ''}, ${res.city || ''} - ${res.state || ''}, Brasil`
          const expected = {
            city: res.city,
            postalCode: clean,
            street: res.street,
            neighborhood: res.neighborhood,
          }
          geocodeAddressWithValidation(full, expected, { lat: -22.68, lng: -43.3 }).then((geo) => {
            if (geo && typeof geo.lat === 'number' && typeof geo.lng === 'number') {
              const isFallback =
                Math.abs(geo.lat - -22.906847) < 0.0001 && Math.abs(geo.lng - -43.172896) < 0.0001
              const isApprox = Boolean(geo.parsed?.isApproximate)

              if (geo.parsed.formattedAddress) {
                setGoogleNormalizedAddress(geo.parsed.formattedAddress)
              }
              if (geo.parsed.locationType) {
                setGeocodeLocationType(geo.parsed.locationType)
              }

              if (isFallback) {
                setHasPrecisionWarning(true)
                setPrecisionWarningText(
                  'Endereço não geocodificado com precisão — revise no mapa antes de salvar.',
                )
                setPrecisionWarningDismissed(false)
                toast.warning(
                  'Endereço não geocodificado com precisão — revise no mapa antes de salvar',
                )
              } else if (isApprox) {
                setLat(geo.lat)
                setLng(geo.lng)
                setHasPrecisionWarning(true)
                setPrecisionWarningText(
                  'Precisão aproximada do CEP. Arraste o pino para calibrar exatamente no imóvel.',
                )
                setPrecisionWarningDismissed(false)
              } else {
                setLat(geo.lat)
                setLng(geo.lng)
                if (geo.parsed.validationWarning) {
                  setHasPrecisionWarning(true)
                  setPrecisionWarningText(geo.parsed.validationWarning)
                  setPrecisionWarningDismissed(false)
                  toast.warning(geo.parsed.validationWarning)
                } else {
                  setHasPrecisionWarning(false)
                  setPrecisionWarningDismissed(false)
                  setPrecisionWarningText('')
                }
              }
            } else {
              setHasPrecisionWarning(true)
              setPrecisionWarningText('Endereço do CEP não geocodificado pelo Google Maps.')
              setPrecisionWarningDismissed(false)
              toast.warning(
                'Endereço não geocodificado com precisão — revise no mapa antes de salvar',
              )
            }
          })
        } else {
          toast.warning('CEP não encontrado. Preencha o endereço manualmente.')
        }
      } catch {
        toast.error('Erro ao consultar CEP.')
      } finally {
        setIsLoadingViaCep(false)
      }
    }
  }

  // Parse link de GPS / WhatsApp com prioridade absoluta para o pino exato e Google Geocoding
  const handleParseLink = async () => {
    const raw = locationLinkInput.trim()
    if (!raw) return

    const parsed = parseCoordinatesFromGoogleLink(raw)
    if (parsed) {
      const parsedLat = parsed.lat
      const parsedLng = parsed.lng
      setLat(parsedLat)
      setLng(parsedLng)
      // Doutrina do Pino Soberano: pin explícito carregado de link do Google Maps é autoritativo e travado
      setIsPinManuallyAdjusted(true)
      isSelectedFromAutocompleteRef.current = true
      isAddressManuallyEditedRef.current = false
      setHasPrecisionWarning(false)
      setPrecisionWarningDismissed(true)
      setIsLoadingLocationLink(true)

      const toastId = toast.loading(
        `Pino identificado (${parsedLat.toFixed(6)}, ${parsedLng.toFixed(6)}). Obtendo endereço real no Google Maps...`,
      )

      try {
        const geoRes = await reverseGeocodeCoordinates(parsedLat, parsedLng)
        if (geoRes) {
          const streetVal =
            geoRes.streetAndNumber ||
            (geoRes.street
              ? geoRes.number
                ? `${geoRes.street}, ${geoRes.number}`
                : geoRes.street
              : '') ||
            (geoRes.formattedAddress ? geoRes.formattedAddress.split(',')[0] : '')

          const newFullAddress = [
            streetVal,
            geoRes.neighborhood || '',
            geoRes.city ? (geoRes.state ? `${geoRes.city} - ${geoRes.state}` : geoRes.city) : '',
            geoRes.postalCode ? `CEP: ${geoRes.postalCode}` : '',
          ]
            .filter(Boolean)
            .join(', ')

          isProgrammaticUpdateRef.current = true
          lastGeocodedAddressRef.current = newFullAddress

          if (streetVal) {
            setStreetAndNumber(streetVal)
          }

          if (geoRes.neighborhood) {
            setNeighborhood(geoRes.neighborhood)
          }
          if (geoRes.city) {
            setCity(geoRes.city)
          }
          if (geoRes.state) {
            const uf = normalizeBrazilianUF(geoRes.state)
            if (uf && BRAZILIAN_STATES.includes(uf)) {
              setUfState(uf)
            }
          }
          if (geoRes.postalCode) {
            setPostalCode(geoRes.postalCode)
          }
          if (geoRes.formattedAddress) {
            setAddressSearchQuery(geoRes.formattedAddress)
          }

          toast.success(
            `Endereço real preenchido com sucesso pelo ${geoRes.source === 'google' ? 'Google Maps' : 'mapa'}!`,
            { id: toastId },
          )
        } else {
          toast.warning(
            `Coordenadas fixadas (${parsedLat.toFixed(5)}, ${parsedLng.toFixed(5)}). Preencha o nome da rua se necessário.`,
            { id: toastId },
          )
        }
      } catch (err) {
        console.error('Erro no reverse geocode:', err)
        toast.error('Coordenadas fixadas, mas houve falha ao obter endereço textual.', {
          id: toastId,
        })
      } finally {
        setIsLoadingLocationLink(false)
      }
      return
    }

    toast.error(
      'Não foi possível identificar coordenadas no link colado. Cole o link do Google Maps.',
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const trimmedName = name.trim()
    const mainPhone = phone.trim()

    if (!trimmedName) {
      toast.error('Preencha o nome do cliente.')
      return
    }

    if (!mainPhone) {
      toast.error('Preencha ao menos um telefone de contato (WhatsApp).')
      return
    }

    const fullAddress = getFullFormattedAddress() || streetAndNumber.trim()
    if (!streetAndNumber.trim() && !fullAddress.trim()) {
      toast.error('Preencha a Rua e Número ou busque pelo endereço/CEP.')
      return
    }

    const phonesToValidate = [mainPhone, phone2.trim() || undefined, phone3.trim() || undefined]

    // DOUTRINA: "Pino Explícito é Soberano"
    // Se o usuário calibrou o pino conscientemente (arraste, clique, URL Google Maps, lat/lng manual
    // ou seleção explícita no autocomplete), essas coordenadas NÃO podem ser sobrescritas por
    // re-geocodificação textual automática.
    let finalLat = lat
    let finalLng = lng

    const hasExplicitPin =
      Boolean(isPinManuallyAdjusted || isSelectedFromAutocompleteRef.current) &&
      typeof finalLat === 'number' &&
      typeof finalLng === 'number' &&
      !(Math.abs(finalLat - -22.906847) < 0.0001 && Math.abs(finalLng - -43.172896) < 0.0001)

    const isDefaultFallback =
      !finalLat ||
      !finalLng ||
      (Math.abs(finalLat - -22.906847) < 0.0001 && Math.abs(finalLng - -43.172896) < 0.0001)

    // A re-geocodificação estrita do texto digitado SÓ roda se NÃO houver pino explícito confirmado
    const needsStrictRegeocoding =
      !hasExplicitPin &&
      (isAddressManuallyEditedRef.current ||
        !isSelectedFromAutocompleteRef.current ||
        isDefaultFallback)

    if (needsStrictRegeocoding && !isPinManuallyAdjusted) {
      try {
        const expected = {
          city: city.trim(),
          postalCode: postalCode.trim(),
          street: streetAndNumber.trim(),
          neighborhood: neighborhood.trim(),
        }
        const geocoded = await geocodeAddressWithValidation(fullAddress, expected)
        if (geocoded && typeof geocoded.lat === 'number' && typeof geocoded.lng === 'number') {
          const isStillFallback =
            Math.abs(geocoded.lat - -22.906847) < 0.0001 &&
            Math.abs(geocoded.lng - -43.172896) < 0.0001
          if (!isStillFallback) {
            finalLat = geocoded.lat
            finalLng = geocoded.lng
            setLat(finalLat)
            setLng(finalLng)
            isAddressManuallyEditedRef.current = false
            isSelectedFromAutocompleteRef.current = true
            setHasPrecisionWarning(false)
            if (geocoded.parsed.formattedAddress) {
              setGoogleNormalizedAddress(geocoded.parsed.formattedAddress)
            }
          } else {
            // Geocodificação retornou fallback: alertar a vendedora
            setHasPrecisionWarning(true)
            setPrecisionWarningText(
              'A geocodificação do endereço digitado retornou coordenada imprecisa. Revise o pino no mapa antes de salvar.',
            )
            toast.warning('Endereço digitado não localizado com precisão no mapa.')
          }
        } else {
          // Geocodificação falhou para o texto digitado
          setHasPrecisionWarning(true)
          setPrecisionWarningText(
            'Não foi possível geocodificar o endereço digitado. Revise o endereço ou posicione o pino no mapa.',
          )
          toast.warning('Não foi possível localizar o endereço digitado. Verifique os dados.')
        }
      } catch (e) {
        console.warn('Tentativa de geocodificação estrita no submit falhou:', e)
      }
    }

    // Validação estrita de divergência (> 3 km):
    // Se houver pino explícito confirmado, alertamos a divergência com o geocoder SEM destruir o pino soberano.
    // Se NÃO houver pino explícito, a localização do texto digitado prevalece.
    if (finalLat && finalLng && fullAddress) {
      try {
        const expected = {
          city: city.trim(),
          postalCode: postalCode.trim(),
          street: streetAndNumber.trim(),
          neighborhood: neighborhood.trim(),
        }
        const geocoded = await geocodeAddressWithValidation(fullAddress, expected)
        if (geocoded && typeof geocoded.lat === 'number' && typeof geocoded.lng === 'number') {
          const isFallback =
            Math.abs(geocoded.lat - -22.906847) < 0.0001 &&
            Math.abs(geocoded.lng - -43.172896) < 0.0001
          if (!isFallback) {
            const distMeters = haversineDistanceMeters(
              finalLat,
              finalLng,
              geocoded.lat,
              geocoded.lng,
            )
            if (distMeters > 3000) {
              if (isPinManuallyAdjusted) {
                toast.warning(
                  `Aviso: O pino confirmado diverge em ${(distMeters / 1000).toFixed(1)} km do endereço textual "${fullAddress}". O pino soberano foi mantido conforme sua escolha.`,
                  { duration: 7000 },
                )
              } else {
                toast.warning(
                  `Atenção: A coordenada anterior diverge em ${(distMeters / 1000).toFixed(1)} km do endereço "${fullAddress}". Atualizando para a localização do texto digitado!`,
                  { duration: 7000 },
                )
                finalLat = geocoded.lat
                finalLng = geocoded.lng
                setLat(finalLat)
                setLng(finalLng)
              }
            }
          }
        }
      } catch (err) {
        console.warn('Erro ao verificar sanidade de coordenadas vs endereço:', err)
      }
    }

    // Se ainda assim não possui coordenadas válidas, alertar mas permitir salvar (nunca bloquear o salvamento)
    if (!finalLat || !finalLng) {
      if (!precisionWarningDismissed) {
        setHasPrecisionWarning(true)
        setPrecisionWarningText(
          'Cliente sem coordenadas válidas calibradas. O cadastro será marcado como pendente de geocodificação.',
        )
        toast.warning(
          'Aviso: Cliente salvo sem coordenadas calibradas. Ficará pendente de geocodificação.',
          { duration: 5000 },
        )
      }
    }

    const payload: Partial<CustomerRecord> = {
      name: trimmedName,
      document: document.trim() || undefined,
      phone: mainPhone,
      email: email.trim() || undefined,
      phone2: phone2.trim() || undefined,
      phone3: phone3.trim() || undefined,
      address: fullAddress,
      street: streetAndNumber.trim(),
      neighborhood: neighborhood.trim(),
      city: city.trim(),
      state: ufState.trim(),
      postal_code: postalCode.trim(),
      complement: complement.trim(),
      lat: finalLat,
      lng: finalLng,
    }

    setIsSubmitting(true)
    try {
      const targetCustomer = customerToEdit || matchedExistingCustomer

      if (targetCustomer) {
        // Checar conflito com OUTRO cliente
        const conflict = await deliveryService.checkPhoneConflict(
          phonesToValidate,
          targetCustomer.id,
        )
        if (conflict.conflict && conflict.customer) {
          toast.error(
            `O telefone ${conflict.duplicatePhone} já pertence ao cliente "${conflict.customer.name}". Evite duplicações!`,
          )
          return
        }

        const updated = await deliveryService.updateCustomer(targetCustomer.id, payload)
        toast.success(`Cadastro do cliente "${trimmedName}" atualizado com sucesso!`)
        resetForm()
        onCustomerCreated(updated)
        onOpenChange(false)
      } else {
        // Checar se já existe pelo telefone
        const conflict = await deliveryService.checkPhoneConflict(phonesToValidate)
        if (conflict.conflict && conflict.customer) {
          // Atualiza o existente em vez de duplicar
          const updated = await deliveryService.updateCustomer(conflict.customer.id, payload)
          toast.info(
            `Telefone vinculado ao cliente "${conflict.customer.name}". Cadastro atualizado sem duplicidade!`,
          )
          resetForm()
          onCustomerCreated(updated)
          onOpenChange(false)
        } else {
          const created = await deliveryService.createCustomer(payload)
          toast.success(`Cliente "${created.name}" cadastrado com sucesso!`)
          resetForm()
          onCustomerCreated(created)
          onOpenChange(false)
        }
      }
    } catch (err) {
      console.error('Erro ao salvar cliente:', err)
      toast.error('Erro ao salvar cliente.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto bg-[#0E1738] text-white border-[#1E2B58] p-5 sm:p-6 shadow-brand-dark">
        <FormErrorBoundary formName="Cadastro de Cliente">
          <DialogHeader className="pb-2 border-b border-[#1E2B58]">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div
                  className={`p-2 rounded-xl border ${
                    isEditMode
                      ? 'bg-[#0052CC]/20 border-[#0052CC]/40 text-[#60A5FA]'
                      : 'bg-[#22C55E]/20 border-[#22C55E]/40 text-[#22C55E]'
                  }`}
                >
                  <UserPlus className="h-5 w-5" />
                </div>
                <div>
                  <DialogTitle className="text-lg font-black text-white font-heading">
                    {isEditMode ? 'Editar Cliente' : 'Cadastrar Novo Cliente'}
                  </DialogTitle>
                  <DialogDescription className="text-xs text-slate-400">
                    {isEditMode
                      ? 'Atualize os dados, telefones ou endereço do cliente selecionado.'
                      : 'Cadastre clientes com e-mail para rastreio, até 3 telefones, busca automática por CEP e deduplicação inteligente.'}
                  </DialogDescription>
                </div>
              </div>

              {onOpenSearch && !isEditMode && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onOpenSearch}
                  className="shrink-0 h-8 text-xs gap-1.5 border-[#1E2B58] bg-[#0A1128] hover:bg-[#1E2B58] text-[#60A5FA] hover:text-white"
                >
                  <Search className="h-3.5 w-3.5 text-[#60A5FA]" />
                  <span className="hidden sm:inline">Buscar Cadastrado</span>
                </Button>
              )}
            </div>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            {/* Banner de Proteção contra Coordenada Default/Fallback Impreciso */}
            {hasPrecisionWarning && (
              <div className="p-3 rounded-xl bg-amber-500/20 border border-amber-500/60 text-amber-200 text-xs flex items-start gap-2.5">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="flex-1 space-y-1">
                  <p className="font-semibold text-amber-300">
                    {precisionWarningText ||
                      'Endereço não geocodificado com precisão — revise no mapa antes de salvar'}
                  </p>
                  <p className="text-[11px] text-amber-200/90 leading-relaxed">
                    Doutrina de Coordenada Travada: cada entrega exige o pin do cliente exato no
                    Google Maps para o cálculo correto de km e combustível. Você pode arrastar o
                    pino no mapa abaixo, digitar latitude/longitude ou confirmar o salvamento para
                    calibrar depois na tela de Verificação.
                  </p>
                  <div className="pt-1 flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setPrecisionWarningDismissed(true)}
                      className="h-6 text-[11px] bg-amber-500/20 border-amber-400/50 text-amber-200 hover:bg-amber-500/30 hover:text-white"
                    >
                      {precisionWarningDismissed
                        ? '✓ Revisão confirmada'
                        : 'Entendido, confirmar revisão consciente'}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Identificação de duplicidade / cliente existente */}
            {matchedExistingCustomer && (
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#0052CC]/20 border border-[#0052CC]/50 text-xs text-[#60A5FA]">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-[#22C55E]" />
                  <span>
                    Cliente já cadastrado encontrado! Os dados foram preenchidos para você
                    atualizar.
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setMatchedExistingCustomer(null)
                    setName('')
                    setPhone('')
                    setPhone2('')
                    setPhone3('')
                    setEmail('')
                    setStreetAndNumber('')
                    setComplement('')
                    setNeighborhood('')
                    setCity('')
                    setPostalCode('')
                  }}
                  className="h-6 text-[11px] text-slate-400 hover:text-white"
                >
                  Limpar
                </Button>
              </div>
            )}

            {/* Nome, Documento (CPF/CNPJ), Telefone Principal e E-mail */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="sm:col-span-1">
                <Label className="text-xs font-semibold text-slate-300">
                  Nome / Empresa <span className="text-[#FF6B35]">*</span>
                </Label>
                <Input
                  placeholder="Ex: Ana Maria Silva"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 h-9 text-xs bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500 focus:border-[#60A5FA]"
                  required
                />
              </div>

              <div className="sm:col-span-1">
                <Label className="text-xs font-semibold text-slate-300">CPF / CNPJ</Label>
                <Input
                  placeholder="000.000.000-00 ou CNPJ"
                  value={document}
                  onChange={(e) => setDocument(e.target.value)}
                  className="mt-1 h-9 text-xs font-mono bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500 focus:border-[#60A5FA]"
                />
              </div>

              <div className="sm:col-span-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-slate-300 flex items-center gap-1">
                    <Phone className="h-3 w-3 text-[#22C55E]" />
                    Telefone (WhatsApp) <span className="text-[#FF6B35]">*</span>
                  </Label>
                  {isSearchingPhone && (
                    <span className="text-[10px] text-[#60A5FA] flex items-center gap-1">
                      <Loader2 className="h-2.5 w-2.5 animate-spin" /> buscando...
                    </span>
                  )}
                </div>
                <Input
                  placeholder="(11) 98765-4321"
                  value={phone}
                  onChange={handlePhoneChange}
                  className="mt-1 h-9 text-xs bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500 focus:border-[#60A5FA]"
                  required
                />
              </div>

              <div className="sm:col-span-1">
                <Label className="text-xs font-semibold text-slate-300">
                  E-mail do Cliente (Opcional)
                </Label>
                <Input
                  type="email"
                  placeholder="cliente@exemplo.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 h-9 text-xs bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500 focus:border-[#60A5FA]"
                />
              </div>
            </div>

            {/* Telefones adicionais (até 3 telefones com deduplicação) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowExtraPhones(!showExtraPhones)}
                  className="h-6 px-1.5 text-xs text-[#60A5FA] hover:text-white hover:bg-[#1E2B58]/40"
                >
                  {showExtraPhones
                    ? '− Ocultar telefones adicionais'
                    : '+ Adicionar telefones 2 e 3 (até 3 números de contato)'}
                </Button>
              </div>

              {showExtraPhones && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-[#0A1128] border border-[#1E2B58]">
                  <div>
                    <Label className="text-xs font-semibold text-slate-300">
                      Telefone 2 (Fixo / Comercial)
                    </Label>
                    <Input
                      placeholder="Ex: (11) 3456-7890"
                      value={phone2}
                      onChange={(e) => setPhone2(e.target.value)}
                      className="mt-1 h-8 text-xs bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500"
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-semibold text-slate-300">
                      Telefone 3 (Recado / Outro)
                    </Label>
                    <Input
                      placeholder="Ex: (11) 91234-5678"
                      value={phone3}
                      onChange={(e) => setPhone3(e.target.value)}
                      className="mt-1 h-8 text-xs bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Busca Rápida por Endereço ou CEP com Google Maps Autocomplete */}
            <div className="p-3.5 rounded-xl bg-[#0A1128] border border-[#1E2B58] space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold text-[#60A5FA] uppercase tracking-wider flex items-center gap-1.5 font-heading">
                  <Search className="h-3.5 w-3.5 text-[#60A5FA]" />
                  Buscar Endereço Inteligente (Google Maps / CEP)
                </Label>
                <span className="text-[10px] text-slate-400">
                  Autocompleta enquanto você digita
                </span>
              </div>

              <BaseAddressAutocomplete
                value={addressSearchQuery}
                onChange={(val) => setAddressSearchQuery(val)}
                onAddressSelect={handleAddressSelect}
                placeholder="Comece a digitar o endereço ou CEP, ex: Av. Brasil, 1000..."
                className="w-full"
                inputClassName="h-9 bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500 focus-visible:border-[#60A5FA] focus-visible:ring-[#60A5FA]/30"
                buttonClassName="h-9 bg-[#1E2B58] hover:bg-[#2A3B7A] text-slate-100 border-[#1E2B58]"
                dropdownClassName="border-[#1E2B58] bg-[#0E1738] divide-[#1E2B58]/60 text-white"
                biasCoordinates={lat && lng ? { lat, lng } : { lat: -22.906847, lng: -43.172896 }}
                showSearchButton={true}
              />

              {/* Link de WhatsApp / Maps */}
              <div className="flex gap-2 pt-1 border-t border-[#1E2B58]/60">
                <div className="relative flex-1">
                  <Input
                    placeholder="Ou cole o link do Google Maps / WhatsApp recebido..."
                    value={locationLinkInput}
                    onChange={(e) => setLocationLinkInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleParseLink()
                      }
                    }}
                    className="h-8 text-xs pl-8 bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500"
                  />
                  <Link2 className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleParseLink}
                  disabled={!locationLinkInput.trim() || isLoadingLocationLink}
                  className="h-8 text-xs bg-[#1E2B58] text-[#60A5FA] hover:bg-[#2A3B7A] hover:text-white font-medium min-w-[105px]"
                >
                  {isLoadingLocationLink ? (
                    <>
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Carregando...
                    </>
                  ) : (
                    <>
                      <Crosshair className="h-3 w-3 mr-1" /> Carregar Pin
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Campos de Endereço Detalhados */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
              <div className="sm:col-span-8">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-slate-300">
                    Rua e Número <span className="text-[#FF6B35]">*</span>
                  </Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleGeocodeFields(true)}
                    disabled={isGeocodingAddress || !streetAndNumber.trim()}
                    className="h-5 px-1.5 text-[11px] text-[#60A5FA] hover:text-white hover:bg-[#1E2B58]/60 flex items-center gap-1 font-medium"
                  >
                    {isGeocodingAddress ? (
                      <>
                        <Loader2 className="h-2.5 w-2.5 animate-spin" /> Geocodificando...
                      </>
                    ) : (
                      <>
                        <Crosshair className="h-2.5 w-2.5" /> Geocodificar Google
                      </>
                    )}
                  </Button>
                </div>
                <Input
                  placeholder="Ex: Av. Paulista, 1000"
                  value={streetAndNumber}
                  onChange={(e) => handleAddressFieldChange(setStreetAndNumber, e.target.value)}
                  onBlur={handleAddressFieldsBlur}
                  className="mt-1 h-9 text-xs bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500 focus:border-[#60A5FA]"
                  required
                />
              </div>

              <div className="sm:col-span-4">
                <Label className="text-xs font-semibold text-slate-300">Complemento / Apto</Label>
                <Input
                  placeholder="Ex: Sala 42, Bloco B"
                  value={complement}
                  onChange={(e) => setComplement(e.target.value)}
                  className="mt-1 h-9 text-xs bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500"
                />
              </div>

              <div className="sm:col-span-4">
                <Label className="text-xs font-semibold text-slate-300">Bairro</Label>
                <Input
                  placeholder="Ex: Bela Vista"
                  value={neighborhood}
                  onChange={(e) => handleAddressFieldChange(setNeighborhood, e.target.value)}
                  onBlur={handleAddressFieldsBlur}
                  className="mt-1 h-9 text-xs bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500 focus:border-[#60A5FA]"
                />
              </div>

              <div className="sm:col-span-4">
                <Label className="text-xs font-semibold text-slate-300">Cidade</Label>
                <Input
                  placeholder="Ex: Rio de Janeiro"
                  value={city}
                  onChange={(e) => handleAddressFieldChange(setCity, e.target.value)}
                  onBlur={handleAddressFieldsBlur}
                  className="mt-1 h-9 text-xs bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500 focus:border-[#60A5FA]"
                />
              </div>

              <div className="sm:col-span-2">
                <Label className="text-xs font-semibold text-slate-300">UF</Label>
                <Select value={ufState} onValueChange={setUfState}>
                  <SelectTrigger className="mt-1 h-9 text-xs bg-[#070D1E] border-[#1E2B58] text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0E1738] border-[#1E2B58] text-white max-h-52">
                    {BRAZILIAN_STATES.map((uf) => (
                      <SelectItem
                        key={uf}
                        value={uf}
                        className="focus:bg-[#0052CC] focus:text-white"
                      >
                        {uf}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="sm:col-span-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-slate-300">CEP</Label>
                  {isLoadingViaCep && <Loader2 className="h-3 w-3 animate-spin text-[#60A5FA]" />}
                </div>
                <Input
                  placeholder="00000-000"
                  value={postalCode}
                  onChange={handleCepChange}
                  maxLength={9}
                  className="mt-1 h-9 text-xs font-mono bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500"
                />
              </div>
            </div>

            {/* Alerta de re-geocodificação recomendada quando endereço for alterado em edição */}
            {isAddressModifiedFromSaved && (
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/40 text-blue-300 text-xs">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-blue-400 shrink-0" />
                  <span>
                    O endereço foi alterado! Recomendamos recalibrar a coordenada Google para manter
                    o cálculo de km exato.
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => handleGeocodeFields(true)}
                  disabled={isGeocodingAddress}
                  className="h-6 text-[11px] bg-blue-500/20 border-blue-400/40 text-white hover:bg-blue-500/40 shrink-0"
                >
                  {isGeocodingAddress ? 'Calibrando...' : 'Recalibrar Pino'}
                </Button>
              </div>
            )}

            {/* Endereço formatado preview normalizado pelo Google / formulário */}
            {(googleNormalizedAddress || streetAndNumber) && (
              <div className="p-2.5 rounded-lg bg-[#070D1E] border border-[#1E2B58] space-y-1 text-[11px]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-slate-300">
                    <Sparkles className="h-3.5 w-3.5 text-[#60A5FA] shrink-0" />
                    <span className="font-semibold text-slate-200">
                      {googleNormalizedAddress
                        ? 'Endereço Normalizado Google Maps:'
                        : 'Endereço Montado:'}
                    </span>
                  </div>
                  {geocodeLocationType && (
                    <Badge
                      variant="outline"
                      className={`text-[10px] uppercase font-mono ${
                        geocodeLocationType === 'ROOFTOP'
                          ? 'border-emerald-500/50 text-emerald-400 bg-emerald-500/10'
                          : 'border-amber-500/50 text-amber-300 bg-amber-500/10'
                      }`}
                    >
                      Precisão: {geocodeLocationType}
                    </Badge>
                  )}
                </div>
                <p className="font-mono text-slate-300 pl-5 break-words">
                  {googleNormalizedAddress || getFullFormattedAddress()}
                </p>
              </div>
            )}

            {/* Mini-mapa com pino interativo e arrastável para confirmação/calibração manual */}
            <div className="rounded-xl border border-[#1E2B58] bg-[#0A1128] p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold text-white flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-[#FF6B35]" />
                  Posicionamento do Pino no Mapa (Doutrina de Coordenada Travada)
                </Label>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleGeocodeFields(true)}
                    disabled={isGeocodingAddress || !streetAndNumber.trim()}
                    className="h-6 text-[11px] text-[#60A5FA] hover:text-white hover:bg-[#1E2B58]"
                  >
                    <RefreshCw
                      className={`h-3 w-3 mr-1 ${isGeocodingAddress ? 'animate-spin' : ''}`}
                    />
                    Re-geocodificar
                  </Button>
                  <span className="text-[11px] text-slate-400 hidden sm:flex items-center gap-1">
                    <Move className="h-3 w-3 text-[#60A5FA]" />
                    Arraste o pino para calibrar
                  </span>
                </div>
              </div>

              <div
                ref={miniMapContainerRef}
                className="w-full h-44 rounded-lg bg-[#070D1E] border border-[#1E2B58] overflow-hidden relative"
              >
                {(!lat || !lng) && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-[#070D1E]/90 z-10 text-slate-400 text-xs">
                    <MapPin className="h-6 w-6 text-slate-500 mb-1 animate-pulse" />
                    <p>Preencha a Rua, CEP ou busque o endereço acima para fixar o pino no mapa.</p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => handleGeocodeFields(true)}
                      className="mt-2 text-xs h-7 border-[#1E2B58] text-[#60A5FA] hover:bg-[#1E2B58]"
                    >
                      Tentar Geocodificar Agora
                    </Button>
                  </div>
                )}
              </div>

              {/* Ajuste manual direto de Coordenadas Lat/Lng */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-[#1E2B58]/40">
                <div>
                  <Label className="text-[10px] text-slate-400 font-mono">Latitude Manual</Label>
                  <Input
                    placeholder="-22.906847"
                    value={lat !== undefined ? String(lat) : ''}
                    onChange={(e) => {
                      const parsed = parseFloat(e.target.value)
                      if (!isNaN(parsed)) {
                        setLat(parsed)
                        setIsPinManuallyAdjusted(true)
                        isSelectedFromAutocompleteRef.current = true
                        setHasPrecisionWarning(false)
                        setPrecisionWarningDismissed(true)
                      } else if (e.target.value === '') {
                        setLat(undefined)
                      }
                    }}
                    className="mt-0.5 h-7 text-xs font-mono bg-[#070D1E] border-[#1E2B58] text-white"
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-slate-400 font-mono">Longitude Manual</Label>
                  <Input
                    placeholder="-43.172896"
                    value={lng !== undefined ? String(lng) : ''}
                    onChange={(e) => {
                      const parsed = parseFloat(e.target.value)
                      if (!isNaN(parsed)) {
                        setLng(parsed)
                        setIsPinManuallyAdjusted(true)
                        isSelectedFromAutocompleteRef.current = true
                        setHasPrecisionWarning(false)
                        setPrecisionWarningDismissed(true)
                      } else if (e.target.value === '') {
                        setLng(undefined)
                      }
                    }}
                    className="mt-0.5 h-7 text-xs font-mono bg-[#070D1E] border-[#1E2B58] text-white"
                  />
                </div>
              </div>

              {typeof lat === 'number' && typeof lng === 'number' && (
                <div className="flex items-center justify-between text-[11px] text-slate-400 pt-0.5">
                  <span className="font-mono text-slate-300">
                    Fixado em: {lat.toFixed(6)}, {lng.toFixed(6)}
                  </span>
                  {isPinManuallyAdjusted ? (
                    <span className="text-emerald-400 font-semibold flex items-center gap-1">
                      ✓ Pino calibrado manualmente (travado)
                    </span>
                  ) : (
                    <span className="text-slate-400 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                      Geocodificado via Google Maps (travado)
                    </span>
                  )}
                </div>
              )}
            </div>

            <DialogFooter className="pt-2 gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  resetForm()
                  onOpenChange(false)
                }}
                className="border-[#1E2B58] text-slate-300 hover:bg-[#1E2B58] hover:text-white text-xs h-9"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className={`${
                  isEditMode ? 'bg-[#0052CC] hover:bg-[#003E99]' : 'bg-[#22C55E] hover:bg-[#1CA24D]'
                } text-white font-bold text-xs h-9 min-w-[140px] shadow-md`}
              >
                {isSubmitting
                  ? 'Salvando...'
                  : isEditMode
                    ? 'Salvar Alterações'
                    : 'Cadastrar Cliente'}
              </Button>
            </DialogFooter>
          </form>
        </FormErrorBoundary>
      </DialogContent>
    </Dialog>
  )
}

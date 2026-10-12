import React, { useEffect, useRef, useState, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Plus,
  Trash2,
  ShoppingBag,
  MapPin,
  Search,
  Crosshair,
  Link2,
  Navigation,
  Check,
  HelpCircle,
  Loader2,
  Building2,
  Sparkles,
  Phone,
  UserCheck,
  Edit3,
  AlertTriangle,
  MessageSquare,
} from 'lucide-react'
import { deliveryService } from '@/services/deliveryService'
import type {
  CustomerRecord,
  CustomerAddressItem,
  UserRecord,
  OrderPriority,
  OrderItem,
  RouteSuggestionDetails,
  OrderRecord,
} from '@/types/delivery'
import { useAuth } from '@/contexts/AuthContext'
import { getErrorMessage } from '@/lib/pocketbase/errors'
import { generateTrackingCode } from '@/lib/trackingCode'
import { toast } from 'sonner'
import {
  BRAZILIAN_STATES,
  loadGoogleMapsScript,
  onGoogleMapsAuthError,
  isGoogleMapsAuthError,
  parseGoogleAddressComponents,
  parseCoordinatesFromGoogleLink,
  reverseGeocodeCoordinates,
  lookupViaCep,
  fallbackGeocodeAddress,
  fallbackReverseGeocode,
  normalizeBrazilianUF,
  geocodeAddressWithValidation,
} from '@/lib/googleMaps'
import { encodePlusCode } from '@/lib/plusCode'
import { haversineDistanceMeters } from '@/lib/geo'
import { MapDataService } from '@/lib/mapDataService'
import { BaseAddressAutocomplete, BaseAddressResult } from '@/components/BaseAddressAutocomplete'
import { FormErrorBoundary } from '@/components/FormErrorBoundary'
import { CustomerSearchCombobox } from '@/components/CustomerSearchCombobox'

interface CreateOrderModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  customers: CustomerRecord[]
  couriers: UserRecord[]
  onOrderCreated: () => void
}

// Fallback Default Center (Rio de Janeiro - centro / polo operacional)
const DEFAULT_CENTER = { lat: -22.906847, lng: -43.172896 }

export const CreateOrderModal: React.FC<CreateOrderModalProps> = ({
  open,
  onOpenChange,
  customers: initialCustomers,
  couriers,
  onOrderCreated,
}) => {
  const { user } = useAuth()
  const [localCustomers, setLocalCustomers] = useState<CustomerRecord[]>(initialCustomers)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [customerId, setCustomerId] = useState<string>('')
  const [selectedCustomerAddressId, setSelectedCustomerAddressId] = useState<string | null>(null)
  const [courierId, setCourierId] = useState<string>('unassigned')
  const [priority, setPriority] = useState<OrderPriority>('normal')
  const [notes, setNotes] = useState<string>('')
  const [items, setItems] = useState<OrderItem[]>([{ name: '', qty: 1, price: 0 }])

  // Sincronizar clientes recebidos por prop
  useEffect(() => {
    if (initialCustomers && initialCustomers.length > 0) {
      setLocalCustomers(initialCustomers)
    }
  }, [initialCustomers])

  // Ao abrir o modal, garantir que os clientes da empresa ativa estejam carregados
  useEffect(() => {
    if (open) {
      deliveryService
        .getCustomers()
        .then((custs) => {
          if (custs && custs.length > 0) {
            setLocalCustomers(custs)
          }
        })
        .catch((err) =>
          console.warn('Erro ao atualizar lista de clientes no CreateOrderModal:', err),
        )
    }
  }, [open])

  // Customer inline state
  const [isAddingCustomer, setIsAddingCustomer] = useState(true)
  const [existingMatchedCustomerId, setExistingMatchedCustomerId] = useState<string | null>(null)
  const [isSearchingPhone, setIsSearchingPhone] = useState(false)
  const [newCustName, setNewCustName] = useState('')
  const [newCustPhone, setNewCustPhone] = useState('')
  const [newCustPhone2, setNewCustPhone2] = useState('')
  const [newCustPhone3, setNewCustPhone3] = useState('')
  const [showExtraPhones, setShowExtraPhones] = useState(false)

  // Search input controlled state
  const [addressSearchQuery, setAddressSearchQuery] = useState('')

  // Split Address Fields (Rua e Número, Bairro, Cidade, UF e CEP)
  const [streetAndNumber, setStreetAndNumber] = useState('')
  const [neighborhood, setNeighborhood] = useState('')
  const [city, setCity] = useState('')
  const [ufState, setUfState] = useState('RJ')
  const [postalCode, setPostalCode] = useState('')
  const [complement, setComplement] = useState('')
  const [referencePoint, setReferencePoint] = useState('')
  const [plusCode, setPlusCode] = useState('')

  // Coordinates
  const [selectedCoords, setSelectedCoords] = useState<{ lat: number; lng: number }>(DEFAULT_CENTER)
  const [hasLocationPinned, setHasLocationPinned] = useState(false)

  // Módulo 3: Sugestão Automática de Rota ao Registrar Nova Entrega
  const [routeSuggestion, setRouteSuggestion] = useState<RouteSuggestionDetails | null>(null)
  const [suggestionState, setSuggestionState] = useState<
    'pending' | 'accepted' | 'rejected' | 'edited'
  >('pending')
  const [isCalculatingSuggestion, setIsCalculatingSuggestion] = useState(false)

  // Alerta preventivo de venda duplicada (<24h)
  const [recentCustomerOrders, setRecentCustomerOrders] = useState<OrderRecord[]>([])
  const [isCheckingRecentOrders, setIsCheckingRecentOrders] = useState(false)
  const [ignoredRecentOrderWarning, setIgnoredRecentOrderWarning] = useState(false)

  // Link parsing input state
  const [locationLinkInput, setLocationLinkInput] = useState('')
  const [isParsingLink, setIsParsingLink] = useState(false)

  // Google Maps state & warnings
  const [isMapsLoaded, setIsMapsLoaded] = useState(false)
  const [mapsAuthWarning, setMapsAuthWarning] = useState<string | null>(null)
  const [isLoadingViaCep, setIsLoadingViaCep] = useState(false)

  // Módulo 3: Função de cálculo inteligente de rota e melhor entregador
  const calculateSmartRouteSuggestion = useCallback(
    async (targetLat: number, targetLng: number) => {
      setIsCalculatingSuggestion(true)
      try {
        const suggestion = await deliveryService.suggestBestCourierForOrder({
          customerLat: targetLat,
          customerLng: targetLng,
          priority,
        })
        if (suggestion) {
          setRouteSuggestion(suggestion)
          setSuggestionState('pending')
          // A sugestão de entregador deve ser APENAS exibida, exigindo clique em ACEITAR para atribuir
        }
      } catch (err) {
        console.warn('Erro ao sugerir rota inteligente:', err)
      } finally {
        setIsCalculatingSuggestion(false)
      }
    },
    [courierId, priority],
  )

  // Map & Autocomplete refs
  const mapContainerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerInstanceRef = useRef<any>(null)
  const isReverseGeocodingRef = useRef<boolean>(false)

  // Rastreamento estrito de edição manual vs seleção explícita
  const isAddressManuallyEditedRef = useRef<boolean>(false)
  const isSelectedFromAutocompleteRef = useRef<boolean>(false)
  const [isPinManuallyAdjusted, setIsPinManuallyAdjusted] = useState(false)

  // Refs de controle de geocodificação direta e anti-loop
  const addressDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastGeocodedAddressRef = useRef<string>('')
  const isProgrammaticUpdateRef = useRef<boolean>(false)

  // Helper to check window.google safely
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getGoogle = (): any => {
    return typeof window !== 'undefined'
      ? (window as unknown as { google?: unknown }).google
      : undefined
  }

  // Listen for Google Maps Authentication Errors (BillingNotEnabled / Quotas)
  useEffect(() => {
    const unsubscribe = onGoogleMapsAuthError((msg) => {
      setMapsAuthWarning(msg)
    })
    return unsubscribe
  }, [])

  // Load Google Maps script when modal opens
  useEffect(() => {
    if (!open) return

    let isMounted = true
    loadGoogleMapsScript().then((success) => {
      if (isMounted) {
        const ok = success && !isGoogleMapsAuthError()
        setIsMapsLoaded(ok)
        if (!ok) {
          setMapsAuthWarning('Google Maps indisponível ou erro de autenticação.')
        }
      }
    })

    return () => {
      isMounted = false
    }
  }, [open])

  // Watch open state change: force map resize when dialog animation completes
  useEffect(() => {
    if (open && isMapsLoaded) {
      const resizeTimer = setTimeout(() => {
        const google = getGoogle()
        if (mapInstanceRef.current && google?.maps) {
          google.maps.event.trigger(mapInstanceRef.current, 'resize')
          mapInstanceRef.current.setCenter(selectedCoords)
        }
      }, 300)
      return () => clearTimeout(resizeTimer)
    }
  }, [open, isMapsLoaded, selectedCoords])

  // Populate customer fields helper
  const populateCustomerForm = useCallback(async (cust: CustomerRecord) => {
    setExistingMatchedCustomerId(cust.id)
    setNewCustName(cust.name || '')
    setNewCustPhone(cust.phone || '')
    setNewCustPhone2(cust.phone2 || '')
    setNewCustPhone3(cust.phone3 || '')
    if (cust.phone2 || cust.phone3) {
      setShowExtraPhones(true)
    }

    setStreetAndNumber(cust.street || cust.address?.split(',')[0] || '')
    setNeighborhood(cust.neighborhood || '')
    setCity(cust.city || '')
    if (cust.state) {
      const uf = normalizeBrazilianUF(cust.state)
      if (uf && BRAZILIAN_STATES.includes(uf)) {
        setUfState(uf)
      }
    }
    setPostalCode(cust.postal_code || '')
    setComplement(cust.complement || '')
    setReferencePoint(cust.reference_point || '')
    setPlusCode(cust.plus_code || '')

    if (cust.lat && cust.lng) {
      setSelectedCoords({ lat: cust.lat, lng: cust.lng })
      setHasLocationPinned(true)
    }

    if (cust.id) {
      setIsCheckingRecentOrders(true)
      try {
        const recents = await deliveryService.getRecentActiveOrdersForCustomer(cust.id, 24)
        setRecentCustomerOrders(recents)
      } catch (err) {
        console.warn('Erro ao checar pedidos recentes do cliente:', err)
        setRecentCustomerOrders([])
      } finally {
        setIsCheckingRecentOrders(false)
      }
    }
  }, [])

  // Auto-lookup existing customer by typed phone
  const checkCustomerByPhoneDebounced = useCallback(
    async (phoneInput: string) => {
      const cleanDigits = phoneInput.replace(/\D/g, '')
      if (cleanDigits.length < 8) return

      // 1. Check in loaded customers array first (search phone1, phone2, phone3)
      const localMatch = localCustomers.find((c) => {
        const d1 = (c.phone || '').replace(/\D/g, '')
        const d2 = (c.phone2 || '').replace(/\D/g, '')
        const d3 = (c.phone3 || '').replace(/\D/g, '')
        return (
          (d1 &&
            (d1 === cleanDigits ||
              (d1.length >= 8 && (d1.endsWith(cleanDigits) || cleanDigits.endsWith(d1))))) ||
          (d2 &&
            (d2 === cleanDigits ||
              (d2.length >= 8 && (d2.endsWith(cleanDigits) || cleanDigits.endsWith(d2))))) ||
          (d3 &&
            (d3 === cleanDigits ||
              (d3.length >= 8 && (d3.endsWith(cleanDigits) || cleanDigits.endsWith(d3)))))
        )
      })

      if (localMatch) {
        populateCustomerForm(localMatch)
        toast.success(
          `Cliente localizado: "${localMatch.name}". Cadastro completo carregado e pronto para edição!`,
        )
        return
      }

      // 2. Query backend across phone, phone2, phone3
      setIsSearchingPhone(true)
      try {
        const found = await deliveryService.findCustomerByPhone(phoneInput)
        if (found) {
          populateCustomerForm(found)
          toast.success(
            `Cliente localizado: "${found.name}". Cadastro completo carregado e pronto para edição!`,
          )
        }
      } catch (e) {
        console.warn('Error querying customer by phone:', e)
      } finally {
        setIsSearchingPhone(false)
      }
    },
    [localCustomers, populateCustomerForm],
  )

  // Phone input handler with auto-search debounce
  const phoneDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handlePhoneInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setNewCustPhone(val)

    if (phoneDebounceRef.current) {
      clearTimeout(phoneDebounceRef.current)
    }

    const digits = val.replace(/\D/g, '')
    if (digits.length >= 8) {
      phoneDebounceRef.current = setTimeout(() => {
        checkCustomerByPhoneDebounced(val)
      }, 500)
    }
  }

  // Parse Google Maps / Waze / WhatsApp coordinates link (usa utilitário centralizado)
  const parseCoordinatesFromText = (text: string): { lat: number; lng: number } | null => {
    return parseCoordinatesFromGoogleLink(text)
  }

  // Populate address fields robustly
  const applyAddressData = useCallback(
    (parsed: {
      streetAndNumber?: string
      street?: string
      number?: string
      neighborhood?: string
      city?: string
      state?: string
      postalCode?: string
      complement?: string
    }) => {
      const pCityNorm = (parsed.city || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
      const pStreetNorm = (parsed.streetAndNumber || parsed.street || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()

      if (parsed.streetAndNumber && (!pCityNorm || pStreetNorm !== pCityNorm)) {
        setStreetAndNumber(parsed.streetAndNumber)
      } else if (parsed.street && (!pCityNorm || pStreetNorm !== pCityNorm)) {
        setStreetAndNumber(parsed.number ? `${parsed.street}, ${parsed.number}` : parsed.street)
      }

      if (parsed.neighborhood) {
        setNeighborhood(parsed.neighborhood)
      }

      if (parsed.city) {
        setCity(parsed.city)
      }

      if (parsed.state) {
        const uf = normalizeBrazilianUF(parsed.state)
        if (uf && BRAZILIAN_STATES.includes(uf)) {
          setUfState(uf)
        }
      }

      if (parsed.postalCode) {
        const cleanCep = parsed.postalCode.replace(/\D/g, '')
        const formattedCep =
          cleanCep.length === 8 ? `${cleanCep.slice(0, 5)}-${cleanCep.slice(5)}` : parsed.postalCode
        setPostalCode(formattedCep)
      }

      if (parsed.complement) {
        setComplement(parsed.complement)
      }
    },
    [],
  )

  // Reverse geocode to fill separate address fields (Google Maps Geocoder prioritário com Nominatim fallback)
  const reverseGeocode = useCallback(
    async (lat: number, lng: number) => {
      if (isReverseGeocodingRef.current) return
      isReverseGeocodingRef.current = true

      try {
        const geoRes = await reverseGeocodeCoordinates(lat, lng)
        if (geoRes) {
          // Prevenção anti-loop: marcar atualização programática antes de aplicar
          const newFullAddress = [
            geoRes.streetAndNumber || geoRes.street || '',
            geoRes.neighborhood || '',
            geoRes.city ? (geoRes.state ? `${geoRes.city} - ${geoRes.state}` : geoRes.city) : '',
            geoRes.postalCode ? `CEP: ${geoRes.postalCode}` : '',
          ]
            .filter(Boolean)
            .join(', ')

          isProgrammaticUpdateRef.current = true
          lastGeocodedAddressRef.current = newFullAddress

          applyAddressData(geoRes)
        }
      } catch (err) {
        console.warn('Erro ao geocodificar coordenadas:', err)
      } finally {
        isReverseGeocodingRef.current = false
      }
    },
    [applyAddressData],
  )

  // Update map marker and center safely without infinite loops
  const updateMapPosition = useCallback(
    (lat: number, lng: number, zoomLevel = 16, shouldReverseGeocode = false) => {
      setSelectedCoords({ lat, lng })
      setHasLocationPinned(true)
      const code = encodePlusCode(lat, lng)
      if (code) setPlusCode(code)
      calculateSmartRouteSuggestion(lat, lng)

      const google = getGoogle()
      const cleanPos = MapDataService.cleanCoords(lat, lng)
      if (mapInstanceRef.current && google?.maps && cleanPos) {
        try {
          const pos = new google.maps.LatLng(cleanPos.lat, cleanPos.lng)
          mapInstanceRef.current.setCenter(pos)
          mapInstanceRef.current.setZoom(zoomLevel)

          if (markerInstanceRef.current) {
            markerInstanceRef.current.setPosition(pos)
          } else {
            markerInstanceRef.current = new google.maps.Marker({
              position: pos,
              map: mapInstanceRef.current,
              draggable: true,
              title: 'Arraste para ajustar o ponto exato de entrega',
              animation: google.maps.Animation.DROP,
            })

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            markerInstanceRef.current.addListener('dragend', (evt: any) => {
              if (!evt?.latLng) return
              const newLat =
                typeof evt.latLng.lat === 'function' ? evt.latLng.lat() : evt.latLng.lat
              const newLng =
                typeof evt.latLng.lng === 'function' ? evt.latLng.lng() : evt.latLng.lng
              setSelectedCoords({ lat: newLat, lng: newLng })
              setHasLocationPinned(true)
              // Doutrina do Pino Soberano: arraste explícito é soberano e travado
              setIsPinManuallyAdjusted(true)
              isSelectedFromAutocompleteRef.current = true
              reverseGeocode(newLat, newLng)
            })
          }
        } catch (e) {
          console.warn('Error updating map marker position:', e)
        }
      }

      if (shouldReverseGeocode) {
        reverseGeocode(lat, lng)
      }
    },
    [reverseGeocode],
  )

  // Initialize Map
  const initMap = useCallback(() => {
    const google = getGoogle()
    if (!mapContainerRef.current || !google?.maps) return

    try {
      if (!mapInstanceRef.current) {
        const map = new google.maps.Map(mapContainerRef.current, {
          center: selectedCoords,
          zoom: hasLocationPinned ? 16 : 13,
          disableDefaultUI: false,
          zoomControl: true,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
        })

        mapInstanceRef.current = map

        const marker = new google.maps.Marker({
          position: selectedCoords,
          map: map,
          draggable: true,
          title: 'Arraste para ajustar o ponto de entrega',
        })
        markerInstanceRef.current = marker

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        marker.addListener('dragend', (evt: any) => {
          if (!evt?.latLng) return
          const newLat = typeof evt.latLng.lat === 'function' ? evt.latLng.lat() : evt.latLng.lat
          const newLng = typeof evt.latLng.lng === 'function' ? evt.latLng.lng() : evt.latLng.lng
          setSelectedCoords({ lat: newLat, lng: newLng })
          setHasLocationPinned(true)
          // Doutrina do Pino Soberano: arraste explícito é soberano e travado
          setIsPinManuallyAdjusted(true)
          isSelectedFromAutocompleteRef.current = true
          reverseGeocode(newLat, newLng)
        })

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.addListener('click', (evt: any) => {
          if (!evt?.latLng) return
          const clickLat = typeof evt.latLng.lat === 'function' ? evt.latLng.lat() : evt.latLng.lat
          const clickLng = typeof evt.latLng.lng === 'function' ? evt.latLng.lng() : evt.latLng.lng
          // Doutrina do Pino Soberano: clique explícito no mapa é soberano e travado
          setIsPinManuallyAdjusted(true)
          isSelectedFromAutocompleteRef.current = true
          updateMapPosition(clickLat, clickLng, map.getZoom() || 16, true)
        })

        // Trigger resize event after short delay so map tiles render completely
        setTimeout(() => {
          if (google?.maps?.event && mapInstanceRef.current) {
            google.maps.event.trigger(mapInstanceRef.current, 'resize')
          }
        }, 100)
      } else {
        // If map already exists, trigger resize and recenter
        google.maps.event?.trigger(mapInstanceRef.current, 'resize')
        mapInstanceRef.current.setCenter(selectedCoords)
      }
    } catch (err) {
      console.error('Error initializing Google Map in modal:', err)
    }
  }, [hasLocationPinned, reverseGeocode, selectedCoords, updateMapPosition])

  // Callback when user selects address from BaseAddressAutocomplete
  const handleAddressSelectFromAutocomplete = useCallback(
    (result: BaseAddressResult) => {
      isProgrammaticUpdateRef.current = true
      // Marca atomicamente que este endereço veio de uma seleção explícita válida
      isSelectedFromAutocompleteRef.current = true
      isAddressManuallyEditedRef.current = false

      if (result.parsed) {
        applyAddressData(result.parsed)
      } else if (result.address || result.name) {
        const full = result.address || result.name || ''
        setStreetAndNumber(full.split(',')[0] || full)
      }

      const fullStr = result.address || result.name || ''
      setAddressSearchQuery(fullStr)
      lastGeocodedAddressRef.current = fullStr

      if (typeof result.lat === 'number' && typeof result.lng === 'number') {
        updateMapPosition(result.lat, result.lng, 16, false)
        toast.success('Endereço selecionado e localizado no mapa!')
      }
    },
    [applyAddressData, updateMapPosition],
  )

  // Automatic CEP lookup when user finishes typing 8 digits in CEP field
  const handleCepChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value.replace(/\D/g, '')
    if (raw.length > 8) raw = raw.slice(0, 8)

    // Format display as 00000-000
    const formatted = raw.length > 5 ? `${raw.slice(0, 5)}-${raw.slice(5)}` : raw
    setPostalCode(formatted)

    if (raw.length === 8) {
      setIsLoadingViaCep(true)
      const res = await lookupViaCep(raw)
      setIsLoadingViaCep(false)
      if (res) {
        applyAddressData(res)
        toast.success(`CEP ${formatted} preenchido!`)
        // Also locate coordinates
        const fullAddr = `${res.street}, ${res.neighborhood}, ${res.city} - ${res.state}`
        fallbackGeocodeAddress(fullAddr).then((geo) => {
          if (geo) {
            updateMapPosition(geo.lat, geo.lng, 16, false)
          }
        })
      } else {
        toast.error('CEP não encontrado. Digite os dados manualmente.')
      }
    }
  }

  // Cleanup references on modal close
  useEffect(() => {
    if (!open) {
      mapInstanceRef.current = null
      markerInstanceRef.current = null
      setIsPinManuallyAdjusted(false)
    }
  }, [open])

  // Initialize Map when modal opens and maps API is ready
  useEffect(() => {
    if (open && isMapsLoaded && isAddingCustomer) {
      const timer = setTimeout(() => {
        initMap()
      }, 150)
      return () => clearTimeout(timer)
    }
  }, [open, isMapsLoaded, isAddingCustomer, initMap])

  // Handler para trocar endereço selecionado de um cliente com múltiplos endereços
  const handleSelectCustomerAddress = (addressItem: CustomerAddressItem) => {
    setSelectedCustomerAddressId(addressItem.id)
    const addrText = addressItem.address || addressItem.street || ''
    setAddressSearchQuery(addrText)
    setStreetAndNumber(addressItem.street || addrText)
    setNeighborhood(addressItem.neighborhood || '')
    setCity(addressItem.city || '')
    setPostalCode(addressItem.postal_code || '')
    setComplement(addressItem.complement || '')
    setReferencePoint(addressItem.reference_point || '')
    if (addressItem.lat && addressItem.lng) {
      setSelectedCoords({ lat: addressItem.lat, lng: addressItem.lng })
      setHasLocationPinned(true)
      setIsPinManuallyAdjusted(true)
      isSelectedFromAutocompleteRef.current = true
      updateMapPosition(addressItem.lat, addressItem.lng, 16, false)
    }
    toast.info(`Endereço "${addressItem.label}" selecionado para a entrega.`)
  }

  // When selecting existing customer
  const handleSelectExistingCustomer = async (id: string) => {
    setCustomerId(id)
    setIgnoredRecentOrderWarning(false)
    const cust = localCustomers.find((c) => c.id === id)

    // Se cliente tiver lista de endereços, escolhe o default ou o primeiro
    if (cust && Array.isArray(cust.addresses) && cust.addresses.length > 0) {
      const defaultAddr = cust.addresses.find((a) => a.is_default) || cust.addresses[0]
      setSelectedCustomerAddressId(defaultAddr.id)
      const custAddr = defaultAddr.address || defaultAddr.street || ''
      setAddressSearchQuery(custAddr)
      setStreetAndNumber(defaultAddr.street || custAddr)
      setNeighborhood(defaultAddr.neighborhood || '')
      setCity(defaultAddr.city || '')
      setPostalCode(defaultAddr.postal_code || '')
      setComplement(defaultAddr.complement || '')
      setReferencePoint(defaultAddr.reference_point || '')
      if (defaultAddr.lat && defaultAddr.lng) {
        setSelectedCoords({ lat: defaultAddr.lat, lng: defaultAddr.lng })
        setHasLocationPinned(true)
        setIsPinManuallyAdjusted(true)
        isSelectedFromAutocompleteRef.current = true
        updateMapPosition(defaultAddr.lat, defaultAddr.lng, 16, false)
      }
    } else {
      setSelectedCustomerAddressId(null)
      if (cust && cust.lat && cust.lng) {
        setSelectedCoords({ lat: cust.lat, lng: cust.lng })
        setHasLocationPinned(true)
        setIsPinManuallyAdjusted(true)
        isSelectedFromAutocompleteRef.current = true
        updateMapPosition(cust.lat, cust.lng, 16, false)
      }

      if (cust) {
        const custAddr = cust.address || cust.street || ''
        setAddressSearchQuery(custAddr)
        setStreetAndNumber(cust.street || custAddr)
        setNeighborhood(cust.neighborhood || '')
        setCity(cust.city || '')
        setPostalCode(cust.postal_code || '')
        setComplement(cust.complement || '')
        setReferencePoint(cust.reference_point || '')
      }
    }

    if (cust) {
      if (cust.name) setNewCustName(cust.name)
      if (cust.phone) setNewCustPhone(cust.phone)
      if (cust.phone2) setNewCustPhone2(cust.phone2)
      if (cust.phone3) setNewCustPhone3(cust.phone3)
    }

    if (id) {
      setIsCheckingRecentOrders(true)
      try {
        const recents = await deliveryService.getRecentActiveOrdersForCustomer(id, 24)
        setRecentCustomerOrders(recents)
      } catch (err) {
        console.warn('Erro ao checar pedidos recentes do cliente:', err)
        setRecentCustomerOrders([])
      } finally {
        setIsCheckingRecentOrders(false)
      }
    } else {
      setRecentCustomerOrders([])
    }
  }

  // Handle parsing coordinates link or WhatsApp text
  const handleApplyLocationLink = async () => {
    const inputVal = locationLinkInput.trim()
    if (!inputVal) return

    setIsParsingLink(true)
    try {
      // 1. Direct coordinate extraction (Maps URLs, WhatsApp pins, lat/lng strings)
      const coords = parseCoordinatesFromText(inputVal)
      if (coords) {
        // Doutrina do Pino Soberano: pin explícito carregado de link do Google Maps é autoritativo e travado
        setIsPinManuallyAdjusted(true)
        isSelectedFromAutocompleteRef.current = true
        isAddressManuallyEditedRef.current = false
        updateMapPosition(coords.lat, coords.lng, 17, true)
        toast.success(
          `Localização identificada (${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}) e campos preenchidos!`,
        )
        setLocationLinkInput('')
        return
      }

      // 2. Check if the link contains a text query like /search/Rua+Exemplo+123 or ?q=Rua+Exemplo
      let cleanQuery = inputVal
      const queryMatch =
        inputVal.match(/(?:q|query|place|search)\/([^?&#]+)/i) ||
        inputVal.match(/[?&](?:q|query|daddr)=([^&#]+)/i)
      if (queryMatch && queryMatch[1]) {
        cleanQuery = decodeURIComponent(queryMatch[1].replace(/\+/g, ' '))
      }

      const google = getGoogle()
      let handled = false
      if (google?.maps?.Geocoder) {
        const geocoder = new google.maps.Geocoder()
        await new Promise<void>((resolve) => {
          geocoder.geocode(
            { address: cleanQuery, componentRestrictions: { country: 'br' } },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (results: any[], status: string) => {
              if (status === 'OK' && results?.[0]?.geometry?.location) {
                const loc = results[0].geometry.location
                const parsed = parseGoogleAddressComponents(
                  results[0].address_components || [],
                  results[0].formatted_address || cleanQuery,
                )
                applyAddressData(parsed)
                updateMapPosition(loc.lat(), loc.lng(), 16, false)
                toast.success('Localização encontrada pelo texto do link/endereço!')
                setLocationLinkInput('')
                handled = true
              }
              resolve()
            },
          )
        })
      }

      if (!handled) {
        const fallbackRes = await fallbackGeocodeAddress(cleanQuery)
        if (fallbackRes) {
          applyAddressData(fallbackRes.parsed)
          updateMapPosition(fallbackRes.lat, fallbackRes.lng, 16, false)
          toast.success('Localização encontrada com sucesso!')
          setLocationLinkInput('')
        } else {
          toast.error(
            'Não foi possível extrair coordenadas deste link. Cole o link do Google Maps ou coordenadas lat,lng.',
          )
        }
      }
    } catch (e) {
      console.error(e)
      toast.error('Erro ao processar localização.')
    } finally {
      setIsParsingLink(false)
    }
  }

  // Geolocation (Current device location)
  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocalização não suportada no seu navegador.')
      return
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords
        updateMapPosition(latitude, longitude, 17, true)
        toast.success('Posição atual detectada!')
      },
      (err) => {
        console.warn(err)
        toast.error('Não foi possível obter sua localização atual.')
      },
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }

  // Item helpers
  const handleAddItem = () => {
    setItems([...items, { name: '', qty: 1, price: 0 }])
  }

  const handleRemoveItem = (index: number) => {
    if (items.length === 1) return
    setItems(items.filter((_, i) => i !== index))
  }

  const handleItemChange = (index: number, field: keyof OrderItem, val: string | number) => {
    const updated = [...items]
    updated[index] = { ...updated[index], [field]: val }
    setItems(updated)
  }

  const totalPrice = items.reduce(
    (acc, item) => acc + (Number(item.price) || 0) * (Number(item.qty) || 1),
    0,
  )

  // Construct formatted combined address string no padrão Uber
  const getFullFormattedAddress = () => {
    const rawStreet = streetAndNumber.trim()
    let streetVal = rawStreet
    let numberVal = ''
    if (rawStreet.includes(',')) {
      const sp = rawStreet.split(',')
      streetVal = sp[0].trim()
      numberVal = sp.slice(1).join(',').trim()
    }

    const parts: string[] = []
    if (streetVal) {
      if (numberVal && !/^(s\/n|sn|sem\s*n[uú]mero)$/i.test(numberVal)) {
        parts.push(`${streetVal}, ${numberVal}`)
      } else {
        parts.push(streetVal)
      }
    }

    if (neighborhood.trim()) parts.push(neighborhood.trim())
    if (city.trim()) {
      parts.push(ufState ? `${city.trim()} - ${ufState}` : city.trim())
    }
    if (postalCode.trim()) {
      const cleanCep = postalCode.replace(/\D/g, '')
      const formattedCep =
        cleanCep.length === 8 ? `${cleanCep.slice(0, 5)}-${cleanCep.slice(5)}` : postalCode.trim()
      parts.push(`CEP ${formattedCep}`)
    }
    return parts.join(', ')
  }

  // Geocodificação direta debounced ao digitar o endereço nos campos estruturados
  const triggerAddressGeocoding = useCallback(
    async (overrideValues?: {
      streetAndNumber?: string
      neighborhood?: string
      city?: string
      ufState?: string
      postalCode?: string
    }) => {
      // Se a atualização foi disparada programaticamente (ex: reverseGeocode pelo arraste do pino), consome a flag e ignora
      if (isProgrammaticUpdateRef.current) {
        isProgrammaticUpdateRef.current = false
        return
      }

      const currentStreet = overrideValues?.streetAndNumber ?? streetAndNumber
      const currentNeighborhood = overrideValues?.neighborhood ?? neighborhood
      const currentCity = overrideValues?.city ?? city
      const currentUf = overrideValues?.ufState ?? ufState
      const currentCep = overrideValues?.postalCode ?? postalCode

      const addressParts: string[] = []
      if (currentStreet.trim()) addressParts.push(currentStreet.trim())
      if (currentNeighborhood.trim()) addressParts.push(currentNeighborhood.trim())
      if (currentCity.trim()) {
        addressParts.push(currentUf ? `${currentCity.trim()} - ${currentUf}` : currentCity.trim())
      }
      if (currentCep.trim()) addressParts.push(`CEP: ${currentCep.trim()}`)

      const fullAddress = addressParts.join(', ')

      // Ignora se endereço for muito curto (< 8 caracteres) ou idêntico ao último geocodificado
      if (
        !fullAddress ||
        fullAddress.length < 8 ||
        fullAddress === lastGeocodedAddressRef.current
      ) {
        return
      }

      try {
        const expected = {
          city: currentCity.trim(),
          postalCode: currentCep.trim(),
          street: currentStreet.trim(),
          neighborhood: currentNeighborhood.trim(),
        }

        const geo = await geocodeAddressWithValidation(fullAddress, expected)

        if (geo && typeof geo.lat === 'number' && typeof geo.lng === 'number') {
          // Ignora se for o ponto genérico de fallback (-22.906847, -43.172896)
          const isFallback =
            Math.abs(geo.lat - -22.906847) < 0.0001 && Math.abs(geo.lng - -43.172896) < 0.0001

          if (!isFallback) {
            lastGeocodedAddressRef.current = fullAddress
            // shouldReverseGeocode = false para não sobrescrever o texto digitado
            updateMapPosition(geo.lat, geo.lng, 16, false)
          }
        }
      } catch (err) {
        console.warn('Erro ao geocodificar endereço digitado:', err)
      }
    },
    [city, neighborhood, postalCode, streetAndNumber, ufState, updateMapPosition],
  )

  // Handler unificado para alterações nos inputs de endereço com debounce de 800ms
  // Qualquer edição manual nos campos de endereço invalida vinculação com sugestão anterior
  const handleAddressFieldChange = (
    setter: (val: string) => void,
    fieldKey: 'streetAndNumber' | 'neighborhood' | 'city' | 'ufState' | 'postalCode',
    value: string,
  ) => {
    isAddressManuallyEditedRef.current = true
    isSelectedFromAutocompleteRef.current = false
    setter(value)

    if (addressDebounceRef.current) {
      clearTimeout(addressDebounceRef.current)
    }

    addressDebounceRef.current = setTimeout(() => {
      triggerAddressGeocoding({ [fieldKey]: value })
    }, 800)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    let finalCustomerId = customerId

    // Helper para sanitizar telefones (remover máscaras e espaços)
    const sanitizePhone = (val: string) => val.replace(/\D/g, '')

    // If using inline customer form (New or existing matched by phone/editing)
    if (isAddingCustomer) {
      if (!newCustName.trim()) {
        toast.error('Preencha o nome do cliente.')
        return
      }

      const rawMainPhone = newCustPhone.trim()
      const cleanMainPhone = sanitizePhone(rawMainPhone)
      if (!rawMainPhone || cleanMainPhone.length < 8) {
        toast.error('Preencha ao menos um telefone de contato válido com DDD para o cliente.')
        return
      }

      const combinedAddress = getFullFormattedAddress()
      if (!streetAndNumber.trim() && !combinedAddress.trim()) {
        toast.error('Preencha ao menos a Rua e Número ou busque pelo endereço.')
        return
      }

      // BUG 1 FIX: Rastrear edição manual. Se a vendedora alterou qualquer campo textual de endereço
      // sem ter selecionado explicitamente uma sugestão do dropdown para aquele endereço, executar
      // geocodificação direta e estrita sobre o texto digitado atual — NUNCA reutilizar coordenadas de consultas anteriores.
      let parsedLat =
        typeof selectedCoords.lat === 'number' && !isNaN(selectedCoords.lat)
          ? selectedCoords.lat
          : Number(selectedCoords.lat) || undefined
      let parsedLng =
        typeof selectedCoords.lng === 'number' && !isNaN(selectedCoords.lng)
          ? selectedCoords.lng
          : Number(selectedCoords.lng) || undefined

      // DOUTRINA: "Pino Explícito é Soberano"
      // Se o usuário calibrou o pino conscientemente (arraste, clique, URL Google Maps, lat/lng manual
      // ou seleção explícita no autocomplete), essas coordenadas NÃO podem ser sobrescritas por
      // re-geocodificação textual automática.
      const hasExplicitPin =
        Boolean(isPinManuallyAdjusted || isSelectedFromAutocompleteRef.current) &&
        typeof parsedLat === 'number' &&
        typeof parsedLng === 'number' &&
        !(Math.abs(parsedLat - -22.906847) < 0.0001 && Math.abs(parsedLng - -43.172896) < 0.0001)

      const isDefaultCoords =
        !parsedLat ||
        !parsedLng ||
        (Math.abs(parsedLat - -22.906847) < 0.0001 && Math.abs(parsedLng - -43.172896) < 0.0001)

      const needsStrictRegeocoding =
        !hasExplicitPin &&
        (isAddressManuallyEditedRef.current ||
          !isSelectedFromAutocompleteRef.current ||
          isDefaultCoords)

      if (needsStrictRegeocoding && !isPinManuallyAdjusted) {
        try {
          const expected = {
            city: city.trim(),
            postalCode: postalCode.trim(),
            street: streetAndNumber.trim(),
            neighborhood: neighborhood.trim(),
          }
          const fullQuery = combinedAddress || streetAndNumber.trim()
          const geocoded = await geocodeAddressWithValidation(fullQuery, expected)
          if (
            geocoded &&
            typeof geocoded.lat === 'number' &&
            typeof geocoded.lng === 'number' &&
            !(
              Math.abs(geocoded.lat - -22.906847) < 0.0001 &&
              Math.abs(geocoded.lng - -43.172896) < 0.0001
            )
          ) {
            parsedLat = geocoded.lat
            parsedLng = geocoded.lng
            setSelectedCoords({ lat: parsedLat, lng: parsedLng })
            setHasLocationPinned(true)
            isAddressManuallyEditedRef.current = false
            isSelectedFromAutocompleteRef.current = true
          } else {
            // Geocodificação falhou ou retornou fallback
            toast.warning(
              'Atenção: Não foi possível calibrar a localização exata do endereço digitado no mapa.',
              { duration: 6000 },
            )
          }
        } catch {
          // segue
        }
      }

      // Validação estrita de divergência (> 3 km):
      // Se houver pino explícito confirmado, alertamos a divergência com o geocoder SEM destruir o pino soberano.
      // Se NÃO houver pino explícito, a localização do texto digitado prevalece.
      if (parsedLat && parsedLng && (combinedAddress || streetAndNumber.trim())) {
        try {
          const expected = {
            city: city.trim(),
            postalCode: postalCode.trim(),
            street: streetAndNumber.trim(),
            neighborhood: neighborhood.trim(),
          }
          const fullQuery = combinedAddress || streetAndNumber.trim()
          const geocoded = await geocodeAddressWithValidation(fullQuery, expected)
          if (
            geocoded &&
            typeof geocoded.lat === 'number' &&
            typeof geocoded.lng === 'number' &&
            !(
              Math.abs(geocoded.lat - -22.906847) < 0.0001 &&
              Math.abs(geocoded.lng - -43.172896) < 0.0001
            )
          ) {
            const distMeters = haversineDistanceMeters(
              parsedLat,
              parsedLng,
              geocoded.lat,
              geocoded.lng,
            )
            if (distMeters > 3000) {
              if (isPinManuallyAdjusted) {
                toast.warning(
                  `Aviso: O pino confirmado diverge em ${(distMeters / 1000).toFixed(1)} km do endereço textual "${fullQuery}". O pino soberano foi mantido conforme sua escolha.`,
                  { duration: 7000 },
                )
              } else {
                toast.warning(
                  `Atenção: A coordenada anterior diverge em ${(distMeters / 1000).toFixed(1)} km do endereço "${fullQuery}". Atualizando para a localização do texto digitado!`,
                  { duration: 7000 },
                )
                parsedLat = geocoded.lat
                parsedLng = geocoded.lng
                setSelectedCoords({ lat: parsedLat, lng: parsedLng })
              }
            }
          }
        } catch (err) {
          console.warn('Erro ao validar divergência de coordenadas vs endereço digitado:', err)
        }
      }

      // ITEM 11: Campo 'Ponto de referência' OBRIGATÓRIO quando sem número (lote/quadra/comunidade)
      const hasNoNumber =
        !streetAndNumber.trim() ||
        /\b(s\/n|sn|sem\s+n[uú]mero|lote|quadra|qd|lt|comunidade)\b/i.test(streetAndNumber) ||
        !/\d+/.test(streetAndNumber)
      if (hasNoNumber && !referencePoint.trim()) {
        toast.error(
          'Endereço sem número detectado (lote/quadra/comunidade/s/n): o Ponto de Referência é OBRIGATÓRIO.',
        )
        return
      }

      const cleanPhone2 = newCustPhone2.trim() ? sanitizePhone(newCustPhone2) : undefined
      const cleanPhone3 = newCustPhone3.trim() ? sanitizePhone(newCustPhone3) : undefined

      const computedPlusCode =
        parsedLat && parsedLng ? encodePlusCode(parsedLat, parsedLng) : plusCode

      const customerPayload: Partial<CustomerRecord> = {
        name: newCustName.trim(),
        phone: cleanMainPhone,
        phone2: cleanPhone2 || undefined,
        phone3: cleanPhone3 || undefined,
        address: combinedAddress || streetAndNumber.trim(),
        street: streetAndNumber.trim(),
        neighborhood: neighborhood.trim(),
        city: city.trim(),
        state: ufState.trim(),
        postal_code: postalCode.trim()
          ? postalCode
              .trim()
              .replace(/\D/g, '')
              .replace(/^(\d{5})(\d{3})$/, '$1-$2')
          : '',
        complement: complement.trim(),
        reference_point: referencePoint.trim(),
        plus_code: computedPlusCode || undefined,
        lat: parsedLat,
        lng: parsedLng,
      }

      setIsSubmitting(true)
      try {
        // Validate phone uniqueness across all 3 phone fields against other customers
        const phonesToValidate = [cleanMainPhone, cleanPhone2, cleanPhone3].filter(
          Boolean,
        ) as string[]

        if (existingMatchedCustomerId) {
          // Check if any of the phones belong to ANOTHER customer (conflict)
          const conflictCheck = await deliveryService.checkPhoneConflict(
            phonesToValidate,
            existingMatchedCustomerId,
          )
          if (conflictCheck.conflict && conflictCheck.customer) {
            toast.error(
              `O telefone ${conflictCheck.duplicatePhone} já está cadastrado para o cliente "${conflictCheck.customer.name}". Não é permitido cadastrar o mesmo telefone para clientes diferentes.`,
            )
            setIsSubmitting(false)
            return
          }

          const existingCustomer = localCustomers.find((c) => c.id === existingMatchedCustomerId)
          const notesLower = (existingCustomer?.notes || '').toLowerCase()
          const isDefinitiveCorrection =
            notesLower.includes('correção definitiva') ||
            notesLower.includes('pin real confirmado') ||
            notesLower.includes('definitivo')

          const updatePayload = { ...customerPayload }
          if (isDefinitiveCorrection) {
            // Preserva rigorosamente o PIN soberano/corrigido já aprovado
            delete updatePayload.lat
            delete updatePayload.lng
          }

          // Update existing customer record directly
          const updatedCust = await deliveryService.updateCustomer(
            existingMatchedCustomerId,
            updatePayload,
          )
          finalCustomerId = updatedCust.id || existingMatchedCustomerId
          setCustomerId(finalCustomerId)
          toast.success(`Cadastro do cliente "${newCustName.trim()}" atualizado com sucesso!`)
        } else {
          // Check if any of the phones already belongs to an existing customer
          const conflictCheck = await deliveryService.checkPhoneConflict(phonesToValidate)
          if (conflictCheck.conflict && conflictCheck.customer) {
            // Found existing customer by one of the phones -> update their record instead of duplicating
            const existingCustomer = conflictCheck.customer
            const notesLower = (existingCustomer?.notes || '').toLowerCase()
            const isDefinitiveCorrection =
              notesLower.includes('correção definitiva') ||
              notesLower.includes('pin real confirmado') ||
              notesLower.includes('definitivo')

            const updatePayload = { ...customerPayload }
            if (isDefinitiveCorrection) {
              // Preserva rigorosamente o PIN soberano/corrigido já aprovado
              delete updatePayload.lat
              delete updatePayload.lng
            }

            const updatedCust = await deliveryService.updateCustomer(
              conflictCheck.customer.id,
              updatePayload,
            )
            finalCustomerId = updatedCust.id || conflictCheck.customer.id
            setCustomerId(finalCustomerId)
            toast.info(
              `Telefone vinculado ao cliente "${conflictCheck.customer.name}". Cadastro atualizado sem duplicidade!`,
            )
          } else {
            // Create new customer
            const created = await deliveryService.createCustomer(customerPayload)
            finalCustomerId = created.id
            setCustomerId(created.id)
            toast.success(`Novo cliente "${created.name}" cadastrado com sucesso!`)
          }
        }
      } catch (err: unknown) {
        console.error('Error saving customer:', err)
        const detailedMsg = getErrorMessage(err)
        toast.error(detailedMsg || 'Erro ao salvar dados do cliente.')
        setIsSubmitting(false)
        return
      }
    }

    if (!finalCustomerId) {
      toast.error('Selecione ou cadastre um cliente.')
      setIsSubmitting(false)
      return
    }

    const validItems = items.filter((i) => i.name.trim().length > 0)
    if (validItems.length === 0) {
      toast.error('Adicione pelo menos um item ao pedido.')
      setIsSubmitting(false)
      return
    }

    setIsSubmitting(true)
    try {
      const assignedCourier = courierId !== 'unassigned' ? courierId : undefined
      const assignmentType = suggestionState === 'accepted' ? 'automatic' : 'manual'
      const suggestionStatus =
        suggestionState === 'accepted' ||
        suggestionState === 'rejected' ||
        suggestionState === 'edited'
          ? suggestionState
          : 'none'

      // Se atribuído diretamente a um entregador, busca dados da base para não deixar start_base vazia
      let baseDataForOrder: {
        start_base_name?: string
        start_base_address?: string
        start_base_lat?: number
        start_base_lng?: number
      } = {}
      if (assignedCourier) {
        try {
          const bases = await deliveryService.getBaseAddresses()
          const defaultBase = bases.find((b) => b.is_default) || bases[0]
          if (defaultBase) {
            baseDataForOrder = {
              start_base_name: defaultBase.name,
              start_base_address: defaultBase.address,
              start_base_lat: defaultBase.lat,
              start_base_lng: defaultBase.lng,
            }
          }
        } catch (bErr) {
          console.warn('Erro ao carregar base default:', bErr)
        }
      }

      // Validação e preenchimento autoritativo do destino do cliente (end_address_*)
      // Garante que o pedido nunca nasça vazio nem com endereço/coordenadas da base
      const selectedCustomerRecord = localCustomers.find((c) => c.id === finalCustomerId)
      const targetAddressText =
        selectedCustomerRecord?.address ||
        selectedCustomerRecord?.street ||
        getFullFormattedAddress() ||
        streetAndNumber.trim() ||
        ''
      const targetCustomerName = selectedCustomerRecord?.name || newCustName.trim() || 'Cliente'
      const targetLat =
        typeof selectedCoords.lat === 'number' && !isNaN(selectedCoords.lat)
          ? selectedCoords.lat
          : selectedCustomerRecord?.lat
      const targetLng =
        typeof selectedCoords.lng === 'number' && !isNaN(selectedCoords.lng)
          ? selectedCoords.lng
          : selectedCustomerRecord?.lng

      // Retry silencioso de criação de pedido: até 3 tentativas gerando novo tracking_code
      // com backoff curto (~200ms) para neutralizar eventuais colisões de concorrência.
      const MAX_ORDER_ATTEMPTS = 3
      let createdOrder: OrderRecord | null = null
      let usedTrackingCode = ''
      let lastCreateError: unknown = null

      for (let attempt = 1; attempt <= MAX_ORDER_ATTEMPTS; attempt++) {
        usedTrackingCode = generateTrackingCode()
        try {
          createdOrder = await deliveryService.createOrder({
            tracking_code: usedTrackingCode,
            seller_id: user?.id,
            customer_id: finalCustomerId,
            customer_address_id: selectedCustomerAddressId || undefined,
            courier_id: assignedCourier,
            status: 'pending',
            sequence: null as any,
            route_released: false,
            route_released_at: undefined,
            route_started: false,
            route_started_at: undefined,
            ...baseDataForOrder,
            end_address_name: targetCustomerName,
            end_address_text: targetAddressText,
            end_address_lat: targetLat,
            end_address_lng: targetLng,
            priority,
            items: validItems,
            total_price: totalPrice,
            notes,
            assignment_type: assignmentType,
            route_suggestion_status: suggestionStatus,
            route_suggestion_details: routeSuggestion || undefined,
            distance_km: routeSuggestion?.distance_km || undefined,
            estimated_arrival: undefined,
          })
          break
        } catch (orderErr) {
          lastCreateError = orderErr
          console.warn(
            `Tentativa ${attempt}/${MAX_ORDER_ATTEMPTS} de criação do pedido ${usedTrackingCode} falhou:`,
            orderErr,
          )
          if (attempt < MAX_ORDER_ATTEMPTS) {
            await new Promise((resolve) => setTimeout(resolve, 200))
          }
        }
      }

      if (!createdOrder) {
        throw lastCreateError || new Error('Falha ao criar registro de pedido após tentativas.')
      }

      // REGRA SOBERANA DE ENDEREÇAMENTO ROTALY (PARTE 3 - ANTI-CEP):
      // Pin do cliente é soberano. Varredura de CEP preventiva desativada: apenas pin_entregador (>500m) opera alertas.

      // Trigger automatic in-app notification
      try {
        await deliveryService.createNotification({
          title: 'Novo Pedido Registrado',
          message: `Pedido ${usedTrackingCode} criado com sucesso. Valor: R$ ${totalPrice.toFixed(2)}`,
          type: 'order',
          read: false,
          user_id: user?.id,
        })
      } catch (notifErr) {
        console.warn('Erro ao enviar notificação interna do pedido:', notifErr)
      }

      toast.success(`Pedido ${usedTrackingCode} registrado com sucesso!`)
      onOrderCreated()
      onOpenChange(false)

      // Reset form
      setCustomerId('')
      setExistingMatchedCustomerId(null)
      setCourierId('unassigned')
      setPriority('normal')
      setNotes('')
      setItems([{ name: '', qty: 1, price: 0 }])
      setAddressSearchQuery('')
      setStreetAndNumber('')
      setNeighborhood('')
      setCity('')
      setPostalCode('')
      setComplement('')
      setNewCustName('')
      setNewCustPhone('')
      setNewCustPhone2('')
      setNewCustPhone3('')
      setShowExtraPhones(false)
      setLocationLinkInput('')
      setHasLocationPinned(false)
      setSelectedCoords(DEFAULT_CENTER)
      setIsPinManuallyAdjusted(false)
    } catch (err: unknown) {
      console.error('Error creating order:', err)
      // No fluxo de vendas, NUNCA usar traduções/mensagens genéricas de e-mail de usuários.
      toast.error('Não foi possível registrar a venda. Verifique os dados e tente novamente.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto p-4 sm:p-6">
        <FormErrorBoundary formName="Registrar Nova Venda">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold text-[#1a1a1a] font-heading">
              <ShoppingBag className="h-5 w-5 text-[#FF6B35]" />
              Registrar Nova Venda & Entrega Rotaly
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-5 py-2">
            {/* Billing / Auth error notice banner (non-intrusive fallback helper) */}
            {mapsAuthWarning && (
              <Alert className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200 py-2.5">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <AlertDescription className="text-xs">
                  <strong>Aviso de Mapa:</strong> A chave do Google Maps precisa de faturamento
                  ativo no Google Cloud Console.
                  <span className="font-semibold text-emerald-700 dark:text-emerald-400 ml-1">
                    O modo inteligente está ativo:
                  </span>{' '}
                  você pode digitar o CEP para preencher o endereço automaticamente (Rua, Bairro,
                  Cidade e UF) ou arrastar o pino.
                </AlertDescription>
              </Alert>
            )}

            {/* Customer Selection or Creation Box */}
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-blue-600" />
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                    Dados do Cliente & Localização de Entrega
                  </Label>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsAddingCustomer(!isAddingCustomer)}
                  className="h-7 text-xs font-semibold text-blue-600 hover:text-blue-700 bg-white dark:bg-slate-800"
                >
                  {isAddingCustomer ? 'Selecionar Existente' : '+ Cadastrar Novo Cliente'}
                </Button>
              </div>

              {!isAddingCustomer ? (
                <div className="space-y-3">
                  <CustomerSearchCombobox
                    customers={localCustomers}
                    selectedCustomerId={customerId}
                    onSelectCustomer={(c) => handleSelectExistingCustomer(c.id)}
                    onOpenCreateNewCustomer={() => setIsAddingCustomer(true)}
                    placeholder="Buscar cliente por nome, CPF, CNPJ ou telefone..."
                  />

                  {customerId && (
                    <div className="rounded-lg bg-white p-3 border border-slate-200 text-xs dark:bg-slate-800 dark:border-slate-700 flex flex-col gap-2.5">
                      {(() => {
                        const sel = localCustomers.find((c) => c.id === customerId)
                        if (!sel) return null
                        const hasMultiple = Array.isArray(sel.addresses) && sel.addresses.length > 0
                        return (
                          <>
                            <div className="flex items-start justify-between">
                              <div className="space-y-1">
                                <p className="font-bold text-slate-900 dark:text-white">
                                  {sel.name}
                                </p>
                                <p className="text-slate-600 dark:text-slate-300">
                                  📞 {sel.phone} {sel.phone2 ? `| 2: ${sel.phone2}` : ''}{' '}
                                  {sel.phone3 ? `| 3: ${sel.phone3}` : ''}
                                </p>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  populateCustomerForm(sel)
                                  setIsAddingCustomer(true)
                                }}
                                className="h-7 text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
                              >
                                <Edit3 className="h-3.5 w-3.5" /> Editar Dados
                              </Button>
                            </div>

                            {/* Seletor de Endereço quando cliente tiver múltiplos endereços cadastrados */}
                            {hasMultiple && (
                              <div className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-1.5">
                                <Label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                                  <MapPin className="h-3 w-3 text-blue-600" /> Escolha o Endereço
                                  para esta Entrega:
                                </Label>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                  {sel.addresses!.map((addr) => {
                                    const isSelected = selectedCustomerAddressId === addr.id
                                    return (
                                      <div
                                        key={addr.id}
                                        onClick={() => handleSelectCustomerAddress(addr)}
                                        className={`p-2 rounded-lg border text-[11px] cursor-pointer transition ${
                                          isSelected
                                            ? 'bg-blue-50 border-blue-500 text-blue-900 font-semibold dark:bg-blue-950/40 dark:text-blue-200'
                                            : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-400 dark:bg-slate-900/40 dark:border-slate-700 dark:text-slate-300'
                                        }`}
                                      >
                                        <div className="flex items-center justify-between gap-1">
                                          <span className="font-bold">{addr.label}</span>
                                          {addr.is_default && (
                                            <span className="text-[9px] text-emerald-600 font-normal">
                                              ★ Padrão
                                            </span>
                                          )}
                                        </div>
                                        <p className="line-clamp-2 text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                                          {addr.address || addr.street}
                                        </p>
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Detalhes do Endereço Ativo */}
                            <div className="pt-1 flex items-center justify-between gap-2 flex-wrap">
                              <p className="text-slate-600 dark:text-slate-300">
                                📍 {streetAndNumber || sel.address}
                              </p>
                              {selectedCoords.lat && selectedCoords.lng && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200 shrink-0"
                                >
                                  ✓ Coordenadas GPS Fixadas
                                </Badge>
                              )}
                            </div>
                          </>
                        )
                      })()}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Notice if editing existing matched customer */}
                  {existingMatchedCustomerId && (
                    <div className="flex items-center justify-between p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300">
                      <span className="flex items-center gap-1.5 font-medium">
                        <UserCheck className="h-4 w-4 text-emerald-600" />
                        Cliente identificado! Você pode editar nome, telefones e endereço
                        diretamente aqui.
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setExistingMatchedCustomerId(null)
                          setNewCustName('')
                          setNewCustPhone('')
                          setNewCustPhone2('')
                          setNewCustPhone3('')
                          setStreetAndNumber('')
                          setNeighborhood('')
                          setCity('')
                          setPostalCode('')
                          setComplement('')
                        }}
                        className="h-6 text-[11px] text-slate-500 hover:text-slate-700 px-2"
                      >
                        Limpar
                      </Button>
                    </div>
                  )}

                  {/* Name & Primary Phone */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                        Nome / Razão Social <span className="text-rose-500">*</span>
                      </Label>
                      <Input
                        placeholder="Ex: João da Silva / Padaria Imperial"
                        value={newCustName}
                        onChange={(e) => setNewCustName(e.target.value)}
                        className="mt-1 bg-white dark:bg-slate-800 text-xs"
                        required
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                          <Phone className="h-3 w-3 text-blue-600" /> Telefone Principal (WhatsApp){' '}
                          <span className="text-rose-500">*</span>
                        </Label>
                        {isSearchingPhone && (
                          <span className="text-[10px] text-blue-600 flex items-center gap-1">
                            <Loader2 className="h-2.5 w-2.5 animate-spin" /> buscando...
                          </span>
                        )}
                      </div>
                      <Input
                        placeholder="Ex: (11) 98765-4321"
                        value={newCustPhone}
                        onChange={handlePhoneInputChange}
                        className="mt-1 bg-white dark:bg-slate-800 text-xs"
                        required
                      />
                    </div>
                  </div>

                  {/* Additional Phones (Up to 3 phones support) */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowExtraPhones(!showExtraPhones)}
                        className="h-6 px-1.5 text-[11px] text-indigo-600 hover:text-indigo-700"
                      >
                        {showExtraPhones
                          ? '− Ocultar telefones secundários'
                          : '+ Adicionar telefone 2 e 3 (até 3 números)'}
                      </Button>
                    </div>

                    {showExtraPhones && (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 p-2.5 rounded-lg bg-white/70 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700">
                        <div>
                          <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                            Telefone 2 (Secundário / Fixo / Comercial)
                          </Label>
                          <Input
                            placeholder="Ex: (11) 3456-7890"
                            value={newCustPhone2}
                            onChange={(e) => setNewCustPhone2(e.target.value)}
                            className="mt-1 bg-white dark:bg-slate-900 text-xs"
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                            Telefone 3 (Recado / Outro)
                          </Label>
                          <Input
                            placeholder="Ex: (11) 91234-5678"
                            value={newCustPhone3}
                            onChange={(e) => setNewCustPhone3(e.target.value)}
                            className="mt-1 bg-white dark:bg-slate-900 text-xs"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 1. Google Places / ViaCEP Autocomplete Search Bar */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                        <Search className="h-3.5 w-3.5 text-blue-600" />
                        Buscar Endereço (Autocompletar Google Maps / CEP)
                      </Label>
                      <span className="text-[10px] text-slate-400">
                        Selecione uma opção na lista para preencher os dados
                      </span>
                    </div>
                    <BaseAddressAutocomplete
                      value={addressSearchQuery}
                      onChange={(val) => setAddressSearchQuery(val)}
                      onAddressSelect={handleAddressSelectFromAutocomplete}
                      placeholder="Digite o endereço ou CEP, ex: Rua Diogo Gulart ou Duque de Caxias..."
                      className="w-full"
                      inputClassName="bg-white dark:bg-slate-800 text-xs border-blue-200 focus-visible:ring-blue-500 text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                      biasCoordinates={hasLocationPinned ? selectedCoords : null}
                      showSearchButton={true}
                    />
                  </div>

                  {/* 2. Customer Location Link Importer (WhatsApp / Google Maps pin) + Botão 'Cliente envia localização' */}
                  <div className="rounded-lg border border-slate-200/80 bg-white/80 p-3 dark:border-slate-800 dark:bg-slate-800/80 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                        <Link2 className="h-3.5 w-3.5 text-indigo-600" />
                        Colar Link ou Localização enviada pelo Cliente
                      </Label>
                      <span className="text-[10px] text-slate-400 flex items-center gap-1">
                        <HelpCircle className="h-3 w-3" /> Pin de WhatsApp / Maps
                      </span>
                    </div>

                    <div className="flex gap-2">
                      <Input
                        placeholder="Cole link do Google Maps, WhatsApp ou coordenadas (-22.90, -43.17)..."
                        value={locationLinkInput}
                        onChange={(e) => setLocationLinkInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            handleApplyLocationLink()
                          }
                        }}
                        className="bg-slate-50 dark:bg-slate-900 text-xs flex-1"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={handleApplyLocationLink}
                        disabled={isParsingLink || !locationLinkInput.trim()}
                        className="text-xs font-semibold gap-1 whitespace-nowrap bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:text-indigo-300"
                      >
                        {isParsingLink ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Crosshair className="h-3.5 w-3.5" />
                        )}
                        Carregar Ponto
                      </Button>
                    </div>

                    {/* ITEM 13: Botão 'Cliente envia localização' (WhatsApp Link) */}
                    <div className="pt-1 border-t border-slate-200/70 dark:border-slate-700/60 flex items-center justify-between">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        Rua sem número ou sem CEP? O cliente marca no mapa:
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const targetId = existingMatchedCustomerId || customerId
                          if (!targetId) {
                            toast.warning(
                              'Selecione ou identifique o cliente pelo telefone primeiro para gerar o link do WhatsApp.',
                            )
                            return
                          }
                          const cleanPhoneDigits = (newCustPhone || '').replace(/\D/g, '')
                          const pinUrl = `${window.location.origin}/pin/${targetId}`
                          const msgText = encodeURIComponent(
                            `Olá ${newCustName || 'cliente'}! Para garantir a entrega exata do seu pedido, por favor abra o link abaixo e confirme a localização do seu imóvel no mapa (basta arrastar o pino até o seu portão e clicar em Confirmar):\n\n${pinUrl}`,
                          )
                          const waUrl =
                            cleanPhoneDigits.length >= 8
                              ? `https://wa.me/55${cleanPhoneDigits}?text=${msgText}`
                              : `https://wa.me/?text=${msgText}`
                          window.open(waUrl, '_blank')
                          toast.success(
                            'WhatsApp aberto com link interativo de mapa para o cliente!',
                          )
                        }}
                        className="h-7 text-xs bg-emerald-500/10 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 gap-1.5 font-medium"
                      >
                        <MessageSquare className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                        Cliente envia localização
                      </Button>
                    </div>
                  </div>

                  {/* 3. Separate Address Fields (Rua, Número, Bairro, Cidade, UF, CEP) */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 pt-1">
                    {/* Rua e Número */}
                    <div className="sm:col-span-8">
                      <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                        Rua e Número <span className="text-rose-500">*</span>
                      </Label>
                      <Input
                        placeholder="Ex: Rua Manuel Vieira, 196"
                        value={streetAndNumber}
                        onChange={(e) =>
                          handleAddressFieldChange(
                            setStreetAndNumber,
                            'streetAndNumber',
                            e.target.value,
                          )
                        }
                        onBlur={() => triggerAddressGeocoding()}
                        className="mt-1 bg-white dark:bg-slate-800 text-xs"
                        required
                      />
                    </div>

                    {/* Complemento */}
                    <div className="sm:col-span-4">
                      <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                        Complemento / Apto / Bloco
                      </Label>
                      <Input
                        placeholder="Ex: Apto 42, Bloco B"
                        value={complement}
                        onChange={(e) => setComplement(e.target.value)}
                        className="mt-1 bg-white dark:bg-slate-800 text-xs"
                      />
                    </div>

                    {/* Bairro */}
                    <div className="sm:col-span-4">
                      <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                        Bairro
                      </Label>
                      <Input
                        placeholder="Ex: Pinheiros"
                        value={neighborhood}
                        onChange={(e) =>
                          handleAddressFieldChange(setNeighborhood, 'neighborhood', e.target.value)
                        }
                        className="mt-1 bg-white dark:bg-slate-800 text-xs"
                      />
                    </div>

                    {/* Cidade */}
                    <div className="sm:col-span-4">
                      <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                        Cidade
                      </Label>
                      <Input
                        placeholder="Ex: Rio de Janeiro"
                        value={city}
                        onChange={(e) => handleAddressFieldChange(setCity, 'city', e.target.value)}
                        className="mt-1 bg-white dark:bg-slate-800 text-xs"
                      />
                    </div>

                    {/* UF */}
                    <div className="sm:col-span-2">
                      <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                        UF (Estado)
                      </Label>
                      <Select
                        value={ufState}
                        onValueChange={(val) =>
                          handleAddressFieldChange(setUfState, 'ufState', val)
                        }
                      >
                        <SelectTrigger className="mt-1 bg-white dark:bg-slate-800 text-xs h-9">
                          <SelectValue placeholder="UF" />
                        </SelectTrigger>
                        <SelectContent className="max-h-52">
                          {BRAZILIAN_STATES.map((st) => (
                            <SelectItem key={st} value={st} className="text-xs">
                              {st}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* CEP */}
                    <div className="sm:col-span-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                          CEP{' '}
                          <span className="text-[10px] text-slate-400 font-normal">(Opcional)</span>
                        </Label>
                        {isLoadingViaCep && (
                          <Loader2 className="h-3 w-3 animate-spin text-blue-600" />
                        )}
                      </div>
                      <Input
                        placeholder="00000-000"
                        value={postalCode}
                        onChange={handleCepChange}
                        maxLength={9}
                        className="mt-1 bg-white dark:bg-slate-800 text-xs font-mono"
                      />
                    </div>

                    {/* ITEM 10: Aviso de CEP opcional */}
                    {!postalCode && (
                      <div className="sm:col-span-12 px-2.5 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-[11px] text-blue-800 dark:text-blue-300 flex items-center justify-between">
                        <span>
                          💡 <strong>Área sem CEP? Use o pin no mapa</strong> — o CEP é opcional
                          (comunidades, loteamentos ou zonas rurais).
                        </span>
                        <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                          Pin soberano ativo
                        </span>
                      </div>
                    )}

                    {/* ITEM 11: Campo 'Ponto de referência' */}
                    <div className="sm:col-span-12">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                          Ponto de Referência
                          {(!streetAndNumber.trim() ||
                            /\b(s\/n|sn|sem\s+n[uú]mero|lote|quadra|qd|lt|comunidade)\b/i.test(
                              streetAndNumber,
                            ) ||
                            !/\d+/.test(streetAndNumber)) && (
                            <span className="text-rose-500 font-bold text-[11px]">
                              * Obrigatório (lote/quadra/comunidade/sem número)
                            </span>
                          )}
                        </Label>
                        <span className="text-[10px] text-slate-400">
                          Exibido em destaque na rota do entregador
                        </span>
                      </div>
                      <Input
                        placeholder="Ex: Em frente ao Mercadinho do Zé, portão cinza, fundos do lote 14"
                        value={referencePoint}
                        onChange={(e) => setReferencePoint(e.target.value)}
                        className="mt-1 bg-white dark:bg-slate-800 text-xs"
                      />
                    </div>
                  </div>

                  {/* Helper badge explaining auto-fill status */}
                  {(streetAndNumber || neighborhood || city || postalCode) && (
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500 bg-slate-100 dark:bg-slate-800/60 p-2 rounded-lg border border-slate-200 dark:border-slate-700">
                      <Sparkles className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                      <span>
                        Endereço formatado: <strong>{getFullFormattedAddress()}</strong>
                      </span>
                    </div>
                  )}

                  {/* 4. Interactive Location Picker Map */}
                  <div className="space-y-1.5 pt-2">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <Navigation className="h-3.5 w-3.5 text-blue-600" />
                        <Label className="text-xs font-bold text-slate-800 dark:text-slate-200">
                          Ponto Exato de Entrega (Arraste o Marcador 📍 no Mapa)
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={handleUseCurrentLocation}
                          className="h-6 px-2 text-[11px] text-blue-600 hover:text-blue-700 flex items-center gap-1"
                        >
                          <Crosshair className="h-3 w-3" /> Minha Posição Atual
                        </Button>
                        {hasLocationPinned && (
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] font-mono text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-200 flex items-center gap-0.5">
                              <Check className="h-3 w-3" /> {selectedCoords.lat.toFixed(4)},{' '}
                              {selectedCoords.lng.toFixed(4)}
                            </span>
                            {plusCode && (
                              <span className="text-[10px] font-mono text-blue-600 bg-blue-50 dark:bg-blue-950/40 px-1.5 py-0.5 rounded border border-blue-200">
                                Plus Code: {plusCode}
                              </span>
                            )}
                          </div>
                        )}{' '}
                      </div>
                    </div>

                    {/* Google Map Canvas Container */}
                    <div className="relative w-full h-48 sm:h-56 rounded-xl overflow-hidden border border-slate-300 dark:border-slate-700 shadow-inner bg-slate-100 dark:bg-slate-900">
                      <div ref={mapContainerRef} className="w-full h-full" />

                      {/* Fallback info when maps is still loading or offline */}
                      {!isMapsLoaded && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 text-white p-4 text-center">
                          <MapPin className="h-8 w-8 text-blue-400 animate-bounce mb-2" />
                          <p className="text-xs font-semibold">Carregando Mapa de Localização...</p>
                          <p className="text-[11px] text-slate-400 mt-1">
                            Você pode preencher o CEP ou endereço acima enquanto o mapa conecta.
                          </p>
                        </div>
                      )}

                      {/* Instructions Banner Overlay */}
                      <div className="absolute bottom-2 left-2 right-2 pointer-events-none flex justify-center">
                        <div className="bg-slate-900/80 backdrop-blur-sm text-white px-3 py-1 rounded-full text-[10px] font-medium shadow flex items-center gap-1.5 border border-slate-700">
                          <MapPin className="h-3 w-3 text-red-400" />
                          <span>
                            Clique no mapa ou arraste o marcador vermelho para o ponto exato da
                            entrega
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Ajuste manual direto de Coordenadas Lat/Lng (Doutrina do Pino Soberano) */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-slate-200 dark:border-slate-800">
                      <div>
                        <Label className="text-[10px] text-slate-500 font-mono">
                          Latitude Manual
                        </Label>
                        <Input
                          placeholder="-22.906847"
                          value={
                            selectedCoords.lat !== undefined && !isNaN(selectedCoords.lat)
                              ? String(selectedCoords.lat)
                              : ''
                          }
                          onChange={(e) => {
                            const parsed = parseFloat(e.target.value)
                            const cleanManual = MapDataService.cleanCoords(
                              parsed,
                              selectedCoords.lng,
                            )
                            if (cleanManual) {
                              setSelectedCoords((prev) => ({ ...prev, lat: cleanManual.lat }))
                              setHasLocationPinned(true)
                              setIsPinManuallyAdjusted(true)
                              isSelectedFromAutocompleteRef.current = true
                              const google = getGoogle()
                              if (mapInstanceRef.current && google?.maps) {
                                try {
                                  const pos = new google.maps.LatLng(
                                    cleanManual.lat,
                                    cleanManual.lng,
                                  )
                                  mapInstanceRef.current.setCenter(pos)
                                  if (markerInstanceRef.current)
                                    markerInstanceRef.current.setPosition(pos)
                                } catch (err) {
                                  console.warn('Erro ao atualizar posição manual lat:', err)
                                }
                              }
                            }
                          }}
                          className="mt-0.5 h-7 text-xs font-mono bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                        />
                      </div>
                      <div>
                        <Label className="text-[10px] text-slate-500 font-mono">
                          Longitude Manual
                        </Label>
                        <Input
                          placeholder="-43.172896"
                          value={
                            selectedCoords.lng !== undefined && !isNaN(selectedCoords.lng)
                              ? String(selectedCoords.lng)
                              : ''
                          }
                          onChange={(e) => {
                            const parsed = parseFloat(e.target.value)
                            const cleanManual = MapDataService.cleanCoords(
                              selectedCoords.lat,
                              parsed,
                            )
                            if (cleanManual) {
                              setSelectedCoords((prev) => ({ ...prev, lng: cleanManual.lng }))
                              setHasLocationPinned(true)
                              setIsPinManuallyAdjusted(true)
                              isSelectedFromAutocompleteRef.current = true
                              const google = getGoogle()
                              if (mapInstanceRef.current && google?.maps) {
                                try {
                                  const pos = new google.maps.LatLng(
                                    cleanManual.lat,
                                    cleanManual.lng,
                                  )
                                  mapInstanceRef.current.setCenter(pos)
                                  if (markerInstanceRef.current)
                                    markerInstanceRef.current.setPosition(pos)
                                } catch (err) {
                                  console.warn('Erro ao atualizar posição manual lng:', err)
                                }
                              }
                            }
                          }}
                          className="mt-0.5 h-7 text-xs font-mono bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                        />
                      </div>
                    </div>

                    {hasLocationPinned &&
                      typeof selectedCoords.lat === 'number' &&
                      typeof selectedCoords.lng === 'number' && (
                        <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 pt-0.5">
                          <span className="font-mono">
                            Fixado em: {selectedCoords.lat.toFixed(6)},{' '}
                            {selectedCoords.lng.toFixed(6)}
                          </span>
                          {isPinManuallyAdjusted ? (
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                              ✓ Pino calibrado manualmente (travado)
                            </span>
                          ) : (
                            <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1">
                              <Check className="h-3 w-3 text-emerald-500" />
                              Geocodificado via Google Maps (travado)
                            </span>
                          )}
                        </div>
                      )}
                  </div>
                </div>
              )}
            </div>

            {/* MÓDULO 3: SUGESTÃO AUTOMÁTICA DE ROTA AO REGISTRAR NOVA ENTREGA */}
            {routeSuggestion && (
              <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50/70 p-3.5 dark:border-indigo-900/60 dark:bg-indigo-950/40 text-xs space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-indigo-950 dark:text-indigo-200 uppercase tracking-wide flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                    SUGESTÃO DO SISTEMA:
                  </span>
                  {suggestionState === 'accepted' ? (
                    <Badge className="bg-emerald-600 text-white text-[10px]">
                      ✓ Sugestão Aceita
                    </Badge>
                  ) : suggestionState === 'rejected' ? (
                    <Badge variant="destructive" className="text-[10px]">
                      Rejeitada (Manual)
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="text-indigo-700 border-indigo-300 text-[10px]"
                    >
                      Otimização Ativa
                    </Badge>
                  )}
                </div>

                {/* Texto exato solicitado pelo Módulo 3 */}
                <div className="bg-white dark:bg-slate-900/90 rounded-lg p-3 border border-indigo-100 dark:border-indigo-900 font-mono text-slate-800 dark:text-slate-200 space-y-1">
                  <p>
                    → Enviar para:{' '}
                    <b className="text-indigo-600 dark:text-indigo-400">
                      {routeSuggestion.courier_name}
                    </b>{' '}
                    (
                    {routeSuggestion.vehicle_type === 'motorcycle'
                      ? 'Moto'
                      : routeSuggestion.vehicle_type === 'car'
                        ? 'Carro'
                        : routeSuggestion.vehicle_type === 'van'
                          ? 'Van'
                          : 'Caminhão'}
                    )
                  </p>
                  <p>
                    → Ordem na rota: <b>{routeSuggestion.order_in_route}ª entrega</b>
                  </p>
                  <p>
                    → Tempo estimado: <b>{routeSuggestion.estimated_time}</b>
                  </p>
                  <p>
                    → Economia:{' '}
                    <b className="text-emerald-600 dark:text-emerald-400">
                      {routeSuggestion.km_saved}km
                    </b>{' '}
                    vs rota manual
                  </p>
                </div>

                {/* Botões de Ação Exatos: [ACEITAR] [REJEITAR] [EDITAR] */}
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    type="button"
                    size="sm"
                    className={`h-7 px-3 text-xs font-bold ${
                      suggestionState === 'accepted'
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white ring-2 ring-emerald-400'
                        : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                    }`}
                    onClick={() => {
                      setCourierId(routeSuggestion.courier_id)
                      setSuggestionState('accepted')
                      toast.success(
                        `Sugestão aceita! Pedido atribuído a ${routeSuggestion.courier_name} como ${routeSuggestion.order_in_route}ª entrega.`,
                      )
                    }}
                  >
                    ACEITAR
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className={`h-7 px-3 text-xs ${
                      suggestionState === 'rejected'
                        ? 'border-rose-400 text-rose-600 bg-rose-50'
                        : 'border-slate-300 hover:bg-slate-100 dark:border-slate-700'
                    }`}
                    onClick={() => {
                      setSuggestionState('rejected')
                      toast.info(
                        'Sugestão rejeitada. Você pode selecionar o entregador manualmente.',
                      )
                    }}
                  >
                    REJEITAR
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2.5 text-xs text-indigo-700 hover:bg-indigo-100 dark:text-indigo-300"
                    onClick={() => {
                      setSuggestionState('edited')
                      toast.info('Modo de edição manual liberado no seletor abaixo.')
                    }}
                  >
                    EDITAR
                  </Button>
                </div>
              </div>
            )}

            {/* Logistics: Courier Assignment & Priority */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Atribuir Entregador
                  </Label>
                  {isCalculatingSuggestion && (
                    <span className="text-[10px] text-indigo-600 flex items-center gap-1">
                      <Loader2 className="h-2.5 w-2.5 animate-spin" /> analisando rotas...
                    </span>
                  )}
                </div>
                <Select
                  value={courierId}
                  onValueChange={(val) => {
                    setCourierId(val)
                    if (routeSuggestion && val !== routeSuggestion.courier_id) {
                      setSuggestionState('edited')
                    }
                  }}
                >
                  <SelectTrigger className="mt-1 bg-white dark:bg-slate-800 text-xs">
                    <SelectValue placeholder="Selecione um entregador" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned" className="text-xs">
                      Sem entregador (Pendente)
                    </SelectItem>
                    {couriers.map((c) => (
                      <SelectItem key={c.id} value={c.id} className="text-xs">
                        🛵 {c.name} ({c.status === 'busy' ? 'Ocupado' : 'Disponível'})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  Prioridade de Entrega
                </Label>
                <Select
                  value={priority}
                  onValueChange={(val) => {
                    setPriority(val as OrderPriority)
                    if (hasLocationPinned) {
                      calculateSmartRouteSuggestion(selectedCoords.lat, selectedCoords.lng)
                    }
                  }}
                >
                  <SelectTrigger className="mt-1 bg-white dark:bg-slate-800 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal" className="text-xs">
                      🟢 Normal (Até 90 min)
                    </SelectItem>
                    <SelectItem value="high" className="text-xs">
                      🟡 Alta (Até 60 min)
                    </SelectItem>
                    <SelectItem value="urgent" className="text-xs">
                      🔴 Urgente (Até 30 min)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Items Table */}
            <div className="space-y-2 rounded-xl border border-slate-200 p-3.5 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/30">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  Itens do Pedido
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddItem}
                  className="h-7 text-xs flex items-center gap-1 bg-white dark:bg-slate-800"
                >
                  <Plus className="h-3.5 w-3.5" /> Adicionar Item
                </Button>
              </div>

              <div className="space-y-2">
                {items.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input
                      placeholder="Descrição do produto / mercadoria"
                      value={item.name}
                      onChange={(e) => handleItemChange(idx, 'name', e.target.value)}
                      className="flex-1 text-xs bg-white dark:bg-slate-800"
                    />
                    <Input
                      type="number"
                      min="1"
                      placeholder="Qtd"
                      value={item.qty || ''}
                      onChange={(e) =>
                        handleItemChange(idx, 'qty', parseInt(e.target.value, 10) || 1)
                      }
                      className="w-16 text-xs text-center bg-white dark:bg-slate-800"
                    />
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="R$ Unit"
                      value={item.price || ''}
                      onChange={(e) =>
                        handleItemChange(idx, 'price', parseFloat(e.target.value) || 0)
                      }
                      className="w-24 text-xs text-right bg-white dark:bg-slate-800"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveItem(idx)}
                      disabled={items.length === 1}
                      className="h-8 w-8 text-slate-400 hover:text-rose-500"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="flex justify-end pt-2 border-t text-sm font-bold text-slate-900 dark:text-white">
                Total Calculado: R$ {totalPrice.toFixed(2)}
              </div>
            </div>

            {/* Notes */}
            <div>
              <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Observações / Instruções de Entrega
              </Label>
              <Textarea
                placeholder="Ex: Entregar na recepção, portaria libera sem interfone, etc..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-1 text-xs resize-none bg-white dark:bg-slate-800"
                rows={2}
              />
            </div>

            {/* AVISO PREVENTIVO: CLIENTE COM PEDIDO ATIVO NAS ÚLTIMAS 24H (DIRETRIZ: AVISAR, NUNCA BLOQUEAR) */}
            {recentCustomerOrders.length > 0 && !ignoredRecentOrderWarning && (
              <div className="rounded-xl border border-amber-300 dark:border-amber-700/60 bg-amber-50/90 dark:bg-amber-950/30 p-3.5 shadow-sm space-y-2">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div className="space-y-1 flex-1">
                    <h4 className="text-xs font-bold text-amber-900 dark:text-amber-200">
                      Aviso: Cliente com Pedido Recente (Possível Venda Dupla)
                    </h4>
                    <p className="text-xs text-amber-800 dark:text-amber-300/90 leading-relaxed">
                      Este cliente já possui o pedido{' '}
                      <strong className="font-mono text-amber-950 dark:text-amber-100 font-bold">
                        {recentCustomerOrders.map((o) => o.tracking_code || o.id).join(', ')}
                      </strong>{' '}
                      pendente/registrado hoje ({recentCustomerOrders.length}{' '}
                      {recentCustomerOrders.length === 1 ? 'pedido ativo' : 'pedidos ativos'} nas
                      últimas 24h).
                    </p>
                    <p className="text-[11px] text-amber-700 dark:text-amber-400">
                      Deseja lançar assim mesmo? Você pode confirmar normalmente.
                    </p>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1 border-t border-amber-200 dark:border-amber-800/40">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIgnoredRecentOrderWarning(true)}
                    className="h-7 text-xs bg-white dark:bg-slate-900 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 hover:bg-amber-100"
                  >
                    Ciente, prosseguir com nova entrega
                  </Button>
                </div>
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-0 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="bg-blue-600 hover:bg-blue-700 text-white font-semibold"
              >
                {isSubmitting ? 'Registrando...' : 'Emitir Pedido'}
              </Button>
            </DialogFooter>
          </form>
        </FormErrorBoundary>
      </DialogContent>
    </Dialog>
  )
}

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
} from 'lucide-react'
import { deliveryService } from '@/services/deliveryService'
import type { CustomerRecord, UserRecord, OrderPriority, OrderItem } from '@/types/delivery'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'

interface CreateOrderModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  customers: CustomerRecord[]
  couriers: UserRecord[]
  onOrderCreated: () => void
}

// Brazilian States list
const BRAZILIAN_STATES = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
]

// Fallback Default Center (São Paulo / Brazil center)
const DEFAULT_CENTER = { lat: -23.55052, lng: -46.633308 }

export const CreateOrderModal: React.FC<CreateOrderModalProps> = ({
  open,
  onOpenChange,
  customers,
  couriers,
  onOrderCreated,
}) => {
  const { user } = useAuth()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [customerId, setCustomerId] = useState<string>('')
  const [courierId, setCourierId] = useState<string>('unassigned')
  const [priority, setPriority] = useState<OrderPriority>('normal')
  const [notes, setNotes] = useState<string>('')
  const [items, setItems] = useState<OrderItem[]>([{ name: '', qty: 1, price: 0 }])

  // New Customer inline state
  const [isAddingCustomer, setIsAddingCustomer] = useState(true)
  const [newCustName, setNewCustName] = useState('')
  const [newCustPhone, setNewCustPhone] = useState('')

  // Search input controlled state
  const [addressSearchQuery, setAddressSearchQuery] = useState('')
  const [isSearchingAddress, setIsSearchingAddress] = useState(false)

  // Split Address Fields
  const [streetAndNumber, setStreetAndNumber] = useState('')
  const [neighborhood, setNeighborhood] = useState('')
  const [city, setCity] = useState('')
  const [ufState, setUfState] = useState('SP')
  const [postalCode, setPostalCode] = useState('')
  const [complement, setComplement] = useState('')

  // Coordinates
  const [selectedCoords, setSelectedCoords] = useState<{ lat: number; lng: number }>(DEFAULT_CENTER)
  const [hasLocationPinned, setHasLocationPinned] = useState(false)

  // Link parsing input state
  const [locationLinkInput, setLocationLinkInput] = useState('')
  const [isParsingLink, setIsParsingLink] = useState(false)

  // Map & Autocomplete refs
  const autocompleteInputRef = useRef<HTMLInputElement>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerInstanceRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const autocompleteInstanceRef = useRef<any>(null)
  const isReverseGeocodingRef = useRef<boolean>(false)

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
  const [isMapsLoaded, setIsMapsLoaded] = useState(false)

  // Helper to check window.google safely
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getGoogle = (): any => {
    return typeof window !== 'undefined'
      ? (window as unknown as { google?: unknown }).google
      : undefined
  }

  // Load Google Maps script if not loaded
  useEffect(() => {
    if (!open) return

    const google = getGoogle()
    if (google?.maps?.places) {
      setIsMapsLoaded(true)
      return
    }

    if (!document.getElementById('google-maps-script')) {
      const script = document.createElement('script')
      script.id = 'google-maps-script'
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry`
      script.async = true
      script.defer = true
      script.onload = () => {
        setIsMapsLoaded(true)
      }
      script.onerror = () => {
        console.warn('Google Maps script failed to load. Interactive fallback will be used.')
      }
      document.head.appendChild(script)
    } else {
      // Check periodically if script is ready
      const checkInterval = setInterval(() => {
        const g = getGoogle()
        if (g?.maps?.places) {
          setIsMapsLoaded(true)
          clearInterval(checkInterval)
        }
      }, 300)
      return () => clearInterval(checkInterval)
    }
  }, [open, apiKey])

  // Parse Google Maps / Waze / WhatsApp coordinates link
  const parseCoordinatesFromText = (text: string): { lat: number; lng: number } | null => {
    const raw = text.trim()
    if (!raw) return null

    // Pattern 1: "@-23.55052,-46.633308" or "!3d-23.55052!4d-46.633308" (Google Maps URL)
    const atMatch = raw.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/)
    if (atMatch) {
      const lat = parseFloat(atMatch[1])
      const lng = parseFloat(atMatch[2])
      if (!isNaN(lat) && !isNaN(lng)) return { lat, lng }
    }

    const data3dMatch = raw.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/)
    if (data3dMatch) {
      const lat = parseFloat(data3dMatch[1])
      const lng = parseFloat(data3dMatch[2])
      if (!isNaN(lat) && !isNaN(lng)) return { lat, lng }
    }

    // Pattern 2: q=-23.55052,-46.633308 or ll=-23.55052,-46.633308 or query=-23.55052,-46.633308
    const queryMatch = raw.match(
      /(?:q|ll|query|destination|loc)=([+-]?\d+\.\d+)[,%20]+([+-]?\d+\.\d+)/i,
    )
    if (queryMatch) {
      const lat = parseFloat(queryMatch[1])
      const lng = parseFloat(queryMatch[2])
      if (!isNaN(lat) && !isNaN(lng)) return { lat, lng }
    }

    // Pattern 3: Bare lat, lng pair (e.g. "-23.55052, -46.633308" or "-23.55052 -46.633308")
    const bareMatch = raw.match(/^([+-]?\d{1,2}\.\d+)[,\s]+([+-]?\d{1,3}\.\d+)$/)
    if (bareMatch) {
      const lat = parseFloat(bareMatch[1])
      const lng = parseFloat(bareMatch[2])
      if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return { lat, lng }
      }
    }

    // Pattern 4: WhatsApp location link (https://maps.google.com/?q=-23.55052,-46.633308)
    const waMatch = raw.match(/q=(-?\d+\.\d+),(-?\d+\.\d+)/)
    if (waMatch) {
      const lat = parseFloat(waMatch[1])
      const lng = parseFloat(waMatch[2])
      if (!isNaN(lat) && !isNaN(lng)) return { lat, lng }
    }

    return null
  }

  // Helper to safely populate address fields from Google Place or Geocode results
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const populateAddressFromComponents = (components: any[], fallbackFormatted?: string) => {
    let streetName = ''
    let streetNumber = ''
    let neighborhoodName = ''
    let cityName = ''
    let stateCode = ''
    let postal = ''

    if (Array.isArray(components)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      components.forEach((comp: any) => {
        const types: string[] = comp.types || []
        if (types.includes('route')) streetName = comp.long_name
        if (types.includes('street_number')) streetNumber = comp.long_name
        if (
          types.includes('sublocality') ||
          types.includes('sublocality_level_1') ||
          types.includes('neighborhood')
        ) {
          neighborhoodName = comp.long_name
        }
        if (types.includes('administrative_area_level_2') || types.includes('locality')) {
          cityName = comp.long_name
        }
        if (types.includes('administrative_area_level_1')) {
          stateCode = comp.short_name
        }
        if (types.includes('postal_code')) {
          postal = comp.long_name
        }
      })
    }

    if (streetName) {
      setStreetAndNumber(streetNumber ? `${streetName}, ${streetNumber}` : streetName)
    } else if (fallbackFormatted) {
      // If no discrete route found, use first part of formatted address
      const firstSegment = fallbackFormatted.split(',')[0] || fallbackFormatted
      setStreetAndNumber(firstSegment)
    }

    if (neighborhoodName) setNeighborhood(neighborhoodName)
    if (cityName) setCity(cityName)
    if (stateCode && BRAZILIAN_STATES.includes(stateCode.toUpperCase())) {
      setUfState(stateCode.toUpperCase())
    }
    if (postal) setPostalCode(postal)
  }

  // Reverse geocode to fill separate address fields
  const reverseGeocode = useCallback((lat: number, lng: number) => {
    const google = getGoogle()
    if (!google?.maps?.Geocoder) return
    if (isReverseGeocodingRef.current) return

    isReverseGeocodingRef.current = true
    try {
      const geocoder = new google.maps.Geocoder()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      geocoder.geocode({ location: { lat, lng } }, (results: any[], status: string) => {
        isReverseGeocodingRef.current = false
        if (status === 'OK' && results?.[0]) {
          populateAddressFromComponents(results[0].address_components, results[0].formatted_address)
        }
      })
    } catch (err) {
      isReverseGeocodingRef.current = false
      console.warn('Geocoding error:', err)
    }
  }, [])

  // Update map marker and center safely without infinite loops
  const updateMapPosition = useCallback(
    (lat: number, lng: number, zoomLevel = 16, shouldReverseGeocode = false) => {
      setSelectedCoords({ lat, lng })
      setHasLocationPinned(true)

      const google = getGoogle()
      if (mapInstanceRef.current && google?.maps) {
        const pos = new google.maps.LatLng(lat, lng)
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
            const newLat = evt.latLng.lat()
            const newLng = evt.latLng.lng()
            setSelectedCoords({ lat: newLat, lng: newLng })
            setHasLocationPinned(true)
            reverseGeocode(newLat, newLng)
          })
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
          const newLat = evt.latLng.lat()
          const newLng = evt.latLng.lng()
          setSelectedCoords({ lat: newLat, lng: newLng })
          setHasLocationPinned(true)
          reverseGeocode(newLat, newLng)
        })

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.addListener('click', (evt: any) => {
          if (!evt?.latLng) return
          const clickLat = evt.latLng.lat()
          const clickLng = evt.latLng.lng()
          updateMapPosition(clickLat, clickLng, map.getZoom() || 16, true)
        })
      }
    } catch (err) {
      console.error('Error initializing Google Map in modal:', err)
    }
  }, [hasLocationPinned, reverseGeocode, selectedCoords, updateMapPosition])

  // Initialize Places Autocomplete
  const initAutocomplete = useCallback(() => {
    const google = getGoogle()
    if (!autocompleteInputRef.current || !google?.maps?.places) return

    try {
      if (autocompleteInstanceRef.current) return

      const autocomplete = new google.maps.places.Autocomplete(autocompleteInputRef.current, {
        componentRestrictions: { country: 'br' },
        fields: ['address_components', 'geometry', 'formatted_address', 'name'],
      })

      autocompleteInstanceRef.current = autocomplete

      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace()
        if (!place || !place.geometry || !place.geometry.location) {
          return
        }

        const lat = place.geometry.location.lat()
        const lng = place.geometry.location.lng()

        populateAddressFromComponents(
          place.address_components || [],
          place.formatted_address || place.name || '',
        )

        // Set input display value
        if (autocompleteInputRef.current) {
          const val = place.formatted_address || place.name || ''
          setAddressSearchQuery(val)
        }

        updateMapPosition(lat, lng, 16, false)
        toast.success('Endereço preenchido com sucesso!')
      })
    } catch (err) {
      console.error('Error attaching Places Autocomplete:', err)
    }
  }, [updateMapPosition])

  // Manual fallback geocode when user presses Enter or clicks search button
  const handleManualAddressSearch = () => {
    const query = addressSearchQuery.trim() || autocompleteInputRef.current?.value.trim()
    if (!query) {
      toast.info('Digite um endereço para buscar.')
      return
    }

    setIsSearchingAddress(true)
    const google = getGoogle()
    if (google?.maps?.Geocoder) {
      const geocoder = new google.maps.Geocoder()
      geocoder.geocode(
        { address: query, componentRestrictions: { country: 'br' } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (results: any[], status: string) => {
          setIsSearchingAddress(false)
          if (status === 'OK' && results?.[0]?.geometry?.location) {
            const loc = results[0].geometry.location
            const lat = loc.lat()
            const lng = loc.lng()
            populateAddressFromComponents(
              results[0].address_components || [],
              results[0].formatted_address || query,
            )
            updateMapPosition(lat, lng, 16, false)
            toast.success('Endereço localizado com sucesso!')
          } else {
            toast.error(
              'Não foi possível localizar este endereço com precisão. Você pode preencher os campos abaixo manualmente ou arrastar o pino no mapa.',
            )
          }
        },
      )
    } else {
      setIsSearchingAddress(false)
      // Basic fallback without geocoder: parse street and number
      setStreetAndNumber(query)
      toast.info('Texto transferido para o campo de Logradouro.')
    }
  }

  // Cleanup references on modal close
  useEffect(() => {
    if (!open) {
      mapInstanceRef.current = null
      markerInstanceRef.current = null
      autocompleteInstanceRef.current = null
    }
  }, [open])

  // Initialize Map and Autocomplete when modal opens and maps API is ready
  useEffect(() => {
    if (open && isMapsLoaded && isAddingCustomer) {
      const timer = setTimeout(() => {
        initMap()
        initAutocomplete()
      }, 150)
      return () => clearTimeout(timer)
    }
  }, [open, isMapsLoaded, isAddingCustomer, initMap, initAutocomplete])

  // When selecting existing customer
  const handleSelectExistingCustomer = (id: string) => {
    setCustomerId(id)
    const cust = customers.find((c) => c.id === id)
    if (cust && cust.lat && cust.lng) {
      setSelectedCoords({ lat: cust.lat, lng: cust.lng })
      setHasLocationPinned(true)
    }
  }

  // Handle parsing coordinates link or WhatsApp text
  const handleApplyLocationLink = () => {
    if (!locationLinkInput.trim()) return

    setIsParsingLink(true)
    try {
      const coords = parseCoordinatesFromText(locationLinkInput)
      if (coords) {
        updateMapPosition(coords.lat, coords.lng, 17, true)
        toast.success(
          `Localização identificada (${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)})`,
        )
        setLocationLinkInput('')
      } else {
        // Try fallback: Geocode address string if it was text
        const google = getGoogle()
        if (google?.maps?.Geocoder) {
          const geocoder = new google.maps.Geocoder()
          geocoder.geocode(
            { address: locationLinkInput, componentRestrictions: { country: 'br' } },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (results: any[], status: string) => {
              if (status === 'OK' && results?.[0]?.geometry?.location) {
                const loc = results[0].geometry.location
                populateAddressFromComponents(
                  results[0].address_components || [],
                  results[0].formatted_address || locationLinkInput,
                )
                updateMapPosition(loc.lat(), loc.lng(), 16, false)
                toast.success('Localização encontrada pelo texto do link/endereço!')
                setLocationLinkInput('')
              } else {
                toast.error(
                  'Não foi possível extrair coordenadas deste link. Cole o link do Google Maps ou coordenadas lat,lng.',
                )
              }
            },
          )
        } else {
          toast.error(
            'Formato não reconhecido. Cole um link do Google Maps (ex: https://maps.app.goo.gl/...) ou coordenadas.',
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

  // Construct formatted combined address string
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    let finalCustomerId = customerId

    // If creating a new inline customer
    if (isAddingCustomer) {
      if (!newCustName.trim()) {
        toast.error('Preencha o nome do cliente.')
        return
      }

      const combinedAddress = getFullFormattedAddress()
      if (!streetAndNumber.trim() && !combinedAddress.trim()) {
        toast.error('Preencha ao menos o logradouro e número ou busque pelo endereço.')
        return
      }

      try {
        const customerData: Partial<CustomerRecord> = {
          name: newCustName.trim(),
          phone: newCustPhone.trim() || '(11) 90000-0000',
          address: combinedAddress || streetAndNumber.trim(),
          street: streetAndNumber.trim(),
          neighborhood: neighborhood.trim(),
          city: city.trim(),
          state: ufState.trim(),
          postal_code: postalCode.trim(),
          complement: complement.trim(),
          lat: selectedCoords.lat,
          lng: selectedCoords.lng,
        }

        const createdCustomer = await deliveryService.createCustomer(customerData)
        finalCustomerId = createdCustomer.id
      } catch (err) {
        console.error('Error creating customer:', err)
        toast.error('Erro ao cadastrar novo cliente.')
        return
      }
    }

    if (!finalCustomerId) {
      toast.error('Selecione ou cadastre um cliente.')
      return
    }

    const validItems = items.filter((i) => i.name.trim().length > 0)
    if (validItems.length === 0) {
      toast.error('Adicione pelo menos um item ao pedido.')
      return
    }

    setIsSubmitting(true)
    try {
      const randomSuffix = Math.floor(100 + Math.random() * 900)
      const trackingCode = `TRK-${new Date().getFullYear()}-${randomSuffix}`

      const now = new Date()
      const assignedCourier = courierId !== 'unassigned' ? courierId : undefined

      await deliveryService.createOrder({
        tracking_code: trackingCode,
        seller_id: user?.id,
        customer_id: finalCustomerId,
        courier_id: assignedCourier,
        status: assignedCourier ? 'in_transit' : 'pending',
        priority,
        items: validItems,
        total_price: totalPrice,
        notes,
        estimated_arrival: assignedCourier
          ? new Date(now.getTime() + 45 * 60 * 1000).toISOString()
          : undefined,
      })

      // Trigger automatic in-app notification
      await deliveryService.createNotification({
        title: 'Novo Pedido Registrado',
        message: `Pedido ${trackingCode} criado com sucesso. Valor: R$ ${totalPrice.toFixed(2)}`,
        type: 'order',
        read: false,
        user_id: user?.id,
      })

      toast.success(`Pedido ${trackingCode} registrado com sucesso!`)
      onOrderCreated()
      onOpenChange(false)

      // Reset form
      setCustomerId('')
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
      setLocationLinkInput('')
      setHasLocationPinned(false)
      setSelectedCoords(DEFAULT_CENTER)
    } catch (err: unknown) {
      console.error('Error creating order:', err)
      const message = err instanceof Error ? err.message : 'Falha ao registrar venda'
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
            <ShoppingBag className="h-5 w-5 text-blue-600" />
            Registrar Nova Venda & Entrega
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 py-2">
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
                <Select value={customerId} onValueChange={handleSelectExistingCustomer}>
                  <SelectTrigger className="w-full bg-white dark:bg-slate-800">
                    <SelectValue placeholder="Selecione um cliente já cadastrado..." />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} — {c.address}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {customerId && (
                  <div className="rounded-lg bg-white p-3 border border-slate-200 text-xs dark:bg-slate-800 dark:border-slate-700">
                    {(() => {
                      const sel = customers.find((c) => c.id === customerId)
                      if (!sel) return null
                      return (
                        <div className="space-y-1">
                          <p className="font-bold text-slate-900 dark:text-white">{sel.name}</p>
                          <p className="text-slate-600 dark:text-slate-300">📞 {sel.phone}</p>
                          <p className="text-slate-600 dark:text-slate-300">📍 {sel.address}</p>
                          {sel.lat && sel.lng && (
                            <Badge
                              variant="outline"
                              className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200"
                            >
                              ✓ Coordenadas GPS Fixadas
                            </Badge>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {/* Name & Phone */}
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
                    <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      Telefone de Contato (WhatsApp)
                    </Label>
                    <Input
                      placeholder="Ex: (11) 98765-4321"
                      value={newCustPhone}
                      onChange={(e) => setNewCustPhone(e.target.value)}
                      className="mt-1 bg-white dark:bg-slate-800 text-xs"
                    />
                  </div>
                </div>

                {/* 1. Google Places Autocomplete Search Bar */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <Search className="h-3.5 w-3.5 text-blue-600" />
                      Buscar Endereço (Autocompletar Google Maps)
                    </Label>
                    <span className="text-[10px] text-slate-400">
                      Digite rua ou comércio para preencher tudo
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        ref={autocompleteInputRef}
                        value={addressSearchQuery}
                        onChange={(e) => setAddressSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            handleManualAddressSearch()
                          }
                        }}
                        placeholder="Comece a digitar o endereço, ex: Av. Paulista, 1000..."
                        className="bg-white dark:bg-slate-800 text-xs pl-8 pr-4 shadow-sm border-blue-200 focus:border-blue-500"
                      />
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleManualAddressSearch}
                      disabled={isSearchingAddress || !addressSearchQuery.trim()}
                      className="text-xs font-semibold gap-1 whitespace-nowrap bg-white hover:bg-slate-100 dark:bg-slate-800"
                    >
                      {isSearchingAddress ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Search className="h-3.5 w-3.5" />
                      )}
                      Buscar
                    </Button>
                  </div>
                </div>

                {/* 2. Customer Location Link Importer (WhatsApp / Google Maps pin) */}
                <div className="rounded-lg border border-slate-200/80 bg-white/80 p-3 dark:border-slate-800 dark:bg-slate-800/80 space-y-2">
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
                      placeholder="Cole link do Google Maps, WhatsApp ou coordenadas (-23.55, -46.63)..."
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
                </div>

                {/* 3. Separate Address Fields */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 pt-1">
                  {/* Rua e Número */}
                  <div className="sm:col-span-8">
                    <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      Rua e Número <span className="text-rose-500">*</span>
                    </Label>
                    <Input
                      placeholder="Ex: Rua Manuel Vieira, 196"
                      value={streetAndNumber}
                      onChange={(e) => setStreetAndNumber(e.target.value)}
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
                      onChange={(e) => setNeighborhood(e.target.value)}
                      className="mt-1 bg-white dark:bg-slate-800 text-xs"
                    />
                  </div>

                  {/* Cidade */}
                  <div className="sm:col-span-4">
                    <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      Cidade
                    </Label>
                    <Input
                      placeholder="Ex: São Paulo"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="mt-1 bg-white dark:bg-slate-800 text-xs"
                    />
                  </div>

                  {/* UF */}
                  <div className="sm:col-span-2">
                    <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      UF (Estado)
                    </Label>
                    <Select value={ufState} onValueChange={setUfState}>
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
                    <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      CEP
                    </Label>
                    <Input
                      placeholder="00000-000"
                      value={postalCode}
                      onChange={(e) => setPostalCode(e.target.value)}
                      className="mt-1 bg-white dark:bg-slate-800 text-xs"
                    />
                  </div>
                </div>

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
                        <span className="text-[10px] font-mono text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-200 flex items-center gap-0.5">
                          <Check className="h-3 w-3" /> {selectedCoords.lat.toFixed(4)},{' '}
                          {selectedCoords.lng.toFixed(4)}
                        </span>
                      )}
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
                          Você pode digitar o endereço acima ou arrastar quando o mapa inicializar.
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
                </div>
              </div>
            )}
          </div>

          {/* Logistics: Courier Assignment & Priority */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Atribuir Entregador
              </Label>
              <Select value={courierId} onValueChange={setCourierId}>
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
              <Select value={priority} onValueChange={(val) => setPriority(val as OrderPriority)}>
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

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold"
            >
              {isSubmitting ? 'Registrando...' : 'Emitir Pedido & Iniciar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

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
  AlertTriangle,
  Building2,
  Sparkles,
  Phone,
  UserCheck,
  Edit3,
} from 'lucide-react'
import { deliveryService } from '@/services/deliveryService'
import type { CustomerRecord, UserRecord, OrderPriority, OrderItem } from '@/types/delivery'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'
import {
  BRAZILIAN_STATES,
  loadGoogleMapsScript,
  onGoogleMapsAuthError,
  isGoogleMapsAuthError,
  parseGoogleAddressComponents,
  lookupViaCep,
  fallbackGeocodeAddress,
  fallbackReverseGeocode,
  normalizeBrazilianUF,
} from '@/lib/googleMaps'

interface CreateOrderModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  customers: CustomerRecord[]
  couriers: UserRecord[]
  onOrderCreated: () => void
}

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
  const [isSearchingAddress, setIsSearchingAddress] = useState(false)

  // Split Address Fields (Rua e Número, Bairro, Cidade, UF e CEP)
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

  // Google Maps state & warnings
  const [isMapsLoaded, setIsMapsLoaded] = useState(false)
  const [mapsAuthWarning, setMapsAuthWarning] = useState<string | null>(null)
  const [isLoadingViaCep, setIsLoadingViaCep] = useState(false)

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
        setIsMapsLoaded(success && !isGoogleMapsAuthError())
      }
    })

    return () => {
      isMounted = false
    }
  }, [open])

  // Populate customer fields helper
  const populateCustomerForm = useCallback((cust: CustomerRecord) => {
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

    if (cust.lat && cust.lng) {
      setSelectedCoords({ lat: cust.lat, lng: cust.lng })
      setHasLocationPinned(true)
    }
  }, [])

  // Auto-lookup existing customer by typed phone
  const checkCustomerByPhoneDebounced = useCallback(
    async (phoneInput: string) => {
      const cleanDigits = phoneInput.replace(/\D/g, '')
      if (cleanDigits.length < 8) return

      // 1. Check in loaded customers array first (search phone1, phone2, phone3)
      const localMatch = customers.find((c) => {
        const d1 = (c.phone || '').replace(/\D/g, '')
        const d2 = (c.phone2 || '').replace(/\D/g, '')
        const d3 = (c.phone3 || '').replace(/\D/g, '')
        return (
          (d1 && (d1 === cleanDigits || (d1.length >= 8 && (d1.endsWith(cleanDigits) || cleanDigits.endsWith(d1))))) ||
          (d2 && (d2 === cleanDigits || (d2.length >= 8 && (d2.endsWith(cleanDigits) || cleanDigits.endsWith(d2))))) ||
          (d3 && (d3 === cleanDigits || (d3.length >= 8 && (d3.endsWith(cleanDigits) || cleanDigits.endsWith(d3)))))
        )
      })

      if (localMatch) {
        populateCustomerForm(localMatch)
        toast.success(`Cliente localizado: "${localMatch.name}". Cadastro completo carregado e pronto para edição!`)
        return
      }

      // 2. Query backend across phone, phone2, phone3
      setIsSearchingPhone(true)
      try {
        const found = await deliveryService.findCustomerByPhone(phoneInput)
        if (found) {
          populateCustomerForm(found)
          toast.success(`Cliente localizado: "${found.name}". Cadastro completo carregado e pronto para edição!`)
        }
      } catch (e) {
        console.warn('Error querying customer by phone:', e)
      } finally {
        setIsSearchingPhone(false)
      }
    },
    [customers, populateCustomerForm],
  )

  // Phone input handler with auto-search debounce
  const phoneDebounceRef = useRef<NodeJS.Timeout | null>(null)
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

  // Parse Google Maps / Waze / WhatsApp coordinates link
  const parseCoordinatesFromText = (text: string): { lat: number; lng: number } | null => {
    let raw = text.trim()
    if (!raw) return null

    try {
      raw = decodeURIComponent(raw)
    } catch {
      // keep raw
    }

    // Pattern 1: @-23.55052,-46.633308 or @-23.55052,-46.633308,17z
    const atMatch = raw.match(/@\s*([+-]?\d+\.\d+)\s*,\s*([+-]?\d+\.\d+)/)
    if (atMatch) {
      const lat = parseFloat(atMatch[1])
      const lng = parseFloat(atMatch[2])
      if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        return { lat, lng }
      }
    }

    // Pattern 2: !3d-23.55052!4d-46.633308 (Google Maps place URLs)
    const data3dMatch = raw.match(/!3d\s*([+-]?\d+\.\d+)\s*!4d\s*([+-]?\d+\.\d+)/)
    if (data3dMatch) {
      const lat = parseFloat(data3dMatch[1])
      const lng = parseFloat(data3dMatch[2])
      if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        return { lat, lng }
      }
    }

    // Pattern 3: q=-23.55052,-46.633308 or ll=-23.55052,-46.633308 or destination=... or loc:...
    const queryMatch = raw.match(
      /(?:q|ll|query|destination|loc|center|daddr|saddr)=([+-]?\d+\.\d+)[,\s%20]+([+-]?\d+\.\d+)/i,
    )
    if (queryMatch) {
      const lat = parseFloat(queryMatch[1])
      const lng = parseFloat(queryMatch[2])
      if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        return { lat, lng }
      }
    }

    // Pattern 4: geo:-23.55052,-46.633308 or geo:0,0?q=-23.55052,-46.633308
    const geoMatch = raw.match(/geo:\s*([+-]?\d+\.\d+)\s*,\s*([+-]?\d+\.\d+)/i)
    if (geoMatch) {
      const lat = parseFloat(geoMatch[1])
      const lng = parseFloat(geoMatch[2])
      if (!isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0)) {
        return { lat, lng }
      }
    }

    // Pattern 5: Waze link https://waze.com/ul?ll=-23.55052,-46.633308 or /ul?q=...
    const wazeMatch = raw.match(/waze\.com\/.*ll=([+-]?\d+\.\d+)[,\s%20]+([+-]?\d+\.\d+)/i)
    if (wazeMatch) {
      const lat = parseFloat(wazeMatch[1])
      const lng = parseFloat(wazeMatch[2])
      if (!isNaN(lat) && !isNaN(lng)) return { lat, lng }
    }

    // Pattern 6: Bare lat, lng pair (e.g. "-23.55052, -46.633308" or "-23.550520 -46.633308")
    const bareMatch = raw.match(/([+-]?\d{1,2}\.\d+)[,\s]+([+-]?\d{1,3}\.\d+)/)
    if (bareMatch) {
      const lat = parseFloat(bareMatch[1])
      const lng = parseFloat(bareMatch[2])
      if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return { lat, lng }
      }
    }

    return null
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
      if (parsed.streetAndNumber) {
        setStreetAndNumber(parsed.streetAndNumber)
      } else if (parsed.street) {
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
        setPostalCode(parsed.postalCode)
      }

      if (parsed.complement) {
        setComplement(parsed.complement)
      }
    },
    [],
  )

  // Reverse geocode to fill separate address fields (Google Maps Geocoder with Nominatim fallback)
  const reverseGeocode = useCallback(
    async (lat: number, lng: number) => {
      if (isReverseGeocodingRef.current) return
      isReverseGeocodingRef.current = true

      const google = getGoogle()
      let handled = false

      if (google?.maps?.Geocoder) {
        try {
          const geocoder = new google.maps.Geocoder()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await new Promise<void>((resolve) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            geocoder.geocode({ location: { lat, lng } }, (results: any[], status: string) => {
              if (status === 'OK' && results?.[0]) {
                const parsed = parseGoogleAddressComponents(
                  results[0].address_components || [],
                  results[0].formatted_address,
                )
                applyAddressData(parsed)
                handled = true
              }
              resolve()
            })
          })
        } catch (err) {
          console.warn('[Google Geocoder] Geocoding exception:', err)
        }
      }

      // If Google geocoder was not available or failed, use OpenStreetMap Nominatim fallback
      if (!handled) {
        try {
          const fallbackData = await fallbackReverseGeocode(lat, lng)
          if (fallbackData) {
            applyAddressData(fallbackData)
            handled = true
          }
        } catch (err) {
          console.warn('Fallback reverse geocode error:', err)
        }
      }

      isReverseGeocodingRef.current = false
    },
    [applyAddressData],
  )

  // Update map marker and center safely without infinite loops
  const updateMapPosition = useCallback(
    (lat: number, lng: number, zoomLevel = 16, shouldReverseGeocode = false) => {
      setSelectedCoords({ lat, lng })
      setHasLocationPinned(true)

      const google = getGoogle()
      if (mapInstanceRef.current && google?.maps) {
        try {
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

        const parsed = parseGoogleAddressComponents(
          place.address_components || [],
          place.formatted_address || place.name || '',
        )

        applyAddressData(parsed)

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
  }, [applyAddressData, updateMapPosition])

  // Manual fallback geocode when user presses Enter or clicks search button
  const handleManualAddressSearch = async () => {
    const query = addressSearchQuery.trim() || autocompleteInputRef.current?.value.trim()
    if (!query) {
      toast.info('Digite um endereço para buscar.')
      return
    }

    setIsSearchingAddress(true)
    let found = false

    // 1. If it looks like a CEP (e.g. 01310-100 or 8 digits)
    const cepDigits = query.replace(/\D/g, '')
    if (cepDigits.length === 8 && /^\d+$/.test(cepDigits)) {
      const viaCepResult = await lookupViaCep(cepDigits)
      if (viaCepResult) {
        applyAddressData(viaCepResult)
        toast.success(`Endereço localizado via CEP ${cepDigits}!`)
        found = true
        // Geocode coordinates via Google or Nominatim
        const fullAddrQuery = `${viaCepResult.street}, ${viaCepResult.neighborhood}, ${viaCepResult.city} - ${viaCepResult.state}, Brasil`
        const nom = await fallbackGeocodeAddress(fullAddrQuery)
        if (nom) {
          updateMapPosition(nom.lat, nom.lng, 16, false)
        }
        setIsSearchingAddress(false)
        return
      }
    }

    // 2. Try Google Maps Geocoder if loaded
    const google = getGoogle()
    if (google?.maps?.Geocoder) {
      try {
        const geocoder = new google.maps.Geocoder()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await new Promise<void>((resolve) => {
          geocoder.geocode(
            { address: query, componentRestrictions: { country: 'br' } },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (results: any[], status: string) => {
              if (status === 'OK' && results?.[0]?.geometry?.location) {
                const loc = results[0].geometry.location
                const lat = loc.lat()
                const lng = loc.lng()
                const parsed = parseGoogleAddressComponents(
                  results[0].address_components || [],
                  results[0].formatted_address || query,
                )
                applyAddressData(parsed)
                updateMapPosition(lat, lng, 16, false)
                toast.success('Endereço localizado no Google Maps!')
                found = true
              }
              resolve()
            },
          )
        })
      } catch (e) {
        console.warn('Google geocoding failed:', e)
      }
    }

    // 3. Try Fallback Geocoding (Nominatim / OpenStreetMap)
    if (!found) {
      try {
        const fallbackRes = await fallbackGeocodeAddress(query)
        if (fallbackRes) {
          applyAddressData(fallbackRes.parsed)
          updateMapPosition(fallbackRes.lat, fallbackRes.lng, 16, false)
          toast.success('Endereço localizado via base geográfica!')
          found = true
        }
      } catch (err) {
        console.warn('Fallback geocode failed:', err)
      }
    }

    setIsSearchingAddress(false)

    if (!found) {
      // Basic fallback without geocoder: parse street and number
      setStreetAndNumber(query)
      toast.info(
        'Texto transferido para o logradouro. Preencha os campos ou informe o CEP para autocompletar.',
      )
    }
  }

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
  const handleApplyLocationLink = async () => {
    const inputVal = locationLinkInput.trim()
    if (!inputVal) return

    setIsParsingLink(true)
    try {
      // 1. Direct coordinate extraction (Maps URLs, WhatsApp pins, lat/lng strings)
      const coords = parseCoordinatesFromText(inputVal)
      if (coords) {
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

    // If using inline customer form (New or existing matched by phone/editing)
    if (isAddingCustomer) {
      if (!newCustName.trim()) {
        toast.error('Preencha o nome do cliente.')
        return
      }

      const mainPhone = newCustPhone.trim()
      if (!mainPhone) {
        toast.error('Preencha ao menos um telefone de contato para o cliente.')
        return
      }

      const combinedAddress = getFullFormattedAddress()
      if (!streetAndNumber.trim() && !combinedAddress.trim()) {
        toast.error('Preencha ao menos a Rua e Número ou busque pelo endereço.')
        return
      }

      const customerPayload: Partial<CustomerRecord> = {
        name: newCustName.trim(),
        phone: mainPhone,
        phone2: newCustPhone2.trim() || undefined,
        phone3: newCustPhone3.trim() || undefined,
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

      try {
        // Validate phone uniqueness across all 3 phone fields against other customers
        const phonesToValidate = [
          mainPhone,
          newCustPhone2.trim() || undefined,
          newCustPhone3.trim() || undefined,
        ]

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
            return
          }

          // Update existing customer record directly
          await deliveryService.updateCustomer(existingMatchedCustomerId, customerPayload)
          finalCustomerId = existingMatchedCustomerId
          toast.success(`Cadastro do cliente "${newCustName.trim()}" atualizado com sucesso!`)
        } else {
          // Check if any of the phones already belongs to an existing customer
          const conflictCheck = await deliveryService.checkPhoneConflict(phonesToValidate)
          if (conflictCheck.conflict && conflictCheck.customer) {
            // Found existing customer by one of the phones -> update their record instead of duplicating
            await deliveryService.updateCustomer(conflictCheck.customer.id, customerPayload)
            finalCustomerId = conflictCheck.customer.id
            toast.info(
              `Telefone vinculado ao cliente "${conflictCheck.customer.name}". Cadastro atualizado sem duplicidade!`,
            )
          } else {
            // Create new customer
            const created = await deliveryService.createCustomer(customerPayload)
            finalCustomerId = created.id
            toast.success(`Novo cliente "${created.name}" cadastrado com sucesso!`)
          }
        }
      } catch (err) {
        console.error('Error saving customer:', err)
        toast.error('Erro ao salvar dados do cliente.')
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
          {/* Billing / Auth error notice banner (non-intrusive fallback helper) */}
          {mapsAuthWarning && (
            <Alert className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200 py-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <AlertDescription className="text-xs">
                <strong>Aviso de Mapa:</strong> A chave do Google Maps precisa de faturamento ativo
                no Google Cloud Console.
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
                <Select value={customerId} onValueChange={handleSelectExistingCustomer}>
                  <SelectTrigger className="w-full bg-white dark:bg-slate-800">
                    <SelectValue placeholder="Selecione um cliente já cadastrado..." />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} — {c.phone} ({c.address})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {customerId && (
                  <div className="rounded-lg bg-white p-3 border border-slate-200 text-xs dark:bg-slate-800 dark:border-slate-700 flex items-start justify-between">
                    {(() => {
                      const sel = customers.find((c) => c.id === customerId)
                      if (!sel) return null
                      return (
                        <div className="space-y-1">
                          <p className="font-bold text-slate-900 dark:text-white">{sel.name}</p>
                          <p className="text-slate-600 dark:text-slate-300">
                            📞 {sel.phone} {sel.phone2 ? `| 2: ${sel.phone2}` : ''} {sel.phone3 ? `| 3: ${sel.phone3}` : ''}
                          </p>
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
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const sel = customers.find((c) => c.id === customerId)
                        if (sel) {
                          populateCustomerForm(sel)
                          setIsAddingCustomer(true)
                        }
                      }}
                      className="h-7 text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
                    >
                      <Edit3 className="h-3.5 w-3.5" /> Editar Dados
                    </Button>
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
                      Cliente identificado! Você pode editar nome, telefones e endereço diretamente aqui.
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
                        <Phone className="h-3 w-3 text-blue-600" /> Telefone Principal (WhatsApp) <span className="text-rose-500">*</span>
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

                {/* 1. Google Places Autocomplete Search Bar */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <Search className="h-3.5 w-3.5 text-blue-600" />
                      Buscar Endereço (Autocompletar Google Maps / CEP)
                    </Label>
                    <span className="text-[10px] text-slate-400">
                      Digite rua, CEP ou local para preencher tudo
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
                        placeholder="Comece a digitar o endereço ou CEP, ex: Av. Paulista, 1000..."
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
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                        CEP
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

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  loadGoogleMapsScript,
  parseGoogleAddressComponents,
  fallbackGeocodeAddress,
  lookupViaCep,
  isGoogleMapsAuthError,
  ParsedAddress,
} from '@/lib/googleMaps'
import { MapPin, Search, Loader2, Building2, Check, AlertCircle, X } from 'lucide-react'

export interface BaseAddressResult {
  name?: string
  address: string
  lat: number
  lng: number
  parsed?: ParsedAddress
}

export interface BiasCoordinates {
  lat: number
  lng: number
}

interface BaseAddressAutocompleteProps {
  value: string
  onChange: (value: string) => void
  onAddressSelect: (result: BaseAddressResult) => void
  placeholder?: string
  className?: string
  inputClassName?: string
  buttonClassName?: string
  dropdownClassName?: string
  biasCoordinates?: BiasCoordinates | null
  showSearchButton?: boolean
}

// Cache de geolocalização do usuário em memória na sessão
let cachedUserPosition: BiasCoordinates | null = null
let userPositionPromise: Promise<BiasCoordinates | null> | null = null

export function getCachedUserCoordinates(): BiasCoordinates | null {
  return cachedUserPosition
}

export function getUserGeolocation(): Promise<BiasCoordinates | null> {
  if (cachedUserPosition) {
    return Promise.resolve(cachedUserPosition)
  }
  if (userPositionPromise) {
    return userPositionPromise
  }
  if (typeof window === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(null)
  }

  userPositionPromise = new Promise<BiasCoordinates | null>((resolve) => {
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          }
          cachedUserPosition = coords
          resolve(coords)
        },
        () => {
          resolve(null)
        },
        {
          enableHighAccuracy: false,
          timeout: 7000,
          maximumAge: 10 * 60 * 1000,
        },
      )
    } catch {
      resolve(null)
    }
  })

  return userPositionPromise
}

export interface PlaceSuggestion {
  placeId: string
  mainText: string
  secondaryText: string
  fullText: string
  source: 'google-new' | 'google-legacy' | 'viacep' | 'osm'
  // Referência para o objeto de predição da Places API (New) se disponível
  rawPrediction?: any
  // Dados de CEP pré-resolvidos se for resultado de busca direta por CEP
  preloadedParsed?: ParsedAddress
  lat?: number
  lng?: number
}

// Blindado com translate="no" e notranslate para impedir que extensões de tradução injetem tags <font>
function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!text) return null
  const cleanQ = query.trim()
  if (!cleanQ) {
    return (
      <span translate="no" className="notranslate">
        {text}
      </span>
    )
  }

  const regex = new RegExp(`(${cleanQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  const parts = text.split(regex)

  return (
    <span translate="no" className="notranslate">
      {parts.map((part, i) =>
        part.toLowerCase() === cleanQ.toLowerCase() ? (
          <mark
            key={i}
            translate="no"
            className="notranslate bg-amber-100 text-amber-950 font-bold px-0.5 rounded-sm dark:bg-amber-500/30 dark:text-amber-200"
          >
            {part}
          </mark>
        ) : (
          <span key={i} translate="no" className="notranslate">
            {part}
          </span>
        ),
      )}
    </span>
  )
}

export const BaseAddressAutocomplete: React.FC<BaseAddressAutocompleteProps> = ({
  value,
  onChange,
  onAddressSelect,
  placeholder = 'Comece a digitar o endereço ou CEP, ex: Rua das Laranjeiras, 100...',
  className = '',
  inputClassName = '',
  buttonClassName = '',
  dropdownClassName = '',
  biasCoordinates = null,
  showSearchButton = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeRequestIdRef = useRef<number>(0)
  const isSelectedRef = useRef<boolean>(false)
  const activeAbortControllerRef = useRef<AbortController | null>(null)

  // Token de sessão do Google Places Autocomplete
  const sessionTokenRef = useRef<any>(null)

  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false)
  const [isResolvingPlace, setIsResolvingPlace] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState<number>(-1)
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null)
  const [userCoords, setUserCoords] = useState<BiasCoordinates | null>(cachedUserPosition)
  const userCoordsRef = useRef<BiasCoordinates | null>(cachedUserPosition)

  // Carregar geolocalização do usuário silenciosamente
  const triggerGeolocation = useCallback(() => {
    getUserGeolocation().then((coords) => {
      if (coords) {
        userCoordsRef.current = coords
        setUserCoords(coords)
      }
    })
  }, [])

  useEffect(() => {
    triggerGeolocation()
  }, [triggerGeolocation])

  const activeBias: BiasCoordinates = userCoordsRef.current ||
    userCoords ||
    cachedUserPosition ||
    biasCoordinates || {
      lat: -22.906847,
      lng: -43.172896,
    }

  // Limpeza atômica de timers, abort controllers e referências de Places no unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
      if (activeAbortControllerRef.current) {
        activeAbortControllerRef.current.abort()
      }
      sessionTokenRef.current = null
    }
  }, [])

  // Pre-carregar Google Maps Script
  useEffect(() => {
    loadGoogleMapsScript().catch(() => {
      // Ignorar; fallbacks assumirão
    })
  }, [])

  // Criar ou renovar session token do Places
  const getOrCreateSessionToken = useCallback(async () => {
    if (sessionTokenRef.current) return sessionTokenRef.current
    try {
      const win = typeof window !== 'undefined' ? (window as any) : null
      if (win?.google?.maps?.places?.AutocompleteSessionToken) {
        sessionTokenRef.current = new win.google.maps.places.AutocompleteSessionToken()
        return sessionTokenRef.current
      }
      if (win?.google?.maps?.importLibrary) {
        const { AutocompleteSessionToken } = await win.google.maps.importLibrary('places')
        if (AutocompleteSessionToken) {
          sessionTokenRef.current = new AutocompleteSessionToken()
          return sessionTokenRef.current
        }
      }
    } catch {
      // Sem suporte a session token nativo
    }
    return null
  }, [])

  const resetSessionToken = useCallback(() => {
    sessionTokenRef.current = null
  }, [])

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  // Garantir que item selecionado pelo teclado fique visível
  useEffect(() => {
    if (isOpen && listRef.current && selectedIndex >= 0) {
      const activeEl = listRef.current.querySelector(
        `[data-index="${selectedIndex}"]`,
      ) as HTMLElement | null
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [selectedIndex, isOpen])

  // Busca de predições com múltiplos provedores em cascata (Places API New -> Legacy -> ViaCEP/OSM)
  const fetchPredictions = useCallback(
    async (queryText: string, requestId: number) => {
      const trimmed = queryText.trim()

      if (trimmed.length < 3 || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        if (requestId === activeRequestIdRef.current) {
          setSuggestions([])
          setIsOpen(false)
          setIsLoadingSuggestions(false)
          setEmptyMessage(null)
        }
        return
      }

      setIsLoadingSuggestions(true)
      setEmptyMessage(null)

      const effectiveBias =
        userCoordsRef.current || userCoords || cachedUserPosition || biasCoordinates || activeBias

      const collectedSuggestions: PlaceSuggestion[] = []

      // 1. Verificar se a busca é por CEP (8 dígitos numéricos)
      const cepDigits = trimmed.replace(/\D/g, '')
      if (cepDigits.length === 8 && /^\d{5}-?\d{3}$|^\d{8}$/.test(trimmed)) {
        try {
          const viaCepData = await lookupViaCep(cepDigits)
          if (viaCepData && viaCepData.street) {
            collectedSuggestions.push({
              placeId: `viacep_${cepDigits}`,
              mainText: `${viaCepData.street}`,
              secondaryText: `${viaCepData.neighborhood ? `${viaCepData.neighborhood}, ` : ''}${viaCepData.city} - ${viaCepData.state} • CEP ${viaCepData.postalCode}`,
              fullText:
                viaCepData.formattedAddress ||
                `${viaCepData.street}, ${viaCepData.neighborhood}, ${viaCepData.city} - ${viaCepData.state}`,
              source: 'viacep',
              preloadedParsed: viaCepData,
            })
          }
        } catch {
          // segue para busca de places
        }
      }

      try {
        const mapsLoaded = await loadGoogleMapsScript()
        const win = typeof window !== 'undefined' ? (window as any) : null

        // 2. Google Places API (New): AutocompleteSuggestion.fetchAutocompleteSuggestions
        let placesNewSucceeded = false
        if (mapsLoaded && !isGoogleMapsAuthError() && win?.google?.maps) {
          try {
            let AutocompleteSuggestionClass = win.google.maps.places?.AutocompleteSuggestion
            if (
              !AutocompleteSuggestionClass &&
              typeof win.google.maps.importLibrary === 'function'
            ) {
              const placesLib = await win.google.maps.importLibrary('places')
              AutocompleteSuggestionClass = placesLib?.AutocompleteSuggestion
            }

            if (AutocompleteSuggestionClass?.fetchAutocompleteSuggestions) {
              const sessionToken = await getOrCreateSessionToken()

              const requestPayload: any = {
                input: trimmed,
                includedRegionCodes: ['br'],
                language: 'pt-BR',
                region: 'br',
              }

              if (sessionToken) {
                requestPayload.sessionToken = sessionToken
              }

              if (effectiveBias && typeof effectiveBias.lat === 'number') {
                requestPayload.locationBias = {
                  circle: {
                    center: { latitude: effectiveBias.lat, longitude: effectiveBias.lng },
                    radius: 50000.0, // 50km
                  },
                }
                requestPayload.origin = {
                  latitude: effectiveBias.lat,
                  longitude: effectiveBias.lng,
                }
              }

              const response =
                await AutocompleteSuggestionClass.fetchAutocompleteSuggestions(requestPayload)

              if (requestId !== activeRequestIdRef.current) return

              if (
                response &&
                Array.isArray(response.suggestions) &&
                response.suggestions.length > 0
              ) {
                for (const item of response.suggestions) {
                  const pred = item?.placePrediction
                  if (!pred) continue

                  const main =
                    pred.structuredFormat?.mainText?.text ||
                    pred.text?.text ||
                    pred.displayName ||
                    ''
                  const secondary = pred.structuredFormat?.secondaryText?.text || ''
                  const full = pred.text?.text || `${main} - ${secondary}`

                  collectedSuggestions.push({
                    placeId: pred.placeId || pred.place || `places_new_${Math.random()}`,
                    mainText: main || full,
                    secondaryText: secondary,
                    fullText: full,
                    source: 'google-new',
                    rawPrediction: pred,
                  })
                }
                placesNewSucceeded = true
              }
            }
          } catch (errPlacesNew) {
            // Se Places (New) falhar, tenta o fallback AutocompleteService legado
          }
        }

        // 3. Fallback: Google Places AutocompleteService (Legacy)
        if (
          !placesNewSucceeded &&
          mapsLoaded &&
          !isGoogleMapsAuthError() &&
          win?.google?.maps?.places?.AutocompleteService
        ) {
          const service = new win.google.maps.places.AutocompleteService()
          const sessionToken = await getOrCreateSessionToken()

          const requestOptions: any = {
            input: trimmed,
            componentRestrictions: { country: 'br' },
          }

          if (sessionToken) {
            requestOptions.sessionToken = sessionToken
          }

          if (effectiveBias && typeof effectiveBias.lat === 'number') {
            if (win.google.maps.LatLng) {
              requestOptions.location = new win.google.maps.LatLng(
                effectiveBias.lat,
                effectiveBias.lng,
              )
            } else {
              requestOptions.location = { lat: effectiveBias.lat, lng: effectiveBias.lng }
            }
            requestOptions.radius = 50000
          }

          const legacyResult = await new Promise<any[]>((resolve) => {
            try {
              service.getPlacePredictions(requestOptions, (predictions: any[], status: string) => {
                if (
                  status === win.google.maps.places.PlacesServiceStatus.OK &&
                  Array.isArray(predictions)
                ) {
                  resolve(predictions)
                } else {
                  resolve([])
                }
              })
            } catch {
              resolve([])
            }
          })

          if (requestId !== activeRequestIdRef.current) return

          if (legacyResult.length > 0) {
            for (const p of legacyResult) {
              collectedSuggestions.push({
                placeId: p.place_id,
                mainText: p.structured_formatting?.main_text || p.description,
                secondaryText: p.structured_formatting?.secondary_text || '',
                fullText: p.description,
                source: 'google-legacy',
              })
            }
          }
        }

        // 4. Fallback OpenStreetMap Nominatim se nenhuma sugestão do Google foi retornada
        if (collectedSuggestions.length === 0) {
          let nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=br&limit=6&q=${encodeURIComponent(
            trimmed,
          )}`

          if (effectiveBias && typeof effectiveBias.lat === 'number') {
            const delta = 0.45
            const minLon = (effectiveBias.lng - delta).toFixed(5)
            const maxLon = (effectiveBias.lng + delta).toFixed(5)
            const minLat = (effectiveBias.lat - delta).toFixed(5)
            const maxLat = (effectiveBias.lat + delta).toFixed(5)
            nominatimUrl += `&viewbox=${minLon},${maxLat},${maxLon},${minLat}&bounded=0`
          }

          if (activeAbortControllerRef.current) {
            activeAbortControllerRef.current.abort()
          }
          const controller = new AbortController()
          activeAbortControllerRef.current = controller
          const timeoutTimer = setTimeout(() => controller.abort(), 4500)

          const res = await fetch(nominatimUrl, {
            signal: controller.signal,
            headers: { 'Accept-Language': 'pt-BR,pt;q=0.9' },
          }).finally(() => {
            clearTimeout(timeoutTimer)
          })

          if (requestId !== activeRequestIdRef.current) return

          if (res.ok) {
            const data = await res.json()
            if (Array.isArray(data) && data.length > 0) {
              for (const item of data) {
                const displayName: string = item.display_name || ''
                const parts = displayName.split(', ')
                const main = parts[0] || displayName
                const secondary = parts.slice(1, 4).join(', ')
                collectedSuggestions.push({
                  placeId: `osm_${item.osm_type || 'node'}_${item.osm_id || Math.random()}`,
                  mainText: main,
                  secondaryText: secondary,
                  fullText: displayName,
                  source: 'osm',
                  lat: parseFloat(item.lat),
                  lng: parseFloat(item.lon),
                })
              }
            }
          }
        }

        if (requestId !== activeRequestIdRef.current) return

        // Deduplicar por fullText / placeId
        const seen = new Set<string>()
        const deduped: PlaceSuggestion[] = []
        for (const s of collectedSuggestions) {
          const key = (s.mainText + '|' + s.secondaryText).toLowerCase()
          if (!seen.has(key)) {
            seen.add(key)
            deduped.push(s)
          }
        }

        if (deduped.length > 0) {
          setSuggestions(deduped)
          setIsOpen(true)
          setSelectedIndex(-1)
          setEmptyMessage(null)
        } else {
          setSuggestions([])
          setIsOpen(true)
          setSelectedIndex(-1)
          setEmptyMessage(
            `Nenhum endereço encontrado para "${trimmed}" — verifique o CEP ou digite mais detalhes.`,
          )
        }
      } catch (err) {
        if (requestId === activeRequestIdRef.current) {
          setSuggestions([])
          setIsOpen(true)
          setEmptyMessage(
            `Nenhum endereço encontrado para "${trimmed}" — verifique o CEP ou digite mais detalhes.`,
          )
        }
      } finally {
        if (requestId === activeRequestIdRef.current) {
          setIsLoadingSuggestions(false)
        }
      }
    },
    [activeBias, getOrCreateSessionToken],
  )

  // Gerenciar digitação com debounce
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value
    isSelectedRef.current = false
    onChange(text)

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    const currentId = ++activeRequestIdRef.current

    if (!text.trim() || text.trim().length < 3) {
      setSuggestions([])
      setIsOpen(false)
      setIsLoadingSuggestions(false)
      setEmptyMessage(null)
      return
    }

    debounceTimerRef.current = setTimeout(() => {
      fetchPredictions(text, currentId)
    }, 280)
  }

  // Resolver detalhes completos ao selecionar uma opção do dropdown
  const handleSelectSuggestion = async (suggestion: PlaceSuggestion) => {
    isSelectedRef.current = true
    setIsOpen(false)
    setSuggestions([])
    setEmptyMessage(null)
    setIsResolvingPlace(true)

    // Atualiza texto visível para endereço selecionado
    onChange(suggestion.fullText)

    const effectiveBias =
      userCoordsRef.current || userCoords || cachedUserPosition || biasCoordinates || activeBias
    const defaultLat = effectiveBias?.lat ?? -22.906847
    const defaultLng = effectiveBias?.lng ?? -43.172896

    try {
      // Caso 1: Sugestão de CEP já pré-resolvida pelo ViaCEP
      if (suggestion.source === 'viacep' && suggestion.preloadedParsed) {
        const fullAddr = suggestion.fullText
        const geo = await fallbackGeocodeAddress(fullAddr, effectiveBias)
        const lat = geo?.lat ?? defaultLat
        const lng = geo?.lng ?? defaultLng

        // FIX A: Os dados estruturados do ViaCEP são SOBERANOS!
        // O geocode do Google muitas vezes retorna apenas no nível cidade/localidade sem route,
        // com CEP truncado (5 dígitos) e sem nome de rua. Aproveitamos APENAS lat/lng do Google.
        const via = suggestion.preloadedParsed
        const cleanCepDigits = (via.postalCode || '').replace(/\D/g, '')
        const formattedCep =
          cleanCepDigits.length === 8
            ? `${cleanCepDigits.slice(0, 5)}-${cleanCepDigits.slice(5)}`
            : via.postalCode || ''

        const streetPart = via.streetAndNumber || via.street || suggestion.mainText
        const parts: string[] = []
        if (streetPart) parts.push(streetPart)
        if (via.neighborhood) parts.push(via.neighborhood)
        if (via.city && via.state) {
          parts.push(`${via.city} - ${via.state}`)
        } else if (via.city) {
          parts.push(via.city)
        }
        if (formattedCep) parts.push(formattedCep)

        const finalFormatted = parts.length > 0 ? parts.join(', ') : fullAddr

        const mergedParsed: ParsedAddress = {
          ...via,
          street: via.street || suggestion.mainText,
          streetAndNumber: via.streetAndNumber || via.street || suggestion.mainText,
          neighborhood: via.neighborhood,
          city: via.city,
          state: via.state,
          postalCode: formattedCep,
          formattedAddress: finalFormatted,
          lat,
          lng,
          source: 'viacep',
          isApproximate: false,
          locationType: 'ROOFTOP',
        }

        onChange(finalFormatted)
        onAddressSelect({
          name: suggestion.mainText,
          address: finalFormatted,
          lat,
          lng,
          parsed: mergedParsed,
        })
        resetSessionToken()
        return
      }

      // Caso 2: Sugestão originada da Places API (New) com toPlace()
      if (suggestion.source === 'google-new' && suggestion.rawPrediction?.toPlace) {
        try {
          const place = suggestion.rawPrediction.toPlace()
          await place.fetchFields({
            fields: ['formattedAddress', 'location', 'addressComponents', 'displayName'],
          })

          const formattedAddress =
            place.formattedAddress || place.displayName || suggestion.fullText
          let lat: number | undefined = undefined
          let lng: number | undefined = undefined

          if (place.location) {
            lat =
              typeof place.location.lat === 'function' ? place.location.lat() : place.location.lat
            lng =
              typeof place.location.lng === 'function' ? place.location.lng() : place.location.lng
          }

          let parsed: ParsedAddress | undefined = undefined
          if (Array.isArray(place.addressComponents) && place.addressComponents.length > 0) {
            parsed = parseGoogleAddressComponents(place.addressComponents, formattedAddress)
          }

          onChange(formattedAddress)
          onAddressSelect({
            name: place.displayName || suggestion.mainText,
            address: formattedAddress,
            lat: lat ?? defaultLat,
            lng: lng ?? defaultLng,
            parsed,
          })
          resetSessionToken()
          return
        } catch (errNewPlace) {
          console.warn(
            'Erro ao resolver toPlace() do Places (New), tentando fallback:',
            errNewPlace,
          )
        }
      }

      // Caso 3: Sugestão do Google Places Legado ou fallback de PlaceId
      const mapsLoaded = await loadGoogleMapsScript()
      const win = typeof window !== 'undefined' ? (window as any) : null

      if (
        mapsLoaded &&
        !isGoogleMapsAuthError() &&
        !suggestion.placeId.startsWith('osm_') &&
        !suggestion.placeId.startsWith('viacep_') &&
        win?.google?.maps?.places?.PlacesService
      ) {
        const dummyDiv = document.createElement('div')
        const service = new win.google.maps.places.PlacesService(dummyDiv)

        const detailsResult = await new Promise<{
          place: any
          status: string
        }>((resolve) => {
          service.getDetails(
            {
              placeId: suggestion.placeId,
              fields: ['formatted_address', 'geometry', 'address_components', 'name'],
              sessionToken: sessionTokenRef.current || undefined,
            },
            (place: any, status: string) => {
              resolve({ place, status })
            },
          )
        })

        if (
          detailsResult.status === win.google.maps.places.PlacesServiceStatus.OK &&
          detailsResult.place
        ) {
          const place = detailsResult.place
          const formattedAddress = place.formatted_address || place.name || suggestion.fullText
          let lat: number | undefined = undefined
          let lng: number | undefined = undefined

          if (place.geometry?.location) {
            lat =
              typeof place.geometry.location.lat === 'function'
                ? place.geometry.location.lat()
                : place.geometry.location.lat
            lng =
              typeof place.geometry.location.lng === 'function'
                ? place.geometry.location.lng()
                : place.geometry.location.lng
          }

          const parsed = place.address_components
            ? parseGoogleAddressComponents(place.address_components, formattedAddress)
            : undefined

          if (formattedAddress) {
            onChange(formattedAddress)
          }

          onAddressSelect({
            name: place.name || suggestion.mainText,
            address: formattedAddress,
            lat: lat ?? defaultLat,
            lng: lng ?? defaultLng,
            parsed,
          })
          resetSessionToken()
          return
        }
      }

      // Caso 4: OSM / Geocoding Fallback
      if (suggestion.lat && suggestion.lng) {
        const geo = await fallbackGeocodeAddress(suggestion.fullText, effectiveBias)
        onAddressSelect({
          name: suggestion.mainText,
          address: geo?.parsed?.formattedAddress || suggestion.fullText,
          lat: suggestion.lat,
          lng: suggestion.lng,
          parsed: geo?.parsed,
        })
        resetSessionToken()
        return
      }

      const geo = await fallbackGeocodeAddress(suggestion.fullText, effectiveBias)
      if (geo) {
        onAddressSelect({
          name: suggestion.mainText,
          address: geo.parsed?.formattedAddress || suggestion.fullText,
          lat: geo.lat,
          lng: geo.lng,
          parsed: geo.parsed,
        })
      } else {
        onAddressSelect({
          name: suggestion.mainText,
          address: suggestion.fullText,
          lat: defaultLat,
          lng: defaultLng,
        })
      }
      resetSessionToken()
    } catch (err) {
      console.warn('Erro ao resolver detalhes da sugestão:', err)
      onAddressSelect({
        name: suggestion.mainText,
        address: suggestion.fullText,
        lat: defaultLat,
        lng: defaultLng,
      })
      resetSessionToken()
    } finally {
      setIsResolvingPlace(false)
    }
  }

  // O botão "Buscar" APENAS consulta/atualiza as sugestões — NUNCA autopreenche sem escolha explícita do usuário
  const handleExplicitSearch = () => {
    const query = value.trim()
    if (!query) return
    const currentId = ++activeRequestIdRef.current
    fetchPredictions(query, currentId)
  }

  // Navegação pelo teclado no dropdown de sugestões (estilo CustomerSearchCombobox)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isOpen && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
          handleSelectSuggestion(suggestions[selectedIndex])
          return
        }
        // Se deu Enter sem focar item, atualiza a lista de opções
        handleExplicitSearch()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setIsOpen(false)
        return
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      handleExplicitSearch()
    }
  }

  return (
    <div
      ref={containerRef}
      translate="no"
      className={`notranslate relative flex items-center gap-1.5 ${className}`}
    >
      <div translate="no" className="notranslate relative flex-1">
        <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#FF6B35] pointer-events-none z-10" />
        <Input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          translate="no"
          onFocus={() => {
            triggerGeolocation()
            if (suggestions.length > 0 && !isSelectedRef.current) {
              setIsOpen(true)
            }
          }}
          placeholder={placeholder}
          className={`notranslate pl-8 pr-16 text-xs transition-colors focus-visible:ring-1 focus-visible:ring-blue-500 ${inputClassName}`}
          autoComplete="off"
          data-form-type="other"
          data-lpignore="true"
          spellCheck={false}
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
        />

        {/* Indicadores de estado na direita do input */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {isLoadingSuggestions && (
            <span title="Buscando opções de endereço...">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
            </span>
          )}
          {isResolvingPlace && (
            <div className="flex items-center gap-1 text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded font-medium dark:bg-blue-950/60 dark:text-blue-300">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Preenchendo...</span>
            </div>
          )}
          {value && !isLoadingSuggestions && !isResolvingPlace && (
            <button
              type="button"
              onClick={() => {
                onChange('')
                setSuggestions([])
                setIsOpen(false)
                setEmptyMessage(null)
                inputRef.current?.focus()
              }}
              className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              title="Limpar busca"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Dropdown de sugestões estruturadas */}
        {isOpen && (suggestions.length > 0 || emptyMessage) && (
          <div
            translate="no"
            className={`notranslate absolute left-0 right-0 top-full mt-1.5 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 text-xs shadow-2xl z-50 dark:border-slate-800 dark:bg-slate-900 ${dropdownClassName}`}
          >
            {/* Header explicativo do dropdown */}
            {suggestions.length > 0 && (
              <div
                translate="no"
                className="notranslate flex items-center justify-between px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-800"
              >
                <span>Escolha o endereço correto:</span>
                <span className="text-slate-400 font-normal normal-case">
                  {suggestions.length} {suggestions.length === 1 ? 'opção' : 'opções'}
                </span>
              </div>
            )}

            {/* Lista de sugestões com navegação por teclado e clique */}
            {suggestions.length > 0 && (
              <ul
                ref={listRef}
                role="listbox"
                translate="no"
                className="notranslate divide-y divide-slate-100 dark:divide-slate-800"
              >
                {suggestions.map((suggestion, idx) => {
                  const isSelected = idx === selectedIndex
                  return (
                    <li
                      key={`${suggestion.placeId}-${idx}`}
                      data-index={idx}
                      role="option"
                      translate="no"
                      aria-selected={isSelected}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        handleSelectSuggestion(suggestion)
                      }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={`notranslate flex items-start gap-2.5 px-3 py-2.5 cursor-pointer rounded-lg transition-colors ${
                        isSelected
                          ? 'bg-blue-50 text-blue-900 dark:bg-blue-950/60 dark:text-blue-100 ring-1 ring-blue-300 dark:ring-blue-800'
                          : 'text-slate-800 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/80'
                      }`}
                    >
                      <div className="shrink-0 mt-0.5">
                        <div
                          className={`w-6 h-6 rounded-md flex items-center justify-center ${
                            isSelected
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                          }`}
                        >
                          <Building2 className="h-3.5 w-3.5" />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-xs leading-snug">
                          <HighlightMatch text={suggestion.mainText} query={value} />
                        </p>
                        {suggestion.secondaryText && (
                          <p
                            translate="no"
                            className="notranslate text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-tight truncate"
                          >
                            {suggestion.secondaryText}
                          </p>
                        )}
                      </div>
                      {isSelected && (
                        <div className="shrink-0 mt-1">
                          <Check className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}

            {/* Estado vazio amigável quando nada é encontrado */}
            {!isLoadingSuggestions && suggestions.length === 0 && emptyMessage && (
              <div className="flex items-start gap-2.5 p-3 text-slate-600 dark:text-slate-400 bg-amber-50/60 dark:bg-amber-950/20 rounded-lg border border-amber-200/60 dark:border-amber-900/40">
                <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs">
                  <p className="font-medium text-slate-800 dark:text-slate-200">{emptyMessage}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Dica: informe o nome da rua junto com o bairro, cidade ou digite o CEP com 8
                    dígitos para preencher os campos.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Botão Buscar: APENAS busca/atualiza sugestões, sem preencher nada direto */}
      {showSearchButton && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isLoadingSuggestions || isResolvingPlace || !value.trim()}
          onClick={handleExplicitSearch}
          className={`h-9 px-3 text-xs font-semibold gap-1 whitespace-nowrap bg-white hover:bg-slate-100 dark:bg-slate-800 shrink-0 ${buttonClassName}`}
          title="Buscar opções de endereço para escolher"
        >
          {isLoadingSuggestions ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Search className="h-3.5 w-3.5" />
          )}
          Buscar
        </Button>
      )}
    </div>
  )
}

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
import { MapPin, Search, Loader2, Building2 } from 'lucide-react'

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
  biasCoordinates?: BiasCoordinates | null
  showSearchButton?: boolean
}

// Cache de geolocalização do usuário em memória na sessão (executado uma única vez por sessão do app)
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
          // Permissão negada ou erro de timeout; resolve silenciosamente com null sem travar a UI
          resolve(null)
        },
        {
          enableHighAccuracy: false,
          timeout: 7000,
          maximumAge: 10 * 60 * 1000, // aceita posição de até 10 minutos
        },
      )
    } catch {
      resolve(null)
    }
  })

  return userPositionPromise
}

interface PlaceSuggestion {
  placeId: string
  mainText: string
  secondaryText: string
  fullText: string
}

export const BaseAddressAutocomplete: React.FC<BaseAddressAutocompleteProps> = ({
  value,
  onChange,
  onAddressSelect,
  placeholder = 'Buscar endereço da base no Maps (Rua, Número, Bairro, Cidade)...',
  className = '',
  inputClassName = '',
  buttonClassName = '',
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

  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false)
  const [isResolvingPlace, setIsResolvingPlace] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState<number>(-1)
  const [isManualSearching, setIsManualSearching] = useState(false)
  const [userCoords, setUserCoords] = useState<BiasCoordinates | null>(cachedUserPosition)
  const userCoordsRef = useRef<BiasCoordinates | null>(cachedUserPosition)

  // Carregar geolocalização do usuário de forma silenciosa e não-bloqueante uma única vez por sessão
  useEffect(() => {
    getUserGeolocation().then((coords) => {
      if (coords) {
        userCoordsRef.current = coords
        setUserCoords(coords)
      }
    })
  }, [])

  // Determinar a coordenada de referência atual (usuário GPS > base de saída recebida via prop)
  const activeBias =
    userCoordsRef.current || userCoords || cachedUserPosition || biasCoordinates || null
  // Pre-carregar Google Maps Script silenciosamente
  useEffect(() => {
    loadGoogleMapsScript().catch(() => {
      // Ignorar se falhar; os fallbacks cuidarão da busca
    })
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

  // Função para buscar predições programáticas (com Google AutocompleteService ou fallback)
  const fetchPredictions = useCallback(
    async (queryText: string, requestId: number) => {
      const trimmed = queryText.trim()
      // Não buscar se for muito curto ou se for URL
      if (trimmed.length < 3 || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        if (requestId === activeRequestIdRef.current) {
          setSuggestions([])
          setIsOpen(false)
          setIsLoadingSuggestions(false)
        }
        return
      }

      setIsLoadingSuggestions(true)

      try {
        const mapsLoaded = await loadGoogleMapsScript()
        const win = window as unknown as { google?: any }

        // 1. Tentar AutocompleteService nativo da API JS
        if (
          mapsLoaded &&
          !isGoogleMapsAuthError() &&
          win.google?.maps?.places?.AutocompleteService
        ) {
          const service = new win.google.maps.places.AutocompleteService()

          // Montar requisição com restrição de país e enviesamento por localização se disponível
          const requestOptions: any = {
            input: trimmed,
            componentRestrictions: { country: 'br' },
          }

          const currentBias =
            userCoordsRef.current || userCoords || cachedUserPosition || biasCoordinates
          if (
            currentBias &&
            typeof currentBias.lat === 'number' &&
            typeof currentBias.lng === 'number'
          ) {
            if (win.google.maps.LatLng) {
              requestOptions.location = new win.google.maps.LatLng(currentBias.lat, currentBias.lng)
            } else {
              requestOptions.location = { lat: currentBias.lat, lng: currentBias.lng }
            }
            // Raio de 50.000m (50km) para priorizar a região metropolitana do usuário/base (ex: RJ)
            requestOptions.radius = 50000
          }

          service.getPlacePredictions(requestOptions, (predictions: any[], status: string) => {
            if (requestId !== activeRequestIdRef.current) return
            setIsLoadingSuggestions(false)

            if (
              status === win.google.maps.places.PlacesServiceStatus.OK &&
              Array.isArray(predictions) &&
              predictions.length > 0
            ) {
              const items: PlaceSuggestion[] = predictions.map((p) => ({
                placeId: p.place_id,
                mainText: p.structured_formatting?.main_text || p.description,
                secondaryText: p.structured_formatting?.secondary_text || '',
                fullText: p.description,
              }))
              setSuggestions(items)
              setIsOpen(true)
              setSelectedIndex(-1)
            } else {
              setSuggestions([])
              setIsOpen(false)
            }
          })
          return
        }

        // 2. Se o Google Maps não estiver disponível ou autenticado, usar Nominatim OpenStreetMap como busca preditiva de endereços no Brasil
        // Se houver coordenadas de bias (GPS ou base de saída), adiciona viewbox para priorizar a região (bounded=0 apenas enviesa os resultados)
        let nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=br&limit=5&q=${encodeURIComponent(
          trimmed,
        )}`

        const currentBias =
          userCoordsRef.current || userCoords || cachedUserPosition || biasCoordinates
        if (
          currentBias &&
          typeof currentBias.lat === 'number' &&
          typeof currentBias.lng === 'number'
        ) {
          // Caixa de ~0.45 graus em torno da coordenada (~50km)
          const delta = 0.45
          const minLon = (currentBias.lng - delta).toFixed(5)
          const maxLon = (currentBias.lng + delta).toFixed(5)
          const minLat = (currentBias.lat - delta).toFixed(5)
          const maxLat = (currentBias.lat + delta).toFixed(5)
          nominatimUrl += `&viewbox=${minLon},${maxLat},${maxLon},${minLat}&bounded=0`
        }

        // Cancelar requisição em voo anterior
        if (activeAbortControllerRef.current) {
          activeAbortControllerRef.current.abort()
        }
        const controller = new AbortController()
        activeAbortControllerRef.current = controller
        const timeoutTimer = setTimeout(() => controller.abort(), 4500)

        const res = await fetch(nominatimUrl, {
          signal: controller.signal,
          headers: {
            'Accept-Language': 'pt-BR,pt;q=0.9',
          },
        }).finally(() => {
          clearTimeout(timeoutTimer)
        })

        if (requestId !== activeRequestIdRef.current) return

        if (res.ok) {
          const data = await res.json()
          if (Array.isArray(data) && data.length > 0) {
            const items: PlaceSuggestion[] = data.map((item: any) => {
              const displayName: string = item.display_name || ''
              const parts = displayName.split(', ')
              const main = parts[0] || displayName
              const secondary = parts.slice(1, 4).join(', ')
              return {
                placeId: `osm_${item.osm_type || 'node'}_${item.osm_id || Math.random()}`,
                mainText: main,
                secondaryText: secondary,
                fullText: displayName,
              }
            })
            setSuggestions(items)
            setIsOpen(true)
            setSelectedIndex(-1)
          } else {
            setSuggestions([])
            setIsOpen(false)
          }
        } else {
          setSuggestions([])
          setIsOpen(false)
        }
      } catch (err) {
        if (requestId === activeRequestIdRef.current) {
          setSuggestions([])
          setIsOpen(false)
        }
      } finally {
        if (requestId === activeRequestIdRef.current) {
          setIsLoadingSuggestions(false)
        }
      }
    },
    [activeBias],
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
      return
    }

    debounceTimerRef.current = setTimeout(() => {
      fetchPredictions(text, currentId)
    }, 300)
  }

  // Resolver detalhes do Place quando uma sugestão é selecionada
  const handleSelectSuggestion = async (suggestion: PlaceSuggestion) => {
    isSelectedRef.current = true
    setIsOpen(false)
    setSuggestions([])
    setIsResolvingPlace(true)

    // Atualiza texto visível para endereço selecionado
    onChange(suggestion.fullText)

    try {
      const mapsLoaded = await loadGoogleMapsScript()
      const win = window as unknown as { google?: any }

      // Se for um placeId do Google e PlacesService estiver disponível
      if (
        mapsLoaded &&
        !isGoogleMapsAuthError() &&
        !suggestion.placeId.startsWith('osm_') &&
        win.google?.maps?.places?.PlacesService
      ) {
        const dummyDiv = document.createElement('div')
        const service = new win.google.maps.places.PlacesService(dummyDiv)

        service.getDetails(
          {
            placeId: suggestion.placeId,
            fields: ['formatted_address', 'geometry', 'address_components', 'name'],
          },
          (place: any, status: string) => {
            setIsResolvingPlace(false)
            if (status === win.google.maps.places.PlacesServiceStatus.OK && place) {
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
                ? parseGoogleAddressComponents(place.address_components)
                : undefined

              if (formattedAddress) {
                onChange(formattedAddress)
              }

              // Coordenadas default calibradas com o bias ativo (GPS ou base de saída) se lat/lng vier indefinido
              const effectiveBias =
                userCoordsRef.current || userCoords || cachedUserPosition || biasCoordinates
              const defaultLat = effectiveBias?.lat ?? -22.906847
              const defaultLng = effectiveBias?.lng ?? -43.172896

              onAddressSelect({
                name: place.name || suggestion.mainText,
                address: formattedAddress,
                lat: lat ?? defaultLat,
                lng: lng ?? defaultLng,
                parsed,
              })
              return
            }

            // Fallback caso getDetails falhe
            const effectiveBias =
              userCoordsRef.current || userCoords || cachedUserPosition || biasCoordinates
            const fallbackDefaultLat = effectiveBias?.lat ?? -22.906847
            const fallbackDefaultLng = effectiveBias?.lng ?? -43.172896

            fallbackGeocodeAddress(suggestion.fullText, activeBias).then((geo) => {
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
                  lat: fallbackDefaultLat,
                  lng: fallbackDefaultLng,
                })
              }
            })
          },
        )
        return
      }

      // Se for do OpenStreetMap ou Google Maps não disponível
      const geo = await fallbackGeocodeAddress(suggestion.fullText)
      const effectiveBias =
        userCoordsRef.current || userCoords || cachedUserPosition || biasCoordinates
      const defaultLat = effectiveBias?.lat ?? -22.906847
      const defaultLng = effectiveBias?.lng ?? -43.172896
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
    } catch (err) {
      console.warn('Erro ao resolver detalhes do endereço:', err)
      const effectiveBias =
        userCoordsRef.current || userCoords || cachedUserPosition || biasCoordinates
      const defaultLat = effectiveBias?.lat ?? -22.906847
      const defaultLng = effectiveBias?.lng ?? -43.172896
      onAddressSelect({
        name: suggestion.mainText,
        address: suggestion.fullText,
        lat: defaultLat,
        lng: defaultLng,
      })
    } finally {
      setIsResolvingPlace(false)
    }
  }

  // Fallback geocode via ViaCEP / OpenStreetMap quando Google Maps Places não estiver disponível ou usuário pressionar Enter/botão
  const handleManualSearch = async () => {
    const query = value.trim()
    if (!query) return

    setIsOpen(false)
    setIsManualSearching(true)
    const effectiveBias =
      userCoordsRef.current || userCoords || cachedUserPosition || biasCoordinates
    const defaultLat = effectiveBias?.lat ?? -22.906847
    const defaultLng = effectiveBias?.lng ?? -43.172896

    // Cancelar requisição de predição em voo se houver
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort()
    }
    const manualController = new AbortController()
    activeAbortControllerRef.current = manualController

    try {
      // 1. Tentar CEP se houver padrão de CEP ou 8 dígitos
      const cepDigits = query.replace(/\D/g, '')
      const cepMatch = query.match(/\d{5}-?\d{3}/) || (cepDigits.length === 8 ? [cepDigits] : null)
      if (cepMatch) {
        const cepResult = await lookupViaCep(cepMatch[0], {
          signal: manualController.signal,
          timeoutMs: 4500,
        })
        if (cepResult) {
          const formatted =
            cepResult.formattedAddress ||
            `${cepResult.street || ''}, ${cepResult.neighborhood || ''}, ${cepResult.city || ''} - ${cepResult.state || ''}`.replace(
              /^,\s*/,
              '',
            )
          onChange(formatted || query)

          // Tentar geocodificar o endereço do CEP para obter lat/lng precisas
          const fullQuery = `${cepResult.street || ''}, ${cepResult.neighborhood || ''}, ${cepResult.city || ''} - ${cepResult.state || ''}, Brasil`
          const geoCep = await fallbackGeocodeAddress(fullQuery, activeBias, {
            signal: manualController.signal,
            timeoutMs: 4500,
          })

          onAddressSelect({
            address: formatted || query,
            lat: geoCep?.lat ?? defaultLat,
            lng: geoCep?.lng ?? defaultLng,
            parsed: geoCep?.parsed || cepResult,
          })
          setIsManualSearching(false)
          return
        }
      }

      // 2. Geocodificação OpenStreetMap / Nominatim fallback
      const geo = await fallbackGeocodeAddress(query, activeBias, {
        signal: manualController.signal,
        timeoutMs: 5000,
      })
      if (geo) {
        onAddressSelect({
          address: geo.parsed?.formattedAddress || query,
          lat: geo.lat,
          lng: geo.lng,
          parsed: geo.parsed,
        })
      } else {
        onAddressSelect({
          address: query,
          lat: defaultLat,
          lng: defaultLng,
        })
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.warn('Manual address search error:', err)
      }
    } finally {
      setIsManualSearching(false)
    }
  }

  // Suporte à navegação pelo teclado no dropdown
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
        handleManualSearch()
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
      handleManualSearch()
    }
  }

  const isBusy = isManualSearching || isResolvingPlace

  return (
    <div ref={containerRef} className={`relative flex items-center gap-1.5 ${className}`}>
      <div className="relative flex-1">
        <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#FF6B35] pointer-events-none z-10" />
        <Input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0 && !isSelectedRef.current) {
              setIsOpen(true)
            }
          }}
          placeholder={placeholder}
          className={`pl-8 ${isLoadingSuggestions ? 'pr-8' : ''} text-xs ${inputClassName}`}
          autoComplete="off"
          data-form-type="other"
          data-lpignore="true"
          spellCheck={false}
        />

        {isLoadingSuggestions && (
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
          </div>
        )}

        {/* Dropdown de sugestões customizado */}
        {isOpen && suggestions.length > 0 && (
          <ul
            ref={listRef}
            className="absolute left-0 right-0 top-full mt-1 max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-xs shadow-2xl z-50 divide-y divide-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:divide-slate-800"
          >
            {suggestions.map((suggestion, idx) => {
              const isSelected = idx === selectedIndex
              return (
                <li
                  key={`${suggestion.placeId}-${idx}`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    handleSelectSuggestion(suggestion)
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-start gap-2.5 px-3 py-2 cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-blue-50 text-blue-900 dark:bg-orange-500/20 dark:text-white'
                      : 'text-slate-800 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'
                  }`}
                >
                  <Building2 className="h-3.5 w-3.5 text-blue-600 dark:text-orange-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {suggestion.mainText}
                    </p>
                    {suggestion.secondaryText && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {suggestion.secondaryText}
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {showSearchButton && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isBusy || !value.trim()}
          onClick={handleManualSearch}
          className={`h-9 px-3 text-xs font-semibold gap-1 whitespace-nowrap bg-white hover:bg-slate-100 dark:bg-slate-800 shrink-0 ${buttonClassName}`}
          title="Buscar endereço e preencher dados"
        >
          {isBusy ? (
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

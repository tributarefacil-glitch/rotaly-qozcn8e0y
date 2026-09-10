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

interface BaseAddressAutocompleteProps {
  value: string
  onChange: (value: string) => void
  onAddressSelect: (result: BaseAddressResult) => void
  placeholder?: string
  className?: string
  inputClassName?: string
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
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeRequestIdRef = useRef<number>(0)
  const isSelectedRef = useRef<boolean>(false)

  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false)
  const [isResolvingPlace, setIsResolvingPlace] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState<number>(-1)
  const [isManualSearching, setIsManualSearching] = useState(false)

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
  const fetchPredictions = useCallback(async (queryText: string, requestId: number) => {
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
      if (mapsLoaded && !isGoogleMapsAuthError() && win.google?.maps?.places?.AutocompleteService) {
        const service = new win.google.maps.places.AutocompleteService()

        service.getPlacePredictions(
          {
            input: trimmed,
            componentRestrictions: { country: 'br' },
          },
          (predictions: any[], status: string) => {
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
          },
        )
        return
      }

      // 2. Se o Google Maps não estiver disponível ou autenticado, usar Nominatim OpenStreetMap como busca preditiva de endereços no Brasil
      const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=br&limit=5&q=${encodeURIComponent(
        trimmed,
      )}`
      const res = await fetch(nominatimUrl, {
        headers: {
          'Accept-Language': 'pt-BR,pt;q=0.9',
        },
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
  }, [])

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

              onAddressSelect({
                name: place.name || suggestion.mainText,
                address: formattedAddress,
                lat: lat ?? -23.565734,
                lng: lng ?? -46.651257,
                parsed,
              })
              return
            }

            // Fallback caso getDetails falhe
            fallbackGeocodeAddress(suggestion.fullText).then((geo) => {
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
                  lat: -23.565734,
                  lng: -46.651257,
                })
              }
            })
          },
        )
        return
      }

      // Se for do OpenStreetMap ou Google Maps não disponível
      const geo = await fallbackGeocodeAddress(suggestion.fullText)
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
          lat: -23.565734,
          lng: -46.651257,
        })
      }
    } catch (err) {
      console.warn('Erro ao resolver detalhes do endereço:', err)
      onAddressSelect({
        name: suggestion.mainText,
        address: suggestion.fullText,
        lat: -23.565734,
        lng: -46.651257,
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
    try {
      // 1. Tentar CEP se houver padrão de CEP
      const cepMatch = query.match(/\d{5}-?\d{3}/)
      if (cepMatch) {
        const cepResult = await lookupViaCep(cepMatch[0])
        if (cepResult) {
          const formatted =
            cepResult.formattedAddress ||
            `${cepResult.street || ''}, ${cepResult.neighborhood || ''}, ${cepResult.city || ''} - ${cepResult.state || ''}`.replace(
              /^,\s*/,
              '',
            )
          onChange(formatted || query)
          onAddressSelect({
            address: formatted || query,
            lat: -23.565734,
            lng: -46.651257,
            parsed: cepResult,
          })
          setIsManualSearching(false)
          return
        }
      }

      // 2. Geocodificação OpenStreetMap / Nominatim fallback
      const geo = await fallbackGeocodeAddress(query)
      if (geo) {
        onAddressSelect({
          address: geo.parsed?.formattedAddress || query,
          lat: geo.lat,
          lng: geo.lng,
          parsed: geo.parsed,
        })
      }
    } catch (err) {
      console.warn('Manual address search error:', err)
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
          className={`pl-8 text-xs ${inputClassName}`}
          autoComplete="off"
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
            className="absolute left-0 right-0 top-full mt-1 max-h-60 overflow-y-auto rounded-md border border-slate-700 bg-slate-900 py-1 text-xs shadow-xl z-50 divide-y divide-slate-800"
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
                    isSelected ? 'bg-orange-500/20 text-white' : 'text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  <Building2 className="h-3.5 w-3.5 text-orange-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-100 truncate">{suggestion.mainText}</p>
                    {suggestion.secondaryText && (
                      <p className="text-[11px] text-slate-400 truncate">
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

      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={isBusy || !value.trim()}
        onClick={handleManualSearch}
        className="h-8 px-2.5 text-xs text-slate-400 hover:text-white shrink-0"
        title="Buscar coordenadas no mapa"
      >
        {isBusy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Search className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  )
}

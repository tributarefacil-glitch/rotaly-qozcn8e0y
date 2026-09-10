import React, { useEffect, useRef, useState } from 'react'
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
import { MapPin, Search, Loader2 } from 'lucide-react'

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

export const BaseAddressAutocomplete: React.FC<BaseAddressAutocompleteProps> = ({
  value,
  onChange,
  onAddressSelect,
  placeholder = 'Buscar endereço da base no Maps (Rua, Número, Bairro, Cidade)...',
  className = '',
  inputClassName = '',
}) => {
  const inputRef = useRef<HTMLInputElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const autocompleteRef = useRef<any>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [mapsReady, setMapsReady] = useState(false)

  // Inicializar Google Maps Autocomplete
  useEffect(() => {
    let active = true

    loadGoogleMapsScript().then((loaded) => {
      if (!active || !loaded || isGoogleMapsAuthError()) return

      const win = window as unknown as { google?: any }
      if (!win.google?.maps?.places?.Autocomplete || !inputRef.current) return

      try {
        const autocomplete = new win.google.maps.places.Autocomplete(inputRef.current, {
          componentRestrictions: { country: 'br' },
          fields: ['formatted_address', 'geometry', 'address_components', 'name'],
          types: ['geocode', 'establishment'],
        })

        autocomplete.addListener('place_changed', () => {
          const place = autocomplete.getPlace()
          if (!place) return

          const formattedAddress = place.formatted_address || place.name || ''
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
            name: place.name,
            address: formattedAddress || value,
            lat: lat ?? -23.565734,
            lng: lng ?? -46.651257,
            parsed,
          })
        })

        autocompleteRef.current = autocomplete
        setMapsReady(true)
      } catch (err) {
        console.warn('Google Places Autocomplete setup failed for Base Address:', err)
      }
    })

    return () => {
      active = false
    }
  }, [])

  // Fallback geocode via ViaCEP / OpenStreetMap quando Google Maps Places não estiver disponível ou usuário pressionar Enter/botão
  const handleManualSearch = async () => {
    const query = value.trim()
    if (!query) return

    setIsSearching(true)
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
          setIsSearching(false)
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
      setIsSearching(false)
    }
  }

  return (
    <div className={`relative flex items-center gap-1.5 ${className}`}>
      <div className="relative flex-1">
        <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#FF6B35] pointer-events-none" />
        <Input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleManualSearch()
            }
          }}
          placeholder={placeholder}
          className={`pl-8 text-xs ${inputClassName}`}
        />
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={isSearching || !value.trim()}
        onClick={handleManualSearch}
        className="h-8 px-2.5 text-xs text-slate-400 hover:text-white shrink-0"
        title="Buscar coordenadas no mapa"
      >
        {isSearching ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Search className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  )
}

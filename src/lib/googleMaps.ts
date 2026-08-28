/**
 * Google Maps Script Loader & Address Resolution Utilities
 */

// Mapping of Brazilian state names and accents to official 2-letter UF codes
export const BRAZILIAN_STATE_MAP: Record<string, string> = {
  AC: 'AC',
  AL: 'AL',
  AP: 'AP',
  AM: 'AM',
  BA: 'BA',
  CE: 'CE',
  DF: 'DF',
  ES: 'ES',
  GO: 'GO',
  MA: 'MA',
  MT: 'MT',
  MS: 'MS',
  MG: 'MG',
  PA: 'PA',
  PB: 'PB',
  PR: 'PR',
  PE: 'PE',
  PI: 'PI',
  RJ: 'RJ',
  RN: 'RN',
  RS: 'RS',
  RO: 'RO',
  RR: 'RR',
  SC: 'SC',
  SP: 'SP',
  SE: 'SE',
  TO: 'TO',
  // Long names & Variations
  ACRE: 'AC',
  ALAGOAS: 'AL',
  AMAPA: 'AP',
  AMAPÁ: 'AP',
  AMAZONAS: 'AM',
  BAHIA: 'BA',
  CEARA: 'CE',
  CEARÁ: 'CE',
  'DISTRITO FEDERAL': 'DF',
  'ESPIRITO SANTO': 'ES',
  'ESPÍRITO SANTO': 'ES',
  GOIAS: 'GO',
  GOIÁS: 'GO',
  MARANHAO: 'MA',
  MARANHÃO: 'MA',
  'MATO GROSSO': 'MT',
  'MATO GROSSO DO SUL': 'MS',
  'MINAS GERAIS': 'MG',
  PARA: 'PA',
  PARÁ: 'PA',
  PARAIBA: 'PB',
  PARAÍBA: 'PB',
  PARANA: 'PR',
  PARANÁ: 'PR',
  PERNAMBUCO: 'PE',
  PIAUI: 'PI',
  PIAUÍ: 'PI',
  'RIO DE JANEIRO': 'RJ',
  'RIO GRANDE DO NORTE': 'RN',
  'RIO GRANDE DO SUL': 'RS',
  RONDONIA: 'RO',
  RONDÔNIA: 'RO',
  RORAIMA: 'RR',
  'SANTA CATARINA': 'SC',
  'SAO PAULO': 'SP',
  'SÃO PAULO': 'SP',
  SERGIPE: 'SE',
  TOCANTINS: 'TO',
}

export const BRAZILIAN_STATES = [
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

/**
 * Normalizes state input (long name, code with spaces, etc.) to valid 2-letter UF
 */
export function normalizeBrazilianUF(rawState?: string): string {
  if (!rawState) return ''
  const cleaned = rawState.trim().toUpperCase()
  if (BRAZILIAN_STATE_MAP[cleaned]) {
    return BRAZILIAN_STATE_MAP[cleaned]
  }
  // Try removing accents
  const noAccents = cleaned.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (BRAZILIAN_STATE_MAP[noAccents]) {
    return BRAZILIAN_STATE_MAP[noAccents]
  }
  return ''
}

export interface ParsedAddress {
  street: string
  number: string
  streetAndNumber: string
  neighborhood: string
  city: string
  state: string
  postalCode: string
  formattedAddress?: string
  lat?: number
  lng?: number
}

/**
 * Robust extractor from Google Address Components array
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseGoogleAddressComponents(
  components: any[],
  fallbackFormatted?: string,
): ParsedAddress {
  let streetName = ''
  let streetNumber = ''
  let neighborhoodName = ''
  let cityName = ''
  let stateCode = ''
  let postal = ''

  if (Array.isArray(components)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    components.forEach((comp: any) => {
      const types: string[] = comp?.types || []
      const longName = (comp?.long_name || '').trim()
      const shortName = (comp?.short_name || '').trim()

      if (types.includes('route')) {
        streetName = longName
      }
      if (types.includes('street_number')) {
        streetNumber = longName
      }
      if (
        types.includes('sublocality') ||
        types.includes('sublocality_level_1') ||
        types.includes('sublocality_level_2') ||
        types.includes('neighborhood')
      ) {
        if (!neighborhoodName) {
          neighborhoodName = longName
        }
      }
      if (
        types.includes('administrative_area_level_2') ||
        types.includes('locality') ||
        types.includes('postal_town')
      ) {
        if (!cityName) {
          cityName = longName
        }
      }
      if (types.includes('administrative_area_level_1')) {
        stateCode = normalizeBrazilianUF(shortName) || normalizeBrazilianUF(longName) || shortName
      }
      if (types.includes('postal_code')) {
        postal = longName
      }
    })
  }

  // If streetNumber was not in components but fallbackFormatted has it (e.g. "Rua Tal, 123 - ...")
  if (!streetNumber && fallbackFormatted) {
    // Try to extract number after comma or space: e.g. "Rua ABC, 123", "Av. Brasil 450", "R. X, 10 B"
    const numMatch = fallbackFormatted.match(
      /(?:,\s*|\s+nº\s*|\s+n°\s*|\s+num\s*|\s+N\s*)(\d+[\w\s\-/]*?)(?=\s*[,-]|\s*$)/i,
    )
    if (numMatch && numMatch[1]) {
      const extractedNum = numMatch[1].trim()
      // Only keep if it looks like a number
      if (/^\d+/.test(extractedNum)) {
        streetNumber = extractedNum
      }
    }
  }

  let streetAndNumber = ''
  if (streetName) {
    streetAndNumber = streetNumber ? `${streetName}, ${streetNumber}` : streetName
  } else if (fallbackFormatted) {
    // Usually formatted as "Rua Exemplo, 123 - Bairro, Cidade - UF, 00000-000, Brazil"
    const firstSegment = fallbackFormatted.split('-')[0] || ''
    const parts = firstSegment.split(',')
    if (parts.length >= 2) {
      streetAndNumber = `${parts[0].trim()}, ${parts[1].trim()}`
    } else {
      streetAndNumber = (parts[0] || '').trim()
    }
  }

  const normalizedState = normalizeBrazilianUF(stateCode)

  return {
    street: streetName,
    number: streetNumber,
    streetAndNumber,
    neighborhood: neighborhoodName,
    city: cityName,
    state: normalizedState,
    postalCode: postal,
    formattedAddress: fallbackFormatted,
  }
}

// Global script loading state and listeners
let googleMapsLoadingPromise: Promise<boolean> | null = null
let googleMapsAuthError = false
const authErrorListeners: Array<(errorMsg: string) => void> = []

export function isGoogleMapsAuthError(): boolean {
  return googleMapsAuthError
}

export function onGoogleMapsAuthError(cb: (errorMsg: string) => void) {
  authErrorListeners.push(cb)
  if (googleMapsAuthError) {
    cb(
      'Google Maps API Key falhou na autenticação (BillingNotEnabled, InvalidKey ou QuotaExceeded).',
    )
  }
  return () => {
    const idx = authErrorListeners.indexOf(cb)
    if (idx !== -1) authErrorListeners.splice(idx, 1)
  }
}

/**
 * Loads the Google Maps JavaScript API with libraries 'places' and 'geometry'.
 * Registers window.gm_authFailure handler to detect billing / key issues cleanly.
 */
export function loadGoogleMapsScript(apiKey?: string): Promise<boolean> {
  const envKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim()
  const keyToUse = apiKey?.trim() || envKey || 'AIzaSyDKQXAMUR4ChVy8lKw61HgjDlHuOt3Ea94'

  // Register gm_authFailure hook globally if not yet registered
  if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any
    if (!win._gm_authFailure_registered) {
      const originalAuthFailure = win.gm_authFailure
      win.gm_authFailure = () => {
        googleMapsAuthError = true
        console.warn(
          '[Google Maps Alert] Falha na autenticação da chave do Google Maps (gm_authFailure). ' +
            'Modo de mapa interativo inteligente ativado com fallback de CEP/Nominatim.',
        )
        authErrorListeners.forEach((fn) =>
          fn(
            'Falha de autenticação do Google Maps (verifique billing/restrição de domínio da chave no Google Cloud).',
          ),
        )
        if (typeof originalAuthFailure === 'function') {
          originalAuthFailure()
        }
      }
      win._gm_authFailure_registered = true
    }
  }

  // If already loaded
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof window !== 'undefined' && (window as any).google?.maps?.places) {
    return Promise.resolve(!googleMapsAuthError)
  }

  if (googleMapsLoadingPromise) {
    return googleMapsLoadingPromise
  }

  googleMapsLoadingPromise = new Promise<boolean>((resolve) => {
    if (typeof window === 'undefined') {
      resolve(false)
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).google?.maps?.places) {
      resolve(!googleMapsAuthError)
      return
    }

    const existingScript = document.getElementById('google-maps-script') as HTMLScriptElement | null
    if (existingScript) {
      // Check if it already loaded or poll for completion
      const checkInterval = setInterval(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((window as any).google?.maps?.places) {
          clearInterval(checkInterval)
          resolve(!googleMapsAuthError)
        }
      }, 200)
      setTimeout(() => {
        clearInterval(checkInterval)
        resolve(false)
      }, 8000)
      return
    }

    const script = document.createElement('script')
    script.id = 'google-maps-script'
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(keyToUse)}&libraries=places,geometry&language=pt-BR&region=BR`
    script.async = true
    script.defer = true

    script.onload = () => {
      // Give a tiny tick for google.maps and sub-modules to finish setup
      setTimeout(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((window as any).google?.maps) {
          resolve(!googleMapsAuthError)
        } else {
          resolve(false)
        }
      }, 50)
    }

    script.onerror = (err) => {
      console.warn('[Google Maps] Script tag loading error:', err)
      resolve(false)
    }

    document.head.appendChild(script)
  })

  return googleMapsLoadingPromise
}

/**
 * Searches address by Brazilian CEP using ViaCEP (free Brazilian Postal API fallback)
 */
export async function lookupViaCep(cep: string): Promise<ParsedAddress | null> {
  const cleanCep = cep.replace(/\D/g, '')
  if (cleanCep.length !== 8) return null

  try {
    const res = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`)
    if (!res.ok) return null
    const data = await res.json()
    if (data.erro) return null

    const uf = normalizeBrazilianUF(data.uf)

    return {
      street: data.logradouro || '',
      number: '',
      streetAndNumber: data.logradouro || '',
      neighborhood: data.bairro || '',
      city: data.localidade || '',
      state: uf || data.uf || '',
      postalCode: data.cep || cleanCep,
      formattedAddress: `${data.logradouro || ''}, ${data.bairro || ''}, ${data.localidade || ''} - ${data.uf || ''}, ${data.cep || ''}`,
    }
  } catch (err) {
    console.warn('ViaCEP lookup failed:', err)
    return null
  }
}

/**
 * Fallback Geocoding with OpenStreetMap Nominatim (when Google Maps Geocoder fails or billing disabled)
 */
export async function fallbackGeocodeAddress(
  query: string,
): Promise<{ lat: number; lng: number; parsed: ParsedAddress } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=br&limit=1&q=${encodeURIComponent(
      query,
    )}`
    const res = await fetch(url, {
      headers: {
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!Array.isArray(data) || data.length === 0) return null

    const item = data[0]
    const lat = parseFloat(item.lat)
    const lng = parseFloat(item.lon)
    const addr = item.address || {}

    const street = addr.road || addr.street || addr.pedestrian || addr.footway || ''
    let num = addr.house_number || ''
    if (!num) {
      const queryNumMatch = query.match(/,\s*(\d+)/) || query.match(/\s+(\d+)\s*(?:,|$)/)
      if (queryNumMatch) num = queryNumMatch[1]
    }
    const streetAndNumber = street
      ? num
        ? `${street}, ${num}`
        : street
      : query.split(',')[0] || ''
    const neighborhood =
      addr.suburb || addr.neighbourhood || addr.city_district || addr.subdistrict || ''
    const city = addr.city || addr.town || addr.municipality || addr.village || addr.county || ''
    const state = normalizeBrazilianUF(
      addr.state || addr['ISO3166-2-lvl4']?.replace('BR-', '') || '',
    )
    const postalCode = addr.postcode || ''

    return {
      lat,
      lng,
      parsed: {
        street,
        number: num,
        streetAndNumber,
        neighborhood,
        city,
        state,
        postalCode,
        formattedAddress: item.display_name,
      },
    }
  } catch (e) {
    console.warn('Fallback Nominatim geocode error:', e)
    return null
  }
}

/**
 * Fallback Reverse Geocoding with OpenStreetMap Nominatim
 */
export async function fallbackReverseGeocode(
  lat: number,
  lng: number,
): Promise<ParsedAddress | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&lat=${lat}&lon=${lng}`
    const res = await fetch(url, {
      headers: {
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!data || !data.address) return null

    const addr = data.address
    const street = addr.road || addr.street || addr.pedestrian || addr.footway || ''
    const num = addr.house_number || ''
    const streetAndNumber = street ? (num ? `${street}, ${num}` : street) : ''
    const neighborhood =
      addr.suburb || addr.neighbourhood || addr.city_district || addr.subdistrict || ''
    const city = addr.city || addr.town || addr.municipality || addr.village || addr.county || ''
    const state = normalizeBrazilianUF(
      addr.state || addr['ISO3166-2-lvl4']?.replace('BR-', '') || '',
    )
    const postalCode = addr.postcode || ''

    return {
      street,
      number: num,
      streetAndNumber,
      neighborhood,
      city,
      state,
      postalCode,
      formattedAddress: data.display_name,
    }
  } catch (e) {
    console.warn('Fallback Nominatim reverse geocode error:', e)
    return null
  }
}

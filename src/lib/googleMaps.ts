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
  source?: 'google' | 'osm' | 'viacep'
}

/**
 * Converte coordenadas em graus, minutos e segundos (DMS) para graus decimais (DD).
 * Ex: 23°01'21.6"S -> -23.0226667
 */
export function dmsToDecimal(
  degrees: number,
  minutes: number,
  seconds: number,
  direction: string,
): number {
  let dd = degrees + minutes / 60 + seconds / 3600
  const dir = direction.toUpperCase()
  if (dir === 'S' || dir === 'W' || dir === 'O') {
    dd = -dd
  }
  return dd
}

/**
 * Extrai coordenadas geográficas de texto ou URLs (Google Maps, Waze, WhatsApp, DMS, coordenadas brutas).
 * Prioridade ABSOLUTA:
 * 1. Parâmetros !3d (lat) e !4d (lng) que marcam o PINO exato do Google Maps.
 * 2. Formato DMS (Graus/Minutos/Segundos) no path ou query (ex: 23°01'21.6"S 43°27'25.4"W).
 * 3. Parâmetros explícitos de busca/ponto: q=lat,lng, ll=lat,lng, loc:lat,lng, destination=lat,lng.
 * 4. URLs geo:lat,lng.
 * 5. URLs Waze (ll=lat,lng).
 * 6. Centro da visualização de tela do mapa (@lat,lng) — apenas quando não há pino fixado.
 * 7. Par lat/lng puro (ex: -23.0226746, -43.4570618).
 */
export function parseCoordinatesFromGoogleLink(
  rawText: string,
): { lat: number; lng: number; source?: string } | null {
  if (!rawText) return null
  let text = rawText.trim()
  if (!text) return null

  // Tenta decodificar URL caso contenha escapes (ex: %20, %22, %C2%B0)
  let decoded = text
  try {
    decoded = decodeURIComponent(text)
  } catch {
    decoded = text
  }

  // 1. Prioridade máxima: parâmetros exatos do PINO no Google Maps (!3d<lat>!4d<lng>)
  // Exemplo: data=!3m1!1e3!4m4!3m3!8m2!3d-23.0226746!4d-43.4570618
  const pinMatch =
    decoded.match(/!3d\s*([+-]?\d+(?:\.\d+)?)\s*!4d\s*([+-]?\d+(?:\.\d+)?)/) ||
    text.match(/!3d\s*([+-]?\d+(?:\.\d+)?)\s*!4d\s*([+-]?\d+(?:\.\d+)?)/)
  if (pinMatch) {
    const lat = parseFloat(pinMatch[1])
    const lng = parseFloat(pinMatch[2])
    if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng, source: 'google_pin_data' }
    }
  }

  // 2. Parâmetro invertido !4d... !3d... caso ocorra em alguma versão
  const pinInvertedMatch = decoded.match(/!4d\s*([+-]?\d+(?:\.\d+)?)\s*!3d\s*([+-]?\d+(?:\.\d+)?)/)
  if (pinInvertedMatch) {
    const lng = parseFloat(pinInvertedMatch[1])
    const lat = parseFloat(pinInvertedMatch[2])
    if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng, source: 'google_pin_data' }
    }
  }

  // 3. Formato DMS (Graus, Minutos e Segundos) comumente presente em URLs do Google Maps Place
  // Ex: 23°01'21.6"S+43°27'25.4"W ou 23°01'21.6"S 43°27'25.4"W
  const dmsRegex =
    /(\d{1,2})[°º\s]+(\d{1,2})['′\s]+(\d+(?:\.\d+)?)["″\s]*([NSEWOnsewo])[,\s+/]+(\d{1,3})[°º\s]+(\d{1,2})['′\s]+(\d+(?:\.\d+)?)["″\s]*([NSEWOnsewo])/
  const dmsMatch = decoded.match(dmsRegex)
  if (dmsMatch) {
    const lat = dmsToDecimal(
      parseFloat(dmsMatch[1]),
      parseFloat(dmsMatch[2]),
      parseFloat(dmsMatch[3]),
      dmsMatch[4],
    )
    const lng = dmsToDecimal(
      parseFloat(dmsMatch[5]),
      parseFloat(dmsMatch[6]),
      parseFloat(dmsMatch[7]),
      dmsMatch[8],
    )
    if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng, source: 'dms_place' }
    }
  }

  // 4. Parâmetros explícitos de consulta / ponto de destino / pino:
  // q=-23.022,-43.457 ou query= ou ll= ou destination= ou loc:lat,lng
  const queryParamRegex =
    /(?:[?&]|\b)(?:q|query|ll|loc|destination|daddr)=([+-]?\d+(?:\.\d+)?)[,\s%20]+([+-]?\d+(?:\.\d+)?)/i
  const qMatch = decoded.match(queryParamRegex) || text.match(queryParamRegex)
  if (qMatch) {
    const lat = parseFloat(qMatch[1])
    const lng = parseFloat(qMatch[2])
    if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng, source: 'query_param' }
    }
  }

  // 5. Geo URI: geo:-23.022,-43.457
  const geoMatch = decoded.match(/geo:\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)/i)
  if (geoMatch) {
    const lat = parseFloat(geoMatch[1])
    const lng = parseFloat(geoMatch[2])
    if (!isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0)) {
      return { lat, lng, source: 'geo_uri' }
    }
  }

  // 6. Waze URL: waze.com/ul?ll=-23.022,-43.457
  const wazeMatch = decoded.match(
    /waze\.com\/.*ll=([+-]?\d+(?:\.\d+)?)[,\s%20]+([+-]?\d+(?:\.\d+)?)/i,
  )
  if (wazeMatch) {
    const lat = parseFloat(wazeMatch[1])
    const lng = parseFloat(wazeMatch[2])
    if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng, source: 'waze' }
    }
  }

  // 7. Centro de visão do mapa (@lat,lng) — apenas quando o link não tem pino !3d/!4d
  // Ex: /@-23.0227634,-43.4595938,763m
  const centerMatch =
    decoded.match(/@\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)/) ||
    text.match(/@\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)/)
  if (centerMatch) {
    const lat = parseFloat(centerMatch[1])
    const lng = parseFloat(centerMatch[2])
    if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng, source: 'map_center' }
    }
  }

  // 8. Coordenadas brutas no formato decimal separado por vírgula ou espaço
  // Ex: "-23.0226746, -43.4570618" ou "-23.0226746 -43.4570618"
  const rawPairMatch = decoded.match(/([+-]?\d{1,2}\.\d+)[,\s]+([+-]?\d{1,3}\.\d+)/)
  if (rawPairMatch) {
    const lat = parseFloat(rawPairMatch[1])
    const lng = parseFloat(rawPairMatch[2])
    if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng, source: 'raw_coords' }
    }
  }

  return null
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
    source: 'google',
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
  const envKey = (
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GOOGLE_MAPS_API_KEY) ||
    (typeof window !== 'undefined' && (window as any).__VITE_GOOGLE_MAPS_API_KEY) ||
    ''
  ).trim()
  const keyToUse = apiKey?.trim() || envKey

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

  // If already marked as auth error
  if (googleMapsAuthError) {
    return Promise.resolve(false)
  }

  // If already loaded
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof window !== 'undefined' && (window as any).google?.maps) {
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
        if ((window as any).google?.maps) {
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

    if (!keyToUse) {
      // Sem chave configurada: resolver como false sem injetar script quebrado
      console.warn('[Google Maps] Nenhuma chave VITE_GOOGLE_MAPS_API_KEY fornecida.')
      resolve(false)
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
      }, 100)
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
export async function lookupViaCep(
  cep: string,
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<ParsedAddress | null> {
  const cleanCep = cep.replace(/\D/g, '')
  if (cleanCep.length !== 8) return null

  const timeoutMs = options?.timeoutMs ?? 5000
  const timeoutController = new AbortController()
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs)

  let combinedSignal: AbortSignal = timeoutController.signal
  if (options?.signal) {
    if (options.signal.aborted) {
      clearTimeout(timer)
      return null
    }
    // Listen to parent abort
    options.signal.addEventListener('abort', () => timeoutController.abort(), { once: true })
  }

  try {
    const res = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`, {
      signal: combinedSignal,
    })
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
  } catch (err: any) {
    if (err?.name !== 'AbortError') {
      console.warn('ViaCEP lookup failed:', err)
    }
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fallback Geocoding with OpenStreetMap Nominatim (when Google Maps Geocoder fails or billing disabled)
 */
/**
 * Geocodificação de endereços brutos OpenStreetMap Nominatim
 */
export async function fallbackNominatimGeocode(
  query: string,
  biasCoords?: { lat: number; lng: number } | null,
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<{ lat: number; lng: number; parsed: ParsedAddress } | null> {
  const timeoutMs = options?.timeoutMs ?? 6000
  const timeoutController = new AbortController()
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs)

  if (options?.signal) {
    if (options.signal.aborted) {
      clearTimeout(timer)
      return null
    }
    options.signal.addEventListener('abort', () => timeoutController.abort(), { once: true })
  }

  try {
    let url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=br&limit=1&q=${encodeURIComponent(
      query,
    )}`

    if (biasCoords && typeof biasCoords.lat === 'number' && typeof biasCoords.lng === 'number') {
      const delta = 0.5
      const minLon = (biasCoords.lng - delta).toFixed(5)
      const maxLon = (biasCoords.lng + delta).toFixed(5)
      const minLat = (biasCoords.lat - delta).toFixed(5)
      const maxLat = (biasCoords.lat + delta).toFixed(5)
      url += `&viewbox=${minLon},${maxLat},${maxLon},${minLat}&bounded=0`
    }
    const res = await fetch(url, {
      signal: timeoutController.signal,
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
  } catch (e: any) {
    if (e?.name !== 'AbortError') {
      console.warn('Fallback Nominatim geocode error:', e)
    }
    return null
  } finally {
    clearTimeout(timer)
  }
}

// In-memory cache for reverse geocoding by rounded coordinates (~10-15 meters)
const reverseGeocodeCache = new Map<string, ParsedAddress>()

/**
 * Cache com raio de tolerância de ~100m para evitar chamadas redundantes
 * à API de Geocoding quando a posição oscila levemente ou altera menos de 100 metros.
 */
interface GeocodeCacheItem {
  lat: number
  lng: number
  result: ParsedAddress
  timestamp: number
}

const geoDistanceToleranceCache: GeocodeCacheItem[] = []

/**
 * Distância Haversine simplificada em metros entre duas coordenadas
 */
function distanceMetersCoords(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000 // metros
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export function findCachedReverseGeocodeWithinMeters(
  lat: number,
  lng: number,
  maxDistanceMeters = 100,
): ParsedAddress | null {
  for (const item of geoDistanceToleranceCache) {
    if (distanceMetersCoords(lat, lng, item.lat, item.lng) <= maxDistanceMeters) {
      return item.result
    }
  }
  return null
}

export function setCachedReverseGeocodeWithTolerance(
  lat: number,
  lng: number,
  result: ParsedAddress,
) {
  // Manter cache bounded
  if (geoDistanceToleranceCache.length > 250) {
    geoDistanceToleranceCache.shift()
  }
  geoDistanceToleranceCache.push({ lat, lng, result, timestamp: Date.now() })
}

export function getCachedReverseGeocodeKey(lat: number, lng: number): string {
  // Round to 4 decimal places (~11 meters precision)
  return `${lat.toFixed(4)},${lng.toFixed(4)}`
}

/**
 * Retorna a chave de API do Google Maps configurada no ambiente
 */
export function getGoogleMapsApiKey(): string {
  return (
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GOOGLE_MAPS_API_KEY) ||
    (typeof window !== 'undefined' && (window as any).__VITE_GOOGLE_MAPS_API_KEY) ||
    ''
  ).trim()
}

/**
 * Reverse Geocoding usando a REST API do Google Maps (fallback direto caso o SDK JS não esteja pronto)
 */
export async function reverseGeocodeGoogleRestApi(
  lat: number,
  lng: number,
  apiKey?: string,
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<ParsedAddress | null> {
  const key = (apiKey || getGoogleMapsApiKey()).trim()
  if (!key) return null

  const timeoutMs = options?.timeoutMs ?? 6000
  const timeoutController = new AbortController()
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs)

  if (options?.signal) {
    if (options.signal.aborted) {
      clearTimeout(timer)
      return null
    }
    options.signal.addEventListener('abort', () => timeoutController.abort(), { once: true })
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=pt-BR&region=BR&key=${encodeURIComponent(
      key,
    )}`
    const res = await fetch(url, { signal: timeoutController.signal })
    if (!res.ok) return null
    const data = await res.json()

    if (data.status === 'OK' && Array.isArray(data.results) && data.results.length > 0) {
      // Priorizar resultado com street_address ou premise ou subpremise ou route
      const bestResult =
        data.results.find((r: any) =>
          r.types?.some((t: string) =>
            ['street_address', 'premise', 'subpremise', 'route'].includes(t),
          ),
        ) || data.results[0]

      const parsed = parseGoogleAddressComponents(
        bestResult.address_components || [],
        bestResult.formatted_address,
      )
      return {
        ...parsed,
        formattedAddress: bestResult.formatted_address || parsed.formattedAddress,
        lat,
        lng,
        source: 'google',
      }
    }
    return null
  } catch (err: any) {
    if (err?.name !== 'AbortError') {
      console.warn('[Google Geocode REST] Erro ao consultar REST Geocoding:', err)
    }
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Reverse geocoding helper prioritário:
 * 1. Tenta carregar e usar o SDK do Google Maps (google.maps.Geocoder)
 * 2. Se falhar ou indisponível, tenta a REST API do Google Geocoding
 * 3. Se nenhuma chave responder com sucesso, usa OpenStreetMap Nominatim como fallback
 */
export async function reverseGeocodeCoordinates(
  lat: number,
  lng: number,
  options?: { signal?: AbortSignal; timeoutMs?: number; toleranceMeters?: number },
): Promise<ParsedAddress | null> {
  // 0. Tolerância de distância (~100m conforme especificação para entregador em tempo real)
  const tolerance = options?.toleranceMeters ?? 100
  if (tolerance > 0) {
    const nearby = findCachedReverseGeocodeWithinMeters(lat, lng, tolerance)
    if (nearby) return nearby
  }

  const cacheKey = getCachedReverseGeocodeKey(lat, lng)
  if (reverseGeocodeCache.has(cacheKey)) {
    return reverseGeocodeCache.get(cacheKey)!
  }

  // 1. Tentar garantir carregamento do Google Maps SDK se houver chave
  const hasKey = Boolean(getGoogleMapsApiKey())
  if (hasKey && !googleMapsAuthError) {
    try {
      await loadGoogleMapsScript()
    } catch {
      // continua para os passos seguintes
    }
  }

  // 2. Try Google Maps JS Geocoder SDK
  try {
    const win = typeof window !== 'undefined' ? (window as any) : null
    if (win?.google?.maps?.Geocoder && !googleMapsAuthError) {
      const geocoder = new win.google.maps.Geocoder()
      const googleResult = await new Promise<ParsedAddress | null>((resolve) => {
        geocoder.geocode(
          { location: { lat, lng }, language: 'pt-BR', region: 'BR' },
          (results: any[], status: string) => {
            if (status === 'OK' && results && results.length > 0) {
              const best =
                results.find((r: any) =>
                  r.types?.some((t: string) =>
                    ['street_address', 'premise', 'subpremise', 'route'].includes(t),
                  ),
                ) || results[0]
              const parsed = parseGoogleAddressComponents(
                best.address_components || [],
                best.formatted_address,
              )
              resolve({
                ...parsed,
                formattedAddress: best.formatted_address || parsed.formattedAddress,
                lat,
                lng,
                source: 'google',
              })
            } else {
              resolve(null)
            }
          },
        )
      })

      if (googleResult && (googleResult.street || googleResult.formattedAddress)) {
        reverseGeocodeCache.set(cacheKey, googleResult)
        setCachedReverseGeocodeWithTolerance(lat, lng, googleResult)
        return googleResult
      }
    }
  } catch (err) {
    console.warn('[Google Maps Geocoder] Exceção no Geocoder JS:', err)
  }

  // 3. Try Google Maps Geocoding REST API (caso JS SDK falhe ou esteja bloqueado por CORS/referrer)
  if (hasKey) {
    try {
      const restResult = await reverseGeocodeGoogleRestApi(lat, lng, undefined, options)
      if (restResult && (restResult.street || restResult.formattedAddress)) {
        reverseGeocodeCache.set(cacheKey, restResult)
        setCachedReverseGeocodeWithTolerance(lat, lng, restResult)
        return restResult
      }
    } catch (err) {
      console.warn('[Google Geocode REST] Falha na chamada REST:', err)
    }
  }

  // 4. OpenStreetMap Nominatim fallback
  const fallbackResult = await fallbackReverseGeocode(lat, lng, options)
  if (fallbackResult) {
    reverseGeocodeCache.set(cacheKey, fallbackResult)
    setCachedReverseGeocodeWithTolerance(lat, lng, fallbackResult)
  }
  return fallbackResult
}

/**
 * Fallback Reverse Geocoding with OpenStreetMap Nominatim
 */
export async function fallbackReverseGeocode(
  lat: number,
  lng: number,
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<ParsedAddress | null> {
  const timeoutMs = options?.timeoutMs ?? 6000
  const timeoutController = new AbortController()
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs)

  if (options?.signal) {
    if (options.signal.aborted) {
      clearTimeout(timer)
      return null
    }
    options.signal.addEventListener('abort', () => timeoutController.abort(), { once: true })
  }

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&lat=${lat}&lon=${lng}`
    const res = await fetch(url, {
      signal: timeoutController.signal,
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
  } catch (e: any) {
    if (e?.name !== 'AbortError') {
      console.warn('Fallback Nominatim reverse geocode error:', e)
    }
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Geocoding direto usando a REST API do Google Maps (Google Geocoding API).
 * Retorna lat/lng e os componentes de endereço estruturados (rua, número, bairro, cidade, UF, CEP).
 */
export async function geocodeAddressGoogleRest(
  address: string,
  apiKey?: string,
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<{ lat: number; lng: number; parsed: ParsedAddress } | null> {
  const cleanAddr = address.trim()
  if (!cleanAddr) return null

  const key = (apiKey || getGoogleMapsApiKey()).trim()
  if (!key) return null

  const timeoutMs = options?.timeoutMs ?? 7000
  const timeoutController = new AbortController()
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs)

  if (options?.signal) {
    if (options.signal.aborted) {
      clearTimeout(timer)
      return null
    }
    options.signal.addEventListener('abort', () => timeoutController.abort(), { once: true })
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      cleanAddr,
    )}&language=pt-BR&region=BR&key=${encodeURIComponent(key)}`

    const res = await fetch(url, { signal: timeoutController.signal })
    if (!res.ok) return null
    const data = await res.json()

    if (data.status === 'OK' && Array.isArray(data.results) && data.results.length > 0) {
      // Priorizar resultado mais preciso (street_address, premise, subpremise, route)
      const bestResult =
        data.results.find((r: any) =>
          r.types?.some((t: string) =>
            ['street_address', 'premise', 'subpremise', 'route'].includes(t),
          ),
        ) || data.results[0]

      const loc = bestResult.geometry?.location
      if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') {
        return null
      }

      const parsed = parseGoogleAddressComponents(
        bestResult.address_components || [],
        bestResult.formatted_address,
      )

      return {
        lat: loc.lat,
        lng: loc.lng,
        parsed: {
          ...parsed,
          formattedAddress: bestResult.formatted_address || parsed.formattedAddress,
          lat: loc.lat,
          lng: loc.lng,
          source: 'google',
        },
      }
    }

    if (data.status === 'REQUEST_DENIED' || data.status === 'OVER_QUERY_LIMIT') {
      console.warn(
        `[Google Geocode REST] Status de retorno: ${data.status} - ${data.error_message || ''}`,
      )
    }

    return null
  } catch (err: any) {
    if (err?.name !== 'AbortError') {
      console.warn('[Google Geocode REST] Erro ao consultar REST Geocoding direto:', err)
    }
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Geocoding unificado de endereços com prioridade Google Maps:
 * 1. Tenta a API REST do Google Geocoding (geocodeAddressGoogleRest) se houver chave configurada
 * 2. Tenta o SDK JS do Google Geocoder caso esteja carregado na página
 * 3. Fallback para OpenStreetMap Nominatim (fallbackGeocodeAddress)
 */
export async function geocodeAddressUnified(
  address: string,
  biasCoords?: { lat: number; lng: number } | null,
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<{ lat: number; lng: number; parsed: ParsedAddress } | null> {
  const cleanAddr = address.trim()
  if (!cleanAddr) return null

  const hasKey = Boolean(getGoogleMapsApiKey())

  // 1. Prioridade: Google Geocoding API REST direta
  if (hasKey && !googleMapsAuthError) {
    try {
      const googleRestResult = await geocodeAddressGoogleRest(cleanAddr, undefined, options)
      if (googleRestResult && typeof googleRestResult.lat === 'number') {
        return googleRestResult
      }
    } catch (err) {
      console.warn('[Unified Geocode] Falha no geocode Google REST:', err)
    }
  }

  // 2. Google Maps JS SDK Geocoder (se já estiver carregado e disponível)
  try {
    const win = typeof window !== 'undefined' ? (window as any) : null
    if (win?.google?.maps?.Geocoder && !googleMapsAuthError) {
      const geocoder = new win.google.maps.Geocoder()
      const sdkResult = await new Promise<{
        lat: number
        lng: number
        parsed: ParsedAddress
      } | null>((resolve) => {
        geocoder.geocode(
          { address: cleanAddr, language: 'pt-BR', region: 'BR' },
          (results: any[], status: string) => {
            if (status === 'OK' && results && results.length > 0) {
              const best =
                results.find((r: any) =>
                  r.types?.some((t: string) =>
                    ['street_address', 'premise', 'subpremise', 'route'].includes(t),
                  ),
                ) || results[0]
              const loc = best.geometry?.location
              if (!loc) {
                resolve(null)
                return
              }
              const lat = typeof loc.lat === 'function' ? loc.lat() : loc.lat
              const lng = typeof loc.lng === 'function' ? loc.lng() : loc.lng
              const parsed = parseGoogleAddressComponents(
                best.address_components || [],
                best.formatted_address,
              )
              resolve({
                lat,
                lng,
                parsed: {
                  ...parsed,
                  formattedAddress: best.formatted_address || parsed.formattedAddress,
                  lat,
                  lng,
                  source: 'google',
                },
              })
            } else {
              resolve(null)
            }
          },
        )
      })
      if (sdkResult) {
        return sdkResult
      }
    }
  } catch (err) {
    console.warn('[Unified Geocode] Falha no Google Maps SDK Geocoder:', err)
  }

  // 3. Fallback final: OpenStreetMap Nominatim
  return fallbackNominatimGeocode(cleanAddr, biasCoords, options)
}

/**
 * Fallback Geocoding unificado: tenta Google REST API primeiro, depois Nominatim
 * Mantido como fallbackGeocodeAddress para compatibilidade total com os componentes existentes
 */
export const fallbackGeocodeAddress = geocodeAddressUnified

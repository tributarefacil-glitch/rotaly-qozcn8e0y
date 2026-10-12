import {
  ParsedAddress,
  reverseGeocodeCoordinates,
  reverseGeocodeGoogleRestApi,
} from '@/lib/googleMaps'

/**
 * Interface do endereço enriquecido no formato Uber
 */
export interface UberAddressResult {
  fullAddress: string
  street: string
  number: string
  complement: string
  neighborhood: string
  city: string
  state: string
  postalCode: string
  lat: number
  lng: number
  locationType?: string
  isInterpolated: boolean
  hasOfficialNumber: boolean
}

/**
 * Extrai lote e quadra ou complementos descritivos preservados
 */
export function extractLoteQuadraComplement(rawText?: string): string {
  if (!rawText) return ''
  const trimmed = rawText.trim()

  // Procura padrões comuns: Lote 13 Qd 02, Lt 10 Qd 4, Lote 04, Qd 02, etc.
  const loteQuadraMatch = trimmed.match(
    /(?:lote|lt\.?)\s*[\w\d]+\s*(?:(?:e|,|qd\.?|quadra)\s*[\w\d]*)?/i,
  )
  if (loteQuadraMatch) {
    return loteQuadraMatch[0].trim()
  }

  const quadraMatch = trimmed.match(/(?:quadra|qd\.?)\s*[\w\d]+/i)
  if (quadraMatch) {
    return quadraMatch[0].trim()
  }

  // Beco, fundos, apto, casa, vila
  const complementMatch = trimmed.match(
    /(?:casa|apto|bloco|fundos|beco|vila|ch[aá]cara|sobrado)\s*[\w\d\s\-/]+/i,
  )
  if (complementMatch) {
    return complementMatch[0].trim()
  }

  return ''
}

/**
 * Constrói a string de endereço no formato padronizado Uber:
 * "Rua X, [nº], Bairro, Cidade - UF, CEP"
 * Mantém lote/quadra no complemento preservado separadamente.
 * Nunca usa "S/N" quando houver número interpolado ou oficial.
 */
export function formatUberAddress(params: {
  street?: string
  number?: string
  complement?: string
  neighborhood?: string
  city?: string
  state?: string
  postalCode?: string
}): string {
  const street = (params.street || '').trim()
  const rawNumber = (params.number || '').trim()
  const complement = (params.complement || '').trim()
  const neighborhood = (params.neighborhood || '').trim()
  const city = (params.city || '').trim()
  const state = (params.state || '').trim().toUpperCase()
  const postalCode = (params.postalCode || '').trim()

  // Se o número for "S/N" ou similar, limpa
  const isSn = /^(s\/n|sn|sem\s*n[uú]mero)$/i.test(rawNumber)
  const cleanNumber = isSn ? '' : rawNumber

  const parts: string[] = []

  // Rua + Número
  if (street) {
    if (cleanNumber) {
      parts.push(`${street}, ${cleanNumber}`)
    } else {
      parts.push(street)
    }
  } else if (cleanNumber) {
    parts.push(cleanNumber)
  }

  // Se não houver número oficial/interpolado na via principal mas houver lote/quadra ou complemento
  if (complement) {
    // Se o complemento ainda não estiver na parte do endereço e for informativo
    const compLower = complement.toLowerCase()
    const alreadyIncluded = parts.some((p) => p.toLowerCase().includes(compLower))
    if (!alreadyIncluded) {
      // Deixar no complemento ou acrescentar se não houver rua estruturada
      if (!street) {
        parts.push(complement)
      }
    }
  }

  if (neighborhood) {
    parts.push(neighborhood)
  }

  let cityState = ''
  if (city && state) {
    cityState = `${city} - ${state}`
  } else if (city) {
    cityState = city
  } else if (state) {
    cityState = state
  }

  if (cityState) {
    parts.push(cityState)
  }

  if (postalCode) {
    const cleanCep = postalCode.replace(/\D/g, '')
    const formattedCep =
      cleanCep.length === 8 ? `${cleanCep.slice(0, 5)}-${cleanCep.slice(5)}` : postalCode
    parts.push(`CEP ${formattedCep}`)
  }

  return parts.join(', ')
}

/**
 * Enriquece coordenada via Google Reverse Geocoding no modelo Uber:
 * - Busca endereço com número interpolado (RANGE_INTERPOLATED ou street_number)
 * - Preserva lote/quadra no campo complement
 * - Monta endereço canônico "Rua X, [nº], Bairro, Cidade - UF, CEP"
 */
export async function reverseGeocodeUberAddress(params: {
  lat: number
  lng: number
  existingAddress?: string
  existingComplement?: string
  apiKey?: string
}): Promise<UberAddressResult | null> {
  const { lat, lng, existingAddress, existingComplement, apiKey } = params

  if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
    return null
  }

  // Tenta REST primeiro ou SDK
  let parsed: ParsedAddress | null = null
  if (apiKey) {
    parsed = await reverseGeocodeGoogleRestApi(lat, lng, apiKey)
  }
  if (!parsed) {
    parsed = await reverseGeocodeCoordinates(lat, lng)
  }

  // Preservar lote/quadra do endereço anterior ou do complemento anterior
  const preservedComplement =
    (existingComplement || '').trim() || extractLoteQuadraComplement(existingAddress) || ''

  if (!parsed) {
    return null
  }

  const street = parsed.street || ''
  let number = (parsed.number || '').trim()
  if (/^(s\/n|sn|sem\s*n[uú]mero)$/i.test(number)) {
    number = ''
  }

  const neighborhood = parsed.neighborhood || ''
  const city = parsed.city || ''
  const state = parsed.state || ''
  const postalCode = parsed.postalCode || ''
  const locationType = parsed.locationType || ''
  const isInterpolated = locationType === 'RANGE_INTERPOLATED' || Boolean(number)
  const hasOfficialNumber = Boolean(number) && locationType === 'ROOFTOP'

  const fullAddress = formatUberAddress({
    street,
    number,
    complement: preservedComplement,
    neighborhood,
    city,
    state,
    postalCode,
  })

  return {
    fullAddress,
    street,
    number,
    complement: preservedComplement,
    neighborhood,
    city,
    state,
    postalCode,
    lat,
    lng,
    locationType,
    isInterpolated,
    hasOfficialNumber,
  }
}

/**
 * Open Location Code (Plus Code) - Google Open-Source Specification
 * Implementação limpa e pura em TypeScript do algoritmo aberto do Google (openlocationcode)
 * Sem dependências externas.
 *
 * Referência: https://github.com/google/open-location-code
 */

const CODE_ALPHABET = '23456789CFGHJMPQRVWX'
const ENCODING_BASE = CODE_ALPHABET.length // 20
const LATITUDE_MAX = 90
const LONGITUDE_MAX = 180
const MAX_DIGIT_COUNT = 15
const PAIR_CODE_LENGTH = 10
const SEPARATOR = '+'
const SEPARATOR_POSITION = 8
const PADDING_CHARACTER = '0'

// Grid sub-divisions (após os 10 primeiros dígitos)
const GRID_COLUMNS = 4
const GRID_ROWS = 5

/**
 * Normaliza a latitude no intervalo [-90, 90]
 */
function clipLatitude(latitude: number): number {
  return Math.min(Math.max(latitude, -LATITUDE_MAX), LATITUDE_MAX)
}

/**
 * Normaliza a longitude no intervalo [-180, 180)
 */
function normalizeLongitude(longitude: number): number {
  let lon = longitude
  while (lon < -LONGITUDE_MAX) {
    lon += 360
  }
  while (lon >= LONGITUDE_MAX) {
    lon -= 360
  }
  return lon
}

/**
 * Codifica lat/lng em um Plus Code (Open Location Code completo).
 * Por padrão gera 10 ou 11 caracteres (ex: "588P6P2V+4C" ou "588P6P2V+4CQ").
 * Precisão padrão: 10 dígitos (resolução ~13.5m x 13.5m).
 */
export function encodePlusCode(
  latitude: number,
  longitude: number,
  codeLength: number = PAIR_CODE_LENGTH,
): string {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return ''
  if (isNaN(latitude) || isNaN(longitude)) return ''
  if (latitude === 0 && longitude === 0) return ''

  let length = Math.min(codeLength, MAX_DIGIT_COUNT)
  if (length < 2 || (length < PAIR_CODE_LENGTH && length % 2 === 1)) {
    length = PAIR_CODE_LENGTH
  }

  // Ajuste do polo norte para evitar overflow
  let lat = clipLatitude(latitude)
  let lon = normalizeLongitude(longitude)
  if (lat === LATITUDE_MAX) {
    lat -= 0.0000001
  }

  // Deslocamento para valores estritamente positivos
  lat += LATITUDE_MAX // 0 .. 180
  lon += LONGITUDE_MAX // 0 .. 360

  let code = ''

  // Resolução de cada par de dígitos
  // Par 1: 20 graus
  // Par 2: 1 grau
  // Par 3: 0.05 graus (3 minutos)
  // Par 4: 0.0025 graus (9 segundos)
  // Par 5: 0.000125 graus (0.45 segundos) ~ 13.7m
  let latVal = lat
  let lonVal = lon

  // Primeiro par (20 graus)
  let latDigit = Math.floor(latVal / 20)
  let lonDigit = Math.floor(lonVal / 20)
  code += CODE_ALPHABET.charAt(latDigit) + CODE_ALPHABET.charAt(lonDigit)
  latVal -= latDigit * 20
  lonVal -= lonDigit * 20

  // Pares subsequentes
  const pairResolutions = [1, 0.05, 0.0025, 0.000125]
  for (let i = 0; i < pairResolutions.length && code.length < length; i++) {
    const res = pairResolutions[i]
    latDigit = Math.floor(latVal / res)
    lonDigit = Math.floor(lonVal / res)
    code += CODE_ALPHABET.charAt(latDigit) + CODE_ALPHABET.charAt(lonDigit)
    latVal -= latDigit * res
    lonVal -= lonDigit * res
  }

  // Inserir separador '+' após o 8º caractere
  if (code.length >= SEPARATOR_POSITION) {
    code = code.slice(0, SEPARATOR_POSITION) + SEPARATOR + code.slice(SEPARATOR_POSITION)
  }

  // Se length menor que 8, preencher com zeros
  if (code.length < SEPARATOR_POSITION) {
    while (code.length < SEPARATOR_POSITION) {
      code += PADDING_CHARACTER
    }
    code += SEPARATOR
  }

  return code
}

/**
 * Valida se uma string é um Plus Code estruturalmente válido
 */
export function isValidPlusCode(code: string): boolean {
  if (!code || typeof code !== 'string') return false
  const clean = code.trim().toUpperCase()

  const sepIndex = clean.indexOf(SEPARATOR)
  if (sepIndex === -1) return false
  if (sepIndex > SEPARATOR_POSITION || sepIndex % 2 === 1) return false

  // Se tem padding
  const padIndex = clean.indexOf(PADDING_CHARACTER)
  if (padIndex > -1) {
    if (padIndex === 0) return false
    if (padIndex < sepIndex) {
      // Padding antes do separador é permitido se seguido apenas de 0 até o '+'
      for (let i = padIndex; i < sepIndex; i++) {
        if (clean.charAt(i) !== PADDING_CHARACTER) return false
      }
      if (clean.length > sepIndex + 1) return false
    }
  }

  // Verificar caracteres
  for (let i = 0; i < clean.length; i++) {
    const ch = clean.charAt(i)
    if (ch === SEPARATOR || ch === PADDING_CHARACTER) continue
    if (CODE_ALPHABET.indexOf(ch) === -1) return false
  }

  return true
}

/**
 * Formata um Plus Code para exibição amigável:
 * Ex: "588P6P2V+4C" -> "588P6P2V+4C"
 * Pode adicionar a cidade/bairro para o formato Google "6P2V+4C, Duque de Caxias - RJ"
 */
export function formatPlusCodeDisplay(
  code: string,
  locality?: { neighborhood?: string; city?: string; state?: string },
): string {
  if (!code) return ''
  const trimmed = code.trim().toUpperCase()
  if (!locality) return trimmed

  const parts: string[] = []
  if (locality.neighborhood) parts.push(locality.neighborhood)
  if (locality.city) parts.push(locality.city)
  if (locality.state) parts.push(locality.state)

  if (parts.length > 0) {
    // Se for código longo (>= 8 caracteres antes do +), o código curto é os 4 caracteres finais + sufixo
    return `${trimmed} (${parts.join(' - ')})`
  }

  return trimmed
}

/**
 * Cria a URL do Google Maps a partir de um Plus Code
 */
export function getPlusCodeMapsUrl(code: string): string {
  if (!code) return ''
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(code.trim())}`
}

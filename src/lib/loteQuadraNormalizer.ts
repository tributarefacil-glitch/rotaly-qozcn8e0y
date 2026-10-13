/**
 * loteQuadraNormalizer.ts
 *
 * Utilitário canônico do Rotaly para normalização de Quadra / Lote.
 * Padrão obrigatório (decisão do dono):
 *   "Qd N, Lt N" — sempre abreviado, dígito (sem zero à esquerda),
 *   Qd SEMPRE antes de Lt, no campo complement, nunca na rua.
 *   Complemento pré-existente é preservado: "Qd N, Lt N — Complemento".
 */

export interface ParsedLoteQuadra {
  quadra?: string // ex: "12", "7", "4A"
  lote?: string // ex: "7", "28", "1B"
  rawMatchedText?: string
  cleanedTextWithoutLoteQuadra?: string
}

export interface NormalizeAddressResult {
  street: string
  number?: string
  complement: string
  referencePoint?: string
  changed: boolean
  quadra?: string
  lote?: string
}

/**
 * Normaliza número/identificador de quadra ou lote:
 * Remove zeros à esquerda mantendo letras (ex: '07' -> '7', '012' -> '12', '01b' -> '1B').
 */
export function sanitizeLoteQuadraValue(val: string): string {
  if (!val) return ''
  const trimmed = val.trim().toUpperCase()
  // Se for apenas dígitos com zeros à esquerda
  const stripped = trimmed.replace(/^0+([0-9]+.*)$/, '$1')
  return stripped || trimmed
}

/**
 * Expressões regulares para detecção de Lote e Quadra em várias formas:
 * LT, Lote, lote, QD, Quadra, quadra, colado ou separado, com vírgulas ou pontuação.
 */
const QUADRA_REGEX = /(?:QD|QUADRA|QDA|Q)\b[\s.,:]*([0-9]+[A-Za-z]?|[A-Za-z])/i
const LOTE_REGEX = /(?:LT|LOTE|L)\b[\s.,:]*([0-9]+[A-Za-z]?|[A-Za-z])/i

// Expressão combinada que captura pares LT/QD em qualquer ordem
// Exemplos:
// 'LT 28 QD 2', 'lote22 quadra12', '211 LOTE,5 QUADRA,3', 'lt1b qd16', 'LT 40 QD 10',
// 'LT 18 QD 07', 'LOTE 8 QUADRA 7', '8 qd 4', 'lote 12 qd 41'
const COMBINED_QD_LT_PATTERNS = [
  // Padrão 1: QD primeiro, depois LT (ex: "QD 12 LT 7", "Quadra 12, Lote 7", "qd12 lt7", "qd 12,5 lt 3")
  /(?:(?:QD|QUADRA|QDA)\s*[,.:]?\s*([0-9]+[A-Za-z]?|[A-Za-z]))[\s,./-]+(?:(?:LT|LOTE)\s*[,.:]?\s*([0-9]+[A-Za-z]?|[A-Za-z]))/i,
  // Padrão 2: LT primeiro, depois QD (ex: "LT 28 QD 2", "lote22 quadra12", "LOTE,5 QUADRA,3", "lt1b qd16")
  /(?:(?:LT|LOTE)\s*[,.:]?\s*([0-9]+[A-Za-z]?|[A-Za-z]))[\s,./-]+(?:(?:QD|QUADRA|QDA)\s*[,.:]?\s*([0-9]+[A-Za-z]?|[A-Za-z]))/i,
  // Padrão 3: Número solto antes de QD (ex: "8 qd 4" -> Lote 8, Quadra 4; "28 QD 2" quando no contexto)
  /(?:^|[\s,])([0-9]+[A-Za-z]?)\s*[,.:]?\s*(?:QD|QUADRA|QDA)\s*[,.:]?\s*([0-9]+[A-Za-z]?|[A-Za-z])/i,
]

/**
 * Extrai quadra e lote de um texto genérico (rua, complemento, ponto de referência).
 */
export function extractLoteQuadra(text: string): ParsedLoteQuadra | null {
  if (!text || typeof text !== 'string') return null
  const raw = text.trim()
  if (!raw) return null

  let quadra: string | undefined
  let lote: string | undefined
  let matchedStr: string | undefined

  // 1. Tentar padrões combinados
  // Padrão 1: QD depois LT
  const m1 = raw.match(
    /(?:QD|QUADRA|QDA)\s*[,.:]?\s*([0-9]+[A-Za-z]?|[A-Za-z])[\s,./-]+(?:LT|LOTE)\s*[,.:]?\s*([0-9]+[A-Za-z]?|[A-Za-z])/i,
  )
  if (m1) {
    quadra = sanitizeLoteQuadraValue(m1[1])
    lote = sanitizeLoteQuadraValue(m1[2])
    matchedStr = m1[0]
  } else {
    // Padrão 2: LT depois QD
    const m2 = raw.match(
      /(?:LT|LOTE)\s*[,.:]?\s*([0-9]+[A-Za-z]?|[A-Za-z])[\s,./-]+(?:QD|QUADRA|QDA)\s*[,.:]?\s*([0-9]+[A-Za-z]?|[A-Za-z])/i,
    )
    if (m2) {
      lote = sanitizeLoteQuadraValue(m2[1])
      quadra = sanitizeLoteQuadraValue(m2[2])
      matchedStr = m2[0]
    } else {
      // Padrão 3: número solto antes de QD (ex: "8 qd 4")
      const m3 = raw.match(
        /(?:^|[\s,])([0-9]+[A-Za-z]?)\s*[,.:]?\s*(?:QD|QUADRA|QDA)\s*[,.:]?\s*([0-9]+[A-Za-z]?|[A-Za-z])/i,
      )
      if (m3) {
        lote = sanitizeLoteQuadraValue(m3[1])
        quadra = sanitizeLoteQuadraValue(m3[2])
        matchedStr = m3[0].trim()
      } else {
        // Padrões individuais isolados
        const mq = raw.match(QUADRA_REGEX)
        const ml = raw.match(LOTE_REGEX)
        if (mq) quadra = sanitizeLoteQuadraValue(mq[1])
        if (ml) lote = sanitizeLoteQuadraValue(ml[1])
        if (mq && ml) {
          // Ambos existem separadamente no texto
          matchedStr = raw
        } else if (mq) {
          matchedStr = mq[0]
        } else if (ml) {
          matchedStr = ml[0]
        }
      }
    }
  }

  if (!quadra && !lote) return null

  // Limpa o texto original removendo APENAS o trecho de Lote/Quadra casado, NUNCA descartando o restante!
  let cleaned = raw
  if (matchedStr) {
    cleaned = cleaned.replace(matchedStr, ' ')
  }
  // Remove menções residuais pontuais caso sobrou LT ou QD isolado
  cleaned = cleaned
    .replace(/(?:LT|LOTE)\s*[,.:]?\s*[0-9]+[A-Za-z]?/gi, ' ')
    .replace(/(?:QD|QUADRA|QDA)\s*[,.:]?\s*[0-9]+[A-Za-z]?/gi, ' ')
    .replace(/\s*,\s*,+/g, ',')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,./\-—–]+|[\s,./\-—–]+$/g, '')
    .trim()

  return {
    quadra,
    lote,
    rawMatchedText: matchedStr,
    cleanedTextWithoutLoteQuadra: cleaned,
  }
}

/**
 * Formata no padrão canônico:
 * Se tiver ambos: "Qd {quadra}, Lt {lote}"
 * Se tiver apenas Qd: "Qd {quadra}"
 * Se tiver apenas Lt: "Lt {lote}"
 */
export function formatCanonicalLoteQuadra(quadra?: string, lote?: string): string {
  const q = quadra ? sanitizeLoteQuadraValue(quadra) : ''
  const l = lote ? sanitizeLoteQuadraValue(lote) : ''

  if (q && l) {
    return `Qd ${q}, Lt ${l}`
  }
  if (q) {
    return `Qd ${q}`
  }
  if (l) {
    return `Lt ${l}`
  }
  return ''
}

/**
 * Mescla o padrão "Qd N, Lt N" com qualquer complemento pré-existente.
 * Exemplo:
 * formatComplementWithLoteQuadra("12", "7", "Casa 2") -> "Qd 12, Lt 7 — Casa 2"
 * formatComplementWithLoteQuadra("12", "7", "Qd 12 Lt 7") -> "Qd 12, Lt 7"
 */
export function formatComplementWithLoteQuadra(
  quadra?: string,
  lote?: string,
  existingComplement?: string,
): string {
  const canonical = formatCanonicalLoteQuadra(quadra, lote)
  if (!canonical) return (existingComplement || '').trim()

  const cleanedExisting = (existingComplement || '')
    .replace(/(?:LT|LOTE)\s*[,.:]?\s*[0-9]+[A-Za-z]?/gi, '')
    .replace(/(?:QD|QUADRA|QDA)\s*[,.:]?\s*[0-9]+[A-Za-z]?/gi, '')
    .replace(/^[\s,./\-—–]+|[\s,./\-—–]+$/g, '')
    .trim()

  if (!cleanedExisting) {
    return canonical
  }
  return `${canonical} — ${cleanedExisting}`
}

/**
 * Normaliza um endereço completo migrando menções de Qd/Lt da rua ou ponto de referência
 * para o campo complement no formato canônico "Qd N, Lt N".
 */
export function normalizeCustomerAddressFields(params: {
  street?: string
  number?: string
  complement?: string
  referencePoint?: string
}): NormalizeAddressResult {
  let street = (params.street || '').trim()
  let complement = (params.complement || '').trim()
  let referencePoint = (params.referencePoint || '').trim()
  const number = params.number?.trim() || ''

  let quadra: string | undefined
  let lote: string | undefined
  let changed = false

  // 1. Verificar se há Qd/Lt no complemento
  const compMatch = extractLoteQuadra(complement)
  if (compMatch) {
    quadra = compMatch.quadra
    lote = compMatch.lote
    // Preservar todo o texto excedente do complemento
    complement = compMatch.cleanedTextWithoutLoteQuadra || ''
    changed = true
  }

  // 2. Verificar se há Qd/Lt na rua/logradouro
  // Remove SOMENTE o trecho Qd/Lt da rua; qualquer descrição excedente na rua que não pertença ao nome da via
  // deve ser preservada (se sobrar texto além do logradouro, pode ser apendado ou mantido)
  const streetMatch = extractLoteQuadra(street)
  if (streetMatch) {
    if (!quadra && streetMatch.quadra) quadra = streetMatch.quadra
    if (!lote && streetMatch.lote) lote = streetMatch.lote
    street = streetMatch.cleanedTextWithoutLoteQuadra || street
    changed = true
  }

  // 3. Verificar se há Qd/Lt no reference_point
  // Item (H): extrair SOMENTE o padrão Qd/Lt; preservar TODO o excedente descritivo
  // (ex.: 'Lt 12 Qd 4, ao lado do Mercado do Zé' -> 'ao lado do Mercado do Zé' não pode ser descartado!)
  const refMatch = extractLoteQuadra(referencePoint)
  let refExcedente = ''
  if (refMatch) {
    if (!quadra && refMatch.quadra) quadra = refMatch.quadra
    if (!lote && refMatch.lote) lote = refMatch.lote
    refExcedente = (refMatch.cleanedTextWithoutLoteQuadra || '').trim()
    referencePoint = refExcedente
    changed = true
  }

  // 4. Montar o complemento canônico preservando integralmente o excedente
  if (quadra || lote) {
    // Se o ponto de referência tinha texto descritivo e ficou vazio o reference_point,
    // mantém no reference_point se houver, ou se o reference_point agora guarda o excedente puro, está preservado!
    const finalComplement = formatComplementWithLoteQuadra(quadra, lote, complement)
    if (finalComplement !== (params.complement || '').trim()) {
      changed = true
    }
    complement = finalComplement
  }

  return {
    street,
    number,
    complement,
    referencePoint,
    changed,
    quadra,
    lote,
  }
}

/**
 * Verifica se um registro de cliente está protegido pela exceção do dono:
 * NÃO alterar clientes corrigidos pelo PIN DO ENTREGADOR:
 * - pending_client_pin preenchido
 * - origem pin_entregador
 * - notas com '[ALERTA ANTI-CEP'
 */
export function isProtectedFromLoteQuadraSweep(customer: {
  pending_client_pin?: unknown
  origin?: string
  origem?: string
  notes?: string
  observacoes?: string
}): boolean {
  if (customer.pending_client_pin) return true
  const originStr = String(customer.origin || customer.origem || '').toLowerCase()
  if (originStr === 'pin_entregador' || originStr.includes('pin_entregador')) return true
  const notesStr = String(customer.notes || customer.observacoes || '')
  if (notesStr.includes('[ALERTA ANTI-CEP')) return true
  return false
}

/**
 * Serviço de consulta e preenchimento de dados de CNPJ
 * Usa BrasilAPI como fonte principal e ReceitaWS como contingência.
 */

export interface CnpjDataResult {
  cnpj: string // apenas dígitos (14)
  nome_razao_social: string
  nome_fantasia: string
  telefone: string
  email: string
  cep: string
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  uf: string
  source: 'brasilapi' | 'receitaws'
}

/**
 * Normaliza e higieniza números de telefone retornados por APIs de CNPJ
 */
export function sanitizePhone(ddd?: string | null, phone?: string | null): string {
  const combined = `${ddd || ''}${phone || ''}`.replace(/\D/g, '')
  if (!combined) return ''
  // Se veio mais de 11 dígitos, pega os primeiros 11
  const digits = combined.slice(0, 11)
  if (digits.length <= 10) {
    return digits.replace(/^(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3')
  }
  return digits.replace(/^(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3')
}

/**
 * Formata CEP para 00000-000
 */
export function sanitizeCep(rawCep?: string | null): string {
  const digits = (rawCep || '').replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 5) return digits
  return digits.replace(/^(\d{5})(\d{0,3})/, '$1-$2')
}

/**
 * Consulta dados do CNPJ na BrasilAPI (gratuita, sem chave)
 */
async function fetchBrasilApi(
  cleanCnpj: string,
  signal?: AbortSignal,
): Promise<CnpjDataResult | null> {
  const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cleanCnpj}`, {
    signal,
    headers: {
      Accept: 'application/json',
    },
  })

  if (!res.ok) {
    return null
  }

  const data = await res.json()

  // Telefone da BrasilAPI costuma vir em ddd_telefone_1 (ex: "5537446349") ou separado
  let telefone = ''
  if (data.ddd_telefone_1) {
    telefone = sanitizePhone('', data.ddd_telefone_1)
  } else if (data.ddd_telefone_2) {
    telefone = sanitizePhone('', data.ddd_telefone_2)
  }

  // Se logradouro vier com tipo em campo separado e não prefixado
  let logradouro = (data.logradouro || '').trim()
  const tipoLogr = (data.descricao_tipo_de_logradouro || '').trim()
  if (tipoLogr && logradouro && !logradouro.toLowerCase().startsWith(tipoLogr.toLowerCase())) {
    logradouro = `${tipoLogr} ${logradouro}`
  }

  const email = (data.email || '').trim().toLowerCase()
  const razaoSocial = (data.razao_social || '').trim()
  const nomeFantasia = (data.nome_fantasia || '').trim()
  const cep = sanitizeCep(data.cep)
  const numero = (data.numero || '').trim()
  const complemento = (data.complemento || '').trim()
  const bairro = (data.bairro || '').trim()
  const cidade = (data.municipio || '').trim()
  const uf = (data.uf || '').trim().toUpperCase()

  return {
    cnpj: cleanCnpj,
    nome_razao_social: razaoSocial,
    nome_fantasia: nomeFantasia,
    telefone,
    email,
    cep,
    logradouro,
    numero,
    complemento,
    bairro,
    cidade,
    uf,
    source: 'brasilapi',
  }
}

/**
 * Consulta dados do CNPJ na ReceitaWS (fallback de contingência)
 */
async function fetchReceitaWs(
  cleanCnpj: string,
  signal?: AbortSignal,
): Promise<CnpjDataResult | null> {
  const res = await fetch(`https://receitaws.com.br/v1/cnpj/${cleanCnpj}`, {
    signal,
    headers: {
      Accept: 'application/json',
    },
  })

  if (!res.ok) {
    return null
  }

  const data = await res.json()
  if (data.status === 'ERROR') {
    return null
  }

  const telefone = sanitizePhone('', data.telefone)
  const email = (data.email || '').trim().toLowerCase()
  const razaoSocial = (data.nome || '').trim()
  const nomeFantasia = (data.fantasia || '').trim()
  const cep = sanitizeCep(data.cep)
  const logradouro = (data.logradouro || '').trim()
  const numero = (data.numero || '').trim()
  const complemento = (data.complemento || '').trim()
  const bairro = (data.bairro || '').trim()
  const cidade = (data.municipio || '').trim()
  const uf = (data.uf || '').trim().toUpperCase()

  return {
    cnpj: cleanCnpj,
    nome_razao_social: razaoSocial,
    nome_fantasia: nomeFantasia,
    telefone,
    email,
    cep,
    logradouro,
    numero,
    complemento,
    bairro,
    cidade,
    uf,
    source: 'receitaws',
  }
}

/**
 * Consulta CNPJ completo com fallback automático (BrasilAPI -> ReceitaWS)
 * Timeout padrão de 8 segundos para evitar travamento de UI.
 */
export async function lookupCnpj(
  cnpj: string,
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<CnpjDataResult | null> {
  const cleanCnpj = cnpj.replace(/\D/g, '')
  if (cleanCnpj.length !== 14) return null

  const timeoutMs = options?.timeoutMs ?? 8000
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
    // 1. Tentar BrasilAPI primeiro
    try {
      const brasilData = await fetchBrasilApi(cleanCnpj, timeoutController.signal)
      if (brasilData && brasilData.nome_razao_social) {
        return brasilData
      }
    } catch (bErr: any) {
      if (bErr?.name === 'AbortError') throw bErr
      console.warn('Falha na consulta BrasilAPI para CNPJ:', cleanCnpj, bErr)
    }

    // 2. Tentar ReceitaWS caso BrasilAPI não tenha respondido
    try {
      const receitaData = await fetchReceitaWs(cleanCnpj, timeoutController.signal)
      if (receitaData && receitaData.nome_razao_social) {
        return receitaData
      }
    } catch (rErr: any) {
      if (rErr?.name === 'AbortError') throw rErr
      console.warn('Falha na consulta ReceitaWS para CNPJ:', cleanCnpj, rErr)
    }

    return null
  } catch (err: any) {
    if (err?.name !== 'AbortError') {
      console.warn('Erro ao consultar CNPJ:', err)
    }
    return null
  } finally {
    clearTimeout(timer)
  }
}

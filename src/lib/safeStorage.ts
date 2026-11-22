/**
 * safeStorage.ts
 *
 * Guarda de cota de armazenamento local do navegador (localStorage/sessionStorage).
 *
 * Contexto (bug de produção, 2026-11): o cache local do app (geometrias OSRM, cache de rota,
 * buffers offline) cresce sem limite e estoura a cota (~5MB). Quando o login grava a sessão
 * ('pocketbase_auth') via setItem, o Storage lança QuotaExceededError ANTES de o authStore
 * salvar o estado em memória, e o fluxo de login inteiro falha com
 * "Failed to execute 'setItem' on 'Storage': Setting the value of 'pocketbase_auth' exceeded the quota."
 *
 * Estratégia em duas camadas:
 * 1. WRAPPER EXPLÍTITO (safeSetItem / safeSetLocalStorage / safeSetCacheItem): try/catch com
 *    eviction do cache do próprio app e nova tentativa. Usado pelos gravadores de cache grandes.
 * 2. GUARDA GLOBAL (installGlobalStorageQuotaGuard): patch idempotente em Storage.prototype.setItem
 *    que cobre TODAS as escritas do app, inclusive as internas do SDK PocketBase, sem quebrar
 *    nenhum fluxo. Em QuotaExceededError: evicta chaves de cache do app (NUNCA credenciais nem
 *    chaves de outros sites), tenta de novo e, se ainda não couber, falha silenciosamente
 *    (estado continua em memória) — o login NUNCA pode falhar por cota de storage.
 */

/** Prefixos de cache/dados do próprio app que podem ser descartados com segurança. */
export const APP_CACHE_KEY_PREFIXES = [
  'rotaly_osrm_leg_cache_',
  'rotaly_cache_route_',
  'rotaly_offline_telem',
  'rotaly_offline_redir_',
  'rotaly_offline_chat_',
  'rotaly_pending_route_finish',
  'rotaly_fuel_discount_',
] as const

/** Limite de tamanho por entrada de cache persistida (acima disso: só memória). */
export const MAX_CACHE_VALUE_LENGTH = 400_000

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  readonly length: number
  key(index: number): string | null
}

/** Detecta erros de cota em todos os navegadores (Chrome/Firefox/Safari/Webkit). */
export function isQuotaError(err: unknown): boolean {
  if (!err) return false
  const name = (err as { name?: string })?.name || ''
  const message = String((err as Error)?.message || err || '')
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    /exceeded the quota|quota.*exceeded|quotaexceeded/i.test(message)
  )
}

function isAppCacheKey(key: string): boolean {
  return APP_CACHE_KEY_PREFIXES.some((p) => key.startsWith(p))
}

function getStoredTimestamp(storage: StorageLike, key: string): number {
  try {
    const raw = storage.getItem(key)
    if (!raw) return 0
    const parsed = JSON.parse(raw) as Record<string, unknown> | unknown[] | null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const field of ['timestamp', 'savedAt', 'enqueuedAt']) {
        const value = (parsed as Record<string, unknown>)[field]
        if (typeof value === 'number' && value > 0) return value
      }
    }
  } catch {
    /* valor não-JSON: sem timestamp, tratado como mais antigo */
  }
  return 0
}

/**
 * Remove chaves de cache do PRÓPRIO app (nunca credenciais, nunca dados de outros sites).
 * Padrão: descarta os mais antigos primeiro. Agressivo: descarta todo o cache do app.
 * Retorna quantas chaves foram removidas.
 */
export function evictAppCache(storage: StorageLike, aggressive = false): number {
  let cacheKeys: string[] = []
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key && isAppCacheKey(key)) cacheKeys.push(key)
    }
  } catch {
    return 0
  }
  if (cacheKeys.length === 0) return 0

  if (!aggressive) {
    // Ordena por timestamp (mais antigo primeiro, sem timestamp = mais antigo)
    cacheKeys = cacheKeys
      .map((key) => ({ key, ts: getStoredTimestamp(storage, key) }))
      .sort((a, b) => a.ts - b.ts)
      .map((entry) => entry.key)
    // Descarta a metade mais antiga por tentativa — evita apagar cache útil sem necessidade
    cacheKeys = cacheKeys.slice(0, Math.ceil(cacheKeys.length / 2))
  }

  let removed = 0
  for (const key of cacheKeys) {
    try {
      storage.removeItem(key)
      removed++
    } catch {
      /* ignore */
    }
  }
  return removed
}

/**
 * Escrita protegida de uma chave com fallback de eviction.
 * Retorna true se persistiu; false se só ficou em memória (chamador decide se aceita).
 */
export function safeSetItem(storage: StorageLike, key: string, value: string): boolean {
  try {
    storage.setItem(key, value)
    return true
  } catch (err) {
    if (!isQuotaError(err)) throw err
  }
  // 1ª tentativa de recuperação: eviction seletiva do cache mais antigo do app
  try {
    evictAppCache(storage)
    storage.setItem(key, value)
    return true
  } catch (err) {
    if (!isQuotaError(err)) throw err
  }
  // 2ª tentativa: eviction agressiva de TODO o cache do app
  try {
    evictAppCache(storage, true)
    storage.setItem(key, value)
    return true
  } catch (err) {
    if (!isQuotaError(err)) throw err
  }
  // Não coube nem com storage limpo de cache: falha controlada, sem exceção
  console.warn(
    `[safeStorage] Sem espaço para "${key}" mesmo após eviction — operando sem persistência desta chave.`,
  )
  return false
}

/** Grava no localStorage do navegador com proteção de cota. */
export function safeSetLocalStorage(key: string, value: string): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false
  return safeSetItem(window.localStorage, key, value)
}

/** Grava no sessionStorage do navegador com proteção de cota. */
export function safeSetSessionStorage(key: string, value: string): boolean {
  if (typeof window === 'undefined' || !window.sessionStorage) return false
  return safeSetItem(window.sessionStorage, key, value)
}

/** Gravação de cache com limite por chave: acima do limite, opera só em memória (retorna false). */
export function safeSetCacheItem(storage: StorageLike, key: string, value: string): boolean {
  if (value.length > MAX_CACHE_VALUE_LENGTH) {
    return false
  }
  return safeSetItem(storage, key, value)
}

/**
 * Aplica a guarda de quota em um protótipo de Storage (usado pelo installer global e pelos testes).
 * Idempotente: se já aplicado, não aplica de novo.
 */
export function patchStoragePrototype(proto: {
  setItem: (this: StorageLike, key: string, value: string) => void
}): boolean {
  const anyProto = proto as unknown as Record<string, unknown>
  if (anyProto.__rotalyQuotaGuardApplied) return true
  const original = proto.setItem
  if (typeof original !== 'function') return false

  const guarded = function (this: StorageLike, key: string, value: string) {
    try {
      original.call(this, key, value)
    } catch (err) {
      if (!isQuotaError(err)) throw err
      // Recuperação: eviction seletiva, depois agressiva, e por fim falha silenciosa.
      try {
        evictAppCache(this)
      } catch {
        /* ignore */
      }
      try {
        original.call(this, key, value)
        console.warn(`[safeStorage] Cota recuperada por eviction para a chave "${key}".`)
        return
      } catch (err2) {
        if (!isQuotaError(err2)) throw err2
      }
      try {
        evictAppCache(this, true)
      } catch {
        /* ignore */
      }
      try {
        original.call(this, key, value)
        console.warn(`[safeStorage] Cota recuperada por eviction agressiva para a chave "${key}".`)
        return
      } catch (err3) {
        if (!isQuotaError(err3)) throw err3
      }
      // NUNCA propagar erro de cota: o authStore do SDK mantém o estado em memória e o
      // login/logout/troca de perfil continuam funcionando em modo degradado (sem persistência).
      console.warn(
        `[safeStorage] Escrita de "${key}" descartada por cota de storage mesmo após eviction.`,
      )
    }
  } as unknown as typeof original

  anyProto.__rotalyOriginalSetItem = original
  anyProto.__rotalyQuotaGuardApplied = true
  proto.setItem = guarded
  return true
}

/**
 * Instala a guarda global no Storage.prototype do navegador.
 * Chame o mais cedo possível no boot (main.tsx importa este módulo primeiro).
 */
export function installGlobalStorageQuotaGuard(): boolean {
  if (typeof window === 'undefined' || typeof Storage === 'undefined') return false
  return patchStoragePrototype(Storage.prototype)
}

// Auto-instalação no carregamento do módulo: cobre qualquer escrita posterior de qualquer serviço.
installGlobalStorageQuotaGuard()

/**
 * Rotaly — Retries de escrita no PocketBase com backoff exponencial + jitter.
 *
 * Contexto (04/11/2026): tempestade de PATCH /api/collections/orders/records/<id>
 * com 429 Too Many Requests e 404 (ids inexistentes) saturando o backend e
 * derrubando consultas públicas (página /track/<code> mostrando "Rastreamento
 * Não Encontrado" para pedidos que existem).
 *
 * Regras desta classe de erro (aplicadas a TODO write de orders/locations):
 *  - 429 (Too Many Requests)  → retentar com backoff exponencial + jitter (máx 3 tentativas)
 *  - 404 (registro inexistente) → NUNCA retentar: abortar em silêncio com log único
 *  - 400 "Values don't match"  → não retentar (payload inválido p/ regra de coleção)
 *  - outros erros de rede      → 1 tentativa extra após backoff curto
 */
import { ClientResponseError } from 'pocketbase'

const MAX_ATTEMPTS = 3
const BASE_DELAY_MS = 600

/** Backoff exponencial com jitter: 600ms, 1200ms, 2400ms (±50%) */
export function sleepWithJitter(ms: number, jitter = 0.5): Promise<void> {
  const delta = ms * jitter
  const wait = Math.max(0, ms - delta) + Math.random() * delta * 2
  return new Promise((resolve) => setTimeout(resolve, wait))
}

function isClientResponseError(err: unknown): err is { status: number; response?: unknown } {
  return (
    !!err &&
    typeof err === 'object' &&
    'status' in (err as Record<string, unknown>) &&
    typeof (err as Record<string, unknown>).status === 'number'
  )
}

/** Extrai status HTTP de ClientResponseError do PocketBase (ou de erros parecidos). */
function extractStatus(err: unknown): number | null {
  if (isClientResponseError(err)) return err.status
  if (err instanceof ClientResponseError) return err.status
  return null
}

/** 404 de registro inexistente: nunca retentar. */
export function isNotFoundWriteError(err: unknown): boolean {
  return extractStatus(err) === 404
}

/** 429 Too Many Requests: retentar com backoff. */
export function isRateLimitWriteError(err: unknown): boolean {
  return extractStatus(err) === 429
}

/** Erro de rede (fetch falhou antes do HTTP): status 0 no ClientResponseError. */
function isNetworkError(err: unknown): boolean {
  return extractStatus(err) === 0
}

/** Log único por chave (evita spam de console em loop). */
const loggedOnce = new Set<string>()
function logOnce(key: string, fn: () => void) {
  if (loggedOnce.has(key)) return
  loggedOnce.add(key)
  fn()
}

/**
 * Executa uma escrita no PocketBase com retry apenas para 429/rede.
 * 404 e validação: aborta imediatamente (registro inexistente não volta a existir).
 */
export async function pbWriteRetry<T>(
  fn: () => Promise<T>,
  opts: { op?: string; maxAttempts?: number } = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS
  const op = opts.op || 'pbWrite'

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const status = extractStatus(err)

      // 404: registro inexistente — abortar silencioso com log único (nunca retentar)
      if (status === 404) {
        logOnce(`404:${op}`, () =>
          console.warn(
            `[pbWriteRetry:${op}] 404 registro inexistente — abortado sem retry (log único).`,
          ),
        )
        throw err
      }

      const isLast = attempt >= maxAttempts
      // 429 e erro de rede: backoff exponencial com jitter e nova tentativa
      if (!isLast && (isRateLimitWriteError(err) || isNetworkError(err))) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1)
        await sleepWithJitter(delay)
        continue
      }

      // Outros erros (validação 400, permissão 403): não retentar
      throw err
    }
  }
  throw new Error(`[pbWriteRetry:${op}] esgotou ${maxAttempts} tentativas`)
}

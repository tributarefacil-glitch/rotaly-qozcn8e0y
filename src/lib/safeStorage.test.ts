/**
 * src/lib/safeStorage.test.ts
 *
 * TESTES DE REGRESSÃO do conserto da cota do localStorage (bug de produção 2026-11).
 *
 * Classe do erro: o cache local do app (geometrias OSRM, rotas offline, buffers de
 * telemetria) cresce sem limite e estoura a cota (~5MB). Quando o login gravava a sessão
 * ('pocketbase_auth') via setItem, o Storage lançava QuotaExceededError ANTES de o
 * authStore salvar o estado em memória, e o fluxo de login inteiro falhava com:
 * "Failed to execute 'setItem' on 'Storage': Setting the value of 'pocketbase_auth'
 * exceeded the quota." (print da tela Login Lojista & Embarcador, v0.0.623).
 *
 * A cura tem duas camadas e ambas ficam travadas aqui:
 *  1. GUARDA GLOBAL: patch idempotente em Storage.prototype.setItem
 *     (patchStoragePrototype / installGlobalStorageQuotaGuard) que em erro de cota
 *     evicta o cache do PRÓPRIO app (prefixos rotaly_*), tenta de novo e, se ainda não
 *     couber, falha silenciosamente — NUNCA propaga a exceção (login não pode morrer).
 *  2. WRAPPER EXPLÍCITO com limite por chave: valores de cache acima de
 *     MAX_CACHE_VALUE_LENGTH (400k caracteres) nem tentam persistir — caem direto em
 *     memória (safeSetCacheItem retorna false), sem exceção.
 *
 * A varredura de TODOS os arquivos de src/** usa `import.meta.glob` com `query: '?raw'`:
 * o Vite entrega o texto integral dos arquivos em tempo de build, sem depender de tipos
 * de node (fs/path/__dirname), que o tsconfig do app (DOM) não enxerga. Padrão idêntico
 * ao whatsappTracking.test.ts. Se qualquer localStorage.setItem/sessionStorage.setItem
 * cru reaparecer fora de safeStorage.ts, este teste quebra.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  APP_CACHE_KEY_PREFIXES,
  MAX_CACHE_VALUE_LENGTH,
  isQuotaError,
  evictAppCache,
  safeSetItem,
  safeSetCacheItem,
  patchStoragePrototype,
  type StorageLike,
} from './safeStorage'

// ─────────────────────────────────────────────────────────────────────────────
// Mock de Storage com cota estourada (mesma mensagem do print de produção)
// ─────────────────────────────────────────────────────────────────────────────

/** Replica o erro exibido na tela de login do lojista (Chrome). */
const criarErroQuota = (chave = 'pocketbase_auth'): Error => {
  const err = new Error(
    `Failed to execute 'setItem' on 'Storage': Setting the value of '${chave}' exceeded the quota.`,
  )
  err.name = 'QuotaExceededError'
  return err
}

/**
 * Storage em memória com cota simulada: setItem lança QuotaExceededError quando o total
 * armazenado excede a cota. O protótipo dessa classe recebe o MESMO patch instalado no
 * Storage.prototype real pelo installGlobalStorageQuotaGuard — exercita o guard de verdade.
 */
class FakeQuotaStorage implements StorageLike {
  private readonly map = new Map<string, string>()
  private quota = Number.POSITIVE_INFINITY

  get length(): number {
    return this.map.size
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null
  }

  removeItem(key: string): void {
    this.map.delete(key)
  }

  setItem(key: string, value: string): void {
    const outros = new Map(this.map)
    outros.delete(key)
    let total = value.length
    for (const v of outros.values()) total += v.length
    if (total > this.quota) throw criarErroQuota(key)
    this.map.set(key, value)
  }

  /** Simula o armazenamento enchendo (dados de outros sites, cache acumulado...). */
  definirCota(quota: number): void {
    this.quota = quota
  }

  chaves(): string[] {
    return Array.from(this.map.keys())
  }

  chavesDeCache(): string[] {
    return this.chaves().filter((k) => APP_CACHE_KEY_PREFIXES.some((p) => k.startsWith(p)))
  }
}

/**
 * Instância com PROTÓTIPO PRÓPRIO (subclasse nova por chamada): o patch de cota é
 * aplicado no protótipo, e assim o patch de um teste nunca vaza para o seguinte.
 */
const criarStorageComCota = (quota: number): FakeQuotaStorage => {
  class InstanciaUnica extends FakeQuotaStorage {}
  const instancia = new InstanciaUnica()
  instancia.definirCota(quota)
  return instancia
}

/** Storage em memória simples (sem cota) para os testes dos wrappers. */
class FakeMemStorage implements StorageLike {
  private readonly map = new Map<string, string>()

  get length(): number {
    return this.map.size
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }

  removeItem(key: string): void {
    this.map.delete(key)
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
}

/** Sessão PocketBase de exemplo (mesma forma do registro salvo pelo authStore). */
const makeSessao = (): string =>
  JSON.stringify({
    token: 'token_de_teste',
    record: { id: 'usr_teste', email: 'lojista@teste.com', role: 'seller' },
  })

// ─────────────────────────────────────────────────────────────────────────────
// 1. Guarda global — login com storage CHEIO não lança QuotaExceededError
// ─────────────────────────────────────────────────────────────────────────────

describe('patchStoragePrototype (mesmo patch do Storage.prototype global)', () => {
  it('replica o bug do print SEM o patch: setItem de sessão com storage cheio lança QuotaExceededError', () => {
    const storage = criarStorageComCota(Number.POSITIVE_INFINITY)
    storage.setItem('rotaly_cache_route_r1', 'x'.repeat(700))
    storage.setItem('rotaly_osrm_leg_cache_r1', 'y'.repeat(700))
    storage.definirCota(1200) // storage cheio: sessão de ~130 chars não cabe

    expect(() => storage.setItem('pocketbase_auth', makeSessao())).toThrowError(
      /exceeded the quota/,
    )
  })

  it("COM o patch: setItem de 'pocketbase_auth' com storage cheio NÃO lança, evicta cache do app e persiste a sessão", () => {
    const storage = criarStorageComCota(Number.POSITIVE_INFINITY)
    storage.setItem('rotaly_cache_route_r1', 'x'.repeat(700))
    storage.setItem('rotaly_cache_route_r2', 'x'.repeat(700))
    storage.setItem('rotaly_osrm_leg_cache_r1', 'y'.repeat(700))
    storage.setItem('rotaly_active_empresa_id', 'empresa_1') // NÃO é cache: nunca evictada
    storage.definirCota(1500)

    const proto = Object.getPrototypeOf(storage) as unknown as {
      setItem: (key: string, value: string) => void
    }
    expect(patchStoragePrototype(proto)).toBe(true)

    // Classe do erro do print: a gravação da sessão no login NÃO pode propagar exceção.
    expect(() => storage.setItem('pocketbase_auth', makeSessao())).not.toThrow()

    // Recuperação por eviction: a sessão coube e ficou gravada.
    expect(storage.getItem('pocketbase_auth')).toBe(makeSessao())
    // O cache mais antigo do app foi descartado para abrir espaço.
    expect(storage.getItem('rotaly_cache_route_r1')).toBeNull()
    expect(storage.getItem('rotaly_cache_route_r2')).toBeNull()
    // Credenciais/contexto do usuário nunca são evictados.
    expect(storage.getItem('rotaly_active_empresa_id')).toBe('empresa_1')
  })

  it('pior caso: valor que não cabe nem com storage limpo falha silenciosamente (sem exceção, login segue)', () => {
    const storage = criarStorageComCota(100) // nem limpando o cache a sessão cabe

    const proto = Object.getPrototypeOf(storage) as unknown as {
      setItem: (key: string, value: string) => void
    }
    patchStoragePrototype(proto)

    let avisos = 0
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      avisos++
    })
    try {
      expect(() => storage.setItem('pocketbase_auth', makeSessao())).not.toThrow()
      expect(storage.getItem('pocketbase_auth')).toBeNull()
      expect(avisos).toBeGreaterThan(0)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('patch é idempotente: segunda aplicação não embrulha de novo', () => {
    const storage = criarStorageComCota(Number.POSITIVE_INFINITY)
    const proto = Object.getPrototypeOf(storage) as unknown as {
      setItem: (key: string, value: string) => void
      __rotalyOriginalSetItem?: unknown
      __rotalyQuotaGuardApplied?: boolean
    }
    expect(patchStoragePrototype(proto)).toBe(true)
    const aposPrimeira = proto.__rotalyOriginalSetItem
    expect(patchStoragePrototype(proto)).toBe(true)
    expect(proto.__rotalyOriginalSetItem).toBe(aposPrimeira)
  })

  it('erros que NÃO são de cota continuam propagando (não engole bug de código)', () => {
    const quebrado: StorageLike = {
      getItem: () => null,
      removeItem: () => undefined,
      length: 0,
      key: () => null,
      setItem: () => {
        throw new TypeError('argumento inválido')
      },
    }
    // safeSetItem só silencia erro de COTA; outros erros sobem.
    expect(() => safeSetItem(quebrado, 'rotaly_x', 'v')).toThrowError(TypeError)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Wrapper explícito — safeSetItem com eviction, evictAppCache e isQuotaError
// ─────────────────────────────────────────────────────────────────────────────

describe('safeSetItem — escrita protegida com eviction', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('grava direto quando há espaço', () => {
    const storage = new FakeMemStorage()
    expect(safeSetItem(storage, 'pocketbase_auth', makeSessao())).toBe(true)
    expect(storage.getItem('pocketbase_auth')).toBe(makeSessao())
  })

  it('estourou a cota: evicta o cache mais antigo do app primeiro e persiste a chave', () => {
    const storage = criarStorageComCota(Number.POSITIVE_INFINITY)
    storage.setItem('rotaly_cache_route_a', JSON.stringify({ timestamp: 1000, d: 'a'.repeat(300) }))
    storage.setItem('rotaly_cache_route_b', JSON.stringify({ timestamp: 2000, d: 'b'.repeat(300) }))
    storage.setItem('rotaly_cache_route_c', JSON.stringify({ timestamp: 3000, d: 'c'.repeat(300) }))
    storage.definirCota(700)

    expect(safeSetItem(storage, 'rotaly_cache_route_novo', 'n'.repeat(400))).toBe(true)
    expect(storage.getItem('rotaly_cache_route_novo')).toBe('n'.repeat(400))
    // A entrada mais antiga (timestamp 1000) foi a primeira candidata ao eviction.
    expect(storage.getItem('rotaly_cache_route_a')).toBeNull()
  })

  it('sem espaço nem com eviction agressiva: retorna false, sem exceção (estado segue em memória)', () => {
    const storage = criarStorageComCota(10)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(safeSetItem(storage, 'pocketbase_auth', makeSessao())).toBe(false)
    expect(storage.getItem('pocketbase_auth')).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('evictAppCache nunca toca chaves fora dos prefixos do app', () => {
    const storage = new FakeMemStorage()
    storage.setItem('pocketbase_auth', makeSessao())
    storage.setItem('rotaly_active_empresa_id', 'empresa_1')
    storage.setItem('rotaly_pending_route_finish_x', JSON.stringify({ enqueuedAt: 1 }))

    const removidas = evictAppCache(storage, true)

    expect(removidas).toBe(1)
    expect(storage.getItem('pocketbase_auth')).toBe(makeSessao())
    expect(storage.getItem('rotaly_active_empresa_id')).toBe('empresa_1')
    expect(storage.getItem('rotaly_pending_route_finish_x')).toBeNull()
  })

  it('isQuotaError reconhece as variantes de quota dos navegadores', () => {
    const chrome = criarErroQuota()
    const firefox = Object.assign(new Error('permissoes'), {
      name: 'NS_ERROR_DOM_QUOTA_REACHED',
    })
    const generica = new Error("Persistent storage maximum size '5242880' exceeded")
    expect(isQuotaError(chrome)).toBe(true)
    expect(isQuotaError(firefox)).toBe(true)
    expect(isQuotaError(generica)).toBe(true)
    expect(isQuotaError(new TypeError('x'))).toBe(false)
    expect(isQuotaError(null)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Limite por chave — cache acima de 400k caracteres nem tenta persistir
// ─────────────────────────────────────────────────────────────────────────────

describe('safeSetCacheItem — limite de MAX_CACHE_VALUE_LENGTH (400k caracteres)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('valor acima do limite: retorna false, NÃO chama setItem e NÃO lança exceção (só memória)', () => {
    const storage = new FakeMemStorage()
    const setItemSpy = vi.spyOn(storage, 'setItem')
    const gigante = 'g'.repeat(MAX_CACHE_VALUE_LENGTH + 1)

    expect(() => safeSetCacheItem(storage, 'rotaly_cache_route_geo', gigante)).not.toThrow()
    expect(safeSetCacheItem(storage, 'rotaly_cache_route_geo', gigante)).toBe(false)
    expect(setItemSpy).not.toHaveBeenCalled()
    expect(storage.getItem('rotaly_cache_route_geo')).toBeNull()
  })

  it('valor exatamente no limite ainda persiste (limite é exclusivo)', () => {
    const storage = new FakeMemStorage()
    const noLimite = 'g'.repeat(MAX_CACHE_VALUE_LENGTH)

    expect(safeSetCacheItem(storage, 'rotaly_cache_route_geo', noLimite)).toBe(true)
    expect(storage.getItem('rotaly_cache_route_geo')).toBe(noLimite)
  })

  it('o limite é 400_000 caracteres — acima disso a escrita cai em eviction/memória', () => {
    expect(MAX_CACHE_VALUE_LENGTH).toBe(400_000)
  })

  it('geometria de rota maior que o limite num storage COM cota não estoura o fluxo do chamador', () => {
    const storage = criarStorageComCota(1000)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const geometria = JSON.stringify({ pontos: new Array(500_000).fill([-22.6977, -43.2936]) })

    expect(() => safeSetCacheItem(storage, 'rotaly_osrm_leg_cache_l1', geometria)).not.toThrow()
    expect(safeSetCacheItem(storage, 'rotaly_osrm_leg_cache_l1', geometria)).toBe(false)
    expect(warnSpy).not.toHaveBeenCalled() // nem tenta gravar: corta antes, sem warning de quota
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. Varredura de código-fonte — nenhum setItem cru de localStorage/sessionStorage
//    fora de safeStorage.ts (se reaparecer, este teste quebra)
// ─────────────────────────────────────────────────────────────────────────────

describe('varredura de src/** — nenhuma escrita crua de storage fora de safeStorage.ts', () => {
  // Códigos-fonte integrais de todos os arquivos do app (string crua via ?raw)
  const fontesBrutas = import.meta.glob('/src/**/*.{tsx,ts}', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as unknown as Record<string, string>

  const lerFonte = (caminho: string): string => {
    const chave = Object.keys(fontesBrutas).find((k) => k.endsWith(`/${caminho}`))
    if (!chave) {
      throw new Error(`Arquivo não encontrado no glob de varredura: ${caminho}`)
    }
    return fontesBrutas[chave]
  }

  it('o glob enxerga os arquivos da varredura (guarda contra glob silenciosamente vazio)', () => {
    expect(Object.keys(fontesBrutas).length).toBeGreaterThan(50)
    lerFonte('lib/safeStorage.ts')
    lerFonte('contexts/AuthContext.tsx')
    lerFonte('pages/CourierApp.tsx')
  })

  it('nenhum arquivo do app contém localStorage.setItem ou sessionStorage.setItem cru', () => {
    const violations: string[] = []
    for (const [caminho, fonte] of Object.entries(fontesBrutas)) {
      // O módulo do guard é o único lugar do mundo que toca Storage diretamente;
      // arquivos de teste são código de verificação, não código do app.
      if (caminho.endsWith('lib/safeStorage.ts')) continue
      if (caminho.endsWith('.test.ts')) continue

      const linhas = fonte.split('\n')
      linhas.forEach((linha, i) => {
        const cortada = linha.trim()
        if (cortada.startsWith('//') || cortada.startsWith('*') || cortada.startsWith('/*')) return
        if (
          /localStorage\.setItem\s*\(/.test(cortada) ||
          /sessionStorage\.setItem\s*\(/.test(cortada)
        ) {
          violations.push(`${caminho} (linha ${i + 1}): ${cortada}`)
        }
      })
    }
    expect(violations).toEqual([])
  })

  it('gravadores de chaves rotaly_* usam o wrapper protegido (padrão do app)', () => {
    for (const rel of [
      'contexts/CompanyContext.tsx',
      'lib/companyResolver.ts',
      'services/deliveryService.ts',
    ]) {
      const fonte = lerFonte(rel)
      expect(fonte).toMatch(/safeSetLocalStorage|safeSetCacheItem|safeSetSessionStorage/)
      expect(fonte).not.toMatch(/localStorage\.setItem\s*\(/)
      expect(fonte).not.toMatch(/sessionStorage\.setItem\s*\(/)
    }
  })
})

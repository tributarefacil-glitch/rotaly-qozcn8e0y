/**
 * src/lib/whatsappTracking.test.ts
 *
 * TESTES DE REGRESSÃO do conserto do WhatsApp no APK do entregador.
 *
 * Classe do erro: no WebView do APK (Capacitor), wa.me navegado dentro do próprio
 * WebView não abre nada — o entregador tinha que copiar o número na mão. A cura tem
 * duas camadas e ambas ficam travadas aqui:
 *  1. Helper centralizado openCustomerWhatsApp: SEMPRE location.href (nunca window.open,
 *     que o WebView engole) e URL https://wa.me/55..., que o MainActivity.java nativo
 *     intercepta e lança como ACTION_VIEW externa.
 *  2. Normalização centralizada: DDI 55 + DDD 21 do RJ + 9º dígito + limpeza de máscara
 *     e de 0 de operadora — para o intent nativo abrir no contato certo.
 *
 * A varredura dos TRÊS pontos de contato do entregador (CourierApp.tsx,
 * CourierChatModal.tsx, CourierDeliveryHistoryModal.tsx) usa `import.meta.glob` com
 * `query: '?raw'`: o Vite entrega o texto integral dos arquivos em tempo de build,
 * sem depender de tipos de node (fs/path), que o tsconfig do app (DOM) não enxerga.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  DEFAULT_DDD,
  normalizeCustomerPhone,
  normalizeWhatsAppPhone,
  buildCourierCustomerMessage,
  openCustomerWhatsApp,
} from './whatsappTracking'

// Códigos-fonte integrais dos três pontos de contato (string crua via ?raw)
const fontesBrutas = import.meta.glob('/src/**/*.{tsx,ts}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as unknown as Record<string, string>

const lerFonte = (caminho: string): string => {
  const chave = Object.keys(fontesBrutas).find((k) => k.endsWith(`/${caminho}`))
  if (!chave) {
    throw new Error(`Arquivo de ponto de contato não encontrado no glob: ${caminho}`)
  }
  return fontesBrutas[chave]
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Normalização centralizada (classe do erro: número abria no contato errado)
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeWhatsAppPhone — normalização para o wa.me do APK', () => {
  it('DDI 55 anteposto a número com DDD 21 (celular RJ)', () => {
    expect(normalizeWhatsAppPhone('21987654321')).toBe('5521987654321')
    expect(normalizeWhatsAppPhone('(21) 98765-4321')).toBe('5521987654321')
  })

  it('8 ou 9 dígitos sem DDD recebem DDD 21 + DDI 55 (cliente GABY, 971344477)', () => {
    expect(normalizeWhatsAppPhone('971344477')).toBe('5521971344477')
    expect(normalizeWhatsAppPhone('97134-4477')).toBe('5521971344477')
    expect(normalizeWhatsAppPhone('26761499')).toBe('552126761499')
  })

  it('9º dígito preservado; 0 de operadora (021) removido', () => {
    expect(normalizeWhatsAppPhone('021987654321')).toBe('5521987654321')
    expect(normalizeWhatsAppPhone('55021987654321')).toBe('5521987654321')
    expect(normalizeWhatsAppPhone('5521987654321')).toBe('5521987654321')
  })

  it('telefone vazio/inválido retorna null (caller decide o aviso ao entregador)', () => {
    expect(normalizeWhatsAppPhone(null)).toBeNull()
    expect(normalizeWhatsAppPhone('')).toBeNull()
    expect(normalizeWhatsAppPhone('12345')).toBeNull()
  })

  it('normalizeCustomerPhone mantém o padrão nacional com DDD 21 do RJ', () => {
    expect(DEFAULT_DDD).toBe('21')
    expect(normalizeCustomerPhone('971344477')).toBe('21971344477')
    expect(normalizeCustomerPhone('5521971344477')).toBe('21971344477')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. openCustomerWhatsApp — camada JS do conserto (location.href, nunca window.open)
// ─────────────────────────────────────────────────────────────────────────────

describe('openCustomerWhatsApp — abertura do WhatsApp no APK', () => {
  const originalLocation = window.location
  const hrefHistory: string[] = []

  const installLocationStub = () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: false,
      value: {
        ...originalLocation,
        get href() {
          return 'https://app.rotaly.com.br/courier'
        },
        set href(v: string) {
          hrefHistory.push(v)
        },
      },
    })
  }

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    })
    hrefHistory.length = 0
    vi.restoreAllMocks()
  })

  it('usa location.href e NUNCA window.open (classe do erro do APK)', () => {
    installLocationStub()
    const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    const destino = openCustomerWhatsApp('(21) 98765-4321')

    expect(destino).toBe('5521987654321')
    expect(hrefHistory).toHaveLength(1)
    expect(hrefHistory[0]).toBe('https://wa.me/5521987654321')
    expect(windowOpenSpy).not.toHaveBeenCalled()
  })

  it('URL gerada é https://wa.me/ com DDI 55 (nunca http, nunca sem DDI)', () => {
    installLocationStub()

    openCustomerWhatsApp('97134-4477', 'Olá! Estou a caminho.')

    expect(hrefHistory).toHaveLength(1)
    const url = hrefHistory[0]
    expect(url.startsWith('https://wa.me/55')).toBe(true)
    expect(url).toContain('5521971344477')
    expect(url).toContain(`text=${encodeURIComponent('Olá! Estou a caminho.')}`)
  })

  it('sem mensagem: navega para https://wa.me/<numero> sem query de texto', () => {
    installLocationStub()

    openCustomerWhatsApp('21987654321')

    expect(hrefHistory[0]).toBe('https://wa.me/5521987654321')
  })

  it('mensagem só de espaços é tratada como ausente (sem ?text= vazio)', () => {
    installLocationStub()

    openCustomerWhatsApp('21987654321', '   ')

    expect(hrefHistory[0]).toBe('https://wa.me/5521987654321')
    expect(hrefHistory[0]).not.toContain('?text=')
  })

  it('telefone inválido NÃO navega e retorna null (nada de wa.me sem número)', () => {
    installLocationStub()

    const resultado = openCustomerWhatsApp('123')

    expect(resultado).toBeNull()
    expect(hrefHistory).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. buildCourierCustomerMessage — mensagem padrão do entregador ao cliente
// ─────────────────────────────────────────────────────────────────────────────

describe('buildCourierCustomerMessage', () => {
  const originalLocation = window.location
  const hrefHistory: string[] = []

  const installLocationStub = () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: false,
      value: {
        ...originalLocation,
        get href() {
          return 'https://app.rotaly.com.br/courier'
        },
        set href(v: string) {
          hrefHistory.push(v)
        },
      },
    })
  }

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    })
    hrefHistory.length = 0
  })

  it('inclui 1º nome do cliente e código de rastreio quando existem', () => {
    const msg = buildCourierCustomerMessage('Gaby Silva', 'TRK-2026-55615302')
    expect(msg).toBe(
      'Olá, Gaby! Sou o entregador do seu pedido TRK-2026-55615302. Estou a caminho.',
    )
  })

  it('sem código de rastreio, mensagem fica sem o código (nunca "undefined")', () => {
    const msg = buildCourierCustomerMessage('Gaby Silva', null)
    expect(msg).toBe('Olá, Gaby! Sou o entregador do seu pedido. Estou a caminho.')
    expect(msg).not.toContain('undefined')
  })

  it('sem nome do cliente, usa fallback Cliente', () => {
    const msg = buildCourierCustomerMessage(undefined, 'TRK-2026-41285998')
    expect(msg).toBe(
      'Olá, Cliente! Sou o entregador do seu pedido TRK-2026-41285998. Estou a caminho.',
    )
  })

  it('mensagem url-encoded dentro do wa.me corresponde ao texto gerado', () => {
    installLocationStub()
    const texto = buildCourierCustomerMessage('Gaby Silva', 'TRK-2026-55615302')

    openCustomerWhatsApp('97134-4477', texto)

    expect(hrefHistory[0]).toBe(`https://wa.me/5521971344477?text=${encodeURIComponent(texto)}`)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. Varredura dos TRÊS pontos de contato do entregador — helper centralizado
// ─────────────────────────────────────────────────────────────────────────────

describe('pontos de contato do entregador usam o helper centralizado (varredura de código-fonte)', () => {
  const pontos = [
    'pages/CourierApp.tsx',
    'components/CourierChatModal.tsx',
    'components/CourierDeliveryHistoryModal.tsx',
  ]

  it.each(pontos)('%s importa openCustomerWhatsApp e buildCourierCustomerMessage', (rel) => {
    const fonte = lerFonte(rel)
    expect(fonte).toMatch(
      /import\s*\{[^}]*openCustomerWhatsApp[^}]*\}\s*from\s*['"]@\/lib\/whatsappTracking/,
    )
    expect(fonte).toMatch(
      /import\s*\{[^}]*buildCourierCustomerMessage[^}]*\}\s*from\s*['"]@\/lib\/whatsappTracking/,
    )
    expect(fonte).toContain('openCustomerWhatsApp(')
    expect(fonte).toContain('buildCourierCustomerMessage(')
  })

  it('nenhum ponto de contato monta wa.me ad hoc nem usa window.open para WhatsApp', () => {
    for (const rel of pontos) {
      const fonte = lerFonte(rel)
      // wa.me só pode aparecer dentro de comentários, nunca montado em código
      const linhasComWaMe = fonte
        .split('\n')
        .filter((linha) => linha.includes('wa.me'))
        .filter((linha) => !linha.trim().startsWith('//') && !linha.trim().startsWith('*'))
      expect(linhasComWaMe).toEqual([])
      expect(fonte).not.toMatch(/window\.open\(\s*[^)]*wa\.me/)
    }
  })
})

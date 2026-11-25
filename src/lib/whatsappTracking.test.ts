/**
 * src/lib/whatsappTracking.test.ts
 *
 * TESTES DE REGRESSÃO do conserto do WhatsApp no APK do entregador.
 *
 * Classe do erro: no WebView do APK, https://wa.me/55... redireciona INTERNAMENTE
 * para whatsapp://send/... e redirecionamentos internos NÃO passam pelo
 * shouldOverrideUrlLoading — estourava net::ERR_UNKNOWN_URL_SCHEME dentro do app.
 * A cura DEFINITIVA tem três camadas e todas ficam travadas aqui:
 *  1. Ponte NATIVA window.RotalyNativeGps.openWhatsApp(numero, mensagem) no
 *     MainActivity.java (android/app e android-overlay): intent DIRETO com package
 *     com.whatsapp, sem passar por navegação do WebView; se o WhatsApp não estiver
 *     instalado, abre https://wa.me/... no navegador EXTERNO. O helper openCustomerWhatsApp
 *     prefere a ponte quando ela existir.
 *  2. Sem ponte (navegador comum): location.href com https://wa.me/55... (nunca
 *     window.open, que popup-blockers e alguns WebViews engolem).
 *  3. Normalização centralizada: DDI 55 + DDD 21 do RJ + 9º dígito + limpeza de máscara
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

// Código NATIVO do APK (MainActivity.java dos dois apps) e builds, também cru:
// a varredura precisa provar que a ponte openWhatsApp existe nos dois e que a
// versão subiu (versionCode 5 / versionName 1.0.4) nos dois build.gradle.
const fontesNativas = import.meta.glob(
  '/android*/app/{build.gradle,src/main/java/**/MainActivity.java}',
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
) as unknown as Record<string, string>

const TODAS_AS_FONTES: Record<string, string> = { ...fontesBrutas, ...fontesNativas }

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
// 2b. Ponte NATIVA window.RotalyNativeGps.openWhatsApp (cura definitiva do APK)
// ─────────────────────────────────────────────────────────────────────────────

describe('openCustomerWhatsApp — ponte nativa openWhatsApp (APK)', () => {
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
    delete (window as { RotalyNativeGps?: unknown }).RotalyNativeGps
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    })
    hrefHistory.length = 0
    vi.restoreAllMocks()
  })

  it('QUANDO a ponte nativa existe, chama openWhatsApp(numero, mensagem) e NÃO navega no WebView', () => {
    installLocationStub()
    const chamadas: Array<{ phone: string; message: string }> = []
    ;(window as { RotalyNativeGps?: unknown }).RotalyNativeGps = {
      openWhatsApp: (phone: string, message?: string) => {
        chamadas.push({ phone, message: message ?? '' })
        return true
      },
    }

    const destino = openCustomerWhatsApp(
      '(21) 98765-4321',
      'Olá, Gaby! Sou o entregador do seu pedido TRK-1. Estou a caminho.',
    )

    expect(destino).toBe('5521987654321')
    expect(chamadas).toEqual([
      {
        phone: '5521987654321',
        message: 'Olá, Gaby! Sou o entregador do seu pedido TRK-1. Estou a caminho.',
      },
    ])
    // nada é carregado dentro do WebView, nem wa.me nem qualquer outro esquema
    expect(hrefHistory).toHaveLength(0)
  })

  it('mensagem vazia chega à ponte como string vazia (sem ?text= vazio no intent nativo)', () => {
    installLocationStub()
    const chamadas: Array<{ phone: string; message: string }> = []
    ;(window as { RotalyNativeGps?: unknown }).RotalyNativeGps = {
      openWhatsApp: (phone: string, message?: string) => {
        chamadas.push({ phone, message: message ?? '' })
        return true
      },
    }

    openCustomerWhatsApp('21987654321', '   ')

    expect(chamadas).toEqual([{ phone: '5521987654321', message: '' }])
    expect(hrefHistory).toHaveLength(0)
  })

  it('ponte existindo mas retornando false (WhatsApp ausente no aparelho): helper cai para wa.me no navegador', () => {
    installLocationStub()
    ;(window as { RotalyNativeGps?: unknown }).RotalyNativeGps = {
      openWhatsApp: () => false,
    }

    const destino = openCustomerWhatsApp('97134-4477', 'Olá! Estou a caminho.')

    expect(destino).toBe('5521971344477')
    expect(hrefHistory).toHaveLength(1)
    expect(hrefHistory[0]).toBe(
      `https://wa.me/5521971344477?text=${encodeURIComponent('Olá! Estou a caminho.')}`,
    )
  })

  it('ponte lançando exceção: helper não quebra e cai para wa.me no navegador', () => {
    installLocationStub()
    ;(window as { RotalyNativeGps?: unknown }).RotalyNativeGps = {
      openWhatsApp: () => {
        throw new Error('ponte indisponível')
      },
    }

    const destino = openCustomerWhatsApp('21987654321')

    expect(destino).toBe('5521987654321')
    expect(hrefHistory).toHaveLength(1)
    expect(hrefHistory[0]).toBe('https://wa.me/5521987654321')
  })

  it('ponte recebe SEMPRE o número já normalizado com DDI 55 (nunca número cru)', () => {
    installLocationStub()
    const phonesRecebidos: string[] = []
    ;(window as { RotalyNativeGps?: unknown }).RotalyNativeGps = {
      openWhatsApp: (phone: string) => {
        phonesRecebidos.push(phone)
        return true
      },
    }

    for (const entrada of [
      '21968058149',
      '(21) 96805-8149',
      '021968058149',
      '968058149',
      '5521968058149',
    ]) {
      openCustomerWhatsApp(entrada, 'teste')
    }

    expect(phonesRecebidos).toEqual([
      '5521968058149',
      '5521968058149',
      '5521968058149',
      '5521968058149',
      '5521968058149',
    ])
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

  // REGRESSÃO DO BUG DO PRINT (APK v0.0.621, net::ERR_UNKNOWN_URL_SCHEME):
  // o WebView carregou `whatsapp://send/?phone=...&type=phone_number` — esquema que
  // o nativo não capturou. Nenhum código em src/ pode gerar/abrir whatsapp://.
  it('nenhum arquivo do app emite ou monta o esquema whatsapp:// (só https://wa.me/)', () => {
    for (const [caminho, fonte] of Object.entries(fontesBrutas)) {
      if (caminho.endsWith('.test.ts')) continue
      const linhas = fonte.split('\n')
      linhas.forEach((linha, i) => {
        const cortada = linha.trim()
        // permitido apenas em comentário documentando a proibição
        if (
          cortada.includes('whatsapp://') &&
          !cortada.startsWith('//') &&
          !cortada.startsWith('*') &&
          !cortada.startsWith('/*')
        ) {
          throw new Error(
            `Esquema proibido whatsapp:// em código de ${caminho} (linha ${i + 1}): ${cortada}`,
          )
        }
      })
      expect(fonte).not.toMatch(/['"`]whatsapp:\/\/send/)
      expect(fonte).not.toMatch(/location\.href\s*=\s*['"`]whatsapp:/)
    }
  })

  it('helper openCustomerWhatsApp consulta a ponte nativa no código-fonte (não só nos testes)', () => {
    const fonte = lerFonte('lib/whatsappTracking.ts')
    // helper referencia a ponte nativa (APK) antes do fallback do navegador
    expect(fonte).toMatch(/RotalyNativeGps\?\.\s*openWhatsApp/)
    // e a ordem do helper: ponte nativa PRIMEIRO, location.href wa.me DEPOIS
    const idxPonte = fonte.indexOf('RotalyNativeGps')
    const idxHref = fonte.indexOf('window.location.href')
    expect(idxPonte).toBeGreaterThan(-1)
    expect(idxHref).toBeGreaterThan(-1)
    expect(idxPonte).toBeLessThan(idxHref)
  })

  it('MainActivity.java dos DOIS apps nativos expõem openWhatsApp com package com.whatsapp', () => {
    const fontesJava = Object.entries(fontesNativas).filter(([caminho]) =>
      caminho.endsWith('/MainActivity.java'),
    )
    expect(fontesJava.length, 'dois MainActivity.java (android/app e android-overlay/app)').toBe(2)
    for (const [caminho, fonte] of fontesJava) {
      expect(fonte, caminho).toContain('public boolean openWhatsApp(String phone, String message)')
      expect(fonte, caminho).toContain('setPackage("com.whatsapp")')
      // fallback: navegador EXTERNO com wa.me quando o WhatsApp não está instalado
      expect(fonte, caminho).toMatch(/https:\/\/wa\.me\/" \+ digits/)
    }
  })

  it('build.gradle dos DOIS apps nativos em versionCode 5 / versionName 1.0.4', () => {
    const gradles = Object.entries(fontesNativas).filter(([caminho]) =>
      caminho.endsWith('/app/build.gradle'),
    )
    expect(gradles.length, 'dois build.gradle (android/app e android-overlay/app)').toBe(2)
    for (const [caminho, fonte] of gradles) {
      expect(fonte, caminho).toMatch(/versionCode\s+5\b/)
      expect(fonte, caminho).toMatch(/versionName\s+"1\.0\.4"/)
    }
  })

  it('openCustomerWhatsApp NUNCA emite whatsapp://: a URL é sempre https://wa.me/55...', () => {
    const hrefHistory: string[] = []
    const originalLocation = window.location
    const stub = () => {
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
    stub()
    try {
      // caso real do print: cliente com DDI+DDD+9º dígito (5521968058149)
      const destino = openCustomerWhatsApp('5521968058149', 'Olá! Estou a caminho.')

      expect(destino).toBe('5521968058149')
      expect(hrefHistory).toHaveLength(1)
      const url = hrefHistory[0]
      expect(url.startsWith('https://wa.me/55')).toBe(true)
      expect(url).not.toContain('whatsapp://')
      expect(url).not.toContain('send/?phone=')
      expect(url).not.toContain('type=phone_number')

      // e qualquer entrada normalizada sai sempre com DDI 55 na URL
      for (const entrada of ['21968058149', '(21) 96805-8149', '021968058149', '968058149']) {
        openCustomerWhatsApp(entrada, 'teste')
        const urlAtual = hrefHistory[hrefHistory.length - 1]
        expect(urlAtual.startsWith('https://wa.me/55')).toBe(true)
        expect(urlAtual).not.toContain('whatsapp://')
      }
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        writable: true,
        value: originalLocation,
      })
      hrefHistory.length = 0
    }
  })
})

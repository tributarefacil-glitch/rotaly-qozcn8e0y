import { describe, it, expect } from 'vitest'

// Teste de regressão do Guia do Entregador (/guia-do-entregador).
// Regra permanente do projeto: TODA correção/feature cria teste de regressão.
// Garante que a rota do guia existe em App.tsx e que os rótulos-chave dos
// botões do app aparecem no guia — se um rótulo mudar no CourierApp, este
// teste falha e obriga a atualizar o guia (varredura ?raw, padrão do projeto).

// Nota: em testes sob src/ (tsconfig DOM) nunca importar fs/path nem usar
// __dirname — ler arquivos de código com import.meta.glob ?raw (padrão
// estabelecido em whatsappTracking.test.ts).

const rawSources = import.meta.glob<string>('/src/**/*.{ts,tsx}', {
  query: '?raw',
  eager: true,
}) as Record<string, string>

function readSrc(relativePath: string): string {
  const match = Object.entries(rawSources).find(([p]) => p.endsWith(relativePath))
  if (!match) throw new Error(`Arquivo não encontrado na varredura: ${relativePath}`)
  return match[1]
}

describe('Guia do Entregador (/guia-do-entregador)', () => {
  const appTsx = readSrc('src/App.tsx')
  const guidePage = readSrc('CourierOnboardingGuidePage.tsx')
  const labels = readSrc('guideLabels.ts')

  it('a rota pública /guia-do-entregador está registrada no App.tsx', () => {
    expect(appTsx).toContain('path="/guia-do-entregador"')
    expect(appTsx).toContain('CourierOnboardingGuidePage')
  })

  it('a página do guia é carregada sem ProtectedRoute (acesso público)', () => {
    // A rota do guia NÃO pode estar dentro de um bloco ProtectedRoute:
    // verifica que existe uma <Route path="/guia-do-entregador" ...> cujo
    // elemento não cita ProtectedRoute no mesmo trecho declarativo.
    const routeMatches =
      appTsx.match(/<Route\s+path="\/guia-do-entregador"[\s\S]{0,400}?\/>/g) || []
    expect(routeMatches.length).toBeGreaterThan(0)
    for (const m of routeMatches) {
      expect(m).not.toContain('ProtectedRoute')
    }
  })

  it('o guia cobre os rótulos-chave dos botões do app (sync com CourierApp)', () => {
    // Rótulos exatos usados no CourierApp e nos modais do entregador
    expect(labels).toContain("'Iniciar Entrega (GPS)'")
    expect(labels).toContain("'Concluir Entrega'")
    expect(labels).toContain("'Cliente em outro endereço (Gravar Ponto A)'")
    expect(labels).toContain("'Não Atendido (Ausente / Recusa / Endereço)'")
    expect(labels).toContain("'Confirmar Entrega de Pedido'")

    // Os rótulos aparecem na página do guia (via import do labels ou literal)
    expect(guidePage).toContain('guideLabels')
    expect(labels).toContain("'Voltar para base: bloqueado'")
    expect(labels).toContain("'Finalize todas as entregas'")
    expect(labels).toContain("'Finalizar Manualmente'")
  })

  it('o guia mostra os textos visuais nas ilustrações dos mockups', () => {
    const mockups = readSrc('CourierGuideMockups.tsx')
    for (const rotulo of [
      'Iniciar Entrega (GPS)',
      'Concluir Entrega',
      'WhatsApp',
      'Cliente em outro endereço (Gravar Ponto A)',
      'Não Atendido (Ausente / Recusa / Endereço)',
      'Confirmar Entrega de Pedido',
      'Voltar para base (Google Maps)',
      'Finalizar Manualmente',
      'Entrega Atual',
    ]) {
      expect(mockups).toContain(rotulo)
    }
  })

  it('o link fixo de download do APK está destacado na etapa de instalação', () => {
    expect(labels).toContain(
      'https://github.com/tributarefacil-glitch/rotaly-qozcn8e0y/releases/download/apk-latest/Rotaly.apk',
    )
    expect(guidePage).toContain('Baixar o app (Rotaly.apk)')
    expect(guidePage).toContain('APK_DOWNLOAD_URL')
  })

  it('a página tem botão de impressão (Salvar como PDF)', () => {
    expect(guidePage).toContain('window.print()')
  })
})

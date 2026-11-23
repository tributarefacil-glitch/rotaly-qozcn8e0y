import { useEffect, useState } from 'react'
import {
  Printer,
  Smartphone,
  MapPin,
  MessageCircle,
  CheckCircle2,
  ShieldAlert,
  WifiOff,
  ChevronDown,
  Download,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  MockupLogin,
  MockupPermissao,
  MockupAceitarRota,
  MockupClienteAtual,
  MockupGoogleMaps,
  MockupForaDeOrdem,
  MockupComprovante,
  MockupPontoANaoAtendido,
  MockupVoltarBase,
  MockupOfflineChat,
} from '@/components/guide/CourierGuideMockups'
import {
  GUIDE_BUTTON_LABELS as L,
  APK_DOWNLOAD_URL,
  GUIDE_COLORS,
} from '@/components/guide/guideLabels'

// Página PÚBLICA (sem login): guia ilustrado de onboarding do APK do entregador.
// Não altera nada do funcionamento do app; é material de treinamento autônomo.

interface GuideStep {
  id: string
  titulo: string
  icone: React.ReactNode
  corAcento: string
  mockup: React.ReactNode
  passos: string[]
  destaque?: { texto: string; tipo: 'alerta' | 'ok' | 'info' }
}

const STEPS: GuideStep[] = [
  {
    id: 'instalacao',
    titulo: '1. Instalar o app Rotaly no seu celular',
    icone: <Smartphone className="h-4 w-4" />,
    corAcento: GUIDE_COLORS.azulIniciar,
    mockup: <MockupLogin />,
    passos: [
      'Toque no link de download abaixo (abra esta página no celular).',
      'Autorize a instalação do APK quando o Android perguntar (o app é da sua empresa).',
      'Abra o Rotaly e entre com o usuário e a senha que a base criou para você.',
    ],
    destaque: {
      texto: 'Download oficial do APK (link fixo, sempre a versão mais recente)',
      tipo: 'info',
    },
  },
  {
    id: 'permissoes',
    titulo: '2. Permitir localização "o tempo todo" e bateria',
    icone: <ShieldAlert className="h-4 w-4" />,
    corAcento: GUIDE_COLORS.laranjaPin,
    mockup: <MockupPermissao />,
    passos: [
      'No primeiro uso, o app pede a permissão de localização em segundo plano.',
      'Abra as configurações: Permissões > Localização > Permitir o tempo todo.',
      'Mantenha "Usar localização precisa" ativa.',
      'Desative a otimização de bateria do Rotaly (o app mostra o passo a passo do seu aparelho: Samsung, Xiaomi ou Motorola).',
    ],
    destaque: {
      texto: 'Sem isso, o Android corta o GPS e seus km não são contados corretamente.',
      tipo: 'alerta',
    },
  },
  {
    id: 'iniciar-rota',
    titulo: '3. Receber e aceitar a rota',
    icone: <MapPin className="h-4 w-4" />,
    corAcento: '#10B981',
    mockup: <MockupAceitarRota />,
    passos: [
      'A base monta sua rota e o app avisa com notificação e som.',
      'Confira quantidade de entregas e km previstos.',
      'Toque em "Aceitar".',
    ],
    destaque: {
      texto:
        'Ao aceitar, o GPS inicia automaticamente — a telemetria começa a gravar o km oficial da rota.',
      tipo: 'ok',
    },
  },
  {
    id: 'cliente-atual',
    titulo: '4. Tela da entrega atual (card do cliente)',
    icone: <MapPin className="h-4 w-4" />,
    corAcento: '#10B981',
    mockup: <MockupClienteAtual />,
    passos: [
      'O card verde "Entrega Atual" mostra cliente, endereço, valor e ponto de referência.',
      'Botão "Iniciar Entrega (GPS)": abre o Google Maps guiando até o cliente.',
      'Botão "WhatsApp": abre a conversa direta com o cliente (sem copiar número).',
      'Botão "Concluir Entrega": registra a entrega com comprovante.',
    ],
  },
  {
    id: 'navegacao',
    titulo: '5. Na rua: siga o Google Maps',
    icone: <MapPin className="h-4 w-4" />,
    corAcento: GUIDE_COLORS.azulIniciar,
    mockup: <MockupGoogleMaps />,
    passos: [
      'O Maps abre já apontando para o cliente atual (e as próximas paradas em sequência).',
      'O GPS continua gravando por trás, mesmo com a tela apagada.',
      'Se sair muito do caminho, o app avisa com som de alerta.',
    ],
    destaque: {
      texto: 'O km oficial é o km viário medido pela telemetria — não existe odômetro no Rotaly.',
      tipo: 'info',
    },
  },
  {
    id: 'comprovante',
    titulo: '6. Entregar: comprovante com foto/assinatura',
    icone: <CheckCircle2 className="h-4 w-4" />,
    corAcento: GUIDE_COLORS.verdeModal,
    mockup: <MockupComprovante />,
    passos: [
      'Chegou no cliente? Toque em "Concluir Entrega".',
      'O modal "Confirmar Entrega de Pedido" abre: confira cliente, código e valor.',
      'Tire a foto do comprovante e/ou pegue a assinatura do cliente.',
      'Toque em "Entrega confirmada!" — a posição GPS é gravada no toque do botão.',
    ],
    destaque: {
      texto:
        'O pin do cliente é capturado no toque de finalização — entregue sempre no local certo.',
      tipo: 'ok',
    },
  },
  {
    id: 'fora-de-ordem',
    titulo: '7. Entregas em sequência (fora de ordem)',
    icone: <ShieldAlert className="h-4 w-4" />,
    corAcento: GUIDE_COLORS.amberPontoA,
    mockup: <MockupForaDeOrdem />,
    passos: [
      'Só a "Entrega Atual" tem botões ativos; as próximas ficam travadas.',
      'Se tentar concluir uma parada futura, o app mostra "Entrega fora de ordem".',
      'Siga a ordem da rota otimizada: ela economiza km e tempo.',
    ],
    destaque: {
      texto: 'Próxima parada destravada automaticamente quando você conclui a atual.',
      tipo: 'ok',
    },
  },
  {
    id: 'ponto-a-nao-atendido',
    titulo: '8. Cliente mudou de endereço? Não estava? (Ponto A / Não Atendido)',
    icone: <MessageCircle className="h-4 w-4" />,
    corAcento: GUIDE_COLORS.amberPontoA,
    mockup: <MockupPontoANaoAtendido />,
    passos: [
      'Cliente em outro endereço? Toque em "Cliente em outro endereço (Gravar Ponto A)": o app grava sua posição GPS no local e você informa o novo endereço.',
      'No novo endereço, toque em "Confirmar Entrega Redirecionada" para gravar o Ponto B e o comprovante.',
      'Cliente ausente, recusou ou endereço errado? Toque em "Não Atendido (Ausente / Recusa / Endereço)" e escolha o motivo.',
    ],
    destaque: {
      texto: 'O Ponto A comprova que você chegou no endereço original antes do redirecionamento.',
      tipo: 'alerta',
    },
  },
  {
    id: 'voltar-base',
    titulo: '9. Terminar o dia: Voltar para base e Finalizar Manualmente',
    icone: <CheckCircle2 className="h-4 w-4" />,
    corAcento: GUIDE_COLORS.azulIniciar,
    mockup: <MockupVoltarBase />,
    passos: [
      'Conclua TODAS as entregas — enquanto houver pendentes, o app mostra "Voltar para base: bloqueado — Finalize todas as entregas".',
      'Concluído tudo, toque em "Voltar para base (Google Maps)" para o trajeto de retorno.',
      'Ao chegar na base, a cerca virtual de 150 m detecta sua chegada.',
      'Dentro da cerca, toque em "Finalizar Manualmente" para encerrar a rota e fechar o dia.',
    ],
    destaque: {
      texto: 'A rota só encerra dentro da cerca da base (150 m) ou por Finalizar Manualmente.',
      tipo: 'ok',
    },
  },
  {
    id: 'offline-chat',
    titulo: '10. Sem internet e falar com a base',
    icone: <WifiOff className="h-4 w-4" />,
    corAcento: GUIDE_COLORS.amberPontoA,
    mockup: <MockupOfflineChat />,
    passos: [
      'Tudo que você faz fica gravado no aparelho, mesmo sem sinal.',
      'Quando a internet voltar (ou fechar e abrir o app), o Rotaly sincroniza sozinho.',
      'Dúvida na rua? Use o botão flutuante de chat (canto da tela) para falar com a base.',
    ],
    destaque: {
      texto: 'Nada se perde offline — a sincronização é automática.',
      tipo: 'ok',
    },
  },
]

export default function CourierOnboardingGuidePage() {
  const [abertos, setAbertos] = useState<string[]>(STEPS.map((s) => s.id))
  const [guiaIphoneUrl, setGuiaIphoneUrl] = useState<string | null>(null)

  useEffect(() => {
    // Link do guia de GPS no iPhone só se a rota existir no app
    fetch('/guia-gps-iphone', { method: 'HEAD' })
      .then((r) => setGuiaIphoneUrl(r.ok ? '/guia-gps-iphone' : null))
      .catch(() => setGuiaIphoneUrl(null))
  }, [])

  const toggle = (id: string) =>
    setAbertos((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]))

  return (
    <div className="min-h-screen bg-slate-100 print:bg-white">
      {/* Cabeçalho fixo com título e botão imprimir */}
      <header className="sticky top-0 z-20 bg-[#003380] text-white shadow-md print:hidden">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 font-black">
            R
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-heading text-base font-black leading-tight">
              Guia do Entregador — Rotaly
            </h1>
            <p className="truncate text-[11px] text-blue-200">
              Do download do APK até finalizar o dia na base
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-white/15 px-3 py-2 text-xs font-bold hover:bg-white/25 print:hidden"
          >
            <Printer className="h-4 w-4" />
            <span className="hidden sm:inline">Imprimir</span>
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-4 pb-16 print:max-w-none print:px-0">
        {/* Aviso rápido */}
        <div className="mb-4 rounded-xl border-2 border-[#0052CC]/20 bg-white p-3 text-xs text-slate-700 print:border-slate-300">
          <p className="font-bold text-slate-900">Guia rápido para o primeiro dia</p>
          <p className="mt-0.5 leading-relaxed">
            Siga as etapas na ordem. Cada etapa mostra a tela real do app (botões com as cores e
            textos exatos). Toque no título para abrir ou fechar cada etapa.
          </p>
        </div>

        {/* Etapas */}
        <div className="space-y-3">
          {STEPS.map((step) => {
            const aberto = abertos.includes(step.id)
            return (
              <section
                key={step.id}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm print:break-inside-avoid print:shadow-none"
              >
                <button
                  type="button"
                  onClick={() => toggle(step.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                  style={{ borderLeft: `6px solid ${step.corAcento}` }}
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white"
                    style={{ background: step.corAcento }}
                  >
                    {step.icone}
                  </span>
                  <h2 className="flex-1 font-heading text-sm font-black leading-snug text-slate-900 sm:text-base">
                    {step.titulo}
                  </h2>
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 shrink-0 text-slate-400 transition-transform print:hidden',
                      aberto && 'rotate-180',
                    )}
                  />
                </button>

                {aberto && (
                  <div className="border-t border-slate-100 px-4 py-4 print:border-slate-200">
                    <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
                      <ol className="space-y-2">
                        {step.passos.map((p, i) => (
                          <li key={i} className="flex items-start gap-2.5">
                            <span
                              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-black text-white"
                              style={{ background: step.corAcento }}
                            >
                              {i + 1}
                            </span>
                            <span className="text-sm leading-relaxed text-slate-800">{p}</span>
                          </li>
                        ))}
                      </ol>
                      <div className="print:mx-auto">{step.mockup}</div>
                    </div>

                    {step.destaque && (
                      <div
                        className={cn(
                          'mt-3 rounded-xl p-3 text-xs font-semibold leading-relaxed',
                          step.destaque.tipo === 'alerta' &&
                            'bg-amber-50 text-amber-900 border border-amber-300',
                          step.destaque.tipo === 'ok' &&
                            'bg-emerald-50 text-emerald-900 border border-emerald-300',
                          step.destaque.tipo === 'info' &&
                            'bg-blue-50 text-blue-900 border border-blue-300',
                        )}
                      >
                        {step.destaque.texto}
                      </div>
                    )}

                    {/* Destaque do link de APK na etapa de instalação */}
                    {step.id === 'instalacao' && (
                      <a
                        href={APK_DOWNLOAD_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 flex items-center gap-2 rounded-xl bg-[#0052CC] px-4 py-3 text-white shadow hover:bg-[#0047B3] print:break-all print:text-[10px] print:underline"
                      >
                        <Download className="h-5 w-5 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-black">
                            Baixar o app (Rotaly.apk)
                          </span>
                          <span className="block truncate text-[10px] text-blue-100">
                            {APK_DOWNLOAD_URL}
                          </span>
                        </span>
                      </a>
                    )}
                  </div>
                )}
              </section>
            )
          })}
        </div>

        {/* Guia iPhone */}
        {guiaIphoneUrl && (
          <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 print:break-inside-avoid">
            <p className="font-bold">Usa iPhone?</p>
            <p className="mt-0.5">
              Consulte o guia de GPS no iPhone:{' '}
              <a
                href={guiaIphoneUrl}
                className="font-bold underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                {guiaIphoneUrl}
              </a>
            </p>
          </div>
        )}

        {/* Rodapé */}
        <footer className="mt-6 text-center text-[11px] text-slate-500 print:mt-2">
          Rotaly — Sistema de entregas com telemetria oficial por GPS. Guia do Entregador.
        </footer>
      </main>
    </div>
  )
}

import React from 'react'
import {
  Printer,
  Download,
  Share2,
  ArrowLeft,
  MapPin,
  Navigation,
  CheckCircle2,
  Fuel,
  AlertTriangle,
  WifiOff,
  CheckSquare,
  ShieldCheck,
  PhoneCall,
  ExternalLink,
  Info,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RotalyLogo } from '@/components/RotalyLogo'
import { useNavigate } from 'react-router-dom'

export default function CourierRedirectionPdfGuidePage() {
  const navigate = useNavigate()

  const handlePrint = () => {
    if (typeof window !== 'undefined') {
      window.print()
    }
  }

  const handleShare = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: 'Guia do Entregador — Entrega Redirecionada (Rotaly)',
          text: 'Guia passo a passo do fluxo de redireção de entregas e cálculo de combustível do Rotaly.',
          url: window.location.href,
        })
      } catch {
        // Usuário cancelou ou navegador não completou o share
      }
    } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(window.location.href)
      alert('Link copiado para a área de transferência! Cole no WhatsApp dos entregadores.')
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 font-sans antialiased print:bg-white print:p-0 print:m-0">
      {/* BARRA SUPERIOR DE AÇÕES (ESCONDIDA NA IMPRESSÃO) */}
      <header className="sticky top-0 z-50 bg-[#002855] text-white shadow-md print:hidden border-b border-blue-900">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                if (window.history.length > 1) {
                  navigate(-1)
                } else {
                  navigate('/courier/profile')
                }
              }}
              className="text-slate-200 hover:text-white hover:bg-white/10 h-9 px-2.5 rounded-lg flex items-center gap-1.5"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline text-xs font-semibold">Voltar</span>
            </Button>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-cyan-300 leading-tight">
                Material de Treinamento
              </p>
              <h1 className="text-sm font-extrabold truncate max-w-[220px] sm:max-w-md">
                Guia em PDF: Entrega Redirecionada
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleShare}
              className="border-blue-400/40 bg-blue-950/40 hover:bg-blue-900/60 text-white text-xs h-9 px-3 rounded-lg flex items-center gap-1.5"
              title="Copiar link ou compartilhar no WhatsApp"
            >
              <Share2 className="h-3.5 w-3.5 text-cyan-300" />
              <span className="hidden sm:inline">Compartilhar</span>
            </Button>

            <Button
              type="button"
              size="sm"
              onClick={handlePrint}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs h-9 px-4 rounded-lg shadow-md flex items-center gap-2 transition"
            >
              <Download className="h-4 w-4" />
              <span>Salvar como PDF</span>
            </Button>
          </div>
        </div>

        {/* Banner de instrução rápida para o usuário */}
        <div className="bg-[#001D3D] border-t border-blue-950 py-1.5 px-4 text-center text-[11px] text-blue-200 flex items-center justify-center gap-2">
          <Info className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
          <span>
            Clique em <strong>&quot;Salvar como PDF&quot;</strong> e no diálogo de impressão
            selecione <strong>&quot;Salvar como PDF&quot;</strong> no destino. Perfeito para enviar
            no WhatsApp!
          </span>
        </div>
      </header>

      {/* BOTÃO FLUTUANTE INFERIOR MOBILE (ESCONDIDO NA IMPRESSÃO) */}
      <div className="fixed bottom-4 right-4 z-40 sm:hidden print:hidden">
        <Button
          type="button"
          onClick={handlePrint}
          className="h-12 px-5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs shadow-2xl flex items-center gap-2 border-2 border-white"
        >
          <Printer className="h-4 w-4" />
          <span>Gerar / Baixar PDF</span>
        </Button>
      </div>

      {/* DOCUMENTO FORMATADO PARA IMPRESSÃO A4 */}
      <main className="max-w-[210mm] mx-auto my-6 p-4 sm:p-8 print:p-0 print:my-0 print:max-w-none">
        <div
          id="courier-guide-pdf-sheet"
          className="bg-white text-slate-900 shadow-xl print:shadow-none rounded-2xl print:rounded-none border border-slate-200 print:border-none p-6 sm:p-10 print:p-6 space-y-6"
        >
          {/* CABEÇALHO DO GUIA: LOGO + IDENTIDADE + TÍTULO */}
          <header className="border-b-2 border-[#002855] pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <RotalyLogo size="md" variant="image" blendMode={true} />
              <div className="border-l border-slate-300 pl-3">
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-[#00A3FF] block">
                  Treinamento Operacional
                </span>
                <span className="text-xs font-semibold text-slate-500">
                  Rotaly • Sua rota, nossa entrega
                </span>
              </div>
            </div>

            <div className="text-left sm:text-right">
              <Badge className="bg-[#002855] text-white border-none text-[10px] uppercase font-bold tracking-wider px-2.5 py-0.5">
                Manual de Campo
              </Badge>
              <p className="text-[11px] font-mono text-slate-400 mt-1">
                Versão 2025 • Para distribuição aos entregadores
              </p>
            </div>
          </header>

          {/* TÍTULO PRINCIPAL E INTRODUÇÃO */}
          <section className="bg-gradient-to-r from-[#002855] to-[#004B99] text-white p-5 rounded-xl shadow-sm">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-lg bg-amber-400 text-slate-950 font-black flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                <Navigation className="h-5 w-5 text-slate-950" />
              </div>
              <div>
                <h1 className="text-lg sm:text-xl font-extrabold tracking-tight leading-snug">
                  Guia do Entregador — Cliente em outro endereço
                </h1>
                <p className="text-xs sm:text-sm text-cyan-200 font-medium mt-1 leading-relaxed">
                  Fluxo oficial de <strong>Entrega Redirecionada</strong>, cálculo automático de km
                  extra e acompanhamento do saldo de combustível.
                </p>
              </div>
            </div>
          </section>

          {/* DIAGRAMA VISUAL A → B (ORIGEM DO SISTEMA ATÉ O NOVO LOCAL) */}
          <section className="border border-slate-200 bg-slate-50 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#002855] flex items-center gap-1.5">
                <Navigation className="h-3.5 w-3.5 text-[#00A3FF]" />
                Visão Geral do Desvio: Ponto A → Ponto B
              </span>
              <span className="text-[10px] font-semibold text-slate-500">
                Auditoria 100% Automática
              </span>
            </div>

            {/* SVG ilustrado do trajeto viário com Ponto A e Ponto B */}
            <div className="relative bg-white rounded-lg border border-slate-200 p-4 overflow-hidden">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center">
                {/* Ponto A */}
                <div className="p-3 rounded-lg bg-amber-50 border-2 border-amber-300 flex items-start gap-3">
                  <div className="h-9 w-9 rounded-full bg-amber-500 text-white font-black text-sm flex items-center justify-center shrink-0 shadow">
                    A
                  </div>
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 block">
                      1. Ponto A (Chegada)
                    </span>
                    <p className="text-xs font-extrabold text-slate-900 mt-0.5 leading-tight">
                      Endereço do Sistema
                    </p>
                    <p className="text-[10px] text-slate-600 mt-0.5">
                      Você chega no local planejado e grava a posição.
                    </p>
                  </div>
                </div>

                {/* Trajeto Intermediário com linha pontilhada */}
                <div className="flex flex-col items-center justify-center px-2 py-1 text-center">
                  <div className="flex items-center gap-2 w-full justify-center">
                    <div className="h-0.5 flex-1 border-t-2 border-dashed border-blue-400" />
                    <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-900 font-mono font-extrabold text-[10px] border border-blue-300">
                      + KM Extra Auditado
                    </span>
                    <div className="h-0.5 flex-1 border-t-2 border-dashed border-blue-400" />
                  </div>
                  <span className="text-[10px] font-semibold text-slate-500 mt-1">
                    Desvio pelo Waze ou Google Maps
                  </span>
                  <span className="text-[9px] text-emerald-700 font-bold">
                    ≤ 3 km = aprovação automática
                  </span>
                </div>

                {/* Ponto B */}
                <div className="p-3 rounded-lg bg-emerald-50 border-2 border-emerald-300 flex items-start gap-3">
                  <div className="h-9 w-9 rounded-full bg-emerald-600 text-white font-black text-sm flex items-center justify-center shrink-0 shadow">
                    B
                  </div>
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 block">
                      2. Ponto B (Novo Local)
                    </span>
                    <p className="text-xs font-extrabold text-slate-900 mt-0.5 leading-tight">
                      Onde o Cliente Está
                    </p>
                    <p className="text-[10px] text-slate-600 mt-0.5">
                      Confirma a entrega e corrige o cadastro oficial.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* AS 4 ETAPAS DO FLUXO (GRID ESTRUTURADO) */}
          <section className="space-y-4">
            <h2 className="text-xs font-extrabold uppercase tracking-widest text-slate-500 border-b border-slate-200 pb-1">
              Passo a Passo da Operação
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* ETAPA 1: PONTO A */}
              <div className="rounded-xl border-2 border-amber-200 bg-amber-50/40 p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-black uppercase">
                    <MapPin className="h-3 w-3" /> Etapa 1
                  </span>
                  <span className="text-[10px] font-bold text-amber-800 font-mono">
                    Local Oficial
                  </span>
                </div>
                <h3 className="text-sm font-extrabold text-slate-900 leading-snug">
                  Ponto A — Chegou no endereço do sistema
                </h3>
                <p className="text-xs text-slate-700 leading-relaxed">
                  Ao chegar no local previsto e constatar que o cliente está em outro endereço,
                  toque no botão:
                </p>
                <div className="p-2.5 rounded-lg bg-amber-500/15 border border-amber-400 text-amber-950 font-bold text-xs flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-amber-700 shrink-0" />
                  <span>&quot;Cliente em outro endereço (Gravar Ponto A)&quot;</span>
                </div>
                <ul className="text-[11px] text-slate-700 space-y-1 pl-1">
                  <li className="flex items-start gap-1.5">
                    <span className="text-amber-600 font-bold">•</span>
                    <span>
                      <strong>Comprovante de visita:</strong> O app grava sua localização exata para
                      provar à central que você cumpriu o trajeto planejado.
                    </span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="text-amber-600 font-bold">•</span>
                    <span>
                      <strong>Não saia do lugar antes de gravar:</strong> Acione o botão ainda em
                      frente ao endereço original para não perder a telemetria do Ponto A.
                    </span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="text-amber-600 font-bold">•</span>
                    <span>
                      <strong>Funciona sem internet:</strong> Mesmo sem sinal de dados, o celular
                      guarda o Ponto A e sincroniza sozinho depois.
                    </span>
                  </li>
                </ul>
              </div>

              {/* ETAPA 2: PONTO A -> B */}
              <div className="rounded-xl border-2 border-blue-200 bg-blue-50/40 p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#0052CC] text-white text-[10px] font-black uppercase">
                    <Navigation className="h-3 w-3" /> Etapa 2
                  </span>
                  <span className="text-[10px] font-bold text-blue-800 font-mono">Desvio</span>
                </div>
                <h3 className="text-sm font-extrabold text-slate-900 leading-snug">
                  Ponto A → B — Trajeto do desvio
                </h3>
                <p className="text-xs text-slate-700 leading-relaxed">
                  Digite o novo endereço ou a descrição do local repassado pelo cliente no campo de
                  texto:
                </p>
                <div className="p-2.5 rounded-lg bg-blue-100/70 border border-blue-300 text-blue-950 text-xs italic">
                  Ex.: &quot;Rua das Flores, 150 - Trabalho&quot;, &quot;portão azul da rua de
                  trás&quot; ou cole o texto que o cliente mandou no WhatsApp.
                </div>
                <ul className="text-[11px] text-slate-700 space-y-1 pl-1">
                  <li className="flex items-start gap-1.5">
                    <span className="text-blue-600 font-bold">•</span>
                    <span>
                      Toque em <strong>&quot;Ir para o novo endereço&quot;</strong>: o Rotaly abre
                      direto o Google Maps ou o Waze já com o caminho traçado.
                    </span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="text-blue-600 font-bold">•</span>
                    <span>
                      A entrega muda para o status <em>&quot;Redirecionada&quot;</em> e a rota fica
                      registrada em segundo plano.
                    </span>
                  </li>
                </ul>
              </div>

              {/* ETAPA 3: PONTO B */}
              <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50/40 p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-black uppercase">
                    <CheckCircle2 className="h-3 w-3" /> Etapa 3
                  </span>
                  <span className="text-[10px] font-bold text-emerald-800 font-mono">
                    Conclusão
                  </span>
                </div>
                <h3 className="text-sm font-extrabold text-slate-900 leading-snug">
                  Ponto B — Confirmação da entrega
                </h3>
                <p className="text-xs text-slate-700 leading-relaxed">
                  Ao entregar a encomenda no novo endereço, toque em{' '}
                  <strong>&quot;Confirmar entrega redirecionada&quot;</strong> e colete foto ou
                  assinatura.
                </p>
                <div className="p-2.5 rounded-lg bg-white border border-emerald-300 text-slate-800 text-xs space-y-1">
                  <div className="flex items-center justify-between font-bold text-emerald-800">
                    <span>Km Extra na hora:</span>
                    <span className="font-mono text-emerald-700">+ KM Calculado</span>
                  </div>
                  <p className="text-[10.5px] text-slate-600">
                    <strong>Até 3,0 km de desvio:</strong> aprovação automática no combustível.{' '}
                    <em>Acima de 3,0 km:</em> conferência simples da Central.
                  </p>
                </div>
                <div className="p-2 rounded-lg bg-emerald-100 border border-emerald-300 flex items-start gap-2">
                  <CheckSquare className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" />
                  <p className="text-[10.5px] text-emerald-950 leading-tight">
                    <strong>☑ Atualizar o endereço oficial deste cliente?</strong> Deixe marcado
                    quando for o endereço definitivo, para as próximas entregas já saírem certas!
                  </p>
                </div>
              </div>

              {/* ETAPA 4: ABA COMBUSTÍVEL */}
              <div className="rounded-xl border-2 border-purple-200 bg-purple-50/40 p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-purple-600 text-white text-[10px] font-black uppercase">
                    <Fuel className="h-3 w-3" /> Etapa 4
                  </span>
                  <span className="text-[10px] font-bold text-purple-800 font-mono">
                    Transparência
                  </span>
                </div>
                <h3 className="text-sm font-extrabold text-slate-900 leading-snug">
                  Aba Combustível — No menu inferior do app
                </h3>
                <p className="text-xs text-slate-700 leading-relaxed">
                  Acompanhe em tempo real suas contas de combustível com total clareza e sem
                  planilhas de papel.
                </p>
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="p-2 rounded-lg bg-white border border-purple-200">
                    <span className="text-[9px] font-bold uppercase text-slate-500 block">
                      Saldo em R$
                    </span>
                    <span className="text-xs font-black text-emerald-600">
                      Adiantamentos − Gasto
                    </span>
                  </div>
                  <div className="p-2 rounded-lg bg-white border border-purple-200">
                    <span className="text-[9px] font-bold uppercase text-slate-500 block">
                      Km Oficial
                    </span>
                    <span className="text-xs font-black text-blue-600">Rota + Redireções</span>
                  </div>
                </div>
                <ul className="text-[11px] text-slate-700 space-y-1 pl-1">
                  <li className="flex items-start gap-1.5">
                    <span className="text-purple-600 font-bold">•</span>
                    <span>
                      <strong>Alerta automático de 80%:</strong> Quando o consumo atinge 80% da
                      média, o sistema avisa o gestor para programar nova recarga antes de zerar.
                    </span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="text-purple-600 font-bold">•</span>
                    <span>
                      Tudo fica sincronizado com a Central: adiantamentos via PIX e km aprovados.
                    </span>
                  </li>
                </ul>
              </div>
            </div>
          </section>

          {/* CAIXA DE DESTAQUE: REGRAS IMPORTANTES */}
          <section className="rounded-xl border-2 border-rose-300 bg-rose-50/70 p-4 sm:p-5 space-y-3">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-rose-600 text-white flex items-center justify-center shrink-0">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <h2 className="text-sm sm:text-base font-extrabold uppercase tracking-wide text-rose-950">
                Atenção: Regras Obrigatórias do Desvio
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-800">
              <div className="p-3 rounded-lg bg-white border border-rose-200 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-rose-900">
                  <MapPin className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                  <span>Só acione no endereço original</span>
                </div>
                <p className="text-[11px] text-slate-600 leading-snug">
                  Use o botão <strong>SOMENTE</strong> quando chegar fisicamente no endereço do
                  sistema e o cliente avisar que está em outro local. Nunca grave de longe.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-white border border-rose-200 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-rose-900">
                  <PhoneCall className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                  <span>Não conseguiu entregar no Ponto B?</span>
                </div>
                <p className="text-[11px] text-slate-600 leading-snug">
                  Se marcou a redireção e <strong>NÃO</strong> entregou, a encomenda fica pendente
                  para a central operacional. <strong>Ligue e avise a equipe</strong> imediatamente.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-white border border-rose-200 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-rose-900">
                  <ShieldCheck className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                  <span>Km gravado sozinho</span>
                </div>
                <p className="text-[11px] text-slate-600 leading-snug">
                  O km extra é registrado automaticamente pelo sistema. Não se preocupe em anotar
                  odômetro ou marcar papel — o cálculo é 100% oficial.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-white border border-rose-200 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-rose-900">
                  <WifiOff className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                  <span>Sem internet na rua?</span>
                </div>
                <p className="text-[11px] text-slate-600 leading-snug">
                  Fique tranquilo: todas as ações (Ponto A, novo endereço e fotos) ficam guardadas
                  no celular e são enviadas sozinhas assim que o sinal 3G/4G/Wi-Fi voltar.
                </p>
              </div>
            </div>
          </section>

          {/* RODAPÉ DO DOCUMENTO */}
          <footer className="border-t border-slate-200 pt-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-slate-500 text-[10px]">
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-[#002855]">Rotaly Tecnologia em Logística</span>
              <span>•</span>
              <span>Central de Suporte Operacional</span>
            </div>
            <div className="flex items-center gap-2">
              <span>
                Tutorial disponível a qualquer momento no app: Perfil → Como usar redireção
              </span>
            </div>
          </footer>
        </div>
      </main>

      {/* CSS DE IMPRESSÃO EMBUTIDO PARA GARANTIR FORMATAÇÃO A4 PERFEITA */}
      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 10mm 12mm 10mm 12mm;
          }
          body {
            background-color: #ffffff !important;
            color: #000000 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          header, footer, nav, button, .print\\:hidden {
            display: none !important;
          }
          #courier-guide-pdf-sheet {
            box-shadow: none !important;
            border: none !important;
            padding: 0 !important;
            margin: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
          }
          .break-inside-avoid {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
        }
      `}</style>
    </div>
  )
}

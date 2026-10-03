import React, { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  MapPin,
  Compass,
  Navigation,
  CheckCircle2,
  Fuel,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Route,
  CheckSquare,
  ShieldCheck,
  AlertCircle,
  HelpCircle,
} from 'lucide-react'

export const COURIER_REDIRECTION_TUTORIAL_KEY = 'rotaly_courier_redirection_tutorial_seen'
export const COURIER_POINT_A_HINT_KEY = 'rotaly_courier_point_a_hint_seen'

interface CourierRedirectionTutorialModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onComplete?: () => void
}

export const CourierRedirectionTutorialModal: React.FC<CourierRedirectionTutorialModalProps> = ({
  open,
  onOpenChange,
  onComplete,
}) => {
  const [currentStep, setCurrentStep] = useState(0)

  const steps = [
    {
      id: 'step_1_point_a',
      badge: 'Etapa 1 de 4',
      badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
      title: 'Chegou no endereço e cliente não está?',
      subtitle: 'Como acionar o botão "Cliente em outro endereço" e registrar o Ponto A',
      renderIllustration: () => (
        <div className="relative w-full h-44 rounded-2xl bg-[#070D1E] border border-[#1E2B58] p-3 flex flex-col justify-between overflow-hidden shadow-inner select-none">
          {/* Fundo decorativo com malha viária sutil */}
          <div className="absolute inset-0 opacity-15 pointer-events-none">
            <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <pattern id="grid-pattern-1" width="24" height="24" patternUnits="userSpaceOnUse">
                  <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#60A5FA" strokeWidth="0.8" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid-pattern-1)" />
            </svg>
          </div>

          {/* Mini topo simulação do app */}
          <div className="flex items-center justify-between text-[11px] text-slate-400 z-10">
            <span className="font-semibold text-slate-300 flex items-center gap-1">
              <Route className="h-3.5 w-3.5 text-[#60A5FA]" /> Parada #1 • Endereço do Sistema
            </span>
            <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-[9px] px-1.5 py-0">
              Chegada Física
            </Badge>
          </div>

          {/* Diagrama Ponto A com GPS */}
          <div className="flex items-center justify-center gap-3 my-auto z-10">
            <div className="relative flex flex-col items-center">
              <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-lg ring-4 ring-amber-500/20 animate-pulse">
                <MapPin className="h-7 w-7 text-white" />
                <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-white text-slate-900 font-black text-[10px] shadow">
                  A
                </span>
              </div>
              <span className="mt-1.5 text-[11px] font-bold text-amber-300">Ponto A Gravado</span>
              <span className="text-[9px] text-slate-400">Local de Chegada Oficial</span>
            </div>

            <div className="flex flex-col items-center justify-center px-1">
              <ArrowRight className="h-5 w-5 text-slate-500" />
              <span className="text-[8px] font-mono text-slate-400 uppercase tracking-wider">
                GPS Telemetria
              </span>
            </div>

            <div className="p-2.5 rounded-xl bg-[#0A1128] border border-[#1E2B58] text-left max-w-[170px]">
              <span className="text-[9px] font-bold uppercase tracking-wider text-amber-400 block">
                Localização Fixada
              </span>
              <p className="text-[10px] text-slate-200 font-medium leading-tight mt-0.5">
                Sua posição exata é congelada como Ponto A para comprovar que você esteve no local.
              </p>
            </div>
          </div>

          {/* Botão simulado */}
          <div className="z-10 pt-1">
            <div className="h-9 w-full rounded-xl border border-amber-500/60 bg-amber-500/15 flex items-center justify-center gap-2 text-amber-200 text-xs font-bold shadow-sm">
              <Compass
                className="h-4 w-4 text-amber-400 animate-spin"
                style={{ animationDuration: '6s' }}
              />
              <span>[ Botão ] Cliente em outro endereço</span>
            </div>
          </div>
        </div>
      ),
      content: (
        <div className="space-y-2.5 text-xs text-slate-300">
          <p className="leading-relaxed">
            Ao chegar no endereço planejado pelo sistema e descobrir que o cliente mudou ou está em
            outro lugar, toque em{' '}
            <strong className="text-amber-300 font-bold">
              &quot;Cliente em outro endereço (Gravar Ponto A)&quot;
            </strong>
            .
          </p>
          <div className="p-3 rounded-xl bg-[#0A1128] border border-[#1E2B58] space-y-1.5">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <span className="text-[11px] text-slate-200">
                <strong>Auditoria protegida:</strong> O sistema grava o Ponto A no exato local da
                sua chegada, comprovando que você cumpriu o trajeto previsto.
              </span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <span className="text-[11px] text-slate-200">
                <strong>Funciona mesmo sem internet:</strong> Se estiver sem sinal de operadora, a
                coordenada fica salva no celular e sincroniza quando reconectar.
              </span>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'step_2_navigation',
      badge: 'Etapa 2 de 4',
      badgeColor: 'bg-blue-500/20 text-[#60A5FA] border-blue-500/30',
      title: 'Digite o novo local e abra o GPS',
      subtitle: 'Informe o endereço informado pelo cliente e acione "Ir para o novo endereço"',
      renderIllustration: () => (
        <div className="relative w-full h-44 rounded-2xl bg-[#070D1E] border border-[#1E2B58] p-3 flex flex-col justify-between overflow-hidden shadow-inner select-none">
          <div className="flex items-center justify-between text-[11px] text-slate-400 z-10">
            <span className="font-semibold text-slate-300 flex items-center gap-1">
              <Navigation className="h-3.5 w-3.5 text-[#00A3FF]" /> Rota de Desvio Ponto A → B
            </span>
            <Badge className="bg-blue-500/20 text-[#60A5FA] border-blue-500/30 text-[9px] px-1.5 py-0">
              Navegação
            </Badge>
          </div>

          {/* Diagrama Trajetória A -> B */}
          <div className="relative flex items-center justify-between px-4 my-auto z-10">
            {/* Ponto A */}
            <div className="flex flex-col items-center">
              <div className="h-10 w-10 rounded-xl bg-amber-500/20 border border-amber-500/50 flex items-center justify-center text-amber-300 font-bold text-xs shadow">
                A
              </div>
              <span className="text-[10px] font-bold text-amber-300 mt-1">Ponto A</span>
              <span className="text-[8px] text-slate-400">Origem</span>
            </div>

            {/* Linha pontilhada animada com distância */}
            <div className="flex-1 mx-3 flex flex-col items-center">
              <span className="text-[9px] font-mono font-bold text-[#60A5FA] mb-1">
                + Trajeto Waze / Maps
              </span>
              <div className="relative w-full h-1.5 bg-[#121E46] rounded-full overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-amber-500 via-[#00A3FF] to-emerald-400 animate-pulse" />
              </div>
              <span className="text-[8px] text-slate-400 mt-1">KM Extra auditado pelo Rotaly</span>
            </div>

            {/* Ponto B */}
            <div className="flex flex-col items-center">
              <div className="h-10 w-10 rounded-xl bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-center text-emerald-300 font-bold text-xs shadow ring-2 ring-emerald-500/20">
                B
              </div>
              <span className="text-[10px] font-bold text-emerald-300 mt-1">Ponto B</span>
              <span className="text-[8px] text-slate-400">Novo Local</span>
            </div>
          </div>

          {/* Botão de Ir para o novo endereço */}
          <div className="z-10 pt-1">
            <div className="h-9 w-full rounded-xl bg-gradient-to-r from-[#0052CC] to-[#0066FF] flex items-center justify-center gap-2 text-white text-xs font-bold shadow-md border border-blue-400/30">
              <Navigation className="h-4 w-4 text-[#60A5FA]" />
              <span>[ Botão ] Ir para o novo endereço (Abre Maps/Waze)</span>
            </div>
          </div>
        </div>
      ),
      content: (
        <div className="space-y-2.5 text-xs text-slate-300">
          <p className="leading-relaxed">
            No modal aberto, preencha o campo de texto com o novo endereço ou ponto de referência
            (ex: <em>&quot;Rua das Flores, 150 - Trabalho&quot;</em>) e toque em{' '}
            <strong className="text-white font-bold">&quot;Ir para o novo endereço&quot;</strong>.
          </p>
          <div className="p-3 rounded-xl bg-[#0A1128] border border-[#1E2B58] space-y-1.5">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#60A5FA] shrink-0 mt-0.5" />
              <span className="text-[11px] text-slate-200">
                <strong>Abertura direta do navegador:</strong> Abre seu aplicativo de navegação
                favorito (Google Maps ou Waze) já com a rota traçada até o cliente.
              </span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#60A5FA] shrink-0 mt-0.5" />
              <span className="text-[11px] text-slate-200">
                <strong>Rastreamento contínuo:</strong> A rota passa para o status de redireção e
                sua telemetria entre o Ponto A e o Ponto B é registrada.
              </span>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'step_3_confirm_and_update_address',
      badge: 'Etapa 3 de 4',
      badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
      title: 'Confirmação, KM Extra e Atualizar Cadastro',
      subtitle: 'Conclua no Ponto B e marque a opção para corrigir o endereço oficial do cliente',
      renderIllustration: () => (
        <div className="relative w-full h-44 rounded-2xl bg-[#070D1E] border border-[#1E2B58] p-3 flex flex-col justify-between overflow-hidden shadow-inner select-none">
          <div className="flex items-center justify-between text-[11px] text-slate-400 z-10">
            <span className="font-semibold text-slate-300 flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Confirmação no Ponto B
            </span>
            <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-[9px] px-1.5 py-0 font-mono">
              + KM Extra Calculado
            </Badge>
          </div>

          {/* Destaque do Checkbox "Marcar Endereço Correto" e do Botão */}
          <div className="space-y-2 z-10 my-auto">
            {/* Box simulando o checkbox do cadastro */}
            <div className="p-2.5 rounded-xl bg-blue-950/40 border border-blue-400/40 flex items-start gap-2">
              <div className="h-4 w-4 rounded bg-[#0052CC] border border-blue-300 flex items-center justify-center text-white shrink-0 mt-0.5">
                <CheckSquare className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-black text-white block">
                  ☑ Atualizar o endereço oficial deste cliente?
                </span>
                <span className="text-[8.5px] text-blue-200 leading-tight block mt-0.5">
                  Corrige o cadastro na origem para as próximas entregas não saírem erradas!
                </span>
              </div>
            </div>

            {/* Linha de KM Extra */}
            <div className="flex items-center justify-between px-2 py-1 rounded-lg bg-[#0A1128] border border-[#1E2B58] text-[10px]">
              <span className="text-slate-300">Desvio calculado A → B:</span>
              <span className="font-mono font-black text-emerald-400">
                +2.4 km (Aprovado auto ≤3km)
              </span>
            </div>
          </div>

          {/* Botão de confirmação */}
          <div className="z-10 pt-1">
            <div className="h-9 w-full rounded-xl bg-gradient-to-r from-emerald-600 to-green-600 flex items-center justify-center gap-2 text-white text-xs font-bold shadow-md border border-emerald-400/30">
              <CheckCircle2 className="h-4 w-4 text-white" />
              <span>[ Botão ] Confirmar entrega redirecionada</span>
            </div>
          </div>
        </div>
      ),
      content: (
        <div className="space-y-2.5 text-xs text-slate-300">
          <p className="leading-relaxed">
            Ao entregar no novo endereço, toque em{' '}
            <strong className="text-emerald-300 font-bold">
              &quot;Confirmar Entrega Redirecionada&quot;
            </strong>
            . O app captura o <strong className="text-white">Ponto B</strong> e calcula o km extra
            na hora.
          </p>
          <div className="p-3 rounded-xl bg-[#0A1128] border border-[#1E2B58] space-y-2">
            <div className="flex items-start gap-2">
              <CheckSquare className="h-4 w-4 text-[#60A5FA] shrink-0 mt-0.5" />
              <span className="text-[11px] text-slate-200">
                <strong className="text-white">Marcar o endereço correto do cliente:</strong>{' '}
                Mantenha marcada a caixa de seleção para atualizar o cadastro no sistema. Isso evita
                que você ou outro entregador vá ao endereço antigo de novo!
              </span>
            </div>
            <div className="flex items-start gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <span className="text-[11px] text-slate-200">
                <strong className="text-emerald-300">Aprovação de combustível:</strong> Desvios de
                até <strong>3,0 km</strong> são aprovados automaticamente no seu saldo. Acima de 3
                km, passam por conferência simples da Central.
              </span>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'step_4_fuel_tab',
      badge: 'Etapa 4 de 4',
      badgeColor: 'bg-green-500/20 text-emerald-300 border-green-500/30',
      title: 'Aba Combustível no App do Entregador',
      subtitle: 'Acompanhe seu saldo em R$, km oficial, consumo médio e alertas diários',
      renderIllustration: () => (
        <div className="relative w-full h-44 rounded-2xl bg-[#070D1E] border border-[#1E2B58] p-3 flex flex-col justify-between overflow-hidden shadow-inner select-none">
          <div className="flex items-center justify-between text-[11px] text-slate-400 z-10">
            <span className="font-semibold text-slate-300 flex items-center gap-1">
              <Fuel className="h-3.5 w-3.5 text-emerald-400" /> Aba Combustível (Menu Inferior)
            </span>
            <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-[9px] px-1.5 py-0">
              Sincronizado
            </Badge>
          </div>

          {/* Cards simulados de Saldo e KM */}
          <div className="grid grid-cols-2 gap-2 my-auto z-10">
            <div className="p-2.5 rounded-xl bg-[#0A1128] border border-[#1E2B58] text-left">
              <span className="text-[9px] uppercase font-bold text-slate-400 block">
                Saldo Disponível
              </span>
              <p className="font-heading font-black text-emerald-400 text-sm mt-0.5">R$ 142,80</p>
              <span className="text-[8px] text-slate-500">Adiantamentos - Gastos</span>
            </div>

            <div className="p-2.5 rounded-xl bg-[#0A1128] border border-[#1E2B58] text-left">
              <span className="text-[9px] uppercase font-bold text-slate-400 block">
                Km Oficial do Mês
              </span>
              <p className="font-heading font-black text-[#60A5FA] text-sm mt-0.5">384.2 km</p>
              <span className="text-[8px] text-slate-500">Viário oficial + Redireções</span>
            </div>
          </div>

          {/* Simulação do menu inferior destacando aba Combustível */}
          <div className="z-10 pt-1">
            <div className="h-8 w-full rounded-xl bg-[#0A1128] border border-[#1E2B58] flex items-center justify-around px-2 text-[10px] text-slate-400">
              <span className="text-slate-500">Minha Rota</span>
              <span className="text-emerald-400 font-bold flex items-center gap-1 bg-emerald-500/10 px-2 py-0.5 rounded-lg border border-emerald-500/30">
                <Fuel className="h-3 w-3" /> Combustível
              </span>
              <span className="text-slate-500">Histórico</span>
              <span className="text-slate-500">Perfil</span>
            </div>
          </div>
        </div>
      ),
      content: (
        <div className="space-y-2.5 text-xs text-slate-300">
          <p className="leading-relaxed">
            No menu inferior do app, acesse a aba{' '}
            <strong className="text-emerald-300 font-bold">&quot;Combustível&quot;</strong> a
            qualquer momento para auditar suas contas com 100% de transparência.
          </p>
          <div className="p-3 rounded-xl bg-[#0A1128] border border-[#1E2B58] space-y-1.5">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <span className="text-[11px] text-slate-200">
                <strong>O que ela mostra:</strong> Todos os adiantamentos recebidos via
                PIX/dinheiro, consumo real de litros, gasto oficial calculado por km e saldo
                atualizado.
              </span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <span className="text-[11px] text-slate-200">
                <strong>Alerta diário inteligente:</strong> Quando o consumo atinge 80% da média, o
                sistema avisa o gestor para sugerir a recarga antes que seu saldo acabe.
              </span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <span className="text-[11px] text-slate-200">
                <strong>Revisão a qualquer momento:</strong> Você pode rever este tutorial na aba{' '}
                <strong className="text-white">Perfil</strong> no card fixo{' '}
                <em>&quot;Como usar redireção&quot;</em>.
              </span>
            </div>
          </div>
        </div>
      ),
    },
  ]

  const activeStep = steps[currentStep]
  const isLast = currentStep === steps.length - 1

  const handleNext = () => {
    if (!isLast) {
      setCurrentStep((prev) => prev + 1)
    } else {
      handleFinish()
    }
  }

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1)
    }
  }

  const handleFinish = () => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(COURIER_REDIRECTION_TUTORIAL_KEY, 'true')
      } catch (err) {
        console.warn('[CourierRedirectionTutorialModal] Erro ao gravar localStorage:', err)
      }
    }
    onComplete?.()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-[#0A1128] border border-[#1E2B58] text-white p-5 rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader className="space-y-1 text-left">
          <div className="flex items-center justify-between">
            <Badge variant="outline" className={`text-[10px] font-bold ${activeStep.badgeColor}`}>
              {activeStep.badge}
            </Badge>
            {/* Indicadores de bolinha */}
            <div className="flex items-center gap-1.5">
              {steps.map((s, idx) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setCurrentStep(idx)}
                  className={`h-2 rounded-full transition-all duration-300 ${
                    idx === currentStep ? 'w-6 bg-[#00A3FF]' : 'w-2 bg-[#1E2B58] hover:bg-slate-600'
                  }`}
                  aria-label={`Ir para etapa ${idx + 1}`}
                />
              ))}
            </div>
          </div>

          <DialogTitle className="text-base font-bold text-white pt-1">
            {activeStep.title}
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-300">
            {activeStep.subtitle}
          </DialogDescription>
        </DialogHeader>

        {/* Ilustração / Diagrama do Passo Atual */}
        <div className="my-2">{activeStep.renderIllustration()}</div>

        {/* Explicações e Dicas */}
        <div>{activeStep.content}</div>

        {/* Rodapé de Navegação */}
        <div className="pt-3 border-t border-[#1E2B58] flex items-center justify-between gap-2">
          {currentStep > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePrev}
              className="border-[#1E2B58] bg-[#0E1738] hover:bg-[#121E46] text-slate-300 text-xs h-10 px-3 rounded-xl flex items-center gap-1"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Anterior</span>
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleFinish}
              className="text-slate-400 hover:text-white text-xs h-10 px-2 rounded-xl"
            >
              Pular tutorial
            </Button>
          )}

          <Button
            type="button"
            size="sm"
            onClick={handleNext}
            className={`text-xs h-10 px-4 rounded-xl font-bold flex items-center gap-1.5 shadow-lg flex-1 justify-center ${
              isLast
                ? 'bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white'
                : 'bg-gradient-to-r from-[#0052CC] to-[#0066FF] hover:from-[#0047B3] hover:to-[#0052CC] text-white border border-blue-400/30'
            }`}
          >
            {isLast ? (
              <>
                <Sparkles className="h-4 w-4 text-emerald-200" />
                <span>Entendi, vamos começar!</span>
              </>
            ) : (
              <>
                <span>Próximo passo</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default CourierRedirectionTutorialModal

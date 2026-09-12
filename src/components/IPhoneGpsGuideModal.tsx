import React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  HelpCircle,
  Settings,
  Compass,
  CheckCircle2,
  Smartphone,
  AlertTriangle,
  Sun,
  Crosshair,
} from 'lucide-react'

interface IPhoneGpsGuideModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onRetry?: () => void
}

export function IPhoneGpsGuideModal({ open, onOpenChange, onRetry }: IPhoneGpsGuideModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-[#0A1128] border border-[#1E2B58] text-slate-100 p-0 overflow-hidden shadow-2xl max-h-[90vh] flex flex-col">
        {/* Topo / Header */}
        <div className="bg-gradient-to-r from-[#0052CC]/40 via-[#0E1738] to-[#0A1128] p-5 border-b border-[#1E2B58]">
          <DialogHeader>
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/20 text-[#60A5FA] border border-blue-500/30">
                <Smartphone className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-white font-heading">
                  Como Liberar GPS no iPhone
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-400 mt-0.5">
                  Passo a passo rápido para o Safari e iOS
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        {/* Conteúdo com scroll */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1 text-xs text-slate-300">
          {/* Passo 1 - Barra de endereço do Safari (Mais rápido) */}
          <div className="rounded-xl border border-blue-500/30 bg-[#0E1738] p-3.5 space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white font-bold text-[11px]">
                1
              </span>
              <h3 className="font-bold text-white text-xs flex items-center gap-1.5">
                <Compass className="h-4 w-4 text-[#60A5FA]" />
                Pela Barra de Endereço do Safari (Mais Rápido)
              </h3>
            </div>
            <ol className="list-decimal list-inside space-y-1.5 pl-1 text-[11.5px] text-slate-300">
              <li>
                Na barra onde fica o site (topo ou rodapé do Safari), toque no ícone{' '}
                <strong className="text-white bg-slate-800 px-1.5 py-0.5 rounded font-mono">
                  aA
                </strong>
                .
              </li>
              <li>
                Toque em <strong className="text-white">Ajustes do Site</strong> (ou{' '}
                <strong className="text-white">Configurações do Site</strong>).
              </li>
              <li>
                Em <strong className="text-white">Localização</strong>, selecione{' '}
                <strong className="text-emerald-400">Permitir</strong> (evite deixar em
                &quot;Perguntar&quot;).
              </li>
              <li>Recarregue a página se solicitado.</li>
            </ol>
          </div>

          {/* Passo 2 - Ajustes do iOS > Safari */}
          <div className="rounded-xl border border-[#1E2B58] bg-[#0E1738] p-3.5 space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-white font-bold text-[11px]">
                2
              </span>
              <h3 className="font-bold text-white text-xs flex items-center gap-1.5">
                <Settings className="h-4 w-4 text-amber-400" />
                Ajustes Gerais do iPhone → Safari
              </h3>
            </div>
            <ol className="list-decimal list-inside space-y-1.5 pl-1 text-[11.5px] text-slate-300">
              <li>
                Abra o aplicativo <strong className="text-white">Ajustes</strong> do iPhone.
              </li>
              <li>
                Role até <strong className="text-white">Safari</strong> → toque em{' '}
                <strong className="text-white">Localização</strong>.
              </li>
              <li>
                Mude de &quot;Perguntar&quot; para{' '}
                <strong className="text-emerald-400">Permitir</strong>.
              </li>
            </ol>
          </div>

          {/* Passo 3 - Privacidade e Localização Precisa */}
          <div className="rounded-xl border border-[#1E2B58] bg-[#0E1738] p-3.5 space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-white font-bold text-[11px]">
                3
              </span>
              <h3 className="font-bold text-white text-xs flex items-center gap-1.5">
                <Crosshair className="h-4 w-4 text-rose-400" />
                Privacidade &amp; &quot;Localização Precisa&quot;
              </h3>
            </div>
            <ol className="list-decimal list-inside space-y-1.5 pl-1 text-[11.5px] text-slate-300">
              <li>
                Em <strong className="text-white">Ajustes</strong> →{' '}
                <strong className="text-white">Privacidade e Segurança</strong> →{' '}
                <strong className="text-white">Serviços de Localização</strong>.
              </li>
              <li>
                Verifique se está <strong className="text-emerald-400">Ativado</strong>.
              </li>
              <li>
                Toque em <strong className="text-white">Sites do Safari</strong> e marque{' '}
                <strong className="text-white">&quot;Durante o Uso do App&quot;</strong>.
              </li>
              <li>
                Ative a chave <strong className="text-emerald-400">Localização Precisa</strong>{' '}
                (essencial para calcular o km e não perder o sinal nos prédios).
              </li>
            </ol>
          </div>

          {/* Dica importante do iPhone: Bloqueio de Tela */}
          <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 p-3 flex items-start gap-2.5 text-[11.5px] text-amber-200">
            <Sun className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <strong className="text-white block font-semibold">
                Dica de Bateria e Tela no iPhone:
              </strong>
              O iOS suspende conexões quando a tela desliga. Ativamos o modo anti-bloqueio (Wake
              Lock) automaticamente na rota, mas mantenha o suporte no veículo com a tela ligada
              durante a entrega.
            </div>
          </div>
        </div>

        {/* Rodapé / Ações */}
        <div className="p-4 border-t border-[#1E2B58] bg-[#070D1E] flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-[#1E2B58] text-slate-300 hover:bg-[#121E46] text-xs h-10 px-4"
          >
            Entendi
          </Button>

          {onRetry && (
            <Button
              type="button"
              onClick={() => {
                onOpenChange(false)
                onRetry()
              }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs h-10 px-4 shadow-lg shadow-emerald-950/40"
            >
              <CheckCircle2 className="h-4 w-4 mr-1.5" />
              Tentar Localizar Agora
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

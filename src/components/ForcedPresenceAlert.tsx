import React, { useEffect } from 'react'
import { AlertOctagon, ArrowLeft, CheckCircle2, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

export type ForcedPresenceReason =
  | 'off_route' // Entregador fora do corredor viário (>600m)
  | 'stopped_off_route' // Entregador parado fora do local da rota
  | 'at_base_unfinalized' // Entregador chegou à base sem encerrar a rota

interface ForcedPresenceAlertProps {
  open: boolean
  reason: ForcedPresenceReason
  details?: {
    distanceMeters?: number
    durationMinutes?: number
    trackingCode?: string
    timeAtBase?: string
    openRouteDuration?: string
  }
  onAcknowledge: () => void
  onAction?: () => void
  actionLabel?: string
}

export const ForcedPresenceAlert: React.FC<ForcedPresenceAlertProps> = ({
  open,
  reason,
  details,
  onAcknowledge,
  onAction,
  actionLabel,
}) => {
  useEffect(() => {
    // Tenta vibrar o aparelho celular repetidamente se suportado pela API
    if (open && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate([400, 200, 400, 200, 600])
      } catch {
        /* ignore */
      }
    }
  }, [open])

  if (!open) return null

  let title = 'ALERTA DE SEGURANÇA NA ROTA'
  let mainMessage = ''
  let subMessage = ''

  if (reason === 'off_route') {
    title = 'VOCÊ ESTÁ FORA DA ROTA'
    mainMessage = 'VOCÊ ESTÁ FORA DA ROTA — volte ao trajeto'
    subMessage = details?.distanceMeters
      ? `Desvio de ${details.distanceMeters}m do corredor viário planejado da entrega ${details.trackingCode || ''}. Retorne imediatamente ao traçado oficial.`
      : 'Desvio viário superior a 600 metros detectado. Retorne imediatamente ao traçado oficial da rota.'
  } else if (reason === 'stopped_off_route') {
    title = 'PARADA FORA DA ROTA'
    mainMessage = 'Você está parado fora do local da rota'
    subMessage = details?.durationMinutes
      ? `Parada não programada detectada há mais de ${details.durationMinutes} min fora dos pontos de parada da rota. Continue o trajeto.`
      : 'Parada suspeita fora do trajeto viário planejado. Continue o trajeto ou justifique na central.'
  } else if (reason === 'at_base_unfinalized') {
    title = 'CHEGADA À BASE DETECTADA'
    mainMessage = 'Você chegou à base — finalize a rota antes de encerrar o expediente'
    subMessage =
      'Seu GPS detectou presença na Base Mais Saudável. Conclua a conferência do odômetro e finalize a rota antes de sair.'
  }

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      className="fixed inset-0 z-[99999] flex flex-col items-center justify-between bg-red-600 text-white p-6 sm:p-10 select-none animate-in fade-in zoom-in-95 duration-200"
      style={{ minHeight: '100dvh' }}
    >
      {/* Topo: Ícone e Badge */}
      <div className="w-full flex items-center justify-between border-b border-red-500/80 pb-4">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-7 w-7 text-white animate-pulse" />
          <span className="text-xs font-black uppercase tracking-widest text-red-100">
            Rotaly · Presença Forçada
          </span>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-700 text-white text-xs font-bold animate-pulse">
          <span className="h-2 w-2 rounded-full bg-white animate-ping" />
          ALERTA ATIVO
        </div>
      </div>

      {/* Centro: Mensagem de Impacto Máximo */}
      <div className="max-w-md w-full text-center space-y-6 my-auto py-6">
        <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-3xl bg-white text-red-600 shadow-2xl animate-bounce">
          <AlertOctagon className="h-14 w-14" />
        </div>

        <div className="space-y-3">
          <span className="text-xs font-black uppercase tracking-wider text-red-200">{title}</span>
          <h1 className="text-2xl sm:text-3xl font-black uppercase tracking-tight text-white leading-tight drop-shadow-md">
            {mainMessage}
          </h1>
          <p className="text-sm sm:text-base text-red-100/90 font-medium leading-relaxed max-w-sm mx-auto">
            {subMessage}
          </p>
        </div>

        {details?.openRouteDuration && (
          <div className="p-3 rounded-xl bg-red-700/80 border border-red-400/50 text-xs text-red-100 font-mono">
            Tempo de Rota Aberta: <strong>{details.openRouteDuration}</strong>
          </div>
        )}
      </div>

      {/* Rodapé: Ações obrigatórias */}
      <div className="w-full max-w-md space-y-3 pt-4 border-t border-red-500/80">
        {onAction && actionLabel && (
          <Button
            type="button"
            size="lg"
            onClick={onAction}
            className="w-full h-14 rounded-2xl bg-white hover:bg-slate-100 text-red-700 font-black text-base shadow-2xl gap-2 active:scale-95 transition-all"
          >
            <CheckCircle2 className="h-5 w-5" />
            {actionLabel}
          </Button>
        )}

        <Button
          type="button"
          size="lg"
          variant="outline"
          onClick={onAcknowledge}
          className="w-full h-14 rounded-2xl border-2 border-white bg-transparent hover:bg-white/10 text-white font-black text-base shadow-lg gap-2 active:scale-95 transition-all"
        >
          <ArrowLeft className="h-5 w-5" />
          Entendi (Ciente do Alerta)
        </Button>
        <p className="text-[11px] text-center text-red-200/80">
          Ao tocar em "Entendi", a confirmação é registrada na auditoria e o alarme é silenciado.
        </p>
      </div>
    </div>
  )
}

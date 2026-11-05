import React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Navigation, MapPin } from 'lucide-react'
import { nativeGpsBridge } from '@/services/nativeGpsBridge'

export interface NavigationWaypoint {
  lat?: number | string | null
  lng?: number | string | null
  address?: string | null
  label?: string | null
}

export interface NavigationTargetPayload {
  name: string
  address: string
  lat?: number
  lng?: number
  waypoints?: NavigationWaypoint[]
  totalPendingStops?: number
  windowStopsCount?: number
}

interface NavigationAppChoiceModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  destinationName?: string
  destinationAddress?: string
  firstStopName?: string
  firstStopAddress?: string
  lat?: number | string | null
  lng?: number | string | null
  origin?: { lat?: number | string | null; lng?: number | string | null }
  remainingWaypoints?: NavigationWaypoint[]
  totalRemainingStops?: number
  currentWindowStopCount?: number
  onNavigateStarted?: () => void
}

export const NavigationAppChoiceModal: React.FC<NavigationAppChoiceModalProps> = ({
  open,
  onOpenChange,
  destinationName,
  destinationAddress,
  firstStopName,
  firstStopAddress,
  lat,
  lng,
  origin,
  remainingWaypoints,
  totalRemainingStops,
  currentWindowStopCount,
  onNavigateStarted,
}) => {
  // Limpeza preventiva de preferência legada Waze
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const legacyNav = localStorage.getItem('preferred_navigation_app')
        if (legacyNav === 'waze') {
          localStorage.setItem('preferred_navigation_app', 'google_maps')
        }
      } catch {
        // Silencioso
      }
    }
  }, [])

  const handleStartNavigation = () => {
    nativeGpsBridge.openNavigation({
      lat,
      lng,
      address: destinationAddress,
      label: destinationName,
      origin,
      waypoints: remainingWaypoints,
      app: 'google_maps',
    })
    onNavigateStarted?.()
    onOpenChange(false)
  }

  const waypointsCount = remainingWaypoints?.length || 0
  const stopsInThisWindow =
    currentWindowStopCount || waypointsCount + (destinationAddress || lat ? 1 : 0)
  const totalPending = totalRemainingStops || stopsInThisWindow

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-[#0E1738] border border-[#1E2B58] text-white p-5 rounded-2xl">
        <DialogHeader className="space-y-1.5 text-left">
          <div className="flex items-center gap-2 text-cyan-400">
            <Navigation className="h-5 w-5" />
            <DialogTitle className="text-base font-bold text-white">
              Navegação Google Maps Otimizada
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-slate-300">
            O Rotaly continua rastreando em segundo plano enquanto você navega na ordem exata da
            rota otimizada.
          </DialogDescription>
        </DialogHeader>

        {destinationName && (
          <div className="rounded-xl bg-[#14214D] border border-[#23356E] p-3 text-xs space-y-2">
            {/* Primeira parada do trajeto (se houver rota com waypoints e firstStopName diferente ou igual) */}
            {firstStopName && waypointsCount > 0 ? (
              <div className="space-y-0.5">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-400 flex items-center gap-1">
                  <span>1ª Parada Imediata</span>
                  <span className="text-slate-400 font-normal">(Início do trajeto)</span>
                </span>
                <div className="flex items-center gap-2 text-white font-bold truncate">
                  <MapPin className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span className="truncate">{firstStopName}</span>
                </div>
                {firstStopAddress && (
                  <p className="text-[11px] text-slate-300 truncate pl-6">{firstStopAddress}</p>
                )}
              </div>
            ) : null}

            {/* Destino final do trecho */}
            <div
              className={`space-y-0.5 ${waypointsCount > 0 ? 'pt-2 border-t border-[#23356E]' : ''}`}
            >
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-cyan-400 flex items-center gap-1">
                <span>
                  {waypointsCount > 0 ? 'Destino Final deste Trecho' : 'Destino da Navegação'}
                </span>
              </span>
              <div className="flex items-center gap-2 text-slate-200 font-bold truncate">
                <MapPin className="h-4 w-4 text-cyan-400 shrink-0" />
                <span className="truncate">{destinationName}</span>
              </div>
              {destinationAddress && (
                <p className="text-[11px] text-slate-400 truncate pl-6">{destinationAddress}</p>
              )}
            </div>

            {waypointsCount > 0 && (
              <div className="pt-2 border-t border-[#23356E] text-[11px] text-cyan-300 pl-1 space-y-1">
                <p className="font-semibold text-white">
                  Janela ativa: {stopsInThisWindow} parada(s) no trajeto do Google Maps
                </p>
                <p className="text-[10px] text-slate-300 leading-relaxed">
                  A navegação começa na 1ª parada ({firstStopName || 'atual'}), passa pelas
                  seguintes na sequência exata e termina no destino final do trecho.
                </p>
                {totalPending > stopsInThisWindow && (
                  <p className="text-[10px] text-amber-300 font-medium leading-relaxed">
                    Rota total com {totalPending} paradas pendentes: o próximo trecho será carregado
                    automaticamente conforme você for concluindo as entregas.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <div className="pt-2">
          {/* Única opção oficial: Google Maps com ordem otimizada */}
          <Button
            type="button"
            onClick={handleStartNavigation}
            className="w-full h-14 bg-gradient-to-r from-[#34A853] to-[#1EA362] hover:from-[#2e944a] hover:to-[#1a8c54] text-white font-black text-sm rounded-xl flex items-center justify-center gap-3 shadow-lg border border-emerald-400/30 transition hover:scale-[1.01]"
          >
            <Navigation className="h-5 w-5 text-white" />
            <div className="text-left">
              <div className="text-xs uppercase font-extrabold tracking-wider text-emerald-100 leading-none">
                Iniciar Navegação Otimizada
              </div>
              <div className="text-base font-black text-white">Abrir no Google Maps</div>
            </div>
          </Button>
        </div>

        <p className="text-[11px] text-center text-slate-400 pt-1">
          Ao terminar o trajeto no GPS externo, volte ao Rotaly para confirmar a entrega.
        </p>
      </DialogContent>
    </Dialog>
  )
}

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

interface NavigationAppChoiceModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  destinationName?: string
  destinationAddress?: string
  lat?: number
  lng?: number
  onNavigateStarted?: () => void
}

export const NavigationAppChoiceModal: React.FC<NavigationAppChoiceModalProps> = ({
  open,
  onOpenChange,
  destinationName,
  destinationAddress,
  lat,
  lng,
  onNavigateStarted,
}) => {
  const handleChoose = (app: 'waze' | 'google_maps') => {
    nativeGpsBridge.openNavigation({
      lat,
      lng,
      address: destinationAddress,
      app,
    })
    onNavigateStarted?.()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-[#0E1738] border border-[#1E2B58] text-white p-5 rounded-2xl">
        <DialogHeader className="space-y-1.5 text-left">
          <div className="flex items-center gap-2 text-cyan-400">
            <Navigation className="h-5 w-5" />
            <DialogTitle className="text-base font-bold text-white">
              Escolher Aplicativo de Navegação
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-slate-300">
            O Rotaly continua rastreando em segundo plano enquanto você navega. Escolha seu app
            preferido:
          </DialogDescription>
        </DialogHeader>

        {destinationName && (
          <div className="rounded-xl bg-[#14214D] border border-[#23356E] p-3 text-xs space-y-1">
            <div className="flex items-center gap-2 text-slate-200 font-bold truncate">
              <MapPin className="h-4 w-4 text-emerald-400 shrink-0" />
              <span className="truncate">{destinationName}</span>
            </div>
            {destinationAddress && (
              <p className="text-[11px] text-slate-400 truncate pl-6">{destinationAddress}</p>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          {/* Opção Waze */}
          <Button
            type="button"
            onClick={() => handleChoose('waze')}
            className="h-14 bg-gradient-to-r from-[#33CCFF] to-[#00A8E8] hover:from-[#29b8e6] hover:to-[#0095d0] text-slate-950 font-black text-sm rounded-xl flex items-center justify-center gap-3 shadow-lg border border-cyan-300/30 transition hover:scale-[1.02]"
          >
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-lg">
              🚗
            </div>
            <div className="text-left">
              <div className="text-xs uppercase font-extrabold tracking-wider text-slate-900 leading-none">
                Navegar com
              </div>
              <div className="text-base font-black text-slate-950">Waze</div>
            </div>
          </Button>

          {/* Opção Google Maps */}
          <Button
            type="button"
            onClick={() => handleChoose('google_maps')}
            className="h-14 bg-gradient-to-r from-[#34A853] to-[#1EA362] hover:from-[#2e944a] hover:to-[#1a8c54] text-white font-black text-sm rounded-xl flex items-center justify-center gap-3 shadow-lg border border-emerald-400/30 transition hover:scale-[1.02]"
          >
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-lg">
              🗺️
            </div>
            <div className="text-left">
              <div className="text-xs uppercase font-extrabold tracking-wider text-emerald-100 leading-none">
                Navegar com
              </div>
              <div className="text-base font-black text-white">Google Maps</div>
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

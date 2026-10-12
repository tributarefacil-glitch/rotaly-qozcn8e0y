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
import { BatteryCharging, Smartphone, Settings, CheckCircle2, ShieldAlert } from 'lucide-react'
import { nativeGpsBridge } from '@/services/nativeGpsBridge'

interface CourierBatteryGuideModalProps {
  open: boolean
  onClose: () => void
  onAcknowledge?: () => void
}

export const BATTERY_OPTIMIZATION_ACK_KEY = 'rotaly_battery_optimization_acknowledged'

export const CourierBatteryGuideModal: React.FC<CourierBatteryGuideModalProps> = ({
  open,
  onClose,
  onAcknowledge,
}) => {
  const isNative = nativeGpsBridge.isNativeEnvironment()

  const handleOpenSettings = async () => {
    try {
      await nativeGpsBridge.openBatteryOptimizationSettings()
    } catch (err) {
      console.warn('[CourierBatteryGuideModal] Falha ao abrir configurações nativas:', err)
    }
  }

  const handleUnderstand = () => {
    try {
      localStorage.setItem(BATTERY_OPTIMIZATION_ACK_KEY, Date.now().toString())
    } catch {
      /* ignore */
    }
    if (onAcknowledge) onAcknowledge()
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-md w-full bg-slate-900 text-slate-100 border-slate-700 p-6 rounded-2xl shadow-2xl">
        <DialogHeader className="space-y-2">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mx-auto mb-1">
            <BatteryCharging className="w-6 h-6" />
          </div>
          <DialogTitle className="text-xl font-bold text-center text-white">
            Garantir GPS Ativo durante a Rota
          </DialogTitle>
          <DialogDescription className="text-xs text-center text-slate-400">
            Para que seus quilômetros e entregas sejam computados sem falhas, desative a otimização
            de bateria do Rotaly no seu celular.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-3 space-y-3 text-sm text-slate-300">
          <div className="bg-slate-800/80 border border-slate-700/60 rounded-xl p-3.5 space-y-2.5">
            <div className="text-xs font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4" /> Passo a Passo no Android
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex items-start gap-2.5">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-amber-500/20 text-amber-300 font-bold flex items-center justify-center text-[11px]">
                  1
                </span>
                <span>
                  Abra as <strong>Configurações</strong> do celular
                </span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-amber-500/20 text-amber-300 font-bold flex items-center justify-center text-[11px]">
                  2
                </span>
                <span>
                  Toque em <strong>Aplicativos</strong> (ou Apps)
                </span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-amber-500/20 text-amber-300 font-bold flex items-center justify-center text-[11px]">
                  3
                </span>
                <span>
                  Localize e selecione <strong>Rotaly</strong>
                </span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-amber-500/20 text-amber-300 font-bold flex items-center justify-center text-[11px]">
                  4
                </span>
                <span>
                  Vá em <strong>Bateria</strong>
                </span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold flex items-center justify-center text-[11px]">
                  ✓
                </span>
                <span>
                  Selecione <strong className="text-emerald-400">Sem restrições</strong> (ou Não
                  Otimizar)
                </span>
              </div>
            </div>
          </div>

          <div className="text-[11px] text-slate-400 bg-slate-800/40 p-2.5 rounded-lg border border-slate-700/40 flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <span>
              Isso impede que o Android encerre o GPS quando o celular for bloqueado no bolso.
            </span>
          </div>
        </div>

        <DialogFooter className="mt-4 flex flex-col sm:flex-row gap-2">
          {isNative && (
            <Button
              type="button"
              variant="outline"
              onClick={handleOpenSettings}
              className="w-full sm:w-auto border-amber-500/40 text-amber-300 hover:bg-amber-500/10 hover:text-amber-200 text-xs py-2 h-auto flex items-center justify-center gap-1.5"
            >
              <Settings className="w-4 h-4" />
              Abrir Configurações
            </Button>
          )}
          <Button
            type="button"
            onClick={handleUnderstand}
            className="w-full sm:flex-1 bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold text-xs py-2 h-auto flex items-center justify-center gap-1.5"
          >
            <CheckCircle2 className="w-4 h-4" />
            Entendi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

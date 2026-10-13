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
import { ShieldAlert, Settings, CheckCircle2, Navigation } from 'lucide-react'
import { nativeGpsBridge } from '@/services/nativeGpsBridge'

interface CourierBackgroundPermissionModalProps {
  open: boolean
  onClose: () => void
  onAcknowledge?: () => void
}

export const BACKGROUND_PERMISSION_ACK_KEY = 'rotaly_background_location_ack'

export const CourierBackgroundPermissionModal: React.FC<CourierBackgroundPermissionModalProps> = ({
  open,
  onClose,
  onAcknowledge,
}) => {
  const isNative = nativeGpsBridge.isNativeEnvironment()

  const handleOpenSettings = async () => {
    try {
      await nativeGpsBridge.requestBackgroundPermissions()
      nativeGpsBridge.openAppSettings()
    } catch (err) {
      console.warn('[CourierBackgroundPermissionModal] Falha ao abrir configurações nativas:', err)
    }
  }

  const handleUnderstand = () => {
    try {
      localStorage.setItem(BACKGROUND_PERMISSION_ACK_KEY, Date.now().toString())
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
          <div className="w-12 h-12 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 mx-auto mb-1">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <DialogTitle className="text-xl font-bold text-center text-white">
            Permissão de Localização em Segundo Plano Obrigatória
          </DialogTitle>
          <DialogDescription className="text-xs text-center text-slate-400">
            Para iniciar sua rota e garantir que seus quilômetros e entregas sejam computados com a
            tela apagada ou usando o Waze/Google Maps, selecione &quot;Permitir o tempo todo&quot;.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-3 space-y-3 text-sm text-slate-300">
          <div className="bg-slate-800/80 border border-slate-700/60 rounded-xl p-3.5 space-y-2.5">
            <div className="text-xs font-semibold text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
              <Navigation className="w-4 h-4" /> Passo a Passo no Android
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex items-start gap-2.5">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-rose-500/20 text-rose-300 font-bold flex items-center justify-center text-[11px]">
                  1
                </span>
                <span>
                  Toque no botão <strong>Abrir Configurações do App</strong> abaixo
                </span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-rose-500/20 text-rose-300 font-bold flex items-center justify-center text-[11px]">
                  2
                </span>
                <span>
                  Acesse <strong>Permissões</strong> &gt; <strong>Localização</strong>
                </span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold flex items-center justify-center text-[11px]">
                  ✓
                </span>
                <span>
                  Selecione <strong className="text-emerald-400">Permitir o tempo todo</strong>{' '}
                  (Allow all the time)
                </span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold flex items-center justify-center text-[11px]">
                  ✓
                </span>
                <span>
                  Mantenha ativa a opção <strong>Usar localização precisa</strong>
                </span>
              </div>
            </div>
          </div>

          <div className="text-[11px] text-amber-300/90 bg-amber-500/10 p-2.5 rounded-lg border border-amber-500/20 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span>
              Sem essa permissão, o sistema operacional bloqueia o rastreamento assim que o
              aplicativo vai para o segundo plano.
            </span>
          </div>
        </div>

        <DialogFooter className="mt-4 flex flex-col sm:flex-row gap-2">
          {isNative && (
            <Button
              type="button"
              variant="outline"
              onClick={handleOpenSettings}
              className="w-full sm:w-auto border-rose-500/40 text-rose-300 hover:bg-rose-500/10 hover:text-rose-200 text-xs py-2 h-auto flex items-center justify-center gap-1.5"
            >
              <Settings className="w-4 h-4" />
              Abrir Configurações
            </Button>
          )}
          <Button
            type="button"
            onClick={handleUnderstand}
            className="w-full sm:flex-1 bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs py-2 h-auto flex items-center justify-center gap-1.5"
          >
            <CheckCircle2 className="w-4 h-4" />
            Entendi, vou configurar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

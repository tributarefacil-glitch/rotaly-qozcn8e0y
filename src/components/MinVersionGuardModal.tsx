import React from 'react'
import { Download, AlertTriangle, RefreshCw, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface MinVersionGuardModalProps {
  isOpen: boolean
  isBlocking: boolean
  currentVersion: string
  minVersion: string
  latestVersion: string
  downloadUrl: string
  releaseNotes?: string
  onClose?: () => void
  onCheckAgain?: () => void
}

export const MinVersionGuardModal: React.FC<MinVersionGuardModalProps> = ({
  isOpen,
  isBlocking,
  currentVersion,
  minVersion,
  latestVersion,
  downloadUrl,
  releaseNotes,
  onClose,
  onCheckAgain,
}) => {
  const handleOpenDownload = () => {
    if (typeof window !== 'undefined') {
      window.location.href = downloadUrl
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isBlocking && onClose?.()}>
      <DialogContent
        className="max-w-md bg-slate-900 border-amber-500/40 text-white shadow-2xl p-6"
        onInteractOutside={(e) => {
          if (isBlocking) e.preventDefault()
        }}
        onEscapeKeyDown={(e) => {
          if (isBlocking) e.preventDefault()
        }}
      >
        <DialogHeader className="space-y-3">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
            <AlertTriangle className="h-8 w-8 animate-pulse" />
          </div>
          <DialogTitle className="text-xl font-bold text-center text-amber-400">
            {isBlocking
              ? 'Atualize o Aplicativo para Continuar'
              : 'Nova Versão do Rotaly Disponível'}
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-300 text-center leading-relaxed">
            {isBlocking
              ? 'Sua versão atual está abaixo da versão mínima obrigatória exigida pelo sistema. Para garantir a segurança das rotas e a precisão do GPS, você deve atualizar o app.'
              : 'Uma versão mais recente do Rotaly está disponível com melhorias de telemetria e navegação.'}
          </DialogDescription>
        </DialogHeader>

        {/* Detalhes de Versão */}
        <div className="my-2 rounded-xl bg-slate-950/70 border border-slate-800 p-4 space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400 flex items-center gap-1.5">
              <Smartphone className="h-3.5 w-3.5 text-slate-400" /> Versão instalada:
            </span>
            <span className="font-mono font-bold text-red-400">v{currentVersion}</span>
          </div>
          {isBlocking && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Versão mínima exigida:</span>
              <span className="font-mono font-bold text-amber-400">v{minVersion}</span>
            </div>
          )}
          <div className="flex items-center justify-between text-xs border-t border-slate-800/80 pt-2">
            <span className="text-slate-400">Versão mais nova:</span>
            <span className="font-mono font-bold text-emerald-400">v{latestVersion}</span>
          </div>

          {releaseNotes && (
            <div className="text-xs text-slate-400 bg-slate-900/90 rounded-lg p-2.5 border border-slate-800 mt-2">
              <strong className="text-slate-300 block mb-0.5">O que mudou:</strong>
              {releaseNotes}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col mt-2">
          <Button
            size="lg"
            className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-slate-950 font-bold shadow-lg shadow-orange-500/20 flex items-center justify-center gap-2"
            onClick={handleOpenDownload}
          >
            <Download className="h-5 w-5" />
            Baixar Atualização (APK)
          </Button>

          <div className="flex items-center justify-between gap-2 w-full pt-1">
            {onCheckAgain && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-slate-400 hover:text-white flex-1 flex items-center justify-center gap-1.5"
                onClick={onCheckAgain}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Verificar Novamente
              </Button>
            )}

            {!isBlocking && onClose && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-slate-400 hover:text-white flex-1"
                onClick={onClose}
              >
                Lembrar Mais Tarde
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

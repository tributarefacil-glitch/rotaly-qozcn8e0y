import React, { useState, useEffect } from 'react'
import { Download, Smartphone, CheckCircle, Bell, WifiOff, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

export const PwaInstallPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isStandalone, setIsStandalone] = useState(false)
  const [isDismissed, setIsDismissed] = useState(false)
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )
  const [pushSupported, setPushSupported] = useState(false)
  const [pushPermission, setPushPermission] = useState<NotificationPermission>('default')

  useEffect(() => {
    // Check if running in standalone PWA mode
    if (typeof window !== 'undefined') {
      const isPwa =
        window.matchMedia('(display-mode: standalone)').matches ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window.navigator as any).standalone === true
      setIsStandalone(isPwa)

      // Listen for display mode changes
      const mediaQuery = window.matchMedia('(display-mode: standalone)')
      const handleDisplayChange = (e: MediaQueryListEvent) => setIsStandalone(e.matches)
      mediaQuery.addEventListener('change', handleDisplayChange)

      // Online/Offline listeners
      const handleOnline = () => {
        setIsOnline(true)
        toast.success('Conexão restabelecida! Sincronizando dados...', { icon: '🟢' })
      }
      const handleOffline = () => {
        setIsOnline(false)
        toast.warning('Modo Offline: Usando cache local do aplicativo.', { icon: '📡' })
      }
      window.addEventListener('online', handleOnline)
      window.addEventListener('offline', handleOffline)

      // Listen for PWA beforeinstallprompt event
      const handleBeforeInstallPrompt = (e: Event) => {
        e.preventDefault()
        setDeferredPrompt(e as BeforeInstallPromptEvent)
      }
      window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)

      // Check Push Notification status
      if ('Notification' in window) {
        setPushSupported(true)
        setPushPermission(Notification.permission)
      }

      return () => {
        mediaQuery.removeEventListener('change', handleDisplayChange)
        window.removeEventListener('online', handleOnline)
        window.removeEventListener('offline', handleOffline)
        window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      }
    }
  }, [])

  const handleInstallClick = async () => {
    if (!deferredPrompt) {
      // Guide for iOS Safari or already installed
      toast.info(
        'Para instalar no iPhone/iPad: Toque no botão Compartilhar e selecione "Adicionar à Tela de Início".',
        { duration: 6000 },
      )
      return
    }

    try {
      await deferredPrompt.prompt()
      const choice = await deferredPrompt.userChoice
      if (choice.outcome === 'accepted') {
        toast.success('App instalado com sucesso na sua tela inicial!')
        setDeferredPrompt(null)
      }
    } catch (err) {
      console.warn('PWA install error:', err)
    }
  }

  const handleRequestPushNotifications = async () => {
    if (!('Notification' in window)) {
      toast.error('Notificações não são suportadas neste navegador.')
      return
    }

    try {
      const perm = await Notification.requestPermission()
      setPushPermission(perm)
      if (perm === 'granted') {
        toast.success('Notificações nativas ativadas com sucesso!')
        if ('serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.ready
          reg.showNotification('Rotaly Entregas', {
            body: 'Notificações push ativas! Você será avisado sobre novos pedidos e rotas.',
            icon: '/icons/icon.svg',
          })
        }
      } else {
        toast.info('Permissão de notificação negada ou não concedida.')
      }
    } catch (e) {
      console.warn('Push permission request failed:', e)
    }
  }

  // Offline banner alert
  if (!isOnline) {
    return (
      <div className="bg-amber-600 text-white text-xs font-semibold px-4 py-2 flex items-center justify-between sticky top-0 z-50 shadow-md">
        <div className="flex items-center gap-2">
          <WifiOff className="h-4 w-4 animate-pulse" />
          <span>
            Você está no Modo Offline. As visualizações e entregas continuarão sincronizadas.
          </span>
        </div>
      </div>
    )
  }

  // If already installed or user dismissed banner
  if (isStandalone || isDismissed) {
    return null
  }

  // Show installation & push banner on non-standalone mobile / web
  return (
    <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-slate-900 text-white px-3.5 py-2.5 text-xs shadow-lg sticky top-0 z-50 flex items-center justify-between gap-2 border-b border-white/10">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white border border-white/20">
          <Smartphone className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="font-bold truncate">Instalar App Rotaly</p>
          <p className="text-[11px] text-blue-100/80 truncate">
            Acesse direto da tela inicial com funcionamento offline e alertas push!
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {pushSupported && pushPermission !== 'granted' && (
          <Button
            size="sm"
            variant="ghost"
            onClick={handleRequestPushNotifications}
            className="h-7 text-[11px] px-2 text-white hover:bg-white/15"
            title="Ativar Notificações Nativas"
          >
            <Bell className="h-3.5 w-3.5 mr-1" />
            <span className="hidden sm:inline">Alertas</span>
          </Button>
        )}

        <Button
          size="sm"
          onClick={handleInstallClick}
          className="h-7 text-[11px] px-3 bg-white text-blue-800 hover:bg-blue-50 font-bold shadow"
        >
          <Download className="h-3.5 w-3.5 mr-1" />
          Instalar PWA
        </Button>

        <button
          type="button"
          onClick={() => setIsDismissed(true)}
          className="text-white/60 hover:text-white p-1 rounded-md"
          title="Fechar aviso"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

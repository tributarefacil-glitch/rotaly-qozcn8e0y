import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  Bell,
  Search,
  LogOut,
  User,
  Shield,
  Truck,
  Store,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Radio,
  ExternalLink,
  KeyRound,
} from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useCompany } from '@/contexts/CompanyContext'
import { RotalyLogo } from '@/components/RotalyLogo'
import { deliveryService } from '@/services/deliveryService'
import type { NotificationRecord } from '@/types/delivery'
import { useRealtime } from '@/hooks/use-realtime'
import { ChangePasswordModal } from '@/components/ChangePasswordModal'
import { shouldDisplayToast } from '@/lib/notificationDedupe'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Building2, ChevronDown } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { toast } from 'sonner'

export const Header: React.FC = () => {
  const { user, role, logout } = useAuth()
  const { currentCompany, allCompanies, setCurrentCompany, hasMultiCompanyAccess } = useCompany()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchTracking, setSearchTracking] = useState('')
  const [notifications, setNotifications] = useState<NotificationRecord[]>([])
  const [isNotifOpen, setIsNotifOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false)
  const [pendingAddressAlerts, setPendingAddressAlerts] = useState(0)

  const checkAlerts = useCallback(async () => {
    try {
      const count = await deliveryService.getPendingAddressAlertsCount(
        role === 'master' ? 'ALL' : currentCompany?.id,
      )
      setPendingAddressAlerts(count)
    } catch (err) {
      console.warn('Erro ao obter contagem de alertas no Header:', err)
    }
  }, [currentCompany?.id, role])

  useEffect(() => {
    checkAlerts()
    const interval = setInterval(checkAlerts, 30000)

    const handleAlertsUpdated = () => {
      checkAlerts()
    }
    window.addEventListener('rotaly:address-alerts-updated', handleAlertsUpdated)

    return () => {
      clearInterval(interval)
      window.removeEventListener('rotaly:address-alerts-updated', handleAlertsUpdated)
    }
  }, [checkAlerts])

  // Fetch initial notifications
  const loadNotifications = async () => {
    try {
      const data = await deliveryService.getNotifications(user?.id)
      setNotifications(data)
      setUnreadCount(data.filter((n) => !n.read).length)
    } catch (err) {
      console.error('Error fetching notifications:', err)
    }
  }

  useEffect(() => {
    if (user) {
      loadNotifications()
    }
  }, [user])

  // Realtime subscription to notifications
  useRealtime<NotificationRecord>(
    'notifications',
    (e) => {
      if (e.action === 'create') {
        const newNotif = e.record
        setNotifications((prev) => [newNotif, ...prev])
        setUnreadCount((prev) => prev + 1)

        // REGRA DE DEDUPLICAÇÃO DE ALERTA:
        // Notificações do tipo 'off_route' (desvios de rota e paradas suspeitas)
        // já possuem camada dedicada de alerta vermelho no painel operacional (SellerDashboard/Torre).
        // O Header não duplica o toast em azul para 'off_route'.
        // Para os demais tipos, aplica chave de deduplicação idempotente.
        const isOffRouteNotification = newNotif.type === 'off_route'
        const dedupeKey = `notif-${newNotif.id || `${newNotif.type}-${newNotif.order_id}-${newNotif.created}`}`

        if (!isOffRouteNotification && shouldDisplayToast(dedupeKey)) {
          toast.info(`🔔 ${newNotif.title}`, {
            description: newNotif.message,
            duration: 5000,
          })
        }
      } else if (e.action === 'update') {
        setNotifications((prev) => prev.map((n) => (n.id === e.record.id ? e.record : n)))
        loadNotifications()
      } else if (e.action === 'delete') {
        setNotifications((prev) => prev.filter((n) => n.id !== e.record.id))
        loadNotifications()
      }
    },
    !!user,
  )

  const handleMarkAllAsRead = async () => {
    try {
      await deliveryService.markAllNotificationsAsRead(notifications)
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
      setUnreadCount(0)
    } catch (err) {
      console.error('Error marking notifications as read:', err)
    }
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (!searchTracking.trim()) return
    navigate(`/track/${searchTracking.trim().toUpperCase()}`)
    setSearchTracking('')
  }

  const roleLabel =
    {
      admin: 'Administrador',
      seller: 'Lojista',
      courier: 'Entregador',
    }[role] || 'Usuário'

  const roleBadgeColor = {
    admin: 'bg-rose-500/10 text-rose-600 border-rose-200',
    seller: 'bg-blue-500/10 text-blue-600 border-blue-200',
    courier: 'bg-purple-500/10 text-purple-600 border-purple-200',
  }[role]

  return (
    <header className="sticky top-0 z-40 flex h-16 w-full items-center justify-between bg-white border-b border-slate-200 text-[#002855] px-4 shadow-sm transition-all sm:px-6">
      {/* Left section: App Brand & Status */}
      <div className="flex items-center gap-3.5">
        <Link to="/" className="flex items-center hover:opacity-95 transition-opacity">
          <RotalyLogo size="panelHeader" theme="light" showTagline={false} />
        </Link>
        <div className="hidden md:flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#00A3FF] opacity-75"></span>
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#00A3FF]"></span>
          </span>
          <span className="text-[11px] font-sans tracking-wide text-[#002855]">
            GPS &amp; Realtime Ativo
          </span>
        </div>

        {/* Active Company Badge (Empresa Única: Rotaly Operações) */}
        <div className="flex items-center">
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700">
            <Building2 className="h-3.5 w-3.5 text-[#00A3FF] shrink-0" />
            <span className="max-w-[140px] sm:max-w-[180px] truncate font-semibold text-[#002855]">
              {currentCompany?.nome_fantasia || 'Rotaly Operações'}
            </span>
            <span className="hidden sm:inline-block rounded bg-[#002855]/10 px-1.5 py-0.2 text-[9px] font-bold text-[#002855]">
              Matriz
            </span>
          </div>
        </div>

        {/* Badge de Endereços Suspeitos na Barra Superior se houver pendências */}
        {pendingAddressAlerts > 0 &&
          (role === 'admin' || role === 'master' || role === 'seller') && (
            <div
              onClick={() => {
                // 1. Dispara evento global para listeners ativos
                window.dispatchEvent(new CustomEvent('rotaly:open-address-alerts'))

                const currentPath = location.pathname
                const isAlreadyOnDashboard =
                  currentPath.startsWith('/admin') || currentPath.startsWith('/seller')

                if (!isAlreadyOnDashboard) {
                  // Rota externa: redireciona para o admin com hash
                  navigate(
                    role === 'seller'
                      ? '/seller#enderecos-suspeitos'
                      : '/admin#enderecos-suspeitos',
                  )
                } else {
                  // Já está no dashboard: rola suavemente até a caixa se existir no DOM
                  const el = document.getElementById('suspicious-addresses-box')
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }
                }
              }}
              className="hidden lg:flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs text-amber-900 font-semibold cursor-pointer hover:bg-amber-100 transition shadow-xs"
              title={`${pendingAddressAlerts} endereço(s) suspeito(s) aguardando revisão`}
            >
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
              <span>
                {pendingAddressAlerts} Endereço{pendingAddressAlerts === 1 ? '' : 's'} Suspeito
                {pendingAddressAlerts === 1 ? '' : 's'}
              </span>
            </div>
          )}
      </div>

      {/* Center section: Global Tracking Code Search */}
      <div className="mx-2 max-w-md flex-1 sm:mx-6">
        <form onSubmit={handleSearch} className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            type="text"
            placeholder="Rastrear entrega Rotaly (ex: TRK-2025-001)..."
            value={searchTracking}
            onChange={(e) => setSearchTracking(e.target.value)}
            className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-4 text-xs text-slate-900 placeholder:text-slate-400 transition focus:border-[#00A3FF] focus:bg-white focus:ring-1 focus:ring-[#00A3FF]"
          />
        </form>
      </div>

      {/* Right section: Notifications & User Profile */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Notification Bell Popover */}
        <Popover open={isNotifOpen} onOpenChange={setIsNotifOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative h-9 w-9 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-[#002855]"
            >
              <Bell className="h-4 w-4 text-[#002855]" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#00A3FF] px-1 text-[10px] font-bold text-white ring-2 ring-white">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-80 sm:w-96 p-0 shadow-xl border-slate-200 bg-white text-[#002855]"
          >
            <div className="flex items-center justify-between border-b border-slate-200 p-3 bg-slate-50">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-[#00A3FF]" />
                <span className="font-heading font-bold text-sm text-[#002855]">Notificações</span>
                {unreadCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="text-xs px-1.5 py-0 bg-blue-100 text-[#002855] border-blue-200 font-bold"
                  >
                    {unreadCount} novas
                  </Badge>
                )}
              </div>
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleMarkAllAsRead}
                  className="h-7 text-xs text-[#00A3FF] hover:text-[#008CE0] font-semibold"
                >
                  Marcar lidas
                </Button>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
              {notifications.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  Nenhuma notificação no momento.
                </div>
              ) : (
                notifications.slice(0, 10).map((n) => (
                  <div
                    key={n.id}
                    className={`p-3 transition hover:bg-slate-50 ${!n.read ? 'bg-blue-50/50' : ''}`}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5">
                        {n.type === 'off_route' && (
                          <AlertTriangle className="h-4 w-4 text-rose-500" />
                        )}
                        {n.type === 'delay' && <Clock className="h-4 w-4 text-amber-500" />}
                        {n.type === 'order' && <Truck className="h-4 w-4 text-[#002855]" />}
                        {n.type === 'system' && <Radio className="h-4 w-4 text-emerald-500" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-bold text-[#002855] truncate">{n.title}</p>
                          <span className="text-[10px] text-slate-400">
                            {new Intl.DateTimeFormat('pt-BR', {
                              timeZone: 'America/Sao_Paulo',
                              hour: '2-digit',
                              minute: '2-digit',
                            }).format(new Date(n.created))}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-600 leading-relaxed font-sans">
                          {n.message}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="border-t border-slate-200 p-2 text-center bg-slate-50">
              <span className="text-[11px] text-slate-500 font-medium">
                Push Real-time Rotaly ativo
              </span>
            </div>
          </PopoverContent>
        </Popover>

        {/* User profile dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="flex items-center gap-2 pl-2 pr-2 sm:pr-3 py-1.5 h-auto rounded-lg hover:bg-slate-100 border border-slate-200 text-[#002855]"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#002855] text-white text-xs font-black uppercase shadow-sm">
                {user?.name ? user.name.slice(0, 2) : 'RO'}
              </div>
              <div className="hidden text-left sm:block">
                <p className="font-heading text-xs font-bold leading-none text-[#002855]">
                  {user?.name || 'Usuário'}
                </p>
                <p className="text-[10px] text-slate-500 leading-none mt-1">{user?.email}</p>
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{user?.name}</p>
                <p className="text-xs leading-none text-muted-foreground">{user?.email}</p>
                <div className="pt-1">
                  <Badge variant="outline" className={`text-[10px] ${roleBadgeColor}`}>
                    {roleLabel}
                  </Badge>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() =>
                navigate(role === 'courier' ? '/courier' : role === 'admin' ? '/admin' : '/seller')
              }
            >
              <Store className="mr-2 h-4 w-4" />
              <span>Ir para Meu Painel</span>
            </DropdownMenuItem>
            {role === 'admin' && (
              <>
                <DropdownMenuItem onClick={() => navigate('/admin')}>
                  <Shield className="mr-2 h-4 w-4" />
                  <span>Painel Admin & KPIs</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/empresas')}>
                  <Building2 className="mr-2 h-4 w-4" />
                  <span>Gestão de Empresas</span>
                </DropdownMenuItem>
              </>
            )}

            <DropdownMenuItem onClick={() => navigate('/track/TRK-2025-001')}>
              <ExternalLink className="mr-2 h-4 w-4" />
              <span>Página de Rastreio Demo</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setIsChangePasswordOpen(true)}
              className="text-[#0052CC] font-medium cursor-pointer"
            >
              <KeyRound className="mr-2 h-4 w-4 text-[#0052CC]" />
              <span>Trocar Senha</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} className="text-rose-600 focus:text-rose-600">
              <LogOut className="mr-2 h-4 w-4" />
              <span>Sair da Conta</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ChangePasswordModal open={isChangePasswordOpen} onOpenChange={setIsChangePasswordOpen} />
    </header>
  )
}

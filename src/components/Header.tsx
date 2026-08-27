import React, { useState, useEffect, useRef } from 'react'
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
} from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { deliveryService } from '@/services/deliveryService'
import type { NotificationRecord } from '@/types/delivery'
import { useRealtime } from '@/hooks/use-realtime'
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { toast } from 'sonner'

export const Header: React.FC = () => {
  const { user, role, logout } = useAuth()
  const navigate = useNavigate()
  const [searchTracking, setSearchTracking] = useState('')
  const [notifications, setNotifications] = useState<NotificationRecord[]>([])
  const [isNotifOpen, setIsNotifOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

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
        toast.info(`🔔 ${newNotif.title}`, {
          description: newNotif.message,
          duration: 5000,
        })
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
      seller: 'Vendedor',
      courier: 'Entregador',
    }[role] || 'Usuário'

  const roleBadgeColor = {
    admin: 'bg-rose-500/10 text-rose-600 border-rose-200',
    seller: 'bg-blue-500/10 text-blue-600 border-blue-200',
    courier: 'bg-purple-500/10 text-purple-600 border-purple-200',
  }[role]

  return (
    <header className="sticky top-0 z-40 flex h-16 w-full items-center justify-between border-b bg-white/95 px-4 backdrop-blur transition-all dark:bg-slate-900/95 sm:px-6">
      {/* Left section: App Brand & Status */}
      <div className="flex items-center gap-3">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-slate-900 to-blue-600 text-white shadow-md shadow-blue-500/20">
            <Truck className="h-5 w-5" />
          </div>
          <div className="hidden flex-col sm:flex">
            <span className="text-base font-bold leading-none tracking-tight text-slate-900 dark:text-white">
              Gestão de Entregas
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Logística em Tempo Real
            </span>
          </div>
        </Link>
        <div className="hidden md:flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50/80 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
          </span>
          GPS & Realtime Ativo
        </div>
      </div>

      {/* Center section: Global Tracking Code Search */}
      <div className="mx-2 max-w-md flex-1 sm:mx-6">
        <form onSubmit={handleSearch} className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            type="text"
            placeholder="Rastrear entrega (ex: TRK-2025-001)..."
            value={searchTracking}
            onChange={(e) => setSearchTracking(e.target.value)}
            className="h-9 w-full rounded-full border-slate-200 bg-slate-50/80 pl-9 pr-4 text-xs shadow-inner transition focus:border-blue-500 focus:bg-white dark:border-slate-800 dark:bg-slate-800/80"
          />
        </form>
      </div>

      {/* Right section: Notifications & User Profile */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Notification Bell Popover */}
        <Popover open={isNotifOpen} onOpenChange={setIsNotifOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="relative h-9 w-9 rounded-full border-slate-200 bg-slate-50 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-800"
            >
              <Bell className="h-4 w-4 text-slate-600 dark:text-slate-300" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 sm:w-96 p-0 shadow-xl">
            <div className="flex items-center justify-between border-b p-3 bg-slate-50 dark:bg-slate-800/50">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-slate-700 dark:text-slate-200" />
                <span className="font-semibold text-sm">Notificações</span>
                {unreadCount > 0 && (
                  <Badge variant="secondary" className="text-xs px-1.5 py-0">
                    {unreadCount} novas
                  </Badge>
                )}
              </div>
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleMarkAllAsRead}
                  className="h-7 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400"
                >
                  Marcar lidas
                </Button>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {notifications.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  Nenhuma notificação no momento.
                </div>
              ) : (
                notifications.slice(0, 10).map((n) => (
                  <div
                    key={n.id}
                    className={`p-3 transition hover:bg-slate-50/80 dark:hover:bg-slate-800/60 ${
                      !n.read ? 'bg-blue-50/40 dark:bg-blue-950/20' : ''
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5">
                        {n.type === 'off_route' && (
                          <AlertTriangle className="h-4 w-4 text-rose-500" />
                        )}
                        {n.type === 'delay' && <Clock className="h-4 w-4 text-amber-500" />}
                        {n.type === 'order' && <Truck className="h-4 w-4 text-blue-500" />}
                        {n.type === 'system' && <Radio className="h-4 w-4 text-emerald-500" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                            {n.title}
                          </p>
                          <span className="text-[10px] text-slate-400">
                            {new Date(n.created).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                          {n.message}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="border-t p-2 text-center bg-slate-50 dark:bg-slate-800/50">
              <span className="text-[11px] text-slate-500">
                Push Real-time via PocketBase ativo
              </span>
            </div>
          </PopoverContent>
        </Popover>

        {/* User profile dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="flex items-center gap-2 pl-2 pr-2 sm:pr-3 py-1.5 h-auto rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-white text-xs font-semibold uppercase">
                {user?.name ? user.name.slice(0, 2) : 'US'}
              </div>
              <div className="hidden text-left sm:block">
                <p className="text-xs font-semibold leading-none text-slate-900 dark:text-white">
                  {user?.name || 'Usuário'}
                </p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-none mt-1">
                  {user?.email}
                </p>
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
              <DropdownMenuItem onClick={() => navigate('/admin')}>
                <Shield className="mr-2 h-4 w-4" />
                <span>Painel Admin & KPIs</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => navigate('/track/TRK-2025-001')}>
              <ExternalLink className="mr-2 h-4 w-4" />
              <span>Página de Rastreio Demo</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} className="text-rose-600 focus:text-rose-600">
              <LogOut className="mr-2 h-4 w-4" />
              <span>Sair da Conta</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

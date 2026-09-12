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
import { useCompany } from '@/contexts/CompanyContext'
import { RotalyLogo } from '@/components/RotalyLogo'
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
import { Building2, ChevronDown } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { toast } from 'sonner'

export const Header: React.FC = () => {
  const { user, role, logout } = useAuth()
  const { currentCompany, allCompanies, setCurrentCompany, hasMultiCompanyAccess } = useCompany()
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
      seller: 'Lojista',
      courier: 'Entregador',
    }[role] || 'Usuário'

  const roleBadgeColor = {
    admin: 'bg-rose-500/10 text-rose-600 border-rose-200',
    seller: 'bg-blue-500/10 text-blue-600 border-blue-200',
    courier: 'bg-purple-500/10 text-purple-600 border-purple-200',
  }[role]

  return (
    <header className="sticky top-0 z-40 flex h-16 w-full items-center justify-between bg-[#0A1128] border-b border-[#1E2B58] text-white px-4 shadow-brand-dark transition-all sm:px-6">
      {/* Left section: App Brand & Status */}
      <div className="flex items-center gap-3.5">
        <Link to="/" className="flex items-center hover:opacity-95 transition-opacity">
          <RotalyLogo size="md" theme="dark" showTagline={false} />
        </Link>
        <div className="hidden md:flex items-center gap-2 rounded-full border border-[#1E2B58] bg-[#0E1738]/80 px-3 py-1 text-xs font-semibold text-slate-200">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22C55E] opacity-75"></span>
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#22C55E]"></span>
          </span>
          <span className="text-[11px] font-sans tracking-wide">GPS &amp; Realtime Ativo</span>
        </div>

        {/* Multi-Tenant Active Company Switcher */}
        {currentCompany && (
          <div className="flex items-center">
            {hasMultiCompanyAccess && allCompanies.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 sm:gap-2 rounded-lg border border-[#1E2B58] bg-[#0E1738] px-2 sm:px-2.5 text-xs text-white hover:bg-[#121E46]"
                    title={currentCompany.nome_fantasia || currentCompany.nome_razao_social}
                  >
                    <Building2 className="h-3.5 w-3.5 text-[#FF6B35] shrink-0" />
                    <span className="max-w-[85px] sm:max-w-[140px] md:max-w-[180px] truncate font-semibold">
                      {currentCompany.nome_fantasia || currentCompany.nome_razao_social}
                    </span>
                    <ChevronDown className="h-3 w-3 text-slate-400 shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="w-56 bg-[#0E1738] border-[#1E2B58] text-white"
                >
                  <DropdownMenuLabel className="text-[10px] uppercase text-slate-400 font-bold">
                    Alternar Empresa
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-[#1E2B58]" />
                  {allCompanies.map((emp) => (
                    <DropdownMenuItem
                      key={emp.id}
                      onClick={() => {
                        setCurrentCompany(emp)
                        toast.success(
                          `Empresa ativa: ${emp.nome_fantasia || emp.nome_razao_social}`,
                        )
                      }}
                      className={`text-xs flex items-center justify-between cursor-pointer ${
                        currentCompany.id === emp.id ? 'bg-[#0052CC] text-white font-bold' : ''
                      }`}
                    >
                      <span className="truncate">{emp.nome_fantasia || emp.nome_razao_social}</span>
                      {currentCompany.id === emp.id && <CheckCircle2 className="h-3 w-3" />}
                    </DropdownMenuItem>
                  ))}
                  {role === 'admin' && (
                    <>
                      <DropdownMenuSeparator className="bg-[#1E2B58]" />
                      <DropdownMenuItem
                        onClick={() => navigate('/empresas')}
                        className="text-xs text-[#60A5FA] cursor-pointer"
                      >
                        <Building2 className="mr-2 h-3.5 w-3.5" />
                        Gerenciar Empresas
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <div className="flex items-center gap-1.5 rounded-lg border border-[#1E2B58] bg-[#0E1738] px-2 sm:px-2.5 py-1 text-xs text-slate-300">
                <Building2 className="h-3.5 w-3.5 text-[#FF6B35] shrink-0" />
                <span className="max-w-[85px] sm:max-w-[140px] truncate font-medium">
                  {currentCompany.nome_fantasia || currentCompany.nome_razao_social}
                </span>
              </div>
            )}
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
            className="h-9 w-full rounded-lg border border-[#1E2B58] bg-[#0E1738] pl-9 pr-4 text-xs text-white placeholder:text-slate-400 transition focus:border-[#60A5FA] focus:bg-[#121E46] focus:ring-1 focus:ring-[#60A5FA]"
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
              className="relative h-9 w-9 rounded-md border border-white/20 bg-white/10 hover:bg-white/20 text-white"
            >
              <Bell className="h-4 w-4 text-white" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#FF6B35] px-1 text-[10px] font-bold text-white ring-2 ring-[#0052CC]">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-80 sm:w-96 p-0 shadow-xl border-slate-200 bg-white text-[#1a1a1a]"
          >
            <div className="flex items-center justify-between border-b border-slate-200 p-3 bg-[#F5F5F5]">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-[#0052CC]" />
                <span className="font-heading font-bold text-sm text-[#1a1a1a]">Notificações</span>
                {unreadCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="text-xs px-1.5 py-0 bg-orange-100 text-[#FF6B35] border-orange-200 font-bold"
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
                  className="h-7 text-xs text-[#0052CC] hover:text-[#003E99] font-semibold"
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
                    className={`p-3 transition hover:bg-blue-50/40 ${
                      !n.read ? 'bg-blue-50/70' : ''
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5">
                        {n.type === 'off_route' && (
                          <AlertTriangle className="h-4 w-4 text-[#E74C3C]" />
                        )}
                        {n.type === 'delay' && <Clock className="h-4 w-4 text-[#FF6B35]" />}
                        {n.type === 'order' && <Truck className="h-4 w-4 text-[#0052CC]" />}
                        {n.type === 'system' && <Radio className="h-4 w-4 text-[#00AA44]" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-bold text-[#1a1a1a] truncate">{n.title}</p>
                          <span className="text-[10px] text-slate-400">
                            {new Date(n.created).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
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

            <div className="border-t border-slate-200 p-2 text-center bg-[#F5F5F5]">
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
              className="flex items-center gap-2 pl-2 pr-2 sm:pr-3 py-1.5 h-auto rounded-lg hover:bg-[#121E46] border border-transparent hover:border-[#1E2B58] text-white"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-tr from-[#0052CC] to-[#60A5FA] text-white text-xs font-black uppercase shadow-sm border border-blue-300/30">
                {user?.name ? user.name.slice(0, 2) : 'LH'}
              </div>
              <div className="hidden text-left sm:block">
                <p className="font-heading text-xs font-bold leading-none text-white">
                  {user?.name || 'Usuário'}
                </p>
                <p className="text-[10px] text-slate-300 leading-none mt-1">{user?.email}</p>
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
            {/* Quick company switch in mobile/profile menu if multi-company available */}
            {hasMultiCompanyAccess && allCompanies.length > 1 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[10px] uppercase text-muted-foreground font-bold">
                  Empresa Ativa
                </DropdownMenuLabel>
                {allCompanies.map((emp) => (
                  <DropdownMenuItem
                    key={`menu-emp-${emp.id}`}
                    onClick={() => {
                      setCurrentCompany(emp)
                      toast.success(`Empresa ativa: ${emp.nome_fantasia || emp.nome_razao_social}`)
                    }}
                    className={`text-xs flex items-center justify-between cursor-pointer ${
                      currentCompany?.id === emp.id ? 'bg-primary/10 text-primary font-bold' : ''
                    }`}
                  >
                    <span className="truncate">{emp.nome_fantasia || emp.nome_razao_social}</span>
                    {currentCompany?.id === emp.id && (
                      <CheckCircle2 className="h-3 w-3 text-primary" />
                    )}
                  </DropdownMenuItem>
                ))}
              </>
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

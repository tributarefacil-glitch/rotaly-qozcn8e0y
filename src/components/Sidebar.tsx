import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Package,
  Bike,
  BarChart3,
  Settings,
  Fuel,
  Sparkles,
  MapPin,
  FileText,
  Users,
  Search,
  Building2,
  Globe,
  AlertTriangle,
  Route,
  ShieldAlert,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useCompany } from '@/contexts/CompanyContext'
import { deliveryService } from '@/services/deliveryService'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface NavItem {
  title: string
  href: string
  icon: React.ElementType
  roles: ('master' | 'admin' | 'seller' | 'courier')[]
  badge?: string
  adminOnly?: boolean
}

const navItems: NavItem[] = [
  {
    title: 'Gestão de Empresas (SaaS)',
    href: '/master',
    icon: Building2,
    roles: ['master'],
    badge: 'Master',
  },
  {
    title: 'Painel Executivo',
    href: '/admin',
    icon: LayoutDashboard,
    roles: ['master', 'admin'],
  },
  {
    title: 'Painel do Lojista',
    href: '/seller',
    icon: Package,
    roles: ['seller', 'admin'],
  },
  {
    title: 'Buscar / Clientes',
    href: '/customers',
    icon: Search,
    roles: ['seller', 'admin'],
  },
  {
    title: 'App do Entregador',
    href: '/courier',
    icon: Bike,
    roles: ['courier', 'admin'],
  },
  {
    title: 'Torre de Controle (Mapa)',
    href: '/control-tower',
    icon: MapPin,
    roles: ['admin', 'seller'],
    badge: 'Ao Vivo',
  },
  {
    title: 'Controle de Combustível',
    href: '/fuel',
    icon: Fuel,
    roles: ['admin', 'seller', 'courier'],
  },
  {
    title: 'Auditoria de KM',
    href: '/admin?tab=km-audit',
    icon: Route,
    roles: ['admin'],
    badge: 'Novo',
  },
  {
    title: 'Desvios & Paradas',
    href: '/admin?tab=deviations',
    icon: MapPin,
    roles: ['admin'],
    badge: 'Alertas',
  },
  {
    title: 'Trilha de Auditoria',
    href: '/admin?tab=audit-trail',
    icon: ShieldAlert,
    roles: ['admin'],
    badge: 'Segurança',
  },
  {
    title: 'Relatórios & KPIs',
    href: '/reports',
    icon: BarChart3,
    roles: ['admin', 'seller'],
  },
  {
    title: 'Notas Fiscais & XML',
    href: '/invoices',
    icon: FileText,
    roles: ['admin', 'seller'],
  },
  {
    title: 'Conteúdo do Site',
    href: '/admin?tab=site-content',
    icon: Globe,
    roles: ['admin'],
  },
  {
    title: 'Configurações Globais',
    href: '/settings',
    icon: Settings,
    roles: ['admin'],
  },
]

export const Sidebar: React.FC = () => {
  const location = useLocation()
  const { user } = useAuth()
  const { currentCompany } = useCompany()
  const role = user?.role || 'seller'
  const isMaster = role === 'master'

  const [pendingAlertsCount, setPendingAlertsCount] = React.useState<number>(0)

  React.useEffect(() => {
    let isMounted = true
    const checkAlerts = async () => {
      try {
        const count = await deliveryService.getPendingAddressAlertsCount(
          isMaster ? 'ALL' : currentCompany?.id,
        )
        if (isMounted) setPendingAlertsCount(count)
      } catch (err) {
        console.warn('Erro ao obter contagem de alertas:', err)
      }
    }
    checkAlerts()
    const interval = setInterval(checkAlerts, 30000)
    return () => {
      isMounted = false
      clearInterval(interval)
    }
  }, [currentCompany?.id, isMaster])

  const filteredItems = navItems
    .filter((item) => {
      if (isMaster) return true // Master vê todos os menus
      if (role === 'admin') {
        // Admin comum de empresa não vê o menu exclusivo do Master
        return item.roles.includes('admin')
      }
      return item.roles.includes(role as any)
    })
    .map((item) => {
      // Ajustar destino conforme a role do usuário
      if (item.title === 'Controle de Combustível') {
        if (role === 'courier') {
          return { ...item, href: '/courier/fuel' }
        }
        if (role === 'seller') {
          return { ...item, href: '/fuel' }
        }
        return { ...item, href: '/admin?tab=fuel' }
      }
      if (item.title === 'Painel Executivo' && pendingAlertsCount > 0) {
        return {
          ...item,
          badge: `${pendingAlertsCount} suspeito${pendingAlertsCount === 1 ? '' : 's'}`,
        }
      }
      if (item.title === 'Painel do Lojista' && pendingAlertsCount > 0) {
        return {
          ...item,
          badge: `${pendingAlertsCount} suspeito${pendingAlertsCount === 1 ? '' : 's'}`,
        }
      }
      return item
    })
  return (
    <aside className="hidden md:flex h-[calc(100vh-4rem)] w-64 flex-col border-r border-slate-200 bg-white text-slate-700 shadow-sm select-none">
      {/* Navigation Links */}
      <div className="flex-1 space-y-1.5 p-4 overflow-y-auto">
        <div className="px-3 py-1 font-heading text-[11px] font-bold uppercase tracking-wider text-slate-400">
          Navegação Rotaly
        </div>
        <nav className="space-y-1.5">
          {filteredItems.map((item) => {
            const Icon = item.icon
            const currentFull = location.pathname + location.search
            const isActive =
              location.pathname === item.href ||
              currentFull === item.href ||
              (item.href.includes('?') &&
                location.pathname === item.href.split('?')[0] &&
                location.search.includes(item.href.split('?')[1]))

            return (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-sans font-medium transition-all duration-150',
                  isActive
                    ? 'bg-[#002855] text-white shadow-sm font-semibold'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-[#002855]',
                )}
              >
                <Icon
                  className={cn('h-4 w-4 shrink-0', isActive ? 'text-[#00A3FF]' : 'text-slate-400')}
                />
                <span className="flex-1 tracking-tight">{item.title}</span>
                {item.badge && (
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[10px] font-sans h-5 px-1.5 font-bold',
                      isActive
                        ? 'border-white/30 text-white bg-white/20'
                        : 'border-[#00A3FF]/40 bg-[#00A3FF]/10 text-[#008CE0]',
                    )}
                  >
                    {item.badge}
                  </Badge>
                )}
              </Link>
            )
          })}
        </nav>
      </div>

      {/* Floating Copilot Helper Card in Sidebar */}
      <div className="p-4 border-t border-slate-200 bg-slate-50/70">
        <div className="rounded-xl bg-white p-3 border border-slate-200 shadow-xs">
          <div className="flex items-center gap-2 mb-1.5">
            <Sparkles className="h-4 w-4 text-[#00A3FF] animate-pulse" />
            <span className="font-heading text-xs font-bold text-[#002855] tracking-wide">
              Rotaly Copilot IA
            </span>
          </div>
          <p className="font-sans text-[11px] text-slate-500 leading-relaxed">
            Consulte rotas inteligentes, status de entregas e KPIs a qualquer instante.
          </p>
        </div>
      </div>
    </aside>
  )
}

export default Sidebar

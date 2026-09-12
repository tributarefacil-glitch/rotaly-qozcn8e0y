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
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface NavItem {
  title: string
  href: string
  icon: React.ElementType
  roles: ('admin' | 'seller' | 'courier')[]
  badge?: string
  adminOnly?: boolean
}

const navItems: NavItem[] = [
  {
    title: 'Painel Master Admin',
    href: '/admin',
    icon: LayoutDashboard,
    roles: ['admin'],
  },
  {
    title: 'Empresas & Multi-Tenant',
    href: '/empresas',
    icon: Building2,
    roles: ['admin'],
    badge: 'Tenant',
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
    title: 'Desvios & Paradas',
    href: '/admin?tab=deviations',
    icon: MapPin,
    roles: ['admin'],
    badge: 'Alertas',
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
    title: 'Configurações Globais',
    href: '/settings',
    icon: Settings,
    roles: ['admin'],
  },
]

export const Sidebar: React.FC = () => {
  const location = useLocation()
  const { user } = useAuth()
  const role = user?.role || 'seller'

  const filteredItems = navItems
    .filter((item) => {
      if (role === 'admin') return true
      return item.roles.includes(role)
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
        // Para admin, pode direcionar para a aba de combustível no painel admin ou /fuel
        return { ...item, href: '/admin?tab=fuel' }
      }
      return item
    })

  return (
    <aside className="hidden md:flex h-[calc(100vh-4rem)] w-64 flex-col border-r border-[#1E2B58] bg-[#0A1128] text-slate-200 shadow-xl select-none">
      {/* Navigation Links */}
      <div className="flex-1 space-y-1.5 p-4 overflow-y-auto">
        <div className="px-3 py-1 font-heading text-[11px] font-black uppercase tracking-wider text-slate-400">
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
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-sans font-medium transition-all duration-150',
                  isActive
                    ? 'bg-gradient-to-r from-[#0052CC] to-[#1D4ED8] text-white shadow-brand font-semibold border border-blue-400/30'
                    : 'text-slate-300 hover:bg-[#121E46] hover:text-white hover:border-[#1E2B58]',
                )}
              >
                <Icon
                  className={cn('h-4 w-4 shrink-0', isActive ? 'text-[#60A5FA]' : 'text-slate-400')}
                />
                <span className="flex-1 tracking-tight">{item.title}</span>
                {item.badge && (
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[10px] font-sans h-5 px-1.5 font-bold',
                      isActive
                        ? 'border-white/30 text-white bg-white/10'
                        : 'border-[#FF6B35]/40 bg-[#FF6B35]/20 text-[#FF6B35]',
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
      <div className="p-4 border-t border-[#1E2B58] bg-[#070D1E]/80">
        <div className="rounded-xl bg-[#0E1738] p-3 border border-[#1E2B58] shadow-sm">
          <div className="flex items-center gap-2 mb-1.5">
            <Sparkles className="h-4 w-4 text-[#FF6B35] animate-pulse" />
            <span className="font-heading text-xs font-bold text-white tracking-wide">
              Rotaly Copilot IA
            </span>
          </div>
          <p className="font-sans text-[11px] text-slate-300 leading-relaxed">
            Consulte rotas inteligentes, status de entregas e KPIs a qualquer instante.
          </p>
        </div>
      </div>
    </aside>
  )
}

export default Sidebar

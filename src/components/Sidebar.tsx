import React from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Package,
  Route as RouteIcon,
  Users,
  BarChart3,
  Settings,
  ShieldCheck,
  Truck,
  Sparkles,
  UserCheck,
  Radio,
  FileText,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Badge } from '@/components/ui/badge'

interface NavItem {
  title: string
  href: string
  icon: React.ElementType
  badge?: string
  adminOnly?: boolean
}

const navItems: NavItem[] = [
  {
    title: 'Painel Geral',
    href: '/seller',
    icon: LayoutDashboard,
  },
  {
    title: 'Torre de Controle',
    href: '/control-tower',
    icon: Radio,
    badge: 'Ao Vivo',
  },
  {
    title: 'Relatórios',
    href: '/reports',
    icon: FileText,
  },
  {
    title: 'Pedidos & Vendas',
    href: '/orders',
    icon: Package,
  },
  {
    title: 'Rotas & Mapa',
    href: '/routes',
    icon: RouteIcon,
  },
  {
    title: 'Clientes',
    href: '/customers',
    icon: Users,
  },
  {
    title: 'Usuários',
    href: '/admin/users',
    icon: UserCheck,
    badge: 'Admin',
    adminOnly: true,
  },
  {
    title: 'Gestão & Métricas',
    href: '/admin',
    icon: BarChart3,
    badge: 'Admin',
    adminOnly: true,
  },
  {
    title: 'Entregadores',
    href: '/couriers',
    icon: Truck,
  },
  {
    title: 'Configurações',
    href: '/settings',
    icon: Settings,
  },
]

export const Sidebar: React.FC = () => {
  const { role } = useAuth()
  const location = useLocation()

  const filteredItems = navItems.filter((item) => {
    if (item.adminOnly && role !== 'admin') return false
    return true
  })

  return (
    <aside className="hidden md:flex h-[calc(100vh-4rem)] w-64 flex-col border-r border-slate-200 bg-[#F5F5F5] text-[#1a1a1a]">
      {/* Navigation Links */}
      <div className="flex-1 space-y-1 p-4 overflow-y-auto">
        <div className="px-3 py-2 font-heading text-xs font-bold uppercase tracking-wider text-slate-500">
          Menu Principal
        </div>
        <nav className="space-y-1">
          {filteredItems.map((item) => {
            const Icon = item.icon
            const isActive = location.pathname === item.href

            return (
              <NavLink
                key={item.href}
                to={item.href}
                className={`group flex items-center justify-between rounded-md px-3 py-2.5 text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-[#0052CC] text-white shadow-sm font-semibold'
                    : 'text-slate-700 hover:bg-white hover:text-[#0052CC] hover:shadow-xs'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon
                    className={`h-4 w-4 transition-colors ${
                      isActive ? 'text-[#FF6B35]' : 'text-[#0052CC] group-hover:text-[#FF6B35]'
                    }`}
                  />
                  <span className={isActive ? 'font-bold' : ''}>{item.title}</span>
                </div>
                {item.badge && (
                  <Badge
                    variant="secondary"
                    className={`text-[10px] font-bold ${
                      isActive
                        ? 'bg-white text-[#0052CC]'
                        : 'bg-white text-[#FF6B35] border border-orange-200 shadow-xs'
                    }`}
                  >
                    {item.badge}
                  </Badge>
                )}
              </NavLink>
            )
          })}
        </nav>
      </div>

      {/* AI Assistant Promo Widget in Sidebar */}
      <div className="p-4 border-t border-slate-200 bg-white/70">
        <div className="rounded-lg bg-blue-50/70 p-3 border border-blue-200 shadow-xs">
          <div className="flex items-center gap-2 mb-1.5">
            <Sparkles className="h-4 w-4 text-[#FF6B35] animate-pulse" />
            <span className="font-heading text-xs font-bold text-[#0052CC]">
              LOGHYPE Copilot IA
            </span>
          </div>
          <p className="font-sans text-[11px] text-slate-600 leading-relaxed">
            Consulte rotas, frotas e atrasos a qualquer momento pelo chat flutuante.
          </p>
        </div>
      </div>
    </aside>
  )
}

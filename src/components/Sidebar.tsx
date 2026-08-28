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
    <aside className="hidden md:flex h-[calc(100vh-4rem)] w-64 flex-col border-r bg-slate-900 text-slate-100 dark:bg-slate-950">
      {/* Navigation Links */}
      <div className="flex-1 space-y-1 p-4 overflow-y-auto">
        <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
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
                className={`group flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 font-semibold'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon
                    className={`h-4 w-4 transition-colors ${
                      isActive ? 'text-white' : 'text-slate-400 group-hover:text-white'
                    }`}
                  />
                  <span>{item.title}</span>
                </div>
                {item.badge && (
                  <Badge
                    variant="secondary"
                    className="bg-slate-800 text-[10px] text-slate-300 border border-slate-700"
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
      <div className="p-4 border-t border-slate-800">
        <div className="rounded-xl bg-gradient-to-br from-blue-900/50 to-indigo-900/40 p-3 border border-blue-500/20 shadow-lg">
          <div className="flex items-center gap-2 mb-1.5">
            <Sparkles className="h-4 w-4 text-blue-400 animate-pulse" />
            <span className="text-xs font-semibold text-blue-200">Copilot Logístico IA</span>
          </div>
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Consulte rotas, frotas e atrasos a qualquer momento pelo chat flutuante.
          </p>
        </div>
      </div>
    </aside>
  )
}

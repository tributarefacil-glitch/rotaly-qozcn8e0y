import React from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Navigation2, CheckSquare, User, Package, Fuel } from 'lucide-react'

export const CourierBottomNav: React.FC = () => {
  const location = useLocation()

  const tabs = [
    {
      label: 'Minha Rota',
      href: '/courier',
      icon: Navigation2,
    },
    {
      label: 'Combustível',
      href: '/courier/fuel',
      icon: Fuel,
    },
    {
      label: 'Histórico',
      href: '/courier/history',
      icon: Package,
    },
    {
      label: 'Perfil',
      href: '/courier/profile',
      icon: User,
    },
  ]

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex h-16 w-full items-center justify-around border-t border-slate-200 bg-white/95 px-2 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 md:hidden">
      {tabs.map((tab) => {
        const Icon = tab.icon
        const isActive = location.pathname === tab.href

        return (
          <NavLink
            key={tab.href}
            to={tab.href}
            className={`flex flex-col items-center justify-center gap-1 py-1 px-3 min-w-[64px] min-h-[48px] rounded-xl transition-all ${
              isActive
                ? 'text-purple-600 dark:text-purple-400 font-bold'
                : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-lg transition-transform ${
                isActive
                  ? 'scale-110 bg-purple-100 text-purple-600 dark:bg-purple-950/60 dark:text-purple-300'
                  : ''
              }`}
            >
              <Icon className="h-4 w-4" />
            </div>
            <span className="text-[11px] leading-none tracking-tight">{tab.label}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}

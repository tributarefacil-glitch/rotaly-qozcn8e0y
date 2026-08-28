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
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex h-16 w-full items-center justify-around border-t border-[#1E2B58] bg-[#0A1128]/95 backdrop-blur-md px-2 shadow-2xl md:hidden">
      {tabs.map((tab) => {
        const Icon = tab.icon
        const isActive = location.pathname === tab.href

        return (
          <NavLink
            key={tab.href}
            to={tab.href}
            className={`flex flex-col items-center justify-center gap-1 py-1 px-3 min-w-[64px] min-h-[48px] rounded-lg transition duration-200 ${
              isActive ? 'text-[#60A5FA] font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-lg transition-transform ${
                isActive
                  ? 'scale-110 bg-[#0052CC]/40 border border-[#60A5FA]/40 text-[#FF6B35]'
                  : ''
              }`}
            >
              <Icon className="h-4 w-4" />
            </div>
            <span className="text-[11px] leading-none tracking-tight font-sans">{tab.label}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}

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
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex h-16 w-full items-center justify-around border-t border-slate-200 bg-white px-2 shadow-brand md:hidden">
      {tabs.map((tab) => {
        const Icon = tab.icon
        const isActive = location.pathname === tab.href

        return (
          <NavLink
            key={tab.href}
            to={tab.href}
            className={`flex flex-col items-center justify-center gap-1 py-1 px-3 min-w-[64px] min-h-[48px] rounded-card transition duration-200 ${
              isActive ? 'text-[#0052CC] font-bold' : 'text-slate-600 hover:text-[#0052CC]'
            }`}
          >
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-card transition-transform ${
                isActive ? 'scale-110 bg-blue-50 text-[#FF6B35]' : ''
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

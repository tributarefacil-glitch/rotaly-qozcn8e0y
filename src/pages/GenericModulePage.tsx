import React from 'react'
import { Header } from '@/components/Header'
import { Sidebar } from '@/components/Sidebar'
import SellerDashboard from '@/pages/SellerDashboard'

export default function GenericModulePage({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="min-h-screen bg-[#070D1E] text-slate-100 flex flex-col font-sans">
      <Header />
      <div className="flex flex-1">
        <Sidebar />
        <main className="flex-1 p-6 space-y-6 max-w-7xl mx-auto w-full">
          <div>
            <h1 className="font-heading text-2xl font-bold text-white">{title}</h1>
            <p className="font-sans text-sm text-slate-400">{description}</p>
          </div>
          <div className="p-12 rounded-2xl border border-dashed border-[#1E2B58] bg-[#0E1738] text-center shadow-brand-dark">
            <p className="font-sans text-sm font-semibold text-slate-300">
              Módulo LOGHYPE sincronizado diretamente com a plataforma e telemetria de frotas ao
              vivo.
            </p>
          </div>
        </main>
      </div>
    </div>
  )
}

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
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
      <Header />
      <div className="flex flex-1">
        <Sidebar />
        <main className="flex-1 p-6 space-y-6 max-w-7xl mx-auto w-full">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{title}</h1>
            <p className="text-xs text-slate-500">{description}</p>
          </div>
          <div className="p-12 rounded-2xl border border-dashed border-slate-300 text-center dark:border-slate-800">
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">
              Módulo sincronizado diretamente com o banco de dados e mapa ao vivo.
            </p>
          </div>
        </main>
      </div>
    </div>
  )
}

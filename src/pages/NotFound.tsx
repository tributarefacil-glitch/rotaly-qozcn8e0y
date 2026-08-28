/* 404 Page - Displays when a user attempts to access a non-existent route - translate to the language of the user */
import { useLocation } from 'react-router-dom'
import { useEffect } from 'react'

const NotFound = () => {
  const location = useLocation()

  useEffect(() => {
    console.error('404 Error: User attempted to access non-existent route:', location.pathname)
  }, [location.pathname])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white p-4 text-center text-[#1a1a1a] font-sans">
      <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-card bg-[#F5F5F5] border border-slate-200 shadow-brand">
        <span className="font-heading font-black text-2xl text-[#FF6B35]">404</span>
      </div>
      <h1 className="font-heading text-2xl font-bold text-[#1a1a1a] mb-2">Página não encontrada</h1>
      <p className="font-sans text-sm text-slate-600 mb-6 max-w-sm">
        O endereço solicitado não existe ou você não possui permissão para acessar este módulo.
      </p>
      <a
        href="/"
        className="inline-flex items-center px-4 py-2 bg-[#0052CC] hover:bg-[#003E99] text-white text-xs font-bold rounded-input shadow-brand transition duration-100"
      >
        Voltar para a LOGHYPE
      </a>
    </div>
  )
}

export default NotFound

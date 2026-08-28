/* 404 Page - Displays when a user attempts to access a non-existent route - translate to the language of the user */
import { useLocation, Link } from 'react-router-dom'
import { useEffect } from 'react'
import { LoghypeLogo } from '@/components/LoghypeLogo'

const NotFound = () => {
  const location = useLocation()

  useEffect(() => {
    console.error('404 Error: User attempted to access non-existent route:', location.pathname)
  }, [location.pathname])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#070D1E] p-4 text-center text-white font-sans">
      <div className="mb-6">
        <LoghypeLogo size="lg" theme="dark" showTagline={true} />
      </div>
      <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-[#0E1738] border border-[#1E2B58] shadow-brand-dark">
        <span className="font-heading font-black text-2xl text-[#FF6B35]">404</span>
      </div>
      <h1 className="font-heading text-2xl font-bold text-white mb-2">Página não encontrada</h1>
      <p className="font-sans text-sm text-slate-400 mb-6 max-w-sm">
        O endereço solicitado não existe ou você não possui permissão para acessar este módulo.
      </p>
      <Link
        to="/"
        className="inline-flex items-center px-5 py-2.5 bg-[#0052CC] hover:bg-[#003E99] text-white text-xs font-bold rounded-xl shadow-brand transition duration-100 border border-blue-400/30"
      >
        Voltar para a LOGHYPE
      </Link>
    </div>
  )
}

export default NotFound

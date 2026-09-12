/* 404 Page - Displays when a user attempts to access a non-existent route */
import { useLocation, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { RotalyLogo } from '@/components/RotalyLogo'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { ArrowRight, Home, LayoutDashboard, Store, Bike, Shield } from 'lucide-react'

const NotFound = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, role, isAuthenticated, isLoading } = useAuth()

  useEffect(() => {
    console.error('404 Error: User attempted to access non-existent route:', location.pathname)
  }, [location.pathname])

  // Determinar rota e texto de destino inteligente conforme o papel do usuário logado
  const getDestination = () => {
    if (!isAuthenticated || !user) {
      return { path: '/', label: 'Voltar para a Rotaly', icon: Home }
    }
    if (role === 'admin') {
      return { path: '/admin', label: 'Ir para Painel Administrador', icon: Shield }
    }
    if (role === 'courier') {
      if (user.status === 'pending' || user.status === 'inactive') {
        return { path: '/pending-approval', label: 'Ver Status do Cadastro', icon: Bike }
      }
      return { path: '/courier', label: 'Ir para App do Entregador', icon: Bike }
    }
    // seller / lojista
    return { path: '/seller', label: 'Ir para Painel do Lojista', icon: Store }
  }

  const destination = getDestination()
  const DestIcon = destination.icon

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#070D1E] p-4 text-center text-white font-sans selection:bg-[#0052CC] relative overflow-hidden">
      {/* Background glow effects */}
      <div className="absolute -top-32 -left-32 w-80 h-80 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -right-32 w-80 h-80 bg-[#FF6B35]/15 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-md w-full flex flex-col items-center">
        <div className="mb-6">
          <RotalyLogo size="lg" theme="dark" showTagline={true} />
        </div>

        <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-[#0E1738] border border-[#1E2B58] shadow-brand-dark">
          <span className="font-heading font-black text-2xl text-[#FF6B35]">404</span>
        </div>

        <h1 className="font-heading text-2xl font-bold text-white mb-2">Página não encontrada</h1>

        <p className="font-sans text-sm text-slate-300 mb-6 max-w-sm leading-relaxed">
          {isAuthenticated ? (
            <>
              O endereço solicitado (
              <code className="text-[#60A5FA] bg-[#0E1738] px-1.5 py-0.5 rounded border border-[#1E2B58] text-xs font-mono">
                {location.pathname}
              </code>
              ) não existe ou você não possui permissão para acessar este módulo.
            </>
          ) : (
            'O endereço solicitado não existe ou você precisa entrar com sua conta para acessar.'
          )}
        </p>

        <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs justify-center">
          <Button
            onClick={() => navigate(destination.path, { replace: true })}
            className="w-full h-11 bg-[#0052CC] hover:bg-[#003E99] text-white text-xs font-bold rounded-xl shadow-brand transition duration-100 border border-blue-400/30 flex items-center justify-center gap-2"
          >
            <DestIcon className="h-4 w-4" />
            <span>{destination.label}</span>
            <ArrowRight className="h-3.5 w-3.5 opacity-80" />
          </Button>

          {isAuthenticated && (
            <Button
              variant="outline"
              onClick={() => navigate('/', { replace: true })}
              className="w-full sm:w-auto h-11 border-[#1E2B58] bg-[#0A1128] hover:bg-[#121E46] text-slate-300 hover:text-white text-xs font-semibold rounded-xl"
            >
              Início
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export default NotFound

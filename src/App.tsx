import React, { Component, ErrorInfo, ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AlertTriangle, RefreshCw, Home, ShieldAlert } from 'lucide-react'
import { Toaster } from '@/components/ui/toaster'
import { Toaster as Sonner } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { CompanyProvider } from '@/contexts/CompanyContext'
import Layout from './components/Layout'
import Index from './pages/Index'
import RegisterPage from './pages/RegisterPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import PendingApprovalPage from './pages/PendingApprovalPage'
import SellerDashboard from './pages/SellerDashboard'
import CourierApp from './pages/CourierApp'
import AdminDashboard from './pages/AdminDashboard'
import CourierFuelPage from './pages/CourierFuelPage'
import CourierHistoryPage from './pages/CourierHistoryPage'
import CourierProfilePage from './pages/CourierProfilePage'
import PublicTrackingPage from './pages/PublicTrackingPage'
import CompaniesPage from './pages/CompaniesPage'
import NotFound from './pages/NotFound'

interface GlobalErrorBoundaryProps {
  children: ReactNode
}

interface GlobalErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

// Fallback UI for GlobalErrorBoundary (Dark Navy #0A1128 theme)
function GlobalErrorFallback({
  error,
  errorInfo,
  onReset,
}: {
  error: Error | null
  errorInfo: ErrorInfo | null
  onReset: () => void
}) {
  const navigate = useNavigate()

  const handleGoHome = () => {
    onReset()
    navigate('/')
  }

  const handleReload = () => {
    window.location.reload()
  }

  return (
    <div className="min-h-screen w-full bg-[#0A1128] text-slate-100 flex items-center justify-center p-4 select-none relative overflow-hidden">
      {/* Background glow graphics */}
      <div className="absolute -top-32 -left-32 w-80 h-80 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -right-32 w-80 h-80 bg-[#FF6B35]/15 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-md w-full relative z-10">
        <Card className="border border-[#1E2B58] bg-[#0E1738] text-white shadow-2xl rounded-2xl overflow-hidden">
          <div className="h-1.5 w-full bg-gradient-to-r from-[#FF6B35] via-amber-500 to-[#0052CC]" />

          <CardHeader className="text-center pt-8 pb-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 mb-2 shadow-inner">
              <AlertTriangle className="h-7 w-7 text-amber-400" />
            </div>
            <CardTitle className="font-heading text-xl font-bold text-white tracking-tight">
              Algo saiu do trilho
            </CardTitle>
            <CardDescription className="text-slate-300 text-xs sm:text-sm mt-1 leading-relaxed">
              Tivemos um problema ao exibir esta tela.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-5 px-6 pb-6">
            {error && (
              <details className="rounded-xl border border-[#1E2B58] bg-[#0A1128] p-3 text-xs text-slate-300">
                <summary className="cursor-pointer font-semibold text-amber-400 hover:text-amber-300 flex items-center gap-1.5 outline-none select-none">
                  <span>Detalhes do erro para debug</span>
                </summary>
                <div className="mt-2.5 space-y-1.5 font-mono text-[11px] text-slate-300 overflow-x-auto max-h-40 whitespace-pre-wrap bg-black/40 p-2.5 rounded-lg border border-white/5">
                  <p className="text-rose-400 font-bold">{error.toString()}</p>
                  {errorInfo?.componentStack && (
                    <p className="text-slate-400 text-[10px] mt-1">{errorInfo.componentStack}</p>
                  )}
                </div>
              </details>
            )}

            <div className="flex flex-col sm:flex-row gap-2.5">
              <Button
                onClick={handleReload}
                className="flex-1 h-10 gap-2 bg-[#0052CC] hover:bg-[#003E99] text-white font-bold text-xs shadow-md rounded-xl transition-all"
              >
                <RefreshCw className="h-4 w-4" />
                Recarregar página
              </Button>
              <Button
                variant="outline"
                onClick={handleGoHome}
                className="flex-1 h-10 gap-2 border-[#1E2B58] bg-[#0A1128] hover:bg-[#121E46] text-slate-200 hover:text-white text-xs font-semibold rounded-xl"
              >
                <Home className="h-4 w-4 text-[#60A5FA]" />
                Ir para o início
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// CORREÇÃO 1: GlobalErrorBoundary class component wrapping all routes inside BrowserRouter
export class GlobalErrorBoundary extends Component<
  GlobalErrorBoundaryProps,
  GlobalErrorBoundaryState
> {
  constructor(props: GlobalErrorBoundaryProps) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    }
  }

  static getDerivedStateFromError(error: Error): Partial<GlobalErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(
      'GlobalErrorBoundary caught an unhandled error:',
      error,
      errorInfo?.componentStack,
    )
    this.setState({ errorInfo })
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <GlobalErrorFallback
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          onReset={this.handleReset}
        />
      )
    }

    return this.props.children
  }
}

// Error Boundary dedicado para rotas com painel no tema Dark Navy (#0E1738)
interface RouteErrorBoundaryProps {
  children: React.ReactNode
  routeName?: string
}

interface RouteErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

function RouteErrorFallback({
  error,
  routeName,
  onReset,
}: {
  error: Error | null
  routeName?: string
  onReset: () => void
}) {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen w-full bg-[#0A1128] text-slate-100 flex items-center justify-center p-4 select-none relative overflow-hidden">
      <div className="absolute -top-32 -left-32 w-80 h-80 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -right-32 w-80 h-80 bg-[#FF6B35]/15 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-lg w-full relative z-10">
        <Card className="border-2 border-amber-500/50 bg-[#0E1738] text-white shadow-2xl rounded-2xl overflow-hidden">
          <div className="h-1.5 w-full bg-gradient-to-r from-amber-500 via-rose-500 to-[#0052CC]" />

          <CardHeader className="text-center pt-8 pb-3">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 border border-amber-500/40 text-amber-400 mb-2 shadow-inner">
              <AlertTriangle className="h-7 w-7 text-amber-400" />
            </div>
            <CardTitle className="font-heading text-xl font-bold text-white tracking-tight">
              Algo saiu do trilho nesta tela
            </CardTitle>
            <CardDescription className="text-slate-300 text-xs sm:text-sm mt-1">
              {routeName
                ? `Tela: ${routeName}`
                : 'Ocorreu um erro inesperado ao carregar os dados.'}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4 px-6 pb-6">
            {error && (
              <div className="rounded-xl border border-rose-500/40 bg-[#0A1128] p-3 text-xs">
                <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400 block mb-1">
                  Mensagem do Erro
                </span>
                <p className="font-mono text-[11px] text-rose-300 break-words whitespace-pre-wrap bg-black/40 p-2.5 rounded-lg border border-white/5">
                  {error.message || String(error)}
                </p>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
              <Button
                onClick={() => window.location.reload()}
                className="flex-1 h-10 gap-2 bg-[#0052CC] hover:bg-[#003E99] text-white font-bold text-xs shadow-md rounded-xl transition-all"
              >
                <RefreshCw className="h-4 w-4" />
                Recarregar Página
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  onReset()
                  navigate('/')
                }}
                className="flex-1 h-10 gap-2 border-[#1E2B58] bg-[#0A1128] hover:bg-[#121E46] text-slate-200 hover:text-white text-xs font-semibold rounded-xl"
              >
                <Home className="h-4 w-4 text-[#60A5FA]" />
                Voltar ao Início
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  constructor(props: RouteErrorBoundaryProps) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    }
  }

  static getDerivedStateFromError(error: Error): Partial<RouteErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(
      `RouteErrorBoundary caught an error in [${this.props.routeName || 'route'}]:`,
      error,
      errorInfo?.componentStack,
    )
    this.setState({ errorInfo })
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <RouteErrorFallback
          error={this.state.error}
          routeName={this.props.routeName}
          onReset={this.handleReset}
        />
      )
    }

    return this.props.children
  }
}

// CORREÇÃO 4: Role Guard Component with Loop Prevention & Safe State
function ProtectedRoute({
  children,
  allowedRoles,
  routeName,
}: {
  children: React.ReactNode
  allowedRoles?: ('admin' | 'seller' | 'courier')[]
  routeName?: string
}) {
  const { user, role, isLoading, isAuthenticated } = useAuth()
  const location = useLocation()

  // Se ainda estiver carregando a sessão/perfil, exibe tela de loading elegante no tema Dark Navy
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0A1128] text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="h-9 w-9 animate-spin rounded-full border-4 border-[#0052CC] border-t-transparent shadow-brand" />
          <span className="font-heading text-xs font-semibold text-slate-300 tracking-wider uppercase">
            Carregando sessão...
          </span>
        </div>
      </div>
    )
  }

  // Se não autenticado ou sem usuário, redireciona para login preservando o state.from sem entrar em loop
  if (!isAuthenticated || !user) {
    if (location.pathname === '/login' || location.pathname === '/') {
      return <>{children}</>
    }
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // Check courier approval status: pending or inactive couriers are directed to pending approval page
  if (role === 'courier' && (user.status === 'pending' || user.status === 'inactive')) {
    if (location.pathname !== '/pending-approval') {
      return <Navigate to="/pending-approval" replace />
    }
    return <>{children}</>
  }

  // BLINDAGEM ESTRITA: perfis não-admin (seller ou courier) NUNCA podem renderizar em /admin ou qualquer sub-rota admin
  if (
    role !== 'admin' &&
    (location.pathname === '/admin' || location.pathname.startsWith('/admin/'))
  ) {
    if (role === 'courier') {
      return <Navigate to="/courier" replace />
    }
    return <Navigate to="/seller" replace />
  }

  // Role verification para rotas que exigem perfis específicos
  if (allowedRoles && !allowedRoles.includes(role)) {
    if (role === 'admin') return <Navigate to="/admin" replace />
    if (role === 'courier') return <Navigate to="/courier" replace />
    return <Navigate to="/seller" replace />
  }

  return <RouteErrorBoundary routeName={routeName}>{children}</RouteErrorBoundary>
}

// Componente dedicado para a rota /couriers:
// - Se role for seller, redireciona para /seller (o painel do vendedor já possui gestão de entregadores da filial)
// - Se role for admin, renderiza AdminDashboard
function CouriersRoute() {
  const { role } = useAuth()
  if (role === 'seller') {
    return <Navigate to="/seller" replace />
  }
  return <AdminDashboard defaultTab="couriers" />
}

// CORREÇÃO 2 & 3: Componente dedicado para a rota /settings
// - Garante que se o perfil for não-admin (ex: vendedor), exibe cartão informativo sem quebrar nem tentar carregar dados de admin
// - Se for admin, renderiza o painel com defaultTab="settings"
function SettingsRoute() {
  const { role } = useAuth()
  const navigate = useNavigate()

  if (role !== 'admin') {
    return (
      <div className="min-h-screen bg-[#070D1E] text-slate-100 flex flex-col justify-center items-center p-4 sm:p-6">
        <div className="max-w-md w-full">
          <Card className="border border-[#1E2B58] bg-[#0E1738] text-white shadow-brand-dark rounded-2xl overflow-hidden">
            <div className="h-1.5 w-full bg-[#FF6B35]" />
            <CardHeader className="text-center pt-6 pb-2">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 mb-2">
                <ShieldAlert className="h-6 w-6" />
              </div>
              <CardTitle className="font-heading text-lg font-bold text-white">
                Acesso Restrito
              </CardTitle>
              <CardDescription className="text-slate-300 text-xs mt-1">
                Você não tem permissão para acessar esta seção.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-2 pb-6">
              <p className="text-[11px] text-slate-400 text-center leading-relaxed">
                As configurações globais e parâmetros de combustível são reservados para o perfil
                Administrador.
              </p>
              <Button
                onClick={() => navigate(role === 'courier' ? '/courier' : '/seller')}
                className="w-full h-10 bg-[#0052CC] hover:bg-[#003E99] text-white font-bold text-xs rounded-xl shadow-brand"
              >
                Voltar para Meu Painel
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return <AdminDashboard defaultTab="settings" />
}

const App = () => (
  <BrowserRouter>
    <GlobalErrorBoundary>
      <AuthProvider>
        <CompanyProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner richColors position="top-right" />
            <Routes>
              {/* Public Track Routes (com suporte a sufixos e variações de path) */}
              <Route path="/track/:tracking_code" element={<PublicTrackingPage />} />
              <Route path="/track" element={<PublicTrackingPage />} />
              <Route path="/track/*" element={<PublicTrackingPage />} />

              {/* Authentication & Access Routes */}
              <Route path="/" element={<Index />} />
              <Route path="/login" element={<Index />} />
              {/* Rota pública de registro desabilitada - exibe aviso claro e redireciona */}
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/pending-approval" element={<PendingApprovalPage />} />

              {/* Protected Seller & Admin Routes */}
              <Route
                path="/seller"
                element={
                  <ProtectedRoute allowedRoles={['admin', 'seller']}>
                    <SellerDashboard defaultTab="overview" />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/control-tower"
                element={
                  <ProtectedRoute allowedRoles={['admin', 'seller']}>
                    <SellerDashboard defaultTab="control-tower" />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/reports"
                element={
                  <ProtectedRoute allowedRoles={['admin', 'seller']}>
                    <SellerDashboard defaultTab="reports" />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/fuel"
                element={
                  <ProtectedRoute allowedRoles={['admin', 'seller']}>
                    <SellerDashboard defaultTab="fuel" />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/orders"
                element={
                  <ProtectedRoute allowedRoles={['admin', 'seller']}>
                    <SellerDashboard defaultTab="overview" />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/routes"
                element={
                  <ProtectedRoute allowedRoles={['admin', 'seller']}>
                    <SellerDashboard defaultTab="control-tower" />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/customers"
                element={
                  <ProtectedRoute allowedRoles={['admin', 'seller']}>
                    <SellerDashboard defaultTab="customers" />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/couriers"
                element={
                  <ProtectedRoute allowedRoles={['admin', 'seller']}>
                    <CouriersRoute />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/settings"
                element={
                  <ProtectedRoute allowedRoles={['admin', 'seller']}>
                    <SettingsRoute />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/invoices"
                element={
                  <ProtectedRoute allowedRoles={['admin', 'seller']}>
                    <SellerDashboard defaultTab="reports" />
                  </ProtectedRoute>
                }
              />

              {/* Multi-tenant Companies Management */}
              <Route
                path="/empresas"
                element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <CompaniesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/empresas"
                element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <CompaniesPage />
                  </ProtectedRoute>
                }
              />

              {/* Protected Admin Executive Dashboard */}
              <Route
                path="/admin"
                element={
                  <ProtectedRoute allowedRoles={['admin']} routeName="Painel do Administrador">
                    <AdminDashboard defaultTab="overview" />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/users"
                element={
                  <ProtectedRoute allowedRoles={['admin']} routeName="Gestão de Usuários (Admin)">
                    <AdminDashboard defaultTab="couriers" />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/users"
                element={
                  <ProtectedRoute allowedRoles={['admin']} routeName="Gestão de Usuários">
                    <AdminDashboard defaultTab="couriers" />
                  </ProtectedRoute>
                }
              />

              {/* Protected Courier Mobile App */}
              <Route
                path="/courier"
                element={
                  <ProtectedRoute allowedRoles={['admin', 'courier']}>
                    <CourierApp />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/courier/fuel"
                element={
                  <ProtectedRoute allowedRoles={['admin', 'courier']}>
                    <CourierFuelPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/courier/tasks"
                element={
                  <ProtectedRoute allowedRoles={['admin', 'courier']}>
                    <CourierApp />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/courier/history"
                element={
                  <ProtectedRoute allowedRoles={['admin', 'courier']}>
                    <CourierHistoryPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/courier/profile"
                element={
                  <ProtectedRoute allowedRoles={['admin', 'courier']}>
                    <CourierProfilePage />
                  </ProtectedRoute>
                }
              />

              {/* Fallback 404 */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </TooltipProvider>
        </CompanyProvider>
      </AuthProvider>
    </GlobalErrorBoundary>
  </BrowserRouter>
)

export default App

import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import {
  Truck,
  Shield,
  Store,
  Lock,
  Mail,
  ArrowRight,
  ArrowLeft,
  Search,
  Zap,
  MapPin,
  CheckCircle2,
  Sparkles,
  Eye,
  EyeOff,
  UserCheck,
  Building2,
  UserPlus,
  KeyRound,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { getErrorMessage } from '@/lib/pocketbase/errors'

type SelectedProfile = 'admin' | 'seller' | 'courier' | null

export default function Index() {
  const { login, isAuthenticated, role } = useAuth()
  const navigate = useNavigate()

  // Selected Profile for the dedicated login view: null means grid of 3 cards
  const [selectedProfile, setSelectedProfile] = useState<SelectedProfile>(null)

  // Login form states
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  // Public Tracking Search state
  const [trackingCode, setTrackingCode] = useState('')

  // Handle opening a specific profile card
  const handleSelectProfile = (p: 'admin' | 'seller' | 'courier') => {
    setSelectedProfile(p)
    setEmail('')
    setPassword('')
  }

  // Quick preset logins for easy demoing
  const handleQuickLogin = async (
    userEmail: string,
    forcedRole: 'admin' | 'seller' | 'courier',
  ) => {
    setEmail(userEmail)
    setPassword('Skip@Pass')
    setSelectedProfile(forcedRole)
    try {
      setIsLoading(true)
      const loggedUser = await login(userEmail, 'Skip@Pass')
      toast.success(`Bem-vindo, ${loggedUser.name || 'Usuário'}!`)
      redirectByRoleAndStatus(loggedUser.role || forcedRole, loggedUser.status)
    } catch (err: unknown) {
      console.error(err)
      toast.error('Falha ao autenticar com as credenciais rápidas.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedEmail = email.trim().toLowerCase()
    if (!trimmedEmail || !password) {
      toast.error('Preencha e-mail e senha para acessar.')
      return
    }

    setIsLoading(true)
    try {
      const loggedUser = await login(trimmedEmail, password)
      toast.success(`Bem-vindo, ${loggedUser.name || 'Usuário'}!`)
      redirectByRoleAndStatus(loggedUser.role || selectedProfile || 'seller', loggedUser.status)
    } catch (err: unknown) {
      console.error('Login error:', err)
      const msg = getErrorMessage(
        err,
        'Credenciais inválidas. Verifique seu e-mail e senha cadastrados.',
      )
      toast.error(msg)
    } finally {
      setIsLoading(false)
    }
  }

  const redirectByRoleAndStatus = (userRole: string, status?: string) => {
    if (userRole === 'courier') {
      if (status === 'pending' || status === 'inactive') {
        navigate('/pending-approval')
      } else {
        navigate('/courier')
      }
    } else if (userRole === 'admin') {
      navigate('/admin')
    } else {
      navigate('/seller')
    }
  }

  const handlePublicTracking = (e: React.FormEvent) => {
    e.preventDefault()
    if (!trackingCode.trim()) {
      toast.error('Digite um código de rastreio válido.')
      return
    }
    navigate(`/track/${trackingCode.trim().toUpperCase()}`)
  }

  // Profile metadata for the form card
  const profileConfig: Record<
    'admin' | 'seller' | 'courier',
    {
      title: string
      subtitle: string
      icon: React.ElementType
      gradient: string
      badgeBg: string
      btnBg: string
      defaultEmail: string
      canRegister: boolean
      registerUrl?: string
    }
  > = {
    admin: {
      title: 'Administrador',
      subtitle: 'Acesso gerencial, aprovações e telemetria',
      icon: Shield,
      gradient: 'from-rose-500 to-red-600',
      badgeBg: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
      btnBg: 'bg-rose-600 hover:bg-rose-500 shadow-rose-600/30',
      defaultEmail: 'tributarefacil@gmail.com',
      canRegister: false,
    },
    seller: {
      title: 'Vendedor & Embarcador',
      subtitle: 'Gestão de pedidos, despacho e rotas de entrega',
      icon: Store,
      gradient: 'from-blue-600 to-indigo-600',
      badgeBg: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
      btnBg: 'bg-blue-600 hover:bg-blue-500 shadow-blue-600/30',
      defaultEmail: 'vendedor@logistica.com',
      canRegister: true,
      registerUrl: '/register?role=seller',
    },
    courier: {
      title: 'Entregador & Motorista',
      subtitle: 'App mobile com GPS, rotas otimizadas e comprovantes',
      icon: Truck,
      gradient: 'from-purple-600 to-indigo-600',
      badgeBg: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
      btnBg: 'bg-purple-600 hover:bg-purple-500 shadow-purple-600/30',
      defaultEmail: 'entregador1@logistica.com',
      canRegister: true,
      registerUrl: '/register?role=courier',
    },
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between selection:bg-blue-500 selection:text-white relative overflow-hidden">
      {/* Background glow graphics */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/2 -right-40 w-96 h-96 bg-purple-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 left-1/3 w-96 h-96 bg-emerald-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* Top Navbar */}
      <header className="relative z-10 w-full border-b border-slate-800/80 bg-slate-950/70 backdrop-blur-md px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link to="/" onClick={() => setSelectedProfile(null)} className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/25">
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <span className="text-lg font-black tracking-tight text-white block leading-tight">
                Gestão de Entregas
              </span>
              <span className="text-[11px] text-slate-400">
                Plataforma de Logística & Rastreamento
              </span>
            </div>
          </Link>

          <div className="flex items-center gap-3">
            {isAuthenticated ? (
              <Button
                onClick={() => redirectByRoleAndStatus(role)}
                className="bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-md"
              >
                Acessar Meu Painel →
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Link to="/register?role=courier">
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-purple-500/40 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20 text-xs hidden sm:flex"
                  >
                    Cadastre-se como Entregador
                  </Button>
                </Link>
                <Badge variant="outline" className="text-xs border-slate-700 text-slate-300">
                  🔒 PocketBase Auth
                </Badge>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="relative z-10 flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-8 sm:py-12 flex flex-col justify-center">
        {selectedProfile ? (
          /* ================= DEDICATED PROFILE LOGIN FORM ================= */
          <div className="max-w-md mx-auto w-full">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedProfile(null)}
              className="mb-4 text-xs text-slate-400 hover:text-white gap-1.5"
            >
              <ArrowLeft className="h-4 w-4" />
              Escolher outro perfil de acesso
            </Button>

            {(() => {
              const cfg = profileConfig[selectedProfile]
              const IconComponent = cfg.icon

              return (
                <Card className="border-slate-800 bg-slate-900/90 text-white backdrop-blur-xl shadow-2xl relative overflow-hidden">
                  <div className={`h-2 w-full bg-gradient-to-r ${cfg.gradient}`} />

                  <CardHeader className="space-y-2 pb-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${cfg.gradient} text-white shadow-md`}
                        >
                          <IconComponent className="h-5 w-5" />
                        </div>
                        <div>
                          <CardTitle className="text-xl font-bold text-white">
                            Login {cfg.title}
                          </CardTitle>
                          <Badge variant="outline" className={`mt-0.5 text-[10px] ${cfg.badgeBg}`}>
                            Perfil {cfg.title}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <CardDescription className="text-slate-400 text-xs">
                      {cfg.subtitle}
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    <form onSubmit={handleLoginSubmit} className="space-y-3.5">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-slate-300">E-mail</Label>
                        <div className="relative">
                          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                          <Input
                            type="email"
                            placeholder="seu.email@exemplo.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="bg-slate-950 border-slate-700 pl-9 text-xs text-white placeholder:text-slate-500 focus:border-blue-500"
                            required
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-semibold text-slate-300">Senha</Label>
                          <Link
                            to="/forgot-password"
                            className="text-[11px] text-blue-400 hover:underline"
                          >
                            Esqueceu a senha?
                          </Link>
                        </div>
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                          <Input
                            type={showPassword ? 'text' : 'password'}
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="bg-slate-950 border-slate-700 pl-9 pr-9 text-xs text-white placeholder:text-slate-500"
                            required
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                          >
                            {showPassword ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      </div>

                      <Button
                        type="submit"
                        disabled={isLoading}
                        className={`w-full h-11 text-white font-bold text-sm shadow-lg transition flex items-center justify-center gap-2 ${cfg.btnBg}`}
                      >
                        {isLoading ? (
                          'Autenticando...'
                        ) : (
                          <>
                            <span>Entrar como {cfg.title}</span>
                            <ArrowRight className="h-4 w-4" />
                          </>
                        )}
                      </Button>
                    </form>

                    {/* Quick 1-click login preset */}
                    <div className="pt-2 border-t border-slate-800 space-y-2">
                      <button
                        type="button"
                        onClick={() => handleQuickLogin(cfg.defaultEmail, selectedProfile)}
                        className="w-full py-2 px-3 rounded-lg bg-slate-950 hover:bg-slate-800/90 border border-slate-800 text-left flex items-center justify-between transition group text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <Zap className="h-3.5 w-3.5 text-amber-400" />
                          <span className="text-slate-300 font-medium">
                            Preencher credencial de teste ({cfg.defaultEmail})
                          </span>
                        </div>
                        <span className="text-[11px] text-blue-400 group-hover:translate-x-0.5 transition-transform">
                          1-Clique →
                        </span>
                      </button>
                    </div>

                    {/* Links to Register or Forgot Password */}
                    <div className="pt-2 text-center text-xs text-slate-400 space-y-2">
                      {cfg.canRegister ? (
                        <p>
                          Ainda não tem conta?{' '}
                          <Link
                            to={cfg.registerUrl!}
                            className="text-blue-400 font-semibold hover:underline"
                          >
                            Cadastre-se aqui
                          </Link>
                        </p>
                      ) : (
                        <p className="text-[11px] text-slate-500">
                          Conta administrativa criada previamente no Skip Cloud.
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })()}
          </div>
        ) : (
          /* ================= 3-BLOCK PROFILE CARDS SELECTION (MAIN LOGIN SCREEN) ================= */
          <div className="space-y-10">
            {/* Header intro */}
            <div className="text-center space-y-3 max-w-2xl mx-auto">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-semibold">
                <Zap className="h-3.5 w-3.5" />
                Controle de Acesso & Perfis de Usuário
              </div>

              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-white leading-tight">
                Selecione seu perfil para acessar
              </h1>

              <p className="text-slate-400 text-sm sm:text-base leading-relaxed">
                Cada módulo possui uma interface dedicada com ferramentas específicas para sua
                operação logística diária.
              </p>
            </div>

            {/* THREE CARDS GRID (ADMIN, SELLER, COURIER) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto w-full">
              {/* CARD 1: ADMINISTRADOR */}
              <div
                onClick={() => handleSelectProfile('admin')}
                role="button"
                tabIndex={0}
                className="group relative flex flex-col justify-between rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/90 to-slate-950/90 p-6 backdrop-blur-xl shadow-xl transition-all duration-300 hover:-translate-y-1.5 hover:border-rose-500/50 hover:shadow-2xl hover:shadow-rose-500/10 cursor-pointer overflow-hidden text-left"
              >
                <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/10 rounded-full blur-2xl group-hover:bg-rose-500/20 transition-all" />

                <div className="space-y-4 relative z-10">
                  <div className="flex items-center justify-between">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-500 to-red-600 text-white shadow-lg shadow-rose-500/25 group-hover:scale-105 transition-transform">
                      <Shield className="h-7 w-7" />
                    </div>
                    <Badge
                      variant="outline"
                      className="text-[10px] uppercase font-bold tracking-wider bg-rose-500/10 text-rose-400 border-rose-500/30"
                    >
                      Acesso Gestor
                    </Badge>
                  </div>

                  <div>
                    <h2 className="text-xl font-bold text-white group-hover:text-rose-400 transition-colors">
                      Administrador
                    </h2>
                    <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                      Painel executivo com métricas financeiras globais, aprovação de cadastros de
                      entregadores, telemetria e controle da equipe.
                    </p>
                  </div>

                  <ul className="space-y-2 text-xs text-slate-300 pt-2 border-t border-slate-800/80">
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                      <span>Gestão e validação de CNH/selfies</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                      <span>Aprovação e bloqueio de usuários</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                      <span>KPIs de SLA e faturamento</span>
                    </li>
                  </ul>
                </div>

                <div className="pt-6 relative z-10">
                  <div className="flex items-center justify-between text-xs font-bold text-rose-400 group-hover:translate-x-1 transition-transform">
                    <span>Entrar como Administrador</span>
                    <ArrowRight className="h-4 w-4" />
                  </div>
                </div>
              </div>

              {/* CARD 2: VENDEDOR */}
              <div
                onClick={() => handleSelectProfile('seller')}
                role="button"
                tabIndex={0}
                className="group relative flex flex-col justify-between rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/90 to-slate-950/90 p-6 backdrop-blur-xl shadow-xl transition-all duration-300 hover:-translate-y-1.5 hover:border-blue-500/50 hover:shadow-2xl hover:shadow-blue-500/10 cursor-pointer overflow-hidden text-left"
              >
                <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl group-hover:bg-blue-500/20 transition-all" />

                <div className="space-y-4 relative z-10">
                  <div className="flex items-center justify-between">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/25 group-hover:scale-105 transition-transform">
                      <Store className="h-7 w-7" />
                    </div>
                    <Badge
                      variant="outline"
                      className="text-[10px] uppercase font-bold tracking-wider bg-blue-500/10 text-blue-400 border-blue-500/30"
                    >
                      Painel Comercial
                    </Badge>
                  </div>

                  <div>
                    <h2 className="text-xl font-bold text-white group-hover:text-blue-400 transition-colors">
                      Vendedor
                    </h2>
                    <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                      Criação de novos pedidos de entrega, monitoramento de status em tempo real,
                      roteirização e cadastro de clientes.
                    </p>
                  </div>

                  <ul className="space-y-2 text-xs text-slate-300 pt-2 border-t border-slate-800/80">
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                      <span>Criação rápida de despachos</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                      <span>Roteirização inteligente com IA</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                      <span>Acompanhamento no mapa ao vivo</span>
                    </li>
                  </ul>
                </div>

                <div className="pt-6 relative z-10">
                  <div className="flex items-center justify-between text-xs font-bold text-blue-400 group-hover:translate-x-1 transition-transform">
                    <span>Entrar como Vendedor</span>
                    <ArrowRight className="h-4 w-4" />
                  </div>
                </div>
              </div>

              {/* CARD 3: ENTREGADOR */}
              <div
                onClick={() => handleSelectProfile('courier')}
                role="button"
                tabIndex={0}
                className="group relative flex flex-col justify-between rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/90 to-slate-950/90 p-6 backdrop-blur-xl shadow-xl transition-all duration-300 hover:-translate-y-1.5 hover:border-purple-500/50 hover:shadow-2xl hover:shadow-purple-500/10 cursor-pointer overflow-hidden text-left"
              >
                <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-2xl group-hover:bg-purple-500/20 transition-all" />

                <div className="space-y-4 relative z-10">
                  <div className="flex items-center justify-between">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-500/25 group-hover:scale-105 transition-transform">
                      <Truck className="h-7 w-7" />
                    </div>
                    <Badge
                      variant="outline"
                      className="text-[10px] uppercase font-bold tracking-wider bg-purple-500/10 text-purple-400 border-purple-500/30"
                    >
                      App Operacional
                    </Badge>
                  </div>

                  <div>
                    <h2 className="text-xl font-bold text-white group-hover:text-purple-400 transition-colors">
                      Entregador
                    </h2>
                    <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                      Interface mobile otimizada com lista de entregas, GPS ativo, assinatura
                      digital na tela e comprovante fotográfico.
                    </p>
                  </div>

                  <ul className="space-y-2 text-xs text-slate-300 pt-2 border-t border-slate-800/80">
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                      <span>Telemetria GPS a cada 30 segundos</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                      <span>Assinatura digital e foto de entrega</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                      <span>Fluxo de cadastro em 3 etapas</span>
                    </li>
                  </ul>
                </div>

                <div className="pt-6 relative z-10">
                  <div className="flex items-center justify-between text-xs font-bold text-purple-400 group-hover:translate-x-1 transition-transform">
                    <span>Entrar como Entregador</span>
                    <ArrowRight className="h-4 w-4" />
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Registration Bar & Public Tracking */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-5xl mx-auto w-full pt-4">
              {/* Public Tracking Box */}
              <div className="lg:col-span-7 rounded-2xl border border-blue-500/30 bg-gradient-to-br from-slate-900/90 to-blue-950/40 p-5 backdrop-blur-xl shadow-xl space-y-3">
                <div className="flex items-center gap-2 text-blue-400 font-bold text-xs uppercase tracking-wider">
                  <Search className="h-4 w-4" />
                  <span>Acompanhe sua Encomenda (Acesso Público Sem Login)</span>
                </div>

                <form onSubmit={handlePublicTracking} className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                      type="text"
                      placeholder="Ex: TRK-2025-001"
                      value={trackingCode}
                      onChange={(e) => setTrackingCode(e.target.value)}
                      className="h-10 bg-slate-950/80 border-slate-700 pl-10 text-xs text-white placeholder:text-slate-500 focus:border-blue-500"
                    />
                  </div>
                  <Button
                    type="submit"
                    className="h-10 px-5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md"
                  >
                    Rastrear Pedido
                  </Button>
                </form>
              </div>

              {/* Register Callout */}
              <div className="lg:col-span-5 rounded-2xl border border-purple-500/30 bg-gradient-to-br from-slate-900/90 to-purple-950/40 p-5 backdrop-blur-xl shadow-xl flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-center gap-2 text-purple-400 font-bold text-xs uppercase tracking-wider">
                    <UserPlus className="h-4 w-4" />
                    <span>Novo na Plataforma?</span>
                  </div>
                  <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                    Cadastre-se como entregador ou vendedor em menos de 2 minutos.
                  </p>
                </div>

                <div className="flex gap-2">
                  <Link to="/register?role=courier" className="flex-1">
                    <Button
                      variant="outline"
                      className="w-full h-9 border-purple-500/50 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20 text-xs font-semibold"
                    >
                      Cadastrar Entregador
                    </Button>
                  </Link>
                  <Link to="/register?role=seller" className="flex-1">
                    <Button
                      variant="outline"
                      className="w-full h-9 border-blue-500/50 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 text-xs font-semibold"
                    >
                      Cadastrar Vendedor
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-slate-800/80 bg-slate-950/90 py-4 px-6 text-center text-xs text-slate-500">
        <p>
          Gestão de Entregas & Telemetria em Tempo Real © {new Date().getFullYear()} — Plataforma
          Skip Cloud
        </p>
      </footer>
    </div>
  )
}

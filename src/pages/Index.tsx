import React, { useState, useEffect } from 'react'
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
  KeyRound,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { RotalyLogo } from '@/components/RotalyLogo'
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

  // Interceptação de segurança: se a rota no browser contiver /track/...,
  // redirecionar imediatamente para a página pública de rastreio em vez de renderizar a Index
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname
      const match = path.match(/^\/track\/([^/?#]+)/i)
      if (match && match[1]) {
        navigate(`/track/${match[1]}`, { replace: true })
      }
    }
  }, [navigate])

  // Selected Profile for the dedicated login view: null means grid of 3 cards
  const [selectedProfile, setSelectedProfile] = useState<SelectedProfile>(null)

  // Login form states
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)

  // Public Tracking Search state
  const [trackingCode, setTrackingCode] = useState('')

  // Handle opening a specific profile card
  const handleSelectProfile = (p: 'admin' | 'seller' | 'courier') => {
    setSelectedProfile(p)
    setEmail('')
    setPassword('')
    setLoginError(null)
  }

  // Quick preset logins for easy demoing
  const handleQuickLogin = async (
    userEmail: string,
    forcedRole: 'admin' | 'seller' | 'courier',
  ) => {
    const cleanEmail = userEmail.trim().toLowerCase()
    setEmail(cleanEmail)
    setPassword('Skip@Pass')
    setSelectedProfile(forcedRole)
    setLoginError(null)
    try {
      setIsLoading(true)
      const loggedUser = await login(cleanEmail, 'Skip@Pass')
      toast.success(`Bem-vindo, ${loggedUser.name || 'Usuário'}!`)
      redirectByRoleAndStatus(loggedUser.role || forcedRole, loggedUser.status)
    } catch (err: unknown) {
      console.error('Quick login error:', err)
      const msg = getErrorMessage(
        err,
        'Credenciais inválidas. Verifique seu e-mail e senha cadastrados.',
      )
      setLoginError(msg)
      toast.error(msg)
    } finally {
      setIsLoading(false)
    }
  }

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginError(null)
    const trimmedEmail = email.trim().toLowerCase()
    if (!trimmedEmail || !password) {
      const msg = 'Preencha e-mail e senha para acessar.'
      setLoginError(msg)
      toast.error(msg)
      return
    }

    if (password.length < 8) {
      const msg = 'A senha deve ter pelo menos 8 caracteres.'
      setLoginError(msg)
      toast.error(msg)
      return
    }

    setIsLoading(true)
    try {
      const loggedUser = await login(trimmedEmail, password)
      setLoginError(null)
      toast.success(`Bem-vindo, ${loggedUser.name || 'Usuário'}!`)
      redirectByRoleAndStatus(loggedUser.role || selectedProfile || 'seller', loggedUser.status)
    } catch (err: unknown) {
      console.error('Login error:', err)
      const msg = getErrorMessage(
        err,
        'E-mail ou senha inválidos. Verifique suas credenciais de acesso.',
      )
      setLoginError(msg)
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
      accessInfo: string
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
      accessInfo: 'Conta administrativa master pré-configurada.',
    },
    seller: {
      title: 'Lojista & Embarcador',
      subtitle: 'Gestão de pedidos, despacho e rotas de entrega',
      icon: Store,
      gradient: 'from-blue-600 to-indigo-600',
      badgeBg: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
      btnBg: 'bg-blue-600 hover:bg-blue-500 shadow-blue-600/30',
      defaultEmail: 'vendedor@logistica.com',
      accessInfo: 'Cadastro de lojista realizado pelo administrador da plataforma.',
    },
    courier: {
      title: 'Entregador & Motorista',
      subtitle: 'App mobile com GPS, rotas otimizadas e comprovantes',
      icon: Truck,
      gradient: 'from-purple-600 to-indigo-600',
      badgeBg: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
      btnBg: 'bg-purple-600 hover:bg-purple-500 shadow-purple-600/30',
      defaultEmail: 'pimentaverdecentro@gmail.com',
      accessInfo: 'Cadastro de entregador realizado pelo administrador ou lojista.',
    },
  }

  return (
    <div className="min-h-screen bg-[#070D1E] text-slate-100 flex flex-col justify-between selection:bg-[#0052CC] selection:text-white relative overflow-hidden">
      {/* Background glow graphics */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-[#0052CC]/25 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/2 -right-40 w-96 h-96 bg-[#FF6B35]/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 left-1/3 w-96 h-96 bg-[#22C55E]/15 rounded-full blur-3xl pointer-events-none" />

      {/* Top Navbar */}
      <header className="relative z-10 w-full border-b border-[#1E2B58] bg-[#0A1128]/90 backdrop-blur-md px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link
            to="/"
            onClick={() => setSelectedProfile(null)}
            className="flex items-center hover:opacity-95"
          >
            <RotalyLogo size="md" theme="dark" showTagline={false} />
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
                <Badge variant="outline" className="text-xs border-slate-700 text-slate-300">
                  🔒 Acesso Restrito por Convite
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
          <div className="max-w-md mx-auto w-full transition-all duration-200">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedProfile(null)}
              className="mb-4 text-xs text-[#0052CC] hover:bg-blue-50 gap-1.5 font-bold rounded-input"
            >
              <ArrowLeft className="h-4 w-4" />
              Escolher outro perfil de acesso
            </Button>

            {(() => {
              const cfg = profileConfig[selectedProfile]
              const IconComponent = cfg.icon

              return (
                <Card className="border border-[#1E2B58] bg-[#0E1738] text-white shadow-brand-dark rounded-2xl relative overflow-hidden">
                  <div className="h-1.5 w-full bg-gradient-to-r from-[#22C55E] via-[#FBBF24] via-[#FF6B35] to-[#EF4444]" />

                  <CardHeader className="space-y-2 pb-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-tr from-[#0052CC] to-[#60A5FA] text-white shadow-brand">
                          <IconComponent className="h-5 w-5 text-white" />
                        </div>
                        <div>
                          <CardTitle className="font-heading text-xl font-bold text-white">
                            Login {cfg.title}
                          </CardTitle>
                          <Badge
                            variant="outline"
                            className={`mt-0.5 text-[10px] font-bold ${cfg.badgeBg}`}
                          >
                            Perfil {cfg.title}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <CardDescription className="font-sans text-slate-400 text-xs">
                      {cfg.subtitle}
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    {loginError && (
                      <div className="p-3 rounded-xl border border-red-500/40 bg-red-500/10 text-red-200 text-xs flex items-start gap-2.5 animate-in fade-in duration-200">
                        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-500 text-white font-bold text-[11px] mt-0.5">
                          !
                        </div>
                        <div className="flex-1">
                          <p className="font-semibold text-red-300">Falha ao entrar</p>
                          <p className="text-slate-200 mt-0.5 leading-relaxed">{loginError}</p>
                        </div>
                      </div>
                    )}

                    <form onSubmit={handleLoginSubmit} className="space-y-3.5">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-bold text-[#1a1a1a]">E-mail</Label>
                        <div className="relative">
                          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                          <Input
                            type="email"
                            placeholder="seu.email@exemplo.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="bg-white border-slate-200 pl-9 text-xs text-[#1a1a1a] placeholder:text-slate-400 focus:border-[#0052CC] rounded-input"
                            required
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-bold text-[#1a1a1a]">Senha</Label>
                          <Link
                            to="/forgot-password"
                            className="text-[11px] text-[#0052CC] font-bold hover:underline"
                          >
                            Esqueceu a senha?
                          </Link>
                        </div>
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                          <Input
                            type={showPassword ? 'text' : 'password'}
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="bg-white border-slate-200 pl-9 pr-9 text-xs text-[#1a1a1a] placeholder:text-slate-400 rounded-input focus:border-[#0052CC]"
                            required
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
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
                        className={`w-full h-11 text-white font-bold text-sm shadow-brand rounded-input transition duration-100 flex items-center justify-center gap-2 ${cfg.btnBg}`}
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
                    <div className="pt-2 border-t border-slate-100 space-y-2">
                      <button
                        type="button"
                        onClick={() => handleQuickLogin(cfg.defaultEmail, selectedProfile)}
                        className="w-full py-2.5 px-3 rounded-input bg-[#F5F5F5] hover:bg-slate-200/70 border border-slate-200 text-left flex items-center justify-between transition group text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <Zap className="h-3.5 w-3.5 text-[#FF6B35]" />
                          <span className="text-[#1a1a1a] font-medium">
                            Credencial de teste ({cfg.defaultEmail})
                          </span>
                        </div>
                        <span className="text-[11px] font-bold text-[#0052CC] group-hover:translate-x-0.5 transition-transform">
                          1-Clique →
                        </span>
                      </button>
                    </div>

                    {/* Access Notice and Forgot Password */}
                    <div className="pt-2 text-center text-xs text-slate-400 space-y-1.5">
                      <p className="text-[11px] text-slate-400">{cfg.accessInfo}</p>
                      <p className="text-[10px] text-slate-500">
                        Não tem conta? Solicite seu acesso ao administrador.
                      </p>
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
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 border border-[#1B3A8C]/20 text-[#1B3A8C] text-xs font-bold font-sans">
                <Zap className="h-3.5 w-3.5 text-[#00A8E8]" />
                Rotaly • Plataforma de Gestão e Rastreamento
              </div>

              <h1 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-[#1a1a1a] leading-tight">
                Selecione seu perfil para acessar
              </h1>

              <p className="font-sans text-slate-600 text-sm sm:text-base leading-relaxed">
                Entrega rápida, confiança garantida. Escolha seu módulo operacional para acessar o
                painel correspondente.
              </p>
            </div>

            {/* THREE CARDS GRID (ADMIN, SELLER, COURIER) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto w-full">
              {/* CARD 1: ADMINISTRADOR */}
              <div
                onClick={() => handleSelectProfile('admin')}
                role="button"
                tabIndex={0}
                className="group relative flex flex-col justify-between rounded-2xl border border-[#1E2B58] bg-[#0E1738] p-6 shadow-brand-dark transition-all duration-200 hover:-translate-y-1 hover:border-[#60A5FA] hover:shadow-brand cursor-pointer overflow-hidden text-left"
              >
                <div className="space-y-4 relative z-10">
                  <div className="flex items-center justify-between">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-tr from-[#0052CC] to-[#60A5FA] text-white shadow-brand group-hover:scale-105 transition-transform">
                      <Shield className="h-6 w-6" />
                    </div>
                    <Badge
                      variant="outline"
                      className="text-[10px] uppercase font-bold tracking-wider bg-[#0052CC]/30 text-[#60A5FA] border-[#60A5FA]/40"
                    >
                      Acesso Master
                    </Badge>
                  </div>

                  <div>
                    <h2 className="font-heading text-xl font-bold text-white group-hover:text-[#60A5FA] transition-colors">
                      Administrador
                    </h2>
                    <p className="font-sans text-xs text-slate-300 mt-1.5 leading-relaxed">
                      Painel executivo com telemetria da frota, aprovação de cadastros de
                      entregadores, relatórios e KPIs globais.
                    </p>
                  </div>

                  <ul className="space-y-2 text-xs text-slate-300 pt-2 border-t border-[#1E2B58] font-sans">
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#22C55E] shrink-0" />
                      <span>Gestão e validação de CNH/selfies</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#22C55E] shrink-0" />
                      <span>Aprovação e bloqueio de usuários</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#22C55E] shrink-0" />
                      <span>KPIs de SLA e faturamento</span>
                    </li>
                  </ul>
                </div>

                <div className="pt-6 relative z-10">
                  <div className="flex items-center justify-between text-xs font-bold text-[#60A5FA] group-hover:translate-x-1 transition-transform">
                    <span>Entrar como Administrador</span>
                    <ArrowRight className="h-4 w-4 text-[#FF6B35]" />
                  </div>
                </div>
              </div>

              {/* CARD 2: LOJISTA */}
              <div
                onClick={() => handleSelectProfile('seller')}
                role="button"
                tabIndex={0}
                className="group relative flex flex-col justify-between rounded-2xl border border-[#1E2B58] bg-[#0E1738] p-6 shadow-brand-dark transition-all duration-200 hover:-translate-y-1 hover:border-[#FF6B35] hover:shadow-brand-orange cursor-pointer overflow-hidden text-left"
              >
                <div className="space-y-4 relative z-10">
                  <div className="flex items-center justify-between">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#FF6B35] text-white shadow-brand group-hover:scale-105 transition-transform">
                      <Store className="h-6 w-6" />
                    </div>
                    <Badge
                      variant="outline"
                      className="text-[10px] uppercase font-bold tracking-wider bg-[#FF6B35]/20 text-[#FF6B35] border-[#FF6B35]/40"
                    >
                      Painel do Lojista
                    </Badge>
                  </div>

                  <div>
                    <h2 className="font-heading text-xl font-bold text-white group-hover:text-[#FF6B35] transition-colors">
                      Lojista
                    </h2>
                    <p className="font-sans text-xs text-slate-300 mt-1.5 leading-relaxed">
                      Criação rápida de despachos, acompanhamento de pedidos no mapa em tempo real e
                      otimização inteligente de rotas.
                    </p>
                  </div>

                  <ul className="space-y-2 text-xs text-slate-300 pt-2 border-t border-[#1E2B58] font-sans">
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#22C55E] shrink-0" />
                      <span>Criação rápida de despachos</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#22C55E] shrink-0" />
                      <span>Roteirização inteligente com IA</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#22C55E] shrink-0" />
                      <span>Acompanhamento no mapa ao vivo</span>
                    </li>
                  </ul>
                </div>

                <div className="pt-6 relative z-10">
                  <div className="flex items-center justify-between text-xs font-bold text-[#FF6B35] group-hover:translate-x-1 transition-transform">
                    <span>Entrar como Lojista</span>
                    <ArrowRight className="h-4 w-4 text-[#60A5FA]" />
                  </div>
                </div>
              </div>

              {/* CARD 3: ENTREGADOR */}
              <div
                onClick={() => handleSelectProfile('courier')}
                role="button"
                tabIndex={0}
                className="group relative flex flex-col justify-between rounded-2xl border border-[#1E2B58] bg-[#0E1738] p-6 shadow-brand-dark transition-all duration-200 hover:-translate-y-1 hover:border-[#60A5FA] hover:shadow-brand cursor-pointer overflow-hidden text-left"
              >
                <div className="space-y-4 relative z-10">
                  <div className="flex items-center justify-between">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-tr from-[#0052CC] to-[#60A5FA] text-white shadow-brand group-hover:scale-105 transition-transform">
                      <Truck className="h-6 w-6" />
                    </div>
                    <Badge
                      variant="outline"
                      className="text-[10px] uppercase font-bold tracking-wider bg-[#0052CC]/30 text-[#60A5FA] border-[#60A5FA]/40"
                    >
                      App Operacional
                    </Badge>
                  </div>

                  <div>
                    <h2 className="font-heading text-xl font-bold text-white group-hover:text-[#60A5FA] transition-colors">
                      Entregador
                    </h2>
                    <p className="font-sans text-xs text-slate-300 mt-1.5 leading-relaxed">
                      Interface mobile simplificada com lista de paradas sequencial, GPS ativo e
                      comprovante com foto e assinatura na tela.
                    </p>
                  </div>

                  <ul className="space-y-2 text-xs text-slate-300 pt-2 border-t border-[#1E2B58] font-sans">
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#22C55E] shrink-0" />
                      <span>Telemetria GPS a cada 30 segundos</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#22C55E] shrink-0" />
                      <span>Assinatura digital e foto de entrega</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#22C55E] shrink-0" />
                      <span>Navegação com Waze / Google Maps</span>
                    </li>
                  </ul>
                </div>

                <div className="pt-6 relative z-10">
                  <div className="flex items-center justify-between text-xs font-bold text-[#60A5FA] group-hover:translate-x-1 transition-transform">
                    <span>Entrar como Entregador</span>
                    <ArrowRight className="h-4 w-4 text-[#FF6B35]" />
                  </div>
                </div>
              </div>
            </div>

            {/* Public Tracking Box & Access Policy Info */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-5xl mx-auto w-full pt-4">
              {/* Public Tracking Box */}
              <div className="lg:col-span-7 rounded-2xl border border-[#1E2B58] bg-[#0E1738] p-5 shadow-brand-dark space-y-3">
                <div className="flex items-center gap-2 text-[#60A5FA] font-bold text-xs uppercase tracking-wider font-heading">
                  <Search className="h-4 w-4 text-[#FF6B35]" />
                  <span>Acompanhe sua Encomenda (Rastreio Público Rotaly)</span>
                </div>

                <form onSubmit={handlePublicTracking} className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                      type="text"
                      placeholder="Digite o código: TRK-2025-001..."
                      value={trackingCode}
                      onChange={(e) => setTrackingCode(e.target.value)}
                      className="h-10 bg-[#0A1128] border-[#1E2B58] pl-10 text-xs text-white placeholder:text-slate-400 focus:border-[#60A5FA] rounded-xl"
                    />
                  </div>
                  <Button
                    type="submit"
                    className="h-10 px-5 bg-[#FF6B35] hover:bg-[#E5531E] text-white font-bold text-xs shadow-brand rounded-xl transition duration-100"
                  >
                    Rastrear Pedido
                  </Button>
                </form>
              </div>

              {/* Invitation Policy Box */}
              <div className="lg:col-span-5 rounded-2xl border border-[#1E2B58] bg-[#0E1738] p-5 shadow-brand-dark flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-center gap-2 text-[#60A5FA] font-bold text-xs uppercase tracking-wider font-heading">
                    <Lock className="h-4 w-4 text-[#FF6B35]" />
                    <span>Cadastro Somente por Convite</span>
                  </div>
                  <p className="font-sans text-xs text-slate-300 mt-1 leading-relaxed">
                    O acesso à plataforma é exclusivo para vendedores e entregadores cadastrados
                    internamente por usuários autorizados do sistema.
                  </p>
                </div>

                <div className="rounded-lg bg-[#0A1128] p-2.5 border border-[#1E2B58] text-[11px] text-slate-400">
                  <span className="text-[#60A5FA] font-semibold">Precisa de acesso?</span> Entre em
                  contato com a equipe de administração ou seu gestor de logística.
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-[#1E2B58] bg-[#0A1128] py-4 px-6 text-center text-xs text-slate-400 font-sans">
        <p>
          Rotaly © {new Date().getFullYear()} — Entrega rápida, confiança garantida • Sua logística
          no próximo nível
        </p>
      </footer>
    </div>
  )
}

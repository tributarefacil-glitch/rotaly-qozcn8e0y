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
  CheckCircle2,
  Eye,
  EyeOff,
  Fuel,
  TrendingUp,
  Activity,
  AlertTriangle,
  Gauge,
  MapPin,
  Camera,
  ChevronDown,
  Menu,
  X,
  Phone,
  Globe,
  Facebook,
  Clock,
  MessageCircle,
  Building2,
  Instagram,
  Linkedin,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { RotalyLogo } from '@/components/RotalyLogo'
import { rotalyLogoImg } from '@/assets/logo-rotaly'
import { deliveryService } from '@/services/deliveryService'
import type { SiteContentRecord } from '@/types/delivery'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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

  // Se o usuário acessar /login diretamente ou com ?profile= ou ?role=, abrir o formulário correto
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const pathname = window.location.pathname
      const searchParams = new URLSearchParams(window.location.search)
      const roleParam = searchParams.get('profile') || searchParams.get('role')
      if (roleParam === 'admin' || roleParam === 'seller' || roleParam === 'courier') {
        setSelectedProfile(roleParam)
        setEmail((prev) => prev || profileConfig[roleParam].defaultEmail || '')
      } else if (pathname === '/login' && !selectedProfile) {
        setSelectedProfile('seller')
        setEmail((prev) => prev || profileConfig['seller'].defaultEmail || '')
      }
    }
  }, [])

  // Se o usuário já estiver autenticado e acessar a raiz "/" ou "/login",
  // redireciona diretamente para o painel correspondente ao seu papel
  useEffect(() => {
    if (isAuthenticated && role) {
      redirectByRoleAndStatus(role)
    }
  }, [isAuthenticated, role])

  // Selected Profile for dedicated login view: null means full landing page
  const [selectedProfile, setSelectedProfile] = useState<SelectedProfile>(() => {
    if (typeof window !== 'undefined') {
      const pathname = window.location.pathname
      const searchParams = new URLSearchParams(window.location.search)
      const roleParam = searchParams.get('profile') || searchParams.get('role')
      if (roleParam === 'admin' || roleParam === 'seller' || roleParam === 'courier') {
        return roleParam
      }
      if (pathname === '/login') {
        return 'seller'
      }
    }
    return null
  })

  // Login form states
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)

  // Mobile navigation drawer
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Public Tracking Search state
  const [trackingCode, setTrackingCode] = useState('')

  // Site Content dinâmico do PocketBase com fallback
  const [siteContent, setSiteContent] = useState<SiteContentRecord>({
    id: 'default',
    key: 'main',
    about_title: 'Tecnologia que move cada entrega',
    about_subtitle:
      'A Rotaly nasceu com um objetivo claro: simplificar a logística urbana de ponta a ponta.',
    about_paragraph_1:
      'Unimos inteligência de rotas viárias, telemetria em tempo real e comprovantes digitais em uma plataforma unificada. Do momento em que o pedido sai do balcão até a assinatura do cliente final, garantimos transparência total, redução de até 40% nos gastos com combustível e previsibilidade para operadores e lojistas.',
    about_paragraph_2:
      'Nossa tecnologia foi desenhada para o dinamismo do dia a dia de farmácias, comércios locais e distribuidoras. Sem atritos, sem planilhas soltas e sem retrabalho, conectamos administradores, gestores de despacho e entregadores de forma intuitiva e eficiente.',
    about_paragraph_3:
      'Com sede no Rio de Janeiro e atendimento em expansão por todo o Brasil, colocamos controle operacional, auditoria de quilometragem e tranquilidade ao alcance de frotas de todos os tamanhos.',
    phone: '(21) 4000-1234',
    whatsapp: '21999999999',
    email: 'contato@rotaly.com.br',
    address: 'Rio de Janeiro - RJ, Brasil',
    opening_hours: 'Segunda a Sábado, das 08:00 às 20:00',
    facebook_url: 'https://facebook.com',
    instagram_url: 'https://instagram.com',
    linkedin_url: 'https://linkedin.com',
    created: '',
    updated: '',
    collectionId: '',
    collectionName: 'site_content',
  })

  useEffect(() => {
    let isMounted = true
    deliveryService
      .getSiteContent()
      .then((data) => {
        if (isMounted && data) {
          setSiteContent((prev) => ({ ...prev, ...data }))
        }
      })
      .catch((err) => {
        console.warn('Usando conteúdo institucional padrão:', err)
      })
    return () => {
      isMounted = false
    }
  }, [])

  // Handle opening a specific profile card
  const handleSelectProfile = (p: 'admin' | 'seller' | 'courier') => {
    setSelectedProfile(p)
    setEmail(profileConfig[p].defaultEmail || '')
    setPassword('')
    setLoginError(null)
    setMobileMenuOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
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
      let msg = getErrorMessage(err)
      if (
        !msg ||
        msg.toLowerCase().includes('something went wrong') ||
        msg.toLowerCase().includes('failed to authenticate')
      ) {
        msg = 'E-mail ou senha incorretos. Verifique suas credenciais de acesso.'
      }
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

    setIsLoading(true)
    try {
      const loggedUser = await login(trimmedEmail, password)
      setLoginError(null)
      toast.success(`Bem-vindo, ${loggedUser.name || 'Usuário'}!`)
      redirectByRoleAndStatus(loggedUser.role || selectedProfile || 'seller', loggedUser.status)
    } catch (err: unknown) {
      console.error('Login error:', err)
      let msg = getErrorMessage(err)
      if (
        !msg ||
        msg.toLowerCase().includes('something went wrong') ||
        msg.toLowerCase().includes('failed to authenticate') ||
        msg.toLowerCase().includes('failed to process request')
      ) {
        msg = 'E-mail ou senha incorretos. Verifique suas credenciais de acesso.'
      }
      setLoginError(msg)
      toast.error(msg)
    } finally {
      setIsLoading(false)
    }
  }

  const redirectByRoleAndStatus = (userRole: string, status?: string) => {
    if (userRole === 'master') {
      navigate('/master', { replace: true })
    } else if (userRole === 'courier') {
      if (status === 'pending' || status === 'inactive') {
        navigate('/pending-approval', { replace: true })
      } else {
        navigate('/courier', { replace: true })
      }
    } else if (userRole === 'admin') {
      navigate('/admin', { replace: true })
    } else {
      // Perfil seller (lojista / vendedor) ou padrão logado
      navigate('/seller', { replace: true })
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

  const scrollToTracking = () => {
    setSelectedProfile(null)
    const el = document.getElementById('rastreamento')
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' })
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
    const input = document.getElementById('tracking-input')
    if (input) {
      setTimeout(() => input.focus(), 300)
    }
  }

  const scrollToSection = (id: string) => {
    setSelectedProfile(null)
    setMobileMenuOpen(false)
    setTimeout(() => {
      const el = document.getElementById(id)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' })
      }
    }, 50)
  }

  // Profile metadata for the form card
  const profileConfig: Record<
    'admin' | 'seller' | 'courier',
    {
      title: string
      subtitle: string
      icon: React.ElementType
      badgeBg: string
      btnBg: string
      defaultEmail: string
      accessInfo: string
    }
  > = {
    admin: {
      title: 'Administrador',
      subtitle: 'Acesso gerencial, aprovações e telemetria da frota',
      icon: Shield,
      badgeBg: 'bg-[#002855]/10 text-[#002855] border-[#002855]/30',
      btnBg: 'bg-[#002855] hover:bg-[#001D3D] text-white',
      defaultEmail: 'tributarefacil@gmail.com',
      accessInfo: 'Conta administrativa master pré-configurada.',
    },
    seller: {
      title: 'Lojista & Embarcador',
      subtitle: 'Gestão de pedidos, despacho e rotas de entrega',
      icon: Store,
      badgeBg: 'bg-[#00A3FF]/15 text-[#0066AA] border-[#00A3FF]/40',
      btnBg: 'bg-[#00A3FF] hover:bg-[#008CE0] text-white shadow-sm',
      defaultEmail: 'davidsmendes16@gmail.com',
      accessInfo: 'Cadastro de lojista realizado pelo administrador da plataforma.',
    },
    courier: {
      title: 'Entregador & Motorista',
      subtitle: 'App mobile com GPS, rotas sequenciais e comprovantes digitais',
      icon: Truck,
      badgeBg: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/40',
      btnBg: 'bg-[#002855] hover:bg-[#001D3D] text-white',
      defaultEmail: 'pimentaverdecentro@gmail.com',
      accessInfo: 'Cadastro de entregador realizado pelo administrador ou lojista.',
    },
  }

  return (
    <div className="min-h-screen bg-white text-[#002855] flex flex-col justify-between selection:bg-[#00A3FF] selection:text-white font-sans antialiased">
      {/* ================= TOP NAVBAR ================= */}
      <header className="sticky top-0 z-40 w-full bg-white/95 backdrop-blur-md border-b border-slate-100 shadow-[0_2px_12px_rgba(0,40,85,0.04)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 min-h-[5.5rem] py-2 flex items-center justify-between gap-4">
          {/* Logo brand: 4x maior (~240-280px no desktop) com fundo coincidente com o cabeçalho */}
          <Link
            to="/"
            onClick={() => setSelectedProfile(null)}
            className="flex items-center group transition-opacity shrink-0 py-1"
            title="Rotaly — Página Inicial"
          >
            <RotalyLogo
              size="header"
              theme="light"
              showTagline={false}
              containerBgClassName="bg-white"
            />
          </Link>

          {/* Center Navigation Links (desktop) */}
          <nav className="hidden lg:flex items-center gap-8 text-sm font-medium text-slate-700">
            <button
              type="button"
              onClick={() => scrollToSection('plataforma')}
              className="hover:text-[#00A3FF] transition-colors"
            >
              Plataforma
            </button>

            {/* Soluções Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-1 hover:text-[#00A3FF] transition-colors outline-none cursor-pointer">
                <span>Soluções</span>
                <ChevronDown className="h-3.5 w-3.5 opacity-70" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-56 p-2 bg-white shadow-xl border-slate-100 rounded-xl"
              >
                <DropdownMenuItem
                  onClick={() => handleSelectProfile('admin')}
                  className="cursor-pointer py-2.5 rounded-lg text-slate-700 hover:text-[#002855] hover:bg-slate-50 font-medium"
                >
                  <Shield className="h-4 w-4 mr-2.5 text-[#002855]" />
                  <span>Para Administradores</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleSelectProfile('seller')}
                  className="cursor-pointer py-2.5 rounded-lg text-slate-700 hover:text-[#002855] hover:bg-slate-50 font-medium"
                >
                  <Store className="h-4 w-4 mr-2.5 text-[#00A3FF]" />
                  <span>Para Lojistas & Farmácias</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleSelectProfile('courier')}
                  className="cursor-pointer py-2.5 rounded-lg text-slate-700 hover:text-[#002855] hover:bg-slate-50 font-medium"
                >
                  <Truck className="h-4 w-4 mr-2.5 text-emerald-600" />
                  <span>Para Entregadores & Frotas</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <button
              type="button"
              onClick={() => scrollToSection('recursos')}
              className="hover:text-[#00A3FF] transition-colors"
            >
              Recursos
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('quem-somos')}
              className="hover:text-[#00A3FF] transition-colors"
            >
              Quem somos
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('contato')}
              className="hover:text-[#00A3FF] transition-colors"
            >
              Contato
            </button>
          </nav>

          {/* Right Action Buttons */}
          <div className="flex items-center gap-2.5 sm:gap-3">
            {/* Dedicated "Entrar" dropdown or direct panel link */}
            {isAuthenticated ? (
              <Button
                onClick={() => redirectByRoleAndStatus(role)}
                className="bg-[#002855] hover:bg-[#001D3D] text-white text-xs sm:text-sm font-semibold h-10 px-4 rounded-xl shadow-sm transition-all"
              >
                Acessar Meu Painel →
              </Button>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="h-10 px-4 sm:px-5 border-slate-300 hover:border-[#002855] hover:bg-slate-50 text-slate-800 font-semibold text-xs sm:text-sm rounded-xl transition-all cursor-pointer"
                  >
                    Entrar
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="w-60 p-2 bg-white shadow-xl border-slate-100 rounded-xl"
                >
                  <div className="px-2 py-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    Escolha seu acesso
                  </div>
                  <DropdownMenuItem
                    onClick={() => handleSelectProfile('admin')}
                    className="cursor-pointer py-2.5 rounded-lg text-slate-700 hover:text-[#002855] hover:bg-slate-50 font-medium text-xs"
                  >
                    <Shield className="h-4 w-4 mr-2.5 text-[#002855]" />
                    <span>Entrar como Administrador</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleSelectProfile('seller')}
                    className="cursor-pointer py-2.5 rounded-lg text-slate-700 hover:text-[#002855] hover:bg-slate-50 font-medium text-xs"
                  >
                    <Store className="h-4 w-4 mr-2.5 text-[#00A3FF]" />
                    <span>Entrar como Lojista</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleSelectProfile('courier')}
                    className="cursor-pointer py-2.5 rounded-lg text-slate-700 hover:text-[#002855] hover:bg-slate-50 font-medium text-xs"
                  >
                    <Truck className="h-4 w-4 mr-2.5 text-emerald-600" />
                    <span>Entrar como Entregador</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* ATALHO FIXO NO MENU: Rastrear Pedido em Ciano #00A3FF */}
            <Button
              type="button"
              onClick={scrollToTracking}
              className="h-10 px-4 sm:px-5 bg-[#00A3FF] hover:bg-[#008CE0] text-white font-bold text-xs sm:text-sm rounded-xl shadow-[0_4px_14px_rgba(0,163,255,0.35)] hover:shadow-[0_6px_20px_rgba(0,163,255,0.45)] transition-all flex items-center gap-2 cursor-pointer"
            >
              <Search className="h-4 w-4" />
              <span className="whitespace-nowrap">Rastrear Pedido</span>
            </Button>

            {/* Mobile menu toggle */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2 text-slate-700 hover:text-[#002855] rounded-lg border border-slate-200"
              aria-label="Abrir menu"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu dropdown */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-slate-100 bg-white px-4 py-4 space-y-2 text-sm font-medium shadow-lg animate-in slide-in-from-top-2">
            <button
              type="button"
              onClick={() => scrollToSection('plataforma')}
              className="w-full text-left py-2 px-3 rounded-lg hover:bg-slate-50 text-slate-800 font-semibold"
            >
              Plataforma & Perfis
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('recursos')}
              className="w-full text-left py-2 px-3 rounded-lg hover:bg-slate-50 text-slate-800 font-semibold"
            >
              Recursos & Diferenciais
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('quem-somos')}
              className="w-full text-left py-2 px-3 rounded-lg hover:bg-slate-50 text-slate-800 font-semibold"
            >
              Quem somos
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('contato')}
              className="w-full text-left py-2 px-3 rounded-lg hover:bg-slate-50 text-slate-800 font-semibold"
            >
              Fale Conosco
            </button>
            <div className="pt-2 border-t border-slate-100 flex flex-col gap-2">
              <Button
                variant="outline"
                onClick={() => handleSelectProfile('seller')}
                className="w-full h-10 border-slate-300 text-[#002855] font-bold"
              >
                Acesso Lojista
              </Button>
              <Button
                variant="outline"
                onClick={() => handleSelectProfile('admin')}
                className="w-full h-10 border-slate-300 text-[#002855] font-bold"
              >
                Acesso Administrador
              </Button>
              <Button
                variant="outline"
                onClick={() => handleSelectProfile('courier')}
                className="w-full h-10 border-slate-300 text-[#002855] font-bold"
              >
                Acesso Entregador
              </Button>
            </div>
          </div>
        )}
      </header>

      {/* ================= MAIN CONTENT ================= */}
      <main className="flex-1 w-full">
        {selectedProfile ? (
          /* ================= DEDICATED PROFILE LOGIN FORM ================= */
          <section className="py-12 sm:py-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto flex flex-col items-center">
            <div className="max-w-md w-full transition-all duration-200">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedProfile(null)}
                className="mb-4 text-xs text-[#002855] hover:bg-slate-100 gap-1.5 font-bold rounded-lg cursor-pointer"
              >
                <ArrowLeft className="h-4 w-4" />
                Voltar à página inicial
              </Button>

              {(() => {
                const cfg = profileConfig[selectedProfile]
                const IconComponent = cfg.icon

                return (
                  <Card className="border border-slate-200 bg-white text-slate-900 shadow-[0_10px_35px_rgba(0,40,85,0.08)] rounded-2xl relative overflow-hidden">
                    <div className="h-1.5 w-full bg-gradient-to-r from-[#002855] via-[#00A3FF] to-[#002855]" />

                    <CardHeader className="space-y-2 pb-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#002855] text-white shadow-sm">
                            <IconComponent className="h-6 w-6 text-white" />
                          </div>
                          <div>
                            <CardTitle className="font-heading text-xl font-bold text-[#002855]">
                              Login {cfg.title}
                            </CardTitle>
                            <Badge
                              variant="outline"
                              className={`mt-0.5 text-[11px] font-bold ${cfg.badgeBg}`}
                            >
                              Perfil {cfg.title}
                            </Badge>
                          </div>
                        </div>
                      </div>
                      <CardDescription className="text-slate-600 text-xs leading-relaxed">
                        {cfg.subtitle}
                      </CardDescription>
                    </CardHeader>

                    <CardContent className="space-y-4">
                      {loginError && (
                        <div className="p-3.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-900 text-xs flex items-start gap-2.5 animate-in fade-in duration-200">
                          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-600 text-white font-bold text-[11px] mt-0.5">
                            !
                          </div>
                          <div className="flex-1">
                            <p className="font-bold text-rose-900">Falha ao entrar</p>
                            <p className="text-rose-700 mt-0.5 leading-relaxed">{loginError}</p>
                          </div>
                        </div>
                      )}

                      <form onSubmit={handleLoginSubmit} className="space-y-3.5">
                        <div className="space-y-1.5">
                          <Label className="text-xs font-bold text-slate-700">E-mail</Label>
                          <div className="relative">
                            <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                            <Input
                              type="email"
                              placeholder="seu.email@exemplo.com"
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              className="bg-white border-slate-300 pl-10 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#00A3FF] focus:ring-1 focus:ring-[#00A3FF] rounded-xl h-11"
                              required
                            />
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs font-bold text-slate-700">Senha</Label>
                            <Link
                              to="/forgot-password"
                              className="text-[11px] text-[#00A3FF] font-semibold hover:underline"
                            >
                              Esqueceu a senha?
                            </Link>
                          </div>
                          <div className="relative">
                            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                            <Input
                              type={showPassword ? 'text' : 'password'}
                              placeholder="••••••••"
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              className="bg-white border-slate-300 pl-10 pr-10 text-xs text-slate-900 placeholder:text-slate-400 rounded-xl h-11 focus:border-[#00A3FF] focus:ring-1 focus:ring-[#00A3FF]"
                              required
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword(!showPassword)}
                              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
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
                          className={`w-full h-11 text-white font-bold text-sm rounded-xl transition duration-150 flex items-center justify-center gap-2 ${cfg.btnBg}`}
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
                          className="w-full py-2.5 px-3.5 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-left flex items-center justify-between transition group text-xs cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <Zap className="h-3.5 w-3.5 text-[#00A3FF]" />
                            <span className="text-slate-700 font-medium">
                              Credencial de teste ({cfg.defaultEmail})
                            </span>
                          </div>
                          <span className="text-[11px] font-bold text-[#00A3FF] group-hover:translate-x-0.5 transition-transform">
                            1-Clique →
                          </span>
                        </button>
                      </div>

                      {/* Access Notice */}
                      <div className="pt-2 text-center text-xs text-slate-500 space-y-1">
                        <p className="text-[11px] text-slate-500">{cfg.accessInfo}</p>
                        <p className="text-[11px] text-slate-400">
                          Acesso restrito a usuários autorizados do sistema Rotaly.
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )
              })()}
            </div>
          </section>
        ) : (
          /* ================= REDESIGNED LANDING PAGE ================= */
          <>
            {/* HERO & RASTREAMENTO DO CLIENTE (DESTAQUE MÁXIMO) */}
            <section
              id="rastreamento"
              className="relative overflow-hidden pt-12 pb-16 sm:pt-20 sm:pb-24 bg-gradient-to-b from-[#F0F7FF] via-white to-white"
            >
              {/* Subtle map route watermark graphic in background */}
              <div className="absolute inset-0 pointer-events-none opacity-40">
                <svg
                  className="w-full h-full"
                  viewBox="0 0 1440 600"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  preserveAspectRatio="xMidYMid slice"
                >
                  <circle cx="200" cy="180" r="140" fill="#00A3FF" fillOpacity="0.04" />
                  <circle cx="1200" cy="260" r="180" fill="#002855" fillOpacity="0.03" />
                  <path
                    d="M 120 320 C 320 220, 520 400, 780 280 C 1020 160, 1220 340, 1380 240"
                    stroke="#00A3FF"
                    strokeWidth="3"
                    strokeDasharray="8 8"
                    strokeOpacity="0.3"
                  />
                  {/* Subtle map pin beacons */}
                  <g transform="translate(180, 160)">
                    <circle cx="16" cy="16" r="14" fill="#00A3FF" fillOpacity="0.12" />
                    <circle cx="16" cy="16" r="6" fill="#00A3FF" />
                  </g>
                  <g transform="translate(1180, 240)">
                    <circle cx="16" cy="16" r="14" fill="#002855" fillOpacity="0.1" />
                    <circle cx="16" cy="16" r="6" fill="#002855" />
                  </g>
                </svg>
              </div>

              <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-6 sm:space-y-8">
                {/* Hero Title & Subtitle */}
                <div className="space-y-3 sm:space-y-4 max-w-3xl mx-auto">
                  <h1 className="font-heading text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-[#002855] leading-tight sm:leading-tight">
                    Acompanhe sua encomenda em tempo real
                  </h1>
                  <p className="text-base sm:text-lg lg:text-xl text-slate-600 font-normal leading-relaxed">
                    Digite o código de rastreio e saiba onde está seu pedido agora.
                  </p>
                </div>

                {/* BIG HERO TRACKING CARD (ELEMENTO CENTRAL E MAIS VISÍVEL) */}
                <div className="max-w-3xl mx-auto">
                  <div className="bg-white rounded-2xl sm:rounded-3xl p-3 sm:p-4 shadow-[0_12px_45px_rgba(0,40,85,0.12)] border border-slate-200/80 transition-shadow hover:shadow-[0_16px_55px_rgba(0,40,85,0.16)]">
                    <form
                      onSubmit={handlePublicTracking}
                      className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3"
                    >
                      {/* Left Shield Badge */}
                      <div className="hidden sm:flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#00A3FF]/10 text-[#00A3FF]">
                        <Shield className="h-7 w-7 text-[#00A3FF]" />
                      </div>

                      {/* Large Input Field */}
                      <div className="relative flex-1">
                        <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                        <Input
                          id="tracking-input"
                          type="text"
                          placeholder="Digite o código de rastreio (ex: TRK-2025-001...)"
                          value={trackingCode}
                          onChange={(e) => setTrackingCode(e.target.value)}
                          className="h-14 sm:h-16 pl-12 pr-4 bg-slate-50/70 border-slate-200 hover:border-slate-300 focus:bg-white focus:border-[#00A3FF] focus:ring-2 focus:ring-[#00A3FF]/20 text-slate-900 placeholder:text-slate-400 text-sm sm:text-base font-medium rounded-xl sm:rounded-2xl shadow-inner transition-all"
                        />
                      </div>

                      {/* Cyan CTA Button (Elemento mais visível) */}
                      <Button
                        type="submit"
                        className="h-14 sm:h-16 px-6 sm:px-8 bg-[#00A3FF] hover:bg-[#008CE0] text-white font-bold text-sm sm:text-base rounded-xl sm:rounded-2xl shadow-[0_6px_22px_rgba(0,163,255,0.4)] hover:shadow-[0_8px_28px_rgba(0,163,255,0.55)] hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2.5 shrink-0 cursor-pointer"
                      >
                        <Search className="h-5 w-5" />
                        <span>Rastrear Pedido</span>
                      </Button>
                    </form>
                  </div>

                  {/* 3 Trust Signals directly below search */}
                  <div className="mt-5 flex flex-wrap items-center justify-center gap-6 sm:gap-10 text-xs sm:text-sm text-slate-600 font-medium">
                    <div className="flex items-center gap-2">
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </div>
                      <span>Atualização em tempo real</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#00A3FF]/15 text-[#0066AA]">
                        <Activity className="h-3.5 w-3.5 text-[#00A3FF]" />
                      </div>
                      <span>Informações precisas</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#002855]/10 text-[#002855]">
                        <Shield className="h-3.5 w-3.5 text-[#002855]" />
                      </div>
                      <span>Entrega segura</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* SEÇÃO: ACESSO À PLATAFORMA (3 CARDS COM ELEVADO CONTRASTE E RESPIRO) */}
            <section id="plataforma" className="py-16 sm:py-24 bg-white border-t border-slate-100">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
                <div className="text-center space-y-3 max-w-2xl mx-auto">
                  <h2 className="font-heading text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-[#002855]">
                    Acesso à Plataforma
                  </h2>
                  <p className="text-slate-600 text-sm sm:text-base font-normal">
                    Escolha seu perfil para acessar o painel correspondente.
                  </p>
                </div>

                {/* 3 Dedicated Profile Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8 max-w-6xl mx-auto">
                  {/* CARD 1: ADMINISTRADOR */}
                  <div
                    onClick={() => handleSelectProfile('admin')}
                    role="button"
                    tabIndex={0}
                    className="group flex flex-col justify-between rounded-2xl sm:rounded-3xl border border-slate-200 bg-white p-7 sm:p-8 shadow-[0_4px_20px_rgba(0,40,85,0.05)] hover:shadow-[0_12px_36px_rgba(0,40,85,0.12)] hover:border-[#002855]/40 transition-all duration-200 cursor-pointer text-left"
                  >
                    <div className="space-y-5">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#002855] text-white shadow-sm group-hover:scale-105 transition-transform">
                        <Shield className="h-6 w-6 text-white" />
                      </div>

                      <div>
                        <h3 className="font-heading text-xl sm:text-2xl font-bold text-[#002855] group-hover:text-[#00A3FF] transition-colors">
                          Administrador
                        </h3>
                        <p className="text-xs sm:text-sm text-slate-600 mt-2 leading-relaxed">
                          Painel executivo com telemetria da frota, aprovação de cadastros de
                          entregadores, relatórios e KPIs globais.
                        </p>
                      </div>

                      <ul className="space-y-2.5 text-xs sm:text-sm text-slate-700 pt-3 border-t border-slate-100">
                        <li className="flex items-start gap-2.5">
                          <CheckCircle2 className="h-4 w-4 text-[#00A3FF] shrink-0 mt-0.5" />
                          <span>Gestão e validação de CNH/selfies</span>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <CheckCircle2 className="h-4 w-4 text-[#00A3FF] shrink-0 mt-0.5" />
                          <span>Aprovação e bloqueio de usuários</span>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <CheckCircle2 className="h-4 w-4 text-[#00A3FF] shrink-0 mt-0.5" />
                          <span>KPIs de SLA e faturamento</span>
                        </li>
                      </ul>
                    </div>

                    <div className="pt-6 sm:pt-8">
                      <div className="flex items-center text-xs sm:text-sm font-bold text-[#002855] group-hover:text-[#00A3FF] group-hover:translate-x-1 transition-all">
                        <span>Entrar como Administrador</span>
                        <ArrowRight className="h-4 w-4 ml-2 text-[#00A3FF]" />
                      </div>
                    </div>
                  </div>

                  {/* CARD 2: LOJISTA */}
                  <div
                    onClick={() => handleSelectProfile('seller')}
                    role="button"
                    tabIndex={0}
                    className="group flex flex-col justify-between rounded-2xl sm:rounded-3xl border border-slate-200 bg-white p-7 sm:p-8 shadow-[0_4px_20px_rgba(0,40,85,0.05)] hover:shadow-[0_12px_36px_rgba(0,163,255,0.18)] hover:border-[#00A3FF] transition-all duration-200 cursor-pointer text-left"
                  >
                    <div className="space-y-5">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#00A3FF] text-white shadow-sm group-hover:scale-105 transition-transform">
                        <Store className="h-6 w-6 text-white" />
                      </div>

                      <div>
                        <h3 className="font-heading text-xl sm:text-2xl font-bold text-[#002855] group-hover:text-[#00A3FF] transition-colors">
                          Lojista
                        </h3>
                        <p className="text-xs sm:text-sm text-slate-600 mt-2 leading-relaxed">
                          Criação rápida de despachos, acompanhamento de pedidos no mapa em tempo
                          real e otimização inteligente de rotas.
                        </p>
                      </div>

                      <ul className="space-y-2.5 text-xs sm:text-sm text-slate-700 pt-3 border-t border-slate-100">
                        <li className="flex items-start gap-2.5">
                          <CheckCircle2 className="h-4 w-4 text-[#00A3FF] shrink-0 mt-0.5" />
                          <span>Criação rápida de despachos</span>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <CheckCircle2 className="h-4 w-4 text-[#00A3FF] shrink-0 mt-0.5" />
                          <span>Roteirização inteligente com IA</span>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <CheckCircle2 className="h-4 w-4 text-[#00A3FF] shrink-0 mt-0.5" />
                          <span>Acompanhamento no mapa ao vivo</span>
                        </li>
                      </ul>
                    </div>

                    <div className="pt-6 sm:pt-8">
                      <div className="flex items-center text-xs sm:text-sm font-bold text-[#00A3FF] group-hover:translate-x-1 transition-all">
                        <span>Entrar como Lojista</span>
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </div>
                    </div>
                  </div>

                  {/* CARD 3: ENTREGADOR */}
                  <div
                    onClick={() => handleSelectProfile('courier')}
                    role="button"
                    tabIndex={0}
                    className="group flex flex-col justify-between rounded-2xl sm:rounded-3xl border border-slate-200 bg-white p-7 sm:p-8 shadow-[0_4px_20px_rgba(0,40,85,0.05)] hover:shadow-[0_12px_36px_rgba(0,40,85,0.12)] hover:border-[#002855]/40 transition-all duration-200 cursor-pointer text-left"
                  >
                    <div className="space-y-5">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#002855] text-white shadow-sm group-hover:scale-105 transition-transform">
                        <Truck className="h-6 w-6 text-white" />
                      </div>

                      <div>
                        <h3 className="font-heading text-xl sm:text-2xl font-bold text-[#002855] group-hover:text-[#00A3FF] transition-colors">
                          Entregador
                        </h3>
                        <p className="text-xs sm:text-sm text-slate-600 mt-2 leading-relaxed">
                          Interface mobile simplificada com lista de paradas sequencial, GPS ativo e
                          comprovante com foto e assinatura na tela.
                        </p>
                      </div>

                      <ul className="space-y-2.5 text-xs sm:text-sm text-slate-700 pt-3 border-t border-slate-100">
                        <li className="flex items-start gap-2.5">
                          <CheckCircle2 className="h-4 w-4 text-[#00A3FF] shrink-0 mt-0.5" />
                          <span>Telemetria GPS a cada 30 segundos</span>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <CheckCircle2 className="h-4 w-4 text-[#00A3FF] shrink-0 mt-0.5" />
                          <span>Assinatura digital e foto de entrega</span>
                        </li>
                        <li className="flex items-start gap-2.5">
                          <CheckCircle2 className="h-4 w-4 text-[#00A3FF] shrink-0 mt-0.5" />
                          <span>Navegação com Waze / Google Maps</span>
                        </li>
                      </ul>
                    </div>

                    <div className="pt-6 sm:pt-8">
                      <div className="flex items-center text-xs sm:text-sm font-bold text-[#002855] group-hover:text-[#00A3FF] group-hover:translate-x-1 transition-all">
                        <span>Entrar como Entregador</span>
                        <ArrowRight className="h-4 w-4 ml-2 text-[#00A3FF]" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* SEÇÃO: POR QUE ESCOLHER A ROTALY? (DIFERENCIAIS SOLICITADOS) */}
            <section
              id="recursos"
              className="py-16 sm:py-24 bg-slate-50/70 border-t border-slate-200/60"
            >
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
                <div className="text-center space-y-3 max-w-2xl mx-auto">
                  <h2 className="font-heading text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-[#002855]">
                    Por que escolher a Rotaly?
                  </h2>
                  <p className="text-slate-600 text-sm sm:text-base font-normal">
                    Tecnologia inteligente para reduzir custos e dar controle absoluto à sua
                    operação de entrega.
                  </p>
                </div>

                {/* 7 Feature Cards Grid com alto contraste e respiro */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                  {/* Diferencial 1: Economia de até 40% de combustível */}
                  <div className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between space-y-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#002855]/10 text-[#002855]">
                      <Fuel className="h-6 w-6 text-[#002855]" />
                    </div>
                    <div className="space-y-1.5">
                      <h4 className="font-heading font-bold text-[#002855] text-sm sm:text-base">
                        Economia de até 40% de combustível
                      </h4>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        Roteirização viária inteligente calcula o caminho de menor custo e menor
                        quilometragem.
                      </p>
                    </div>
                  </div>

                  {/* Diferencial 2: +30% de produtividade dos entregadores */}
                  <div className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between space-y-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#00A3FF]/15 text-[#00A3FF]">
                      <TrendingUp className="h-6 w-6 text-[#00A3FF]" />
                    </div>
                    <div className="space-y-1.5">
                      <h4 className="font-heading font-bold text-[#002855] text-sm sm:text-base">
                        +30% de produtividade dos entregadores
                      </h4>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        Sequenciamento lógico de paradas reduz tempo ocioso e acelera as entregas
                        por hora.
                      </p>
                    </div>
                  </div>

                  {/* Diferencial 3: Monitoramento em tempo real de toda a operação */}
                  <div className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between space-y-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#002855]/10 text-[#002855]">
                      <Activity className="h-6 w-6 text-[#002855]" />
                    </div>
                    <div className="space-y-1.5">
                      <h4 className="font-heading font-bold text-[#002855] text-sm sm:text-base">
                        Monitoramento em tempo real de toda a operação
                      </h4>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        Torre de controle ao vivo com localização precisa, telemetria e status
                        instantâneo.
                      </p>
                    </div>
                  </div>

                  {/* Diferencial 4: Prevenção de desvios de rota e paradas fora do local */}
                  <div className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between space-y-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600">
                      <AlertTriangle className="h-6 w-6 text-amber-600" />
                    </div>
                    <div className="space-y-1.5">
                      <h4 className="font-heading font-bold text-[#002855] text-sm sm:text-base">
                        Prevenção de desvios de rota
                      </h4>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        Detecção automática de paradas indevidas e alertas de saída de rota
                        designada.
                      </p>
                    </div>
                  </div>

                  {/* Diferencial 5: Controle de quilometragem e performance */}
                  <div className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between space-y-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#002855]/10 text-[#002855]">
                      <Gauge className="h-6 w-6 text-[#002855]" />
                    </div>
                    <div className="space-y-1.5">
                      <h4 className="font-heading font-bold text-[#002855] text-sm sm:text-base">
                        Controle de quilometragem e performance
                      </h4>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        Métricas auditadas de km rodado, consumo estimado e adiantamentos de
                        combustível.
                      </p>
                    </div>
                  </div>

                  {/* Diferencial 6: Rastreamento em tempo real para empresa e cliente final */}
                  <div className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between space-y-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#00A3FF]/15 text-[#00A3FF]">
                      <MapPin className="h-6 w-6 text-[#00A3FF]" />
                    </div>
                    <div className="space-y-1.5">
                      <h4 className="font-heading font-bold text-[#002855] text-sm sm:text-base">
                        Rastreamento em tempo real
                      </h4>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        Transparência total com link público de rastreio para cliente final e painel
                        para empresa.
                      </p>
                    </div>
                  </div>

                  {/* Diferencial 7: Comprovante de entrega com foto e assinatura digital */}
                  <div className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between space-y-3 sm:col-span-2 lg:col-span-2">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#002855]/10 text-[#002855]">
                      <Camera className="h-6 w-6 text-[#002855]" />
                    </div>
                    <div className="space-y-1.5">
                      <h4 className="font-heading font-bold text-[#002855] text-sm sm:text-base">
                        Comprovante de entrega com foto e assinatura digital
                      </h4>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        Elimine contestações de entrega com registro fotográfico do pacote e
                        assinatura colhida direto no celular do motorista.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* ================= SEÇÃO DEDICADA: QUEM SOMOS ================= */}
            <section
              id="quem-somos"
              className="py-16 sm:py-24 bg-gradient-to-b from-white via-slate-50/70 to-white border-t border-slate-200/70 scroll-mt-20"
            >
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center">
                  <div className="lg:col-span-7 space-y-6">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#002855]/10 border border-[#002855]/20 text-[#002855] text-xs font-bold uppercase tracking-wider">
                      <Building2 className="h-3.5 w-3.5 text-[#00A3FF]" />
                      Institucional Rotaly
                    </div>
                    <h2 className="text-2xl sm:text-4xl font-extrabold text-[#002855] font-heading tracking-tight leading-tight">
                      {siteContent.about_title || 'Tecnologia que move cada entrega'}
                    </h2>
                    {siteContent.about_subtitle && (
                      <p className="text-base sm:text-lg text-[#00A3FF] font-semibold leading-relaxed">
                        {siteContent.about_subtitle}
                      </p>
                    )}
                    <div className="space-y-4 text-slate-600 text-sm sm:text-base leading-relaxed">
                      {siteContent.about_paragraph_1 && <p>{siteContent.about_paragraph_1}</p>}
                      {siteContent.about_paragraph_2 && <p>{siteContent.about_paragraph_2}</p>}
                      {siteContent.about_paragraph_3 && <p>{siteContent.about_paragraph_3}</p>}
                    </div>
                    <div className="pt-2 flex flex-wrap gap-4">
                      <Button
                        type="button"
                        onClick={() => scrollToSection('contato')}
                        className="bg-[#002855] hover:bg-[#001D3D] text-white font-bold h-11 px-6 rounded-xl shadow-sm transition-all flex items-center gap-2 cursor-pointer"
                      >
                        <MessageCircle className="h-4 w-4 text-[#00A3FF]" />
                        <span>Falar com Nossa Equipe</span>
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={scrollToTracking}
                        className="border-slate-300 hover:border-[#002855] text-[#002855] font-bold h-11 px-5 rounded-xl transition-all flex items-center gap-2 cursor-pointer"
                      >
                        <Search className="h-4 w-4 text-[#00A3FF]" />
                        <span>Rastrear Encomenda</span>
                      </Button>
                    </div>
                  </div>

                  <div className="lg:col-span-5">
                    <div className="relative rounded-3xl bg-gradient-to-br from-[#002855] to-[#001D3D] p-8 text-white shadow-2xl overflow-hidden border border-[#002855]/30">
                      <div className="absolute -top-12 -right-12 w-48 h-48 bg-[#00A3FF]/20 rounded-full blur-3xl pointer-events-none" />
                      <div className="relative space-y-6">
                        <div className="inline-flex p-3 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/15">
                          <RotalyLogo size="md" theme="dark" showTagline={false} />
                        </div>
                        <h3 className="text-xl font-bold font-heading text-white">
                          Conectando operações com precisão e economia
                        </h3>
                        <p className="text-xs sm:text-sm text-slate-300 leading-relaxed font-sans">
                          Desenvolvemos soluções para quem vive a logística na prática. Do despacho
                          automatizado à prestação de contas com telemetria real.
                        </p>
                        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/10 text-xs">
                          <div className="space-y-1">
                            <span className="text-2xl font-black text-[#00A3FF] block font-heading">
                              40%
                            </span>
                            <span className="text-slate-300">Menos gastos em combustível</span>
                          </div>
                          <div className="space-y-1">
                            <span className="text-2xl font-black text-[#00A3FF] block font-heading">
                              100%
                            </span>
                            <span className="text-slate-300">Telemetria e fotos auditadas</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* ================= SEÇÃO DEDICADA: FALE CONOSCO / CONTATO ================= */}
            <section
              id="contato"
              className="py-16 sm:py-24 bg-white border-t border-slate-200/80 scroll-mt-20"
            >
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="text-center max-w-2xl mx-auto space-y-3 mb-12">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#00A3FF]/15 border border-[#00A3FF]/30 text-[#0066AA] text-xs font-bold uppercase tracking-wider">
                    <Phone className="h-3.5 w-3.5 text-[#00A3FF]" />
                    Atendimento Direto
                  </div>
                  <h2 className="text-2xl sm:text-4xl font-extrabold text-[#002855] font-heading tracking-tight">
                    Fale Conosco
                  </h2>
                  <p className="text-sm sm:text-base text-slate-600">
                    Dúvidas sobre a plataforma, suporte ou planos personalizados para sua frota?
                    Nossa equipe está pronta para atender você.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {/* WhatsApp */}
                  {siteContent.whatsapp && (
                    <a
                      href={`https://wa.me/${siteContent.whatsapp.replace(/\D/g, '')}`}
                      target="_blank"
                      rel="noreferrer"
                      className="group rounded-2xl bg-white border-2 border-slate-200 hover:border-[#00A3FF] p-6 shadow-sm hover:shadow-lg transition-all duration-200 flex flex-col justify-between space-y-4"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 group-hover:bg-emerald-500 group-hover:text-white transition-colors">
                          <MessageCircle className="h-6 w-6" />
                        </div>
                        <Badge
                          variant="outline"
                          className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border-emerald-200"
                        >
                          WhatsApp Oficial
                        </Badge>
                      </div>
                      <div className="space-y-1">
                        <h4 className="font-heading font-bold text-[#002855] text-base group-hover:text-[#00A3FF] transition-colors">
                          Mensagem Rápida
                        </h4>
                        <p className="text-xs text-slate-500">Clique para abrir no WhatsApp</p>
                        <p className="text-sm font-semibold text-slate-800 pt-1">
                          {siteContent.whatsapp}
                        </p>
                      </div>
                      <span className="text-xs font-bold text-[#00A3FF] inline-flex items-center gap-1 group-hover:underline">
                        Iniciar conversa →
                      </span>
                    </a>
                  )}

                  {/* Telefone */}
                  {siteContent.phone && (
                    <a
                      href={`tel:${siteContent.phone.replace(/\D/g, '')}`}
                      className="group rounded-2xl bg-white border-2 border-slate-200 hover:border-[#002855] p-6 shadow-sm hover:shadow-lg transition-all duration-200 flex flex-col justify-between space-y-4"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#002855]/10 text-[#002855] group-hover:bg-[#002855] group-hover:text-white transition-colors">
                          <Phone className="h-6 w-6" />
                        </div>
                        <Badge
                          variant="outline"
                          className="text-[10px] font-bold text-slate-700 bg-slate-50 border-slate-200"
                        >
                          Ligação
                        </Badge>
                      </div>
                      <div className="space-y-1">
                        <h4 className="font-heading font-bold text-[#002855] text-base">
                          Central de Atendimento
                        </h4>
                        <p className="text-xs text-slate-500">Atendimento telefônico direto</p>
                        <p className="text-sm font-semibold text-slate-800 pt-1">
                          {siteContent.phone}
                        </p>
                      </div>
                      <span className="text-xs font-bold text-[#002855] inline-flex items-center gap-1 group-hover:underline">
                        Ligar agora →
                      </span>
                    </a>
                  )}

                  {/* E-mail */}
                  {siteContent.email && (
                    <a
                      href={`mailto:${siteContent.email}`}
                      className="group rounded-2xl bg-white border-2 border-slate-200 hover:border-[#00A3FF] p-6 shadow-sm hover:shadow-lg transition-all duration-200 flex flex-col justify-between space-y-4"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#00A3FF]/15 text-[#00A3FF] group-hover:bg-[#00A3FF] group-hover:text-white transition-colors">
                          <Mail className="h-6 w-6" />
                        </div>
                        <Badge
                          variant="outline"
                          className="text-[10px] font-bold text-[#0066AA] bg-sky-50 border-sky-200"
                        >
                          E-mail
                        </Badge>
                      </div>
                      <div className="space-y-1">
                        <h4 className="font-heading font-bold text-[#002855] text-base group-hover:text-[#00A3FF] transition-colors">
                          Suporte & Parcerias
                        </h4>
                        <p className="text-xs text-slate-500">Envie suas solicitações</p>
                        <p className="text-sm font-semibold text-slate-800 pt-1 break-all">
                          {siteContent.email}
                        </p>
                      </div>
                      <span className="text-xs font-bold text-[#00A3FF] inline-flex items-center gap-1 group-hover:underline">
                        Enviar e-mail →
                      </span>
                    </a>
                  )}

                  {/* Endereço & Horário */}
                  <div className="rounded-2xl bg-slate-50 border-2 border-slate-200 p-6 shadow-sm flex flex-col justify-between space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#002855]/10 text-[#002855]">
                        <Clock className="h-6 w-6 text-[#002855]" />
                      </div>
                      <Badge
                        variant="outline"
                        className="text-[10px] font-bold text-slate-600 bg-white border-slate-200"
                      >
                        Horário
                      </Badge>
                    </div>
                    <div className="space-y-2">
                      <div>
                        <h4 className="font-heading font-bold text-[#002855] text-sm">
                          Horário de Funcionamento
                        </h4>
                        <p className="text-xs text-slate-600 mt-0.5">
                          {siteContent.opening_hours || 'Segunda a Sábado, das 08:00 às 20:00'}
                        </p>
                      </div>
                      {siteContent.address && (
                        <div className="pt-2 border-t border-slate-200">
                          <h5 className="font-heading font-bold text-[#002855] text-xs flex items-center gap-1">
                            <MapPin className="h-3 w-3 text-[#00A3FF]" />
                            Localização
                          </h5>
                          <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                            {siteContent.address}
                          </p>
                        </div>
                      )}
                    </div>
                    <span className="text-[11px] font-semibold text-slate-500">
                      Atendimento em todo o Brasil
                    </span>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}
      </main>

      {/* ================= FOOTER INSTITUCIONAL COMPLETO ================= */}
      <footer
        id="quem-somos"
        className="bg-[#002855] text-white pt-14 pb-8 border-t border-[#001D3D]"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          {/* Top 4 Columns */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-10">
            {/* Column 1: Brand & Sobre */}
            <div className="space-y-4">
              <div className="flex items-center">
                {/* Logo container para rodapé institucional - 4x maior e fundo unificado com o card branco */}
                <div className="bg-white rounded-2xl px-5 py-3 inline-flex items-center justify-center shadow-lg border border-white/20">
                  <RotalyLogo
                    size="footer"
                    theme="light"
                    showTagline={false}
                    containerBgClassName="bg-white"
                  />
                </div>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed font-sans">
                {siteContent.about_subtitle ||
                  'Plataforma completa de gestão e rastreamento para operações de entrega com tecnologia, segurança e inteligência.'}
              </p>
              <p className="text-[11px] text-[#00A3FF] font-semibold">Sua rota, nossa entrega.</p>
            </div>

            {/* Column 2: Sobre a Rotaly */}
            <div className="space-y-3">
              <h4 className="font-heading font-bold text-sm text-white uppercase tracking-wider">
                Sobre a Rotaly
              </h4>
              <ul className="space-y-2 text-xs text-slate-300 font-sans">
                <li>
                  <button
                    type="button"
                    onClick={() => scrollToSection('plataforma')}
                    className="hover:text-white transition-colors"
                  >
                    Nossa Plataforma
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => scrollToSection('recursos')}
                    className="hover:text-white transition-colors"
                  >
                    Tecnologia e Algoritmos
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => scrollToSection('recursos')}
                    className="hover:text-white transition-colors"
                  >
                    Segurança e Telemetria
                  </button>
                </li>
                <li>
                  <span className="text-slate-400">Soluções para PMEs e Grandes Frotas</span>
                </li>
              </ul>
            </div>

            {/* Column 3: Links Úteis */}
            <div className="space-y-3">
              <h4 className="font-heading font-bold text-sm text-white uppercase tracking-wider">
                Links úteis
              </h4>
              <ul className="space-y-2 text-xs text-slate-300 font-sans">
                <li>
                  <button
                    type="button"
                    onClick={scrollToTracking}
                    className="hover:text-[#00A3FF] transition-colors flex items-center gap-1.5"
                  >
                    <Search className="h-3 w-3 text-[#00A3FF]" />
                    <span>Rastrear Encomenda</span>
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => handleSelectProfile('seller')}
                    className="hover:text-white transition-colors"
                  >
                    Acesso Lojista
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => handleSelectProfile('courier')}
                    className="hover:text-white transition-colors"
                  >
                    Acesso Entregador
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => handleSelectProfile('admin')}
                    className="hover:text-white transition-colors"
                  >
                    Acesso Administrador
                  </button>
                </li>
                <li>
                  <span className="text-slate-400">Política de Privacidade & Termos</span>
                </li>
              </ul>
            </div>

            {/* Column 4: Fale conosco & Siga-nos */}
            <div className="space-y-3">
              <h4 className="font-heading font-bold text-sm text-white uppercase tracking-wider">
                Fale conosco
              </h4>
              <ul className="space-y-2 text-xs text-slate-300 font-sans">
                {siteContent.whatsapp && (
                  <li>
                    <a
                      href={`https://wa.me/${siteContent.whatsapp.replace(/\D/g, '')}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 hover:text-[#00A3FF] transition-colors"
                    >
                      <MessageCircle className="h-3.5 w-3.5 text-[#00A3FF] shrink-0" />
                      <span>WhatsApp: {siteContent.whatsapp}</span>
                    </a>
                  </li>
                )}
                {siteContent.phone && (
                  <li>
                    <a
                      href={`tel:${siteContent.phone.replace(/\D/g, '')}`}
                      className="inline-flex items-center gap-2 hover:text-[#00A3FF] transition-colors"
                    >
                      <Phone className="h-3.5 w-3.5 text-[#00A3FF] shrink-0" />
                      <span>{siteContent.phone}</span>
                    </a>
                  </li>
                )}
                {siteContent.email && (
                  <li>
                    <a
                      href={`mailto:${siteContent.email}`}
                      className="inline-flex items-center gap-2 hover:text-[#00A3FF] transition-colors"
                    >
                      <Mail className="h-3.5 w-3.5 text-[#00A3FF] shrink-0" />
                      <span>{siteContent.email}</span>
                    </a>
                  </li>
                )}
                {siteContent.address && (
                  <li className="flex items-start gap-2">
                    <MapPin className="h-3.5 w-3.5 text-[#00A3FF] shrink-0 mt-0.5" />
                    <span>{siteContent.address}</span>
                  </li>
                )}
              </ul>

              {(siteContent.facebook_url ||
                siteContent.instagram_url ||
                siteContent.linkedin_url) && (
                <div className="pt-2">
                  <span className="text-xs font-semibold text-slate-200 block mb-2">Siga-nos</span>
                  <div className="flex items-center gap-2.5">
                    {siteContent.facebook_url && (
                      <a
                        href={siteContent.facebook_url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Facebook Rotaly"
                        className="h-8 w-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
                      >
                        <Facebook className="h-4 w-4" />
                      </a>
                    )}
                    {siteContent.instagram_url && (
                      <a
                        href={siteContent.instagram_url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Instagram Rotaly"
                        className="h-8 w-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
                      >
                        <Instagram className="h-4 w-4" />
                      </a>
                    )}
                    {siteContent.linkedin_url && (
                      <a
                        href={siteContent.linkedin_url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="LinkedIn Rotaly"
                        className="h-8 w-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
                      >
                        <Linkedin className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Copyright Bar (limpo, sem selo de plataforma) */}
          <div className="border-t border-white/10 pt-6 text-center text-xs text-slate-400 font-sans flex flex-col sm:flex-row items-center justify-between gap-2">
            <p>© {new Date().getFullYear()} Rotaly. Todos os direitos reservados.</p>
            <p className="font-mono text-[11px] text-slate-400">v0.0.331</p>
          </div>
        </div>
      </footer>
    </div>
  )
}

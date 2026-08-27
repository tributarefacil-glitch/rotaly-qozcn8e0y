import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Truck,
  Search,
  Lock,
  Mail,
  ArrowRight,
  ShieldCheck,
  Zap,
  MapPin,
  CheckCircle2,
  Bell,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'

export default function Index() {
  const { login, isAuthenticated, role } = useAuth()
  const navigate = useNavigate()

  // Login form states
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // Public Tracking Search state
  const [trackingCode, setTrackingCode] = useState('')

  // Quick preset logins for easy demoing
  const handleQuickLogin = async (userEmail: string) => {
    setEmail(userEmail)
    setPassword('Skip@Pass')
    try {
      setIsLoading(true)
      const loggedUser = await login(userEmail, 'Skip@Pass')
      toast.success(`Bem-vindo, ${loggedUser.name}!`)
      redirectByRole(loggedUser.role || 'seller')
    } catch (err: unknown) {
      console.error(err)
      toast.error('Falha ao autenticar com as credenciais rápidas.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) {
      toast.error('Preencha e-mail e senha.')
      return
    }

    setIsLoading(true)
    try {
      const loggedUser = await login(email, password)
      toast.success(`Bem-vindo, ${loggedUser.name}!`)
      redirectByRole(loggedUser.role || 'seller')
    } catch (err: unknown) {
      console.error('Login error:', err)
      toast.error('Credenciais inválidas. Verifique seu e-mail e senha.')
    } finally {
      setIsLoading(false)
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

  const redirectByRole = (userRole: string) => {
    if (userRole === 'courier') {
      navigate('/courier')
    } else if (userRole === 'admin') {
      navigate('/admin')
    } else {
      navigate('/seller')
    }
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
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/25">
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <span className="text-lg font-black tracking-tight text-white block leading-tight">
                Gestão de Entregas
              </span>
              <span className="text-[11px] text-slate-400">
                Logística Inteligente em Tempo Real
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {isAuthenticated ? (
              <Button
                onClick={() => redirectByRole(role)}
                className="bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-md"
              >
                Acessar Meu Painel →
              </Button>
            ) : (
              <Badge variant="outline" className="text-xs border-slate-700 text-slate-300">
                🔒 Sistema Conectado ao Skip Cloud
              </Badge>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="relative z-10 flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-10 sm:py-14 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
        {/* Left Column: Hero & Public Tracking */}
        <div className="lg:col-span-7 space-y-8">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-semibold">
              <Zap className="h-3.5 w-3.5" />
              Roteirização com IA + GPS ao Vivo + Notificações Push
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight text-white leading-[1.1]">
              Controle total de <br />
              <span className="bg-gradient-to-r from-blue-400 via-indigo-300 to-purple-400 bg-clip-text text-transparent">
                entregas e frotas
              </span>{' '}
              em tempo real.
            </h1>

            <p className="text-slate-300 text-base sm:text-lg leading-relaxed max-w-xl">
              Plataforma completa para administradores, vendedores e entregadores. Rastreamento
              preciso de ponta a ponta, sem fricção e com atualizações instantâneas.
            </p>
          </div>

          {/* PUBLIC TRACKING HERO CARD */}
          <div className="rounded-2xl border border-blue-500/30 bg-gradient-to-br from-slate-900/90 to-blue-950/40 p-6 backdrop-blur-xl shadow-2xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 translate-x-4 -translate-y-4 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl group-hover:bg-blue-500/20 transition-all" />

            <div className="flex items-center gap-2.5 text-blue-400 font-bold text-sm uppercase tracking-wider mb-2">
              <Search className="h-4 w-4" />
              <span>Acompanhe sua Encomenda (Público)</span>
            </div>

            <p className="text-xs text-slate-300 mb-4">
              Clientes podem consultar a localização do entregador e o status da entrega sem
              precisar fazer login.
            </p>

            <form onSubmit={handlePublicTracking} className="flex flex-col sm:flex-row gap-2.5">
              <div className="relative flex-1">
                <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  type="text"
                  placeholder="Ex: TRK-2025-001"
                  value={trackingCode}
                  onChange={(e) => setTrackingCode(e.target.value)}
                  className="h-12 bg-slate-950/80 border-slate-700 pl-10 text-sm text-white placeholder:text-slate-500 focus:border-blue-500"
                />
              </div>
              <Button
                type="submit"
                className="h-12 px-6 bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2"
              >
                <span>Rastrear Agora</span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </form>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
              <span>Exemplos rápidos:</span>
              <button
                type="button"
                onClick={() => setTrackingCode('TRK-2025-001')}
                className="text-blue-400 hover:underline"
              >
                TRK-2025-001
              </button>
              <span>•</span>
              <button
                type="button"
                onClick={() => setTrackingCode('TRK-2025-002')}
                className="text-blue-400 hover:underline"
              >
                TRK-2025-002
              </button>
              <span>•</span>
              <button
                type="button"
                onClick={() => setTrackingCode('TRK-2025-003')}
                className="text-blue-400 hover:underline"
              >
                TRK-2025-003
              </button>
            </div>
          </div>

          {/* Highlights */}
          <div className="grid grid-cols-3 gap-4 pt-2">
            <div className="border border-slate-800 rounded-xl p-3 bg-slate-900/50">
              <p className="text-xl font-bold text-white">3 Perfis</p>
              <p className="text-xs text-slate-400">Admin, Vendedor & Entregador</p>
            </div>
            <div className="border border-slate-800 rounded-xl p-3 bg-slate-900/50">
              <p className="text-xl font-bold text-white">30s GPS</p>
              <p className="text-xs text-slate-400">Telemetria em tempo real</p>
            </div>
            <div className="border border-slate-800 rounded-xl p-3 bg-slate-900/50">
              <p className="text-xl font-bold text-white">AI Copilot</p>
              <p className="text-xs text-slate-400">Assistente de rotas integrado</p>
            </div>
          </div>
        </div>

        {/* Right Column: Portal Login Card */}
        <div className="lg:col-span-5">
          <Card className="border-slate-800 bg-slate-900/90 text-white backdrop-blur-xl shadow-2xl">
            <CardHeader className="space-y-1">
              <CardTitle className="text-2xl font-bold text-white">Acessar Plataforma</CardTitle>
              <CardDescription className="text-slate-400 text-xs">
                Entre com seu e-mail e senha para acessar o painel do seu perfil.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              <form onSubmit={handleLoginSubmit} className="space-y-3.5">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300">E-mail de Acesso</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                    <Input
                      type="email"
                      placeholder="seu.email@logistica.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="bg-slate-950 border-slate-700 pl-9 text-xs text-white placeholder:text-slate-500"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300">Senha</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                    <Input
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="bg-slate-950 border-slate-700 pl-9 text-xs text-white"
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-10 bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm shadow-md transition"
                >
                  {isLoading ? 'Entrando...' : 'Entrar no Sistema'}
                </Button>
              </form>

              {/* Demo Quick Logins */}
              <div className="pt-3 border-t border-slate-800 space-y-2">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider text-center">
                  Acessos Rápidos de Demonstração (1-Clique):
                </p>

                <div className="grid grid-cols-1 gap-2">
                  <button
                    type="button"
                    onClick={() => handleQuickLogin('tributarefacil@gmail.com')}
                    className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left transition group"
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded bg-rose-500/20 text-rose-400 text-xs font-bold">
                        A
                      </span>
                      <div>
                        <p className="text-xs font-semibold text-white">Administrador</p>
                        <p className="text-[10px] text-slate-400">tributarefacil@gmail.com</p>
                      </div>
                    </div>
                    <span className="text-[11px] text-rose-400 group-hover:translate-x-1 transition-transform">
                      Entrar →
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleQuickLogin('vendedor@logistica.com')}
                    className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left transition group"
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded bg-blue-500/20 text-blue-400 text-xs font-bold">
                        V
                      </span>
                      <div>
                        <p className="text-xs font-semibold text-white">
                          Vendedor / Painel ao Vivo
                        </p>
                        <p className="text-[10px] text-slate-400">vendedor@logistica.com</p>
                      </div>
                    </div>
                    <span className="text-[11px] text-blue-400 group-hover:translate-x-1 transition-transform">
                      Entrar →
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleQuickLogin('entregador1@logistica.com')}
                    className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-left transition group"
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded bg-purple-500/20 text-purple-400 text-xs font-bold">
                        E
                      </span>
                      <div>
                        <p className="text-xs font-semibold text-white">
                          Entregador (Lucas Motoboy)
                        </p>
                        <p className="text-[10px] text-slate-400">entregador1@logistica.com</p>
                      </div>
                    </div>
                    <span className="text-[11px] text-purple-400 group-hover:translate-x-1 transition-transform">
                      Entrar →
                    </span>
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-slate-800/80 bg-slate-950/90 py-4 px-6 text-center text-xs text-slate-500">
        <p>
          Gestão de Entregas & Telemetria em Tempo Real © {new Date().getFullYear()} — Skip Cloud
          Platform
        </p>
      </footer>
    </div>
  )
}

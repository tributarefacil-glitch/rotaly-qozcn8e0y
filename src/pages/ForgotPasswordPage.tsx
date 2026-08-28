import React, { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Mail,
  KeyRound,
  Lock,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Truck,
  ShieldCheck,
  Send,
  Sparkles,
} from 'lucide-react'
import { deliveryService } from '@/services/deliveryService'
import { getErrorMessage } from '@/lib/pocketbase/errors'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { toast } from 'sonner'


export default function ForgotPasswordPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const initialToken = searchParams.get('token') || ''

  // Step 1: Request reset email, Step 2: Confirm with token & new password
  const [step, setStep] = useState<1 | 2>(initialToken ? 2 : 1)
  const [email, setEmail] = useState('')
  const [token, setToken] = useState(initialToken)
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [emailSent, setEmailSent] = useState(false)

  // Step 1: Send reset email
  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedEmail = email.trim().toLowerCase()
    if (!trimmedEmail) {
      toast.error('Informe seu e-mail cadastrado.')
      return
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(trimmedEmail)) {
      toast.error('Informe um formato de e-mail válido.')
      return
    }

    setIsLoading(true)
    try {
      await deliveryService.requestPasswordReset(trimmedEmail)
      setEmailSent(true)
      toast.success(
        'Código/Link de redefinição enviado com sucesso! Verifique sua caixa de entrada.',
      )
      // Advance to step 2 so user can paste the code or click the email link
      setStep(2)
    } catch (err: unknown) {
      console.error('Password reset request error:', err)
      // For security, PocketBase might still succeed or report errors
      const msg = getErrorMessage(err, 'Falha ao solicitar recuperação de senha.')
      toast.error(msg)
    } finally {
      setIsLoading(false)
    }
  }

  // Step 2: Confirm new password
  const handleConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedToken = token.trim()

    if (!trimmedToken) {
      toast.error('Informe o código ou token recebido no e-mail.')
      return
    }

    if (!password || password.length < 8) {
      toast.error('A nova senha deve conter pelo menos 8 caracteres.')
      return
    }

    if (password !== passwordConfirm) {
      toast.error('As senhas não coincidem.')
      return
    }

    setIsLoading(true)
    try {
      await deliveryService.confirmPasswordReset(trimmedToken, password, passwordConfirm)
      toast.success('Senha redefinida com sucesso! Você já pode fazer login.')
      navigate('/login')
    } catch (err: unknown) {
      console.error('Password reset confirmation error:', err)
      const msg = getErrorMessage(err, 'Token inválido ou expirado. Solicite uma nova redefinição.')
      toast.error(msg)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#FFFFFF] text-[#1a1a1a] flex flex-col justify-between selection:bg-[#0052CC] selection:text-white relative font-sans">
      {/* Header */}
      <header className="relative z-10 w-full border-b border-slate-200 bg-white shadow-subtle px-6 py-3.5">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0A1128] text-white shadow-sm p-1.5">
                <Truck className="h-5 w-5 text-[#FF6B35]" />
              </div>
              <div>
                <span className="font-heading text-lg font-black tracking-tight text-[#0052CC] block leading-tight">
                  LOGHYPE
                </span>
                <span className="font-sans text-[11px] text-slate-500">
                  Entrega rápida, confiança garantida
                </span>
              </div>
            </div>
          </Link>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/login')}
            className="text-xs text-[#0052CC] hover:bg-blue-50 font-bold gap-1.5 rounded-input"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar para o Login
          </Button>
        </div>
      </header>
      {/* Main Form */}
      <main className="relative z-10 flex-1 max-w-md mx-auto w-full px-4 py-12 flex items-center justify-center">
        <Card className="w-full border border-slate-200 bg-white text-[#1a1a1a] shadow-brand rounded-card">
          <CardHeader className="space-y-1">
            <div className="flex h-12 w-12 items-center justify-center rounded-card bg-[#0052CC] text-white shadow-brand mb-2">
              <KeyRound className="h-6 w-6 text-white" />
            </div>
            <CardTitle className="font-heading text-2xl font-black text-[#1a1a1a]">
              {initialToken ? 'Criar Nova Senha' : 'Recuperar Senha'}
            </CardTitle>
            <CardDescription className="font-sans text-slate-600 text-xs">
              {initialToken
                ? 'Informe sua nova senha para redefinir o acesso à sua conta.'
                : 'Informe seu e-mail cadastrado para enviarmos as instruções de redefinição.'}
            </CardDescription>{' '}
          </CardHeader>
          <CardContent className="space-y-5">
            {step === 1 ? (
              <form onSubmit={handleRequestReset} className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-300">
                    Seu E-mail Cadastrado
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                    <Input
                      type="email"
                      placeholder="exemplo@logistica.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="bg-slate-950 border-slate-700 pl-9 text-xs text-white placeholder:text-slate-500 focus:border-blue-500"
                      required
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-11 bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm shadow-md transition gap-2"
                >
                  <Send className="h-4 w-4" />
                  {isLoading ? 'Enviando...' : 'Enviar Código de Recuperação'}
                </Button>

                <div className="text-center pt-2">
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="text-xs text-blue-400 hover:underline"
                  >
                    Já tem o código/token? Clique aqui para redefinir.
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleConfirmReset} className="space-y-4">
                {emailSent && (
                  <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>
                      Enviamos um e-mail com o token de redefinição para <strong>{email}</strong>.
                    </span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-300">
                    Código / Token de Redefinição
                  </Label>
                  <div className="relative">
                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                    <Input
                      type="text"
                      placeholder="Cole o token recebido por e-mail"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      className="bg-slate-950 border-slate-700 pl-9 text-xs text-white placeholder:text-slate-500 font-mono"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-300">Nova Senha</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                    <Input
                      type="password"
                      placeholder="Mínimo 8 caracteres"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="bg-slate-950 border-slate-700 pl-9 text-xs text-white placeholder:text-slate-500"
                      minLength={8}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-300">
                    Confirmar Nova Senha
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                    <Input
                      type="password"
                      placeholder="Repita a nova senha"
                      value={passwordConfirm}
                      onChange={(e) => setPasswordConfirm(e.target.value)}
                      className="bg-slate-950 border-slate-700 pl-9 text-xs text-white placeholder:text-slate-500"
                      minLength={8}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  <Button
                    type="submit"
                    disabled={isLoading}
                    className="w-full h-11 bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm shadow-md transition"
                  >
                    {isLoading ? 'Redefinindo...' : 'Redefinir Senha e Entrar'}
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep(1)}
                    className="w-full h-9 border-slate-700 bg-slate-950 text-slate-400 hover:text-white text-xs"
                  >
                    Solicitar novo código
                  </Button>
                </div>
              </form>
            )}

            <div className="pt-3 border-t border-slate-800 text-center">
              <Link to="/login" className="text-xs text-slate-400 hover:text-white transition">
                Lembrou a senha?{' '}
                <span className="text-blue-400 font-semibold hover:underline">Fazer login</span>
              </Link>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-slate-800/80 bg-slate-950/90 py-4 px-6 text-center text-xs text-slate-500">
        <p>LOGHYPE — Entrega rápida, confiança garantida • Recuperação de Acesso</p>
      </footer>
    </div>
  )
}

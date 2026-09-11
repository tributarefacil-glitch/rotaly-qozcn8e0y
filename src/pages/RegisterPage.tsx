import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Lock, ArrowLeft, ShieldAlert } from 'lucide-react'
import { RotalyLogo } from '@/components/RotalyLogo'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { toast } from 'sonner'

export default function RegisterPage() {
  const navigate = useNavigate()

  useEffect(() => {
    toast.info('Cadastro público desabilitado', {
      description: 'O auto-cadastro público está encerrado. Solicite seu acesso ao administrador.',
    })
  }, [])

  return (
    <div className="min-h-screen bg-[#070D1E] text-slate-100 flex flex-col justify-between selection:bg-[#0052CC] selection:text-white relative font-sans">
      {/* Background glow graphics */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-[#0052CC]/25 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/2 -right-40 w-96 h-96 bg-[#FF6B35]/15 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 w-full border-b border-[#1E2B58] bg-[#0A1128]/90 backdrop-blur-md px-6 py-3.5 shadow-brand-dark">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link to="/" className="flex items-center hover:opacity-95">
            <RotalyLogo size="md" theme="dark" showTagline={false} />
          </Link>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/login')}
            className="text-xs text-[#60A5FA] hover:text-white hover:bg-[#121E46] font-bold gap-1.5 rounded-lg border border-[#1E2B58]"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar para o Login
          </Button>
        </div>
      </header>

      {/* Main Container */}
      <main className="relative z-10 flex-1 max-w-xl mx-auto w-full px-4 py-8 sm:py-12 flex flex-col justify-center">
        <Card className="border border-[#1E2B58] bg-[#0E1738] text-white shadow-brand-dark rounded-2xl overflow-hidden">
          <div className="h-1.5 w-full bg-gradient-to-r from-[#0052CC] via-[#FF6B35] to-[#EF4444]" />
          <CardContent className="p-8 text-center space-y-6">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-[#0052CC]/15 text-[#60A5FA] border border-[#0052CC]/30 shadow-brand">
              <Lock className="h-10 w-10 text-[#FF6B35]" />
            </div>

            <div className="space-y-2.5">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-semibold">
                <ShieldAlert className="h-3.5 w-3.5" />
                Acesso Restrito
              </div>
              <h1 className="font-heading text-2xl sm:text-3xl font-black text-white">
                Cadastro Somente por Convite
              </h1>
              <p className="font-sans text-slate-300 text-sm leading-relaxed max-w-md mx-auto">
                O auto-cadastro público de vendedores e entregadores está desativado. Para obter
                acesso à plataforma Rotaly, solicite a criação de sua conta diretamente ao
                administrador ou lojista responsável.
              </p>
            </div>

            <div className="rounded-xl border border-[#1E2B58] bg-[#0A1128] p-4 text-xs text-slate-400 text-left space-y-2">
              <p className="font-bold text-white flex items-center gap-1.5">
                ℹ️ Como ter acesso ao sistema?
              </p>
              <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-300">
                <li>
                  <strong>Lojistas / Embarcadores:</strong> o cadastro de sua loja é realizado pelo
                  administrador master da operação.
                </li>
                <li>
                  <strong>Entregadores:</strong> sua conta é cadastrada diretamente pelo lojista ou
                  pela administração da frota.
                </li>
              </ul>
            </div>

            <div className="pt-2 flex flex-col sm:flex-row gap-3 justify-center">
              <Button
                onClick={() =>
                  navigate('/login', {
                    state: {
                      message:
                        'Cadastro somente por convite. Solicite seu acesso ao administrador.',
                    },
                  })
                }
                className="h-11 px-8 bg-[#0052CC] hover:bg-[#003E99] text-white font-bold text-sm shadow-brand rounded-xl"
              >
                Ir para o Login
              </Button>
            </div>
          </CardContent>
        </Card>
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

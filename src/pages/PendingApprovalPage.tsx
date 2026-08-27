import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Clock,
  ShieldCheck,
  AlertCircle,
  RefreshCw,
  LogOut,
  Truck,
  CheckCircle2,
  FileCheck,
  Phone,
  Mail,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'

export default function PendingApprovalPage() {
  const { user, refreshUser, logout } = useAuth()
  const navigate = useNavigate()
  const [isRefreshing, setIsRefreshing] = useState(false)

  const handleCheckStatus = async () => {
    setIsRefreshing(true)
    try {
      await refreshUser()
      // If refreshed status is active, go to courier
      if (user?.status === 'active' || user?.status === 'idle' || user?.status === 'busy') {
        toast.success('Seu cadastro foi aprovado! Bem-vindo.')
        navigate('/courier')
      } else if (user?.status === 'inactive') {
        toast.error('Seu cadastro está inativo. Entre em contato com a administração.')
      } else {
        toast.info('Seu cadastro ainda está em análise pela equipe administrativa.')
      }
    } catch {
      toast.error('Não foi possível atualizar seu status no momento.')
    } finally {
      setIsRefreshing(false)
    }
  }

  const isInactive = user?.status === 'inactive'

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between selection:bg-blue-500 selection:text-white relative overflow-hidden">
      {/* Background glow graphics */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-amber-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/2 -right-40 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 w-full border-b border-slate-800/80 bg-slate-950/70 backdrop-blur-md px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-amber-500 to-amber-700 text-white shadow-lg shadow-amber-500/20">
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <span className="text-base font-bold text-white leading-tight block">
                Gestão de Entregas
              </span>
              <span className="text-xs text-slate-400">Verificação de Conta</span>
            </div>
          </Link>

          <Button
            variant="ghost"
            size="sm"
            onClick={logout}
            className="text-xs text-slate-400 hover:text-white"
          >
            <LogOut className="h-4 w-4 mr-1.5" />
            Sair
          </Button>
        </div>
      </header>

      {/* Main Container */}
      <main className="relative z-10 flex-1 max-w-xl mx-auto w-full px-4 py-12 flex items-center justify-center">
        <Card className="w-full border-slate-800 bg-slate-900/90 text-white shadow-2xl backdrop-blur-xl">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-inner">
              {isInactive ? (
                <AlertCircle className="h-8 w-8 text-rose-400" />
              ) : (
                <Clock className="h-8 w-8 text-amber-400 animate-pulse" />
              )}
            </div>

            <Badge
              variant="outline"
              className={`mx-auto mb-2 text-xs uppercase tracking-wider font-bold ${
                isInactive
                  ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
              }`}
            >
              {isInactive ? 'Conta Inativa / Bloqueada' : 'Cadastro em Análise'}
            </Badge>

            <CardTitle className="text-2xl font-black text-white">
              {isInactive
                ? 'Acesso Temporariamente Suspenso'
                : 'Aguardando Liberação do Administrador'}
            </CardTitle>

            <CardDescription className="text-slate-300 text-sm mt-2 leading-relaxed">
              {isInactive
                ? 'Sua conta de entregador está com status Inativo. Entre em contato com a equipe de logística para mais informações.'
                : 'Recebemos suas informações e seus documentos (RG/CNH e selfie). Nossa equipe de gestão está conferindo os dados para liberação do acesso.'}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6 pt-4">
            {/* Status Checklist Box */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3 text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                <span className="text-slate-400">Usuário:</span>
                <span className="font-semibold text-white">{user?.name || 'Não informado'}</span>
              </div>
              <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                <span className="text-slate-400">E-mail:</span>
                <span className="font-semibold text-white">{user?.email}</span>
              </div>
              <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                <span className="text-slate-400">Perfil:</span>
                <span className="font-semibold text-purple-400">🛵 Entregador</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Status atual:</span>
                <span
                  className={`font-bold uppercase ${
                    isInactive ? 'text-rose-400' : 'text-amber-400'
                  }`}
                >
                  {user?.status || 'Pendente'}
                </span>
              </div>
            </div>

            {/* Steps Info */}
            <div className="space-y-2.5 text-xs text-slate-300">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>Cadastro e envio de documentos concluídos com sucesso.</span>
              </div>
              <div className="flex items-start gap-2.5">
                <FileCheck className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <span>Análise documental pelo time de validação e compliance.</span>
              </div>
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
                <span>Após aprovação, suas rotas e entregas serão liberadas imediatamente.</span>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-3 pt-2">
              <Button
                onClick={handleCheckStatus}
                disabled={isRefreshing}
                className="w-full h-11 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-sm shadow-lg shadow-amber-500/20 gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                {isRefreshing ? 'Verificando...' : 'Verificar Status de Aprovação'}
              </Button>

              <Button
                variant="outline"
                onClick={logout}
                className="w-full h-10 border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800 text-xs"
              >
                Voltar à Tela de Login
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-slate-800/80 bg-slate-950/90 py-4 px-6 text-center text-xs text-slate-500">
        <p>Gestão de Entregas & Logística — Sistema de Credenciamento Seguro</p>
      </footer>
    </div>
  )
}

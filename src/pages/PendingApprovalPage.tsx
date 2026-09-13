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
  FileText,
  Phone,
  Mail,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { RotalyLogo } from '@/components/RotalyLogo'
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
    <div className="min-h-screen bg-white text-[#002855] flex flex-col justify-between relative font-sans">
      {/* Header */}
      <header className="relative z-10 w-full border-b border-slate-200 bg-white/95 backdrop-blur-md px-6 py-3.5 shadow-xs">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link to="/" className="flex items-center hover:opacity-95">
            <RotalyLogo size="md" theme="light" showTagline={false} />
          </Link>

          <Button
            variant="ghost"
            size="sm"
            onClick={logout}
            className="text-xs text-rose-600 hover:bg-rose-50 font-bold gap-1.5 rounded-lg border border-rose-200"
          >
            <LogOut className="h-4 w-4" />
            Sair da Conta
          </Button>
        </div>
      </header>
      {/* Main Container */}
      <main className="relative z-10 flex-1 max-w-xl mx-auto w-full px-4 py-12 flex items-center justify-center">
        <Card className="w-full border border-slate-200 bg-white text-[#002855] shadow-lg rounded-2xl">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-[#00A3FF] border border-blue-200 shadow-xs">
              {isInactive ? (
                <AlertCircle className="h-8 w-8 text-rose-600" />
              ) : (
                <Clock className="h-8 w-8 text-[#00A3FF] animate-pulse" />
              )}
            </div>

            <Badge
              variant="outline"
              className={`mx-auto mb-2 text-xs uppercase tracking-wider font-bold ${
                isInactive
                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                  : 'bg-blue-50 text-[#002855] border-blue-200'
              }`}
            >
              {isInactive ? 'Conta Inativa / Bloqueada' : 'Cadastro em Análise'}
            </Badge>

            <CardTitle className="font-heading text-2xl font-black text-[#002855]">
              {isInactive
                ? 'Acesso Temporariamente Suspenso'
                : 'Aguardando Liberação do Administrador'}
            </CardTitle>

            <CardDescription className="font-sans text-slate-500 text-sm mt-2 leading-relaxed">
              {isInactive
                ? 'Sua conta de entregador está com status Inativo. Entre em contato com a equipe de logística para mais informações.'
                : 'Recebemos suas informações e seus documentos (RG/CNH e selfie). Nossa equipe de gestão está conferindo os dados para liberação do acesso.'}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6 pt-4">
            {/* Status Checklist Box */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3 text-xs font-sans">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                <span className="text-slate-500">Usuário:</span>
                <span className="font-bold text-[#002855]">{user?.name || 'Não informado'}</span>
              </div>
              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                <span className="text-slate-500">E-mail:</span>
                <span className="font-bold text-[#002855]">{user?.email}</span>
              </div>
              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                <span className="text-slate-500">Perfil:</span>
                <span className="font-bold text-[#00A3FF]">🛵 Entregador Rotaly</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Status atual:</span>
                <span
                  className={`font-bold uppercase ${
                    isInactive ? 'text-rose-600' : 'text-[#002855]'
                  }`}
                >
                  {user?.status || 'Pendente'}
                </span>
              </div>
            </div>

            {/* Steps Info */}
            <div className="space-y-2.5 text-xs text-slate-600 font-sans">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>Cadastro e envio de documentos concluídos com sucesso.</span>
              </div>
              <div className="flex items-start gap-2.5">
                <FileText className="h-4 w-4 text-[#00A3FF] shrink-0 mt-0.5" />
                <span>Análise documental pelo time de validação e compliance da Rotaly.</span>
              </div>
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="h-4 w-4 text-[#002855] shrink-0 mt-0.5" />
                <span>Após aprovação, suas rotas e entregas serão liberadas imediatamente.</span>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-3 pt-2">
              <Button
                onClick={handleCheckStatus}
                disabled={isRefreshing}
                className="w-full h-11 bg-[#00A3FF] hover:bg-[#008CE0] text-white font-bold text-sm shadow-sm rounded-xl gap-2 transition duration-100"
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                {isRefreshing ? 'Verificando...' : 'Verificar Status de Aprovação'}
              </Button>

              <Button
                variant="outline"
                onClick={logout}
                className="w-full h-10 border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-xs font-bold rounded-xl"
              >
                Voltar à Tela de Login
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-slate-200 bg-white py-4 px-6 text-center text-xs text-slate-500">
        <p>Rotaly — Entrega rápida, confiança garantida • Sistema de Credenciamento</p>
      </footer>
    </div>
  )
}

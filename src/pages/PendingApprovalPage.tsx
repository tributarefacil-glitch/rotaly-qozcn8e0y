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
            onClick={logout}
            className="text-xs text-[#E74C3C] hover:bg-red-50 font-bold gap-1.5 rounded-input"
          >
            <LogOut className="h-4 w-4" />
            Sair da Conta
          </Button>
        </div>
      </header>
      {/* Main Container */}
      <main className="relative z-10 flex-1 max-w-xl mx-auto w-full px-4 py-12 flex items-center justify-center">
        <Card className="w-full border border-slate-200 bg-white text-[#1a1a1a] shadow-brand rounded-card">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-card bg-orange-50 text-[#FF6B35] border border-orange-200 shadow-sm">
              {isInactive ? (
                <AlertCircle className="h-8 w-8 text-[#E74C3C]" />
              ) : (
                <Clock className="h-8 w-8 text-[#FF6B35] animate-pulse" />
              )}
            </div>

            <Badge
              variant="outline"
              className={`mx-auto mb-2 text-xs uppercase tracking-wider font-bold ${
                isInactive
                  ? 'bg-red-50 text-[#E74C3C] border-[#E74C3C]/30'
                  : 'bg-orange-50 text-[#FF6B35] border-[#FF6B35]/30'
              }`}
            >
              {isInactive ? 'Conta Inativa / Bloqueada' : 'Cadastro em Análise'}
            </Badge>

            <CardTitle className="font-heading text-2xl font-black text-[#1a1a1a]">
              {isInactive
                ? 'Acesso Temporariamente Suspenso'
                : 'Aguardando Liberação do Administrador'}
            </CardTitle>

            <CardDescription className="font-sans text-slate-600 text-sm mt-2 leading-relaxed">
              {isInactive
                ? 'Sua conta de entregador está com status Inativo. Entre em contato com a equipe de logística para mais informações.'
                : 'Recebemos suas informações e seus documentos (RG/CNH e selfie). Nossa equipe de gestão está conferindo os dados para liberação do acesso.'}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6 pt-4">
            {/* Status Checklist Box */}
            <div className="rounded-card border border-slate-200 bg-[#F5F5F5] p-4 space-y-3 text-xs font-sans">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                <span className="text-slate-500">Usuário:</span>
                <span className="font-bold text-[#1a1a1a]">{user?.name || 'Não informado'}</span>
              </div>
              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                <span className="text-slate-500">E-mail:</span>
                <span className="font-bold text-[#1a1a1a]">{user?.email}</span>
              </div>
              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                <span className="text-slate-500">Perfil:</span>
                <span className="font-bold text-[#0052CC]">🛵 Entregador LOGHYPE</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Status atual:</span>
                <span
                  className={`font-bold uppercase ${
                    isInactive ? 'text-[#E74C3C]' : 'text-[#FF6B35]'
                  }`}
                >
                  {user?.status || 'Pendente'}
                </span>
              </div>
            </div>

            {/* Steps Info */}
            <div className="space-y-2.5 text-xs text-slate-600 font-sans">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-[#00AA44] shrink-0 mt-0.5" />
                <span>Cadastro e envio de documentos concluídos com sucesso.</span>
              </div>
              <div className="flex items-start gap-2.5">
                <FileText className="h-4 w-4 text-[#FF6B35] shrink-0 mt-0.5" />
                <span>Análise documental pelo time de validação e compliance da LOGHYPE.</span>
              </div>
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="h-4 w-4 text-[#0052CC] shrink-0 mt-0.5" />
                <span>Após aprovação, suas rotas e entregas serão liberadas imediatamente.</span>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-3 pt-2">
              <Button
                onClick={handleCheckStatus}
                disabled={isRefreshing}
                className="w-full h-11 bg-[#0052CC] hover:bg-[#003E99] text-white font-bold text-sm shadow-brand rounded-input gap-2 transition duration-100"
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                {isRefreshing ? 'Verificando...' : 'Verificar Status de Aprovação'}
              </Button>

              <Button
                variant="outline"
                onClick={logout}
                className="w-full h-10 border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-xs font-bold rounded-input"
              >
                Voltar à Tela de Login
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-slate-800/80 bg-slate-950/90 py-4 px-6 text-center text-xs text-slate-500">
        <p>LOGHYPE — Entrega rápida, confiança garantida • Sistema de Credenciamento</p>
      </footer>
    </div>
  )
}

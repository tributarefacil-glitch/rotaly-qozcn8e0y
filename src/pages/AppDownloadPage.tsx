import React, { useState } from 'react'
import {
  Download,
  Smartphone,
  ShieldCheck,
  MapPin,
  BatteryCharging,
  LogIn,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Copy,
  Check,
  ChevronRight,
  Sparkles,
  RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { RotalyLogo } from '@/components/RotalyLogo'
import { nativeGpsBridge } from '@/services/nativeGpsBridge'

export const AppDownloadPage: React.FC = () => {
  // Link padrão configurável do APK (hospedado no Skip Cloud, release do GitHub ou CDN direto)
  // Pode ser sobrescrito pelo admin ou definido por variável
  const [apkDownloadUrl] = useState<string>(
    'https://github.com/tributarefacil-glitch/rotaly-qozcn8e0y/actions',
  )
  const [copiedLink, setCopiedLink] = useState(false)

  const handleCopyLink = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href)
      setCopiedLink(true)
      toast.success('Link desta página copiado!', {
        description: 'Envie para o WhatsApp dos entregadores.',
      })
      setTimeout(() => setCopiedLink(false), 2500)
    }
  }

  const steps = [
    {
      num: '1',
      title: 'Baixar o Aplicativo',
      desc: 'Toque no botão "Baixar APK Rotaly" acima. O arquivo rotaly-app.apk começará a ser baixado no seu celular Android.',
      icon: <Download className="h-5 w-5 text-cyan-400" />,
      tag: 'Download Direto',
    },
    {
      num: '2',
      title: 'Liberar Instalação (Fontes Desconhecidas)',
      desc: 'Ao abrir o arquivo, se o Android avisar "Arquivo pode ser nocivo" ou "Instalar apps desconhecidos", toque em "Instalar assim mesmo" ou vá em Configurações > Permitir desta fonte. O app é oficial da Rotaly para a frota interna.',
      icon: <ShieldCheck className="h-5 w-5 text-emerald-400" />,
      tag: 'Segurança Android',
    },
    {
      num: '3',
      title: 'Permitir Localização "O Tempo Todo"',
      desc: 'MUITO IMPORTANTE: Quando o app abrir e pedir localização, escolha a opção "PERMITIR O TEMPO TODO" (e não apenas "Durante o uso do app"). Isso garante que sua rota continue rastreando com o Waze aberto ou tela apagada.',
      icon: <MapPin className="h-5 w-5 text-amber-400" />,
      tag: 'GPS em Segundo Plano',
    },
    {
      num: '4',
      title: 'Desativar Otimização de Bateria',
      desc: 'Vá em Configurações do Celular > Aplicativos > Rotaly > Bateria > marque "Sem restrições" ou "Não otimizar". Isso impede que a bateria do celular desligue o GPS no meio da rua.',
      icon: <BatteryCharging className="h-5 w-5 text-blue-400" />,
      tag: 'Operação Contínua',
    },
    {
      num: '5',
      title: 'Entrar com seu E-mail e Senha',
      desc: 'Abra o Rotaly e faça login com seu e-mail e senha de entregador já cadastrados pela empresa. Sua rota do dia aparecerá pronta.',
      icon: <LogIn className="h-5 w-5 text-purple-400" />,
      tag: 'Acesso Normal',
    },
  ]

  return (
    <div className="min-h-screen bg-[#070D22] text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-slate-950">
      {/* Topo / Header Rotaly */}
      <header className="border-b border-[#1E2B58] bg-[#0E1738]/80 backdrop-blur-md sticky top-0 z-30 px-4 py-3">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RotalyLogo className="h-8 w-auto" />
          </div>
          <Badge className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[11px] font-bold">
            Versão Oficial CLT 1.0.0
          </Badge>
        </div>
      </header>

      {/* Conteúdo Principal Mobile-First */}
      <main className="flex-1 max-w-xl mx-auto w-full p-4 sm:p-6 space-y-6">
        {/* Hero Card */}
        <div className="rounded-3xl border border-[#1E2B58] bg-gradient-to-b from-[#0E1738] to-[#121E46] p-6 shadow-2xl space-y-4 text-center relative overflow-hidden">
          <div className="absolute top-0 right-0 -mr-12 -mt-12 w-40 h-40 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-0 -ml-12 -mb-12 w-40 h-40 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />

          <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-tr from-[#0052CC] to-[#00A8E8] flex items-center justify-center shadow-lg shadow-cyan-500/20 border border-cyan-400/30">
            <Smartphone className="h-8 w-8 text-white" />
          </div>

          <div className="space-y-1.5">
            <span className="text-xs font-bold uppercase tracking-widest text-cyan-400">
              Aplicativo Oficial do Entregador
            </span>
            <h1 className="text-2xl sm:text-3xl font-black text-white font-heading tracking-tight">
              Instale o Rotaly no seu Celular
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-md mx-auto">
              Novo aplicativo Android com GPS contínuo em segundo plano. Não perde seus km mesmo com
              Waze aberto ou tela apagada.
            </p>
          </div>

          {/* Botão Principal de Download / Badge se já estiver no app nativo */}
          <div className="pt-2 space-y-2.5">
            {nativeGpsBridge.isNativeEnvironment() ? (
              <div className="w-full p-4 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 flex flex-col items-center justify-center gap-2 shadow-lg">
                <div className="flex items-center gap-2 font-bold text-sm text-emerald-300">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                  <span>Você já está usando o app nativo</span>
                </div>
                <p className="text-xs text-emerald-100/80 text-center">
                  Seu aplicativo já está com suporte oficial ao GPS em 2º plano e atualizações
                  diretas.
                </p>
                <a href="/app" className="mt-1">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 px-4 border-emerald-400/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 font-bold text-xs rounded-xl"
                  >
                    Voltar para o Painel de Entregas
                  </Button>
                </a>
              </div>
            ) : (
              <>
                <a
                  href={apkDownloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex w-full"
                >
                  <Button
                    type="button"
                    className="w-full h-14 bg-gradient-to-r from-[#0052CC] via-[#0066FF] to-[#00A8E8] hover:from-[#0047B3] hover:to-[#0095d0] text-white font-black text-base rounded-2xl shadow-xl shadow-blue-500/25 flex items-center justify-center gap-3 border border-cyan-400/40 transition hover:scale-[1.01]"
                  >
                    <Download className="h-6 w-6 animate-bounce" />
                    <span>Baixar APK Rotaly (v1.0.0)</span>
                  </Button>
                </a>

                <div className="flex items-center justify-between gap-2 px-1 text-[11px] text-slate-400">
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    Compatível com Android 8 ao 14+
                  </span>
                  <span>Tamanho: ~12 MB</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Aviso de Atualização Direta: Atualize sem desinstalar */}
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/40 p-4 flex items-start gap-3 text-xs text-emerald-100 shadow-lg">
          <RefreshCw className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-bold text-white text-xs">
                Atualização Rápida: Instale direto por cima!
              </p>
              <Badge className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] px-1.5 py-0">
                Não precisa desinstalar
              </Badge>
            </div>
            <p className="text-[11px] text-emerald-200/90 leading-relaxed">
              Com a assinatura oficial fixa do Rotaly, qualquer nova versão instala{' '}
              <strong className="text-white">diretamente por cima da anterior</strong>. Você{' '}
              <span className="text-emerald-300 underline font-semibold">não perde o login</span>,{' '}
              não precisa redigitar senha e não perde seu histórico de entregas ou rotas em
              andamento.
            </p>
          </div>
        </div>

        {/* Banner de Destaque: Por que instalar o APK? */}
        <div className="rounded-2xl border border-cyan-500/30 bg-cyan-950/30 p-4 flex items-start gap-3 text-xs text-cyan-100 shadow-lg">
          <Sparkles className="h-5 w-5 text-cyan-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold text-white text-xs">
              Vantagem exclusiva do App Nativo vs Navegador:
            </p>
            <p className="text-[11px] text-cyan-200/90 leading-relaxed">
              O navegador bloqueia o GPS quando você troca pro Waze ou desliga a tela. O App Nativo
              Rotaly mantém uma notificação fixa (&quot;Rotaly está rastreando&quot;) que nunca
              interrompe a gravação da sua rota e do seu combustível.
            </p>
          </div>
        </div>

        {/* Passo a Passo Ilustrado */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400 font-heading">
              Passo a Passo de Instalação (5 passos simples)
            </h2>
            <span className="text-[11px] text-slate-400 font-mono">1 a 2 minutos</span>
          </div>

          <div className="space-y-3">
            {steps.map((st) => (
              <div
                key={st.num}
                className="rounded-2xl border border-[#1E2B58] bg-[#0E1738] p-4 flex items-start gap-3.5 shadow-md hover:border-[#2E3F78] transition"
              >
                <div className="flex flex-col items-center gap-1 shrink-0">
                  <div className="w-9 h-9 rounded-xl bg-[#14214D] border border-[#23356E] flex items-center justify-center font-heading font-black text-sm text-cyan-300">
                    {st.num}
                  </div>
                  <div className="p-1 rounded-md bg-[#14214D]/50">{st.icon}</div>
                </div>

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h3 className="text-sm font-bold text-white">{st.title}</h3>
                    <Badge className="bg-[#14214D] text-slate-300 border border-[#23356E] text-[10px] font-semibold px-2 py-0">
                      {st.tag}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">{st.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Dúvidas Frequentes e Avisos do Android */}
        <div className="rounded-2xl border border-[#1E2B58] bg-[#0E1738] p-5 space-y-3 text-xs">
          <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>Avisos comuns do Android durante a instalação</span>
          </div>

          <div className="space-y-2.5 text-slate-300 text-[11px] leading-relaxed">
            <div className="p-3 rounded-xl bg-[#14214D]/60 border border-[#23356E] space-y-1">
              <strong className="text-white block">
                Preciso desinstalar o Rotaly antigo para atualizar?
              </strong>
              <span>
                <strong className="text-emerald-400">Não!</strong> Basta baixar o novo APK e tocar
                em &quot;Atualizar&quot; ou &quot;Instalar&quot;. O Android atualizará por cima
                automaticamente mantendo sua conta conectada e seus dados intactos. Só é necessário
                desinstalar caso você tenha uma versão muito antiga compilada em modo debug sem a
                chave oficial.
              </span>
            </div>

            <div className="p-3 rounded-xl bg-[#14214D]/60 border border-[#23356E] space-y-1">
              <strong className="text-white block">
                &quot;O arquivo pode ser nocivo&quot; (ou aviso de segurança do Chrome):
              </strong>
              <span>
                Isso é padrão no Android para qualquer aplicativo instalado fora da Google Play.
                Pode tocar em &quot;Fazer o download mesmo assim&quot; e prosseguir. O app é 100%
                seguro e desenvolvido para a nossa frota.
              </span>
            </div>

            <div className="p-3 rounded-xl bg-[#14214D]/60 border border-[#23356E] space-y-1">
              <strong className="text-white block">
                &quot;Para sua segurança, seu telefone não tem permissão para instalar apps dessa
                fonte&quot;:
              </strong>
              <span>
                Toque no botão &quot;Configurações&quot; que aparece na tela e ative a chave
                &quot;Permitir desta fonte&quot;. Em seguida, volte e toque em &quot;Instalar&quot;.
              </span>
            </div>
          </div>
        </div>

        {/* Compartilhar com Entregadores */}
        <div className="rounded-2xl border border-[#1E2B58] bg-[#0E1738] p-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <div className="space-y-0.5 text-center sm:text-left">
            <p className="font-bold text-white">Precisa enviar para outros entregadores?</p>
            <p className="text-[11px] text-slate-400">
              Copie o link desta página e envie no grupo do WhatsApp da equipe.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={handleCopyLink}
            className="w-full sm:w-auto border-cyan-500/40 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 font-bold text-xs h-10 px-4 rounded-xl flex items-center justify-center gap-2 shrink-0"
          >
            {copiedLink ? (
              <Check className="h-4 w-4 text-emerald-400" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            <span>{copiedLink ? 'Link Copiado!' : 'Copiar Link'}</span>
          </Button>
        </div>

        {/* Opção Fallback: Acessar pelo navegador */}
        <div className="text-center pt-2 pb-6 space-y-1.5">
          <p className="text-[11px] text-slate-400">
            Teve dificuldade na instalação? Você ainda pode acessar a versão web temporariamente:
          </p>
          <a
            href="/login"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-cyan-400 hover:text-cyan-300 underline"
          >
            <span>Entrar pelo navegador (versão web)</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </main>
    </div>
  )
}
export default AppDownloadPage

import React, { useState, useEffect } from 'react'
import {
  Globe,
  Save,
  RefreshCw,
  Info,
  Phone,
  MessageCircle,
  Mail,
  MapPin,
  Clock,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Share2,
  FileText,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { deliveryService } from '@/services/deliveryService'
import { SiteContentRecord } from '@/types/delivery'
import { toast } from 'sonner'
import { getErrorMessage } from '@/lib/pocketbase/errors'

interface SiteContentFormData {
  about_title: string
  about_subtitle: string
  about_paragraph_1: string
  about_paragraph_2: string
  about_paragraph_3: string
  phone: string
  whatsapp: string
  email: string
  address: string
  opening_hours: string
  facebook_url: string
  instagram_url: string
  linkedin_url: string
}

const initialFormData: SiteContentFormData = {
  about_title: '',
  about_subtitle: '',
  about_paragraph_1: '',
  about_paragraph_2: '',
  about_paragraph_3: '',
  phone: '',
  whatsapp: '',
  email: '',
  address: '',
  opening_hours: '',
  facebook_url: '',
  instagram_url: '',
  linkedin_url: '',
}

export const SiteContentManager: React.FC = () => {
  const [formData, setFormData] = useState<SiteContentFormData>(initialFormData)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)

  const loadContent = async () => {
    try {
      setIsLoading(true)
      const data: SiteContentRecord = await deliveryService.getSiteContent()
      setFormData({
        about_title: data.about_title || '',
        about_subtitle: data.about_subtitle || '',
        about_paragraph_1: data.about_paragraph_1 || '',
        about_paragraph_2: data.about_paragraph_2 || '',
        about_paragraph_3: data.about_paragraph_3 || '',
        phone: data.phone || '',
        whatsapp: data.whatsapp || '',
        email: data.email || '',
        address: data.address || '',
        opening_hours: data.opening_hours || '',
        facebook_url: data.facebook_url || '',
        instagram_url: data.instagram_url || '',
        linkedin_url: data.linkedin_url || '',
      })
      if (data.updated) {
        setLastSavedAt(new Date(data.updated))
      }
    } catch (err) {
      console.error('Erro ao carregar conteúdo do site:', err)
      toast.error('Não foi possível carregar os dados institucionais do site.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadContent()
  }, [])

  const handleWhatsappChange = (val: string) => {
    // Manter apenas dígitos para o WhatsApp (DDI + DDD + número)
    const digitsOnly = val.replace(/\D/g, '')
    setFormData((prev) => ({ ...prev, whatsapp: digitsOnly }))
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)
    setSaveSuccess(false)

    try {
      // Higienizar WhatsApp caso tenha caracteres estranhos
      const sanitizedWhatsapp = formData.whatsapp.replace(/\D/g, '')

      await deliveryService.updateSiteContent({
        about_title: formData.about_title.trim(),
        about_subtitle: formData.about_subtitle.trim(),
        about_paragraph_1: formData.about_paragraph_1.trim(),
        about_paragraph_2: formData.about_paragraph_2.trim(),
        about_paragraph_3: formData.about_paragraph_3.trim(),
        phone: formData.phone.trim(),
        whatsapp: sanitizedWhatsapp,
        email: formData.email.trim(),
        address: formData.address.trim(),
        opening_hours: formData.opening_hours.trim(),
        facebook_url: formData.facebook_url.trim(),
        instagram_url: formData.instagram_url.trim(),
        linkedin_url: formData.linkedin_url.trim(),
      })

      const now = new Date()
      setLastSavedAt(now)
      setSaveSuccess(true)
      toast.success('Conteúdo do site público salvo e atualizado com sucesso!')

      // Limpar feedback visual temporário após 4 segundos
      setTimeout(() => {
        setSaveSuccess(false)
      }, 4000)
    } catch (err) {
      console.error('Erro ao salvar conteúdo do site:', err)
      const msg = getErrorMessage(err, 'Erro ao atualizar dados do site público.')
      toast.error(`Falha ao salvar: ${msg}`)
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <Card className="border-[#1E2B58] bg-[#0A1128] text-slate-100 shadow-md">
        <CardContent className="p-8 flex flex-col items-center justify-center space-y-3">
          <RefreshCw className="h-6 w-6 animate-spin text-[#00A3FF]" />
          <p className="text-xs text-slate-400">Carregando conteúdo institucional do site...</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      {/* Banner Informativo com Link para o Site */}
      <Alert className="border-[#1E2B58] bg-[#0E1738] text-slate-200">
        <Info className="h-4 w-4 text-[#00A3FF]" />
        <AlertTitle className="font-heading text-sm font-bold text-white flex items-center justify-between">
          <span>Gestão do Site Público Institucional</span>
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-normal text-[#00A3FF] hover:underline flex items-center gap-1 shrink-0"
          >
            <span>Ver site público</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </AlertTitle>
        <AlertDescription className="text-xs text-slate-300 mt-1 leading-relaxed">
          O conteúdo salvo neste formulário é exibido em <strong>www.rotaly.com.br</strong> nas
          seções <strong>&ldquo;Quem Somos&rdquo;</strong> e{' '}
          <strong>&ldquo;Fale Conosco&rdquo;</strong>, além do rodapé da página inicial. Qualquer
          alteração tem efeito imediato para os visitantes.
        </AlertDescription>
      </Alert>

      {/* Feedback de sucesso */}
      {saveSuccess && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          <span>
            Conteúdo salvo com sucesso! As seções &ldquo;Quem Somos&rdquo; e &ldquo;Fale
            Conosco&rdquo; do site já estão atualizadas.
          </span>
        </div>
      )}

      {/* SEÇÃO 1: QUEM SOMOS */}
      <Card className="border-[#1E2B58] bg-[#0A1128] text-slate-100 shadow-sm">
        <CardHeader className="border-b border-[#1E2B58] pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#002855] text-[#00A3FF] border border-[#00A3FF]/20">
                <FileText className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="font-heading text-base font-bold text-white">
                  Seção &ldquo;Quem Somos&rdquo; (Institucional)
                </CardTitle>
                <CardDescription className="text-xs text-slate-400">
                  Títulos e parágrafos que contam a história, a missão e os diferenciais da Rotaly.
                </CardDescription>
              </div>
            </div>
            <Badge className="bg-[#002855] text-[#00A3FF] border-[#00A3FF]/30 text-[10px] font-semibold">
              Landing Page
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="about_title" className="text-xs font-semibold text-slate-200">
                Título Principal
              </Label>
              <Input
                id="about_title"
                value={formData.about_title}
                onChange={(e) => setFormData({ ...formData, about_title: e.target.value })}
                placeholder="Ex: Tecnologia que move cada entrega"
                className="bg-[#070D1E] border-[#1E2B58] text-white text-xs h-9 focus-visible:ring-[#00A3FF]"
              />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="about_subtitle" className="text-xs font-semibold text-slate-200">
                Subtítulo / Chamada de Destaque
              </Label>
              <Input
                id="about_subtitle"
                value={formData.about_subtitle}
                onChange={(e) => setFormData({ ...formData, about_subtitle: e.target.value })}
                placeholder="Ex: A Rotaly nasceu com um objetivo claro: simplificar a logística urbana de ponta a ponta."
                className="bg-[#070D1E] border-[#1E2B58] text-white text-xs h-9 focus-visible:ring-[#00A3FF]"
              />
            </div>
          </div>

          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label
                htmlFor="about_paragraph_1"
                className="text-xs font-semibold text-slate-200 flex items-center justify-between"
              >
                <span>Parágrafo 1 (Proposta de Valor e Eficiência)</span>
                <span className="text-[10px] text-slate-400 font-normal">
                  Primeiro bloco de texto
                </span>
              </Label>
              <Textarea
                id="about_paragraph_1"
                rows={3}
                value={formData.about_paragraph_1}
                onChange={(e) => setFormData({ ...formData, about_paragraph_1: e.target.value })}
                placeholder="Descreva a tecnologia, unificação de rotas, telemetria em tempo real e comprovantes digitais..."
                className="bg-[#070D1E] border-[#1E2B58] text-white text-xs focus-visible:ring-[#00A3FF] resize-y"
              />
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="about_paragraph_2"
                className="text-xs font-semibold text-slate-200 flex items-center justify-between"
              >
                <span>Parágrafo 2 (Segmentos Atendidos e Operação)</span>
                <span className="text-[10px] text-slate-400 font-normal">
                  Segundo bloco de texto
                </span>
              </Label>
              <Textarea
                id="about_paragraph_2"
                rows={3}
                value={formData.about_paragraph_2}
                onChange={(e) => setFormData({ ...formData, about_paragraph_2: e.target.value })}
                placeholder="Explique como a plataforma funciona para farmácias, comércios e distribuidoras..."
                className="bg-[#070D1E] border-[#1E2B58] text-white text-xs focus-visible:ring-[#00A3FF] resize-y"
              />
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="about_paragraph_3"
                className="text-xs font-semibold text-slate-200 flex items-center justify-between"
              >
                <span>Parágrafo 3 (Presença, Alcance e Suporte)</span>
                <span className="text-[10px] text-slate-400 font-normal">
                  Terceiro bloco de texto
                </span>
              </Label>
              <Textarea
                id="about_paragraph_3"
                rows={3}
                value={formData.about_paragraph_3}
                onChange={(e) => setFormData({ ...formData, about_paragraph_3: e.target.value })}
                placeholder="Fale sobre a sede, expansão geográfica e compromisso com o cliente..."
                className="bg-[#070D1E] border-[#1E2B58] text-white text-xs focus-visible:ring-[#00A3FF] resize-y"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SEÇÃO 2: FALE CONOSCO & CONTATOS */}
      <Card className="border-[#1E2B58] bg-[#0A1128] text-slate-100 shadow-sm">
        <CardHeader className="border-b border-[#1E2B58] pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#002855] text-[#00A3FF] border border-[#00A3FF]/20">
                <Phone className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="font-heading text-base font-bold text-white">
                  Seção &ldquo;Fale Conosco&rdquo; &amp; Canais de Atendimento
                </CardTitle>
                <CardDescription className="text-xs text-slate-400">
                  Telefone, WhatsApp direto, e-mail institucional, endereço e horário de suporte.
                </CardDescription>
              </div>
            </div>
            <Badge className="bg-[#002855] text-[#00A3FF] border-[#00A3FF]/30 text-[10px] font-semibold">
              Contato Direto
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* WhatsApp (com DDI) */}
            <div className="space-y-1.5">
              <Label
                htmlFor="whatsapp"
                className="text-xs font-semibold text-slate-200 flex items-center gap-1.5"
              >
                <MessageCircle className="h-3.5 w-3.5 text-emerald-400" />
                WhatsApp (apenas números com DDI)
              </Label>
              <Input
                id="whatsapp"
                value={formData.whatsapp}
                onChange={(e) => handleWhatsappChange(e.target.value)}
                placeholder="Ex: 5521999999999"
                className="bg-[#070D1E] border-[#1E2B58] text-white font-mono text-xs h-9 focus-visible:ring-[#00A3FF]"
              />
              <p className="text-[10px] text-slate-400">
                Gera o link direto <code>https://wa.me/55...</code>. Somente dígitos (ex:
                5521999999999).
              </p>
            </div>

            {/* Telefone Comercial */}
            <div className="space-y-1.5">
              <Label
                htmlFor="phone"
                className="text-xs font-semibold text-slate-200 flex items-center gap-1.5"
              >
                <Phone className="h-3.5 w-3.5 text-[#00A3FF]" />
                Telefone Comercial
              </Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="Ex: (21) 4000-1234"
                className="bg-[#070D1E] border-[#1E2B58] text-white text-xs h-9 focus-visible:ring-[#00A3FF]"
              />
              <p className="text-[10px] text-slate-400">
                Telefone fixo ou central de atendimento com DDD.
              </p>
            </div>

            {/* E-mail de Contato */}
            <div className="space-y-1.5">
              <Label
                htmlFor="email"
                className="text-xs font-semibold text-slate-200 flex items-center gap-1.5"
              >
                <Mail className="h-3.5 w-3.5 text-indigo-400" />
                E-mail de Contato
              </Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="Ex: contato@rotaly.com.br"
                className="bg-[#070D1E] border-[#1E2B58] text-white text-xs h-9 focus-visible:ring-[#00A3FF]"
              />
            </div>

            {/* Horário de Atendimento */}
            <div className="space-y-1.5">
              <Label
                htmlFor="opening_hours"
                className="text-xs font-semibold text-slate-200 flex items-center gap-1.5"
              >
                <Clock className="h-3.5 w-3.5 text-amber-400" />
                Horário de Atendimento
              </Label>
              <Input
                id="opening_hours"
                value={formData.opening_hours}
                onChange={(e) => setFormData({ ...formData, opening_hours: e.target.value })}
                placeholder="Ex: Segunda a Sábado, das 08:00 às 20:00"
                className="bg-[#070D1E] border-[#1E2B58] text-white text-xs h-9 focus-visible:ring-[#00A3FF]"
              />
            </div>

            {/* Endereço Físico / Base */}
            <div className="space-y-1.5 md:col-span-2">
              <Label
                htmlFor="address"
                className="text-xs font-semibold text-slate-200 flex items-center gap-1.5"
              >
                <MapPin className="h-3.5 w-3.5 text-rose-400" />
                Endereço Físico / Sede Operacional
              </Label>
              <Input
                id="address"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                placeholder="Ex: Rio de Janeiro - RJ, Brasil"
                className="bg-[#070D1E] border-[#1E2B58] text-white text-xs h-9 focus-visible:ring-[#00A3FF]"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SEÇÃO 3: REDES SOCIAIS (OPCIONAIS) */}
      <Card className="border-[#1E2B58] bg-[#0A1128] text-slate-100 shadow-sm">
        <CardHeader className="border-b border-[#1E2B58] pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#002855] text-[#00A3FF] border border-[#00A3FF]/20">
                <Share2 className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="font-heading text-base font-bold text-white">
                  Redes Sociais Oficiais (Opcionais)
                </CardTitle>
                <CardDescription className="text-xs text-slate-400">
                  Links diretos para as páginas da Rotaly no Facebook, Instagram e LinkedIn.
                </CardDescription>
              </div>
            </div>
            <Badge variant="outline" className="text-slate-400 border-[#1E2B58] text-[10px]">
              Opcional
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="facebook_url" className="text-xs font-semibold text-slate-200">
                Facebook URL
              </Label>
              <Input
                id="facebook_url"
                value={formData.facebook_url}
                onChange={(e) => setFormData({ ...formData, facebook_url: e.target.value })}
                placeholder="https://facebook.com/rotaly"
                className="bg-[#070D1E] border-[#1E2B58] text-white text-xs h-9 focus-visible:ring-[#00A3FF]"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="instagram_url" className="text-xs font-semibold text-slate-200">
                Instagram URL
              </Label>
              <Input
                id="instagram_url"
                value={formData.instagram_url}
                onChange={(e) => setFormData({ ...formData, instagram_url: e.target.value })}
                placeholder="https://instagram.com/rotaly"
                className="bg-[#070D1E] border-[#1E2B58] text-white text-xs h-9 focus-visible:ring-[#00A3FF]"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="linkedin_url" className="text-xs font-semibold text-slate-200">
                LinkedIn URL
              </Label>
              <Input
                id="linkedin_url"
                value={formData.linkedin_url}
                onChange={(e) => setFormData({ ...formData, linkedin_url: e.target.value })}
                placeholder="https://linkedin.com/company/rotaly"
                className="bg-[#070D1E] border-[#1E2B58] text-white text-xs h-9 focus-visible:ring-[#00A3FF]"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* BARRA DE AÇÕES: SALVAR */}
      <div className="sticky bottom-4 z-10 flex flex-col sm:flex-row items-center justify-between gap-3 p-4 rounded-xl bg-[#070D1E]/95 backdrop-blur border border-[#1E2B58] shadow-2xl">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Globe className="h-4 w-4 text-[#00A3FF]" />
          <span>
            {lastSavedAt ? (
              <>
                Última atualização gravada em{' '}
                <strong className="text-slate-200">
                  {lastSavedAt.toLocaleDateString('pt-BR')} às{' '}
                  {lastSavedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </strong>
              </>
            ) : (
              'As alterações serão refletidas em tempo real em www.rotaly.com.br'
            )}
          </span>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={loadContent}
            disabled={isSaving || isLoading}
            className="border-[#1E2B58] text-slate-300 hover:bg-[#121E46] text-xs h-9"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
            Recarregar
          </Button>

          <Button
            type="submit"
            disabled={isSaving}
            className="bg-[#0052CC] hover:bg-[#0041A8] text-white font-bold text-xs h-9 px-5 gap-2 shadow-brand min-w-[150px]"
          >
            {isSaving ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                Salvando...
              </>
            ) : (
              <>
                <Save className="h-3.5 w-3.5" />
                Salvar Conteúdo
              </>
            )}
          </Button>
        </div>
      </div>
    </form>
  )
}
export default SiteContentManager

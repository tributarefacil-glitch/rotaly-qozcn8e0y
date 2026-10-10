import React, { useMemo, useState } from 'react'
import {
  ShieldCheck,
  AlertTriangle,
  MapPin,
  FileQuestion,
  Users,
  Compass,
  CheckCircle2,
  ExternalLink,
  Edit3,
  Send,
  Sparkles,
  Phone,
  Search,
  Filter,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { CustomerRecord } from '@/types/delivery'
import { formatPlusCodeDisplay } from '@/lib/plusCode'
import { toast } from 'sonner'

export interface CustomerQualityReportProps {
  customers: CustomerRecord[]
  onEditCustomer: (customer: CustomerRecord) => void
  onRefresh?: () => void
}

/**
 * Item 14 & 15 do Comando Unificado Rotaly:
 * - Item 14: Relatório de Qualidade do Cadastro (widget com % pin calibrado por entregador,
 *   % sem número com referência preenchida, % sem CEP).
 * - Item 15: Fila "Cadastro Incompleto" com calibração urgente (MARCIA CAMPOS, CAROLINE,
 *   TEREZA, THATA, ALEX e clientes com pending_client_pin).
 */
export const CustomerQualityReport: React.FC<CustomerQualityReportProps> = ({
  customers,
  onEditCustomer,
  onRefresh,
}) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [filterMode, setFilterMode] = useState<
    'all_incomplete' | 'urgent_5' | 'pending_pin' | 'no_cep' | 'no_ref'
  >('all_incomplete')

  // IDs canônicos da fila urgente de contingência e sem CEP
  const URGENT_IDS = useMemo(
    () => [
      'ucz7n508mxhqjvf', // MARCIA CAMPOS (pin contingência fallback)
      'f5b4fo0yod1gzsf', // CAROLINE (sem CEP)
      'eh11io1z4ezov2b', // TEREZA (sem CEP)
      'osso2gq3ma8etxb', // THATA (sem CEP)
      'dzgrcu38lzyqkfr', // ALEX (sem CEP)
    ],
    [],
  )

  // Métricas de Qualidade do Cadastro (Item 14)
  const metrics = useMemo(() => {
    const total = customers.length
    if (total === 0) {
      return {
        total: 0,
        calibratedCouriersCount: 0,
        calibratedCouriersPercent: 0,
        noNumberCount: 0,
        noNumberWithRefCount: 0,
        noNumberWithRefPercent: 0,
        noCepCount: 0,
        noCepPercent: 0,
        withPendingClientPinCount: 0,
      }
    }

    // 1. % de clientes com pin calibrado por entregador
    // Origem/nota tipo 'pin_entregador', 'CORREÇÃO AUTOMÁTICA PIN ENTREGADOR' ou 'GPS APROVADO'
    const calibratedCouriers = customers.filter((c) => {
      const notes = (c.notes || '').toLowerCase()
      return (
        notes.includes('pin_entregador') ||
        notes.includes('pin entregador') ||
        notes.includes('gps aprovado') ||
        notes.includes('calibrados no local pelo entregador')
      )
    })
    const calibratedCouriersCount = calibratedCouriers.length
    const calibratedCouriersPercent = Math.round((calibratedCouriersCount / total) * 100)

    // 2. Clientes sem número (número vazio ou 0) e % que possuem ponto de referência preenchido
    // Regex para checar se street/address possui número positivo explícito
    const noNumberCustomers = customers.filter((c) => {
      const fullAddr = `${c.street || ''} ${c.address || ''}`.trim().toLowerCase()
      // Detecta ', 0' ou 'sem número' ou 's/n' ou ausência de número seguido de rua
      const hasExplicitZero =
        /,\s*0(\D|$)/.test(fullAddr) ||
        fullAddr.includes('s/n') ||
        fullAddr.includes('sem numero') ||
        fullAddr.includes('sem número')
      const hasNumber = /\d+/.test(fullAddr) && !hasExplicitZero
      return hasExplicitZero || !hasNumber
    })
    const noNumberCount = noNumberCustomers.length
    const noNumberWithRef = noNumberCustomers.filter((c) =>
      Boolean(c.reference_point && c.reference_point.trim()),
    )
    const noNumberWithRefCount = noNumberWithRef.length
    const noNumberWithRefPercent =
      noNumberCount > 0 ? Math.round((noNumberWithRefCount / noNumberCount) * 100) : 100

    // 3. % sem CEP (postal_code vazio ou em branco)
    const noCepCustomers = customers.filter((c) => !c.postal_code || !c.postal_code.trim())
    const noCepCount = noCepCustomers.length
    const noCepPercent = Math.round((noCepCount / total) * 100)

    // 4. Clientes com sugestão pendente do cliente (pending_client_pin)
    const withPendingClientPinCount = customers.filter(
      (c) =>
        c.pending_client_pin &&
        typeof c.pending_client_pin === 'object' &&
        Object.keys(c.pending_client_pin).length > 0,
    ).length

    return {
      total,
      calibratedCouriersCount,
      calibratedCouriersPercent,
      noNumberCount,
      noNumberWithRefCount,
      noNumberWithRefPercent,
      noCepCount,
      noCepPercent,
      withPendingClientPinCount,
    }
  }, [customers])

  // Fila de Calibração Urgente / Cadastro Incompleto (Item 15)
  const incompleteQueue = useMemo(() => {
    return customers
      .map((c) => {
        const isUrgent5 = URGENT_IDS.includes(c.id)
        const hasPendingPin = Boolean(
          c.pending_client_pin &&
          typeof c.pending_client_pin === 'object' &&
          Object.keys(c.pending_client_pin).length > 0,
        )
        const isMissingCep = !c.postal_code || !c.postal_code.trim()
        const fullAddr = `${c.street || ''} ${c.address || ''}`.trim().toLowerCase()
        const isNoNumber =
          /,\s*0(\D|$)/.test(fullAddr) ||
          fullAddr.includes('s/n') ||
          fullAddr.includes('sem numero') ||
          fullAddr.includes('sem número') ||
          !/\d+/.test(fullAddr)
        const isMissingRef = isNoNumber && (!c.reference_point || !c.reference_point.trim())
        const isFallbackPin =
          (typeof c.lat === 'number' &&
            typeof c.lng === 'number' &&
            Math.abs(c.lat - -22.906847) < 0.0001 &&
            Math.abs(c.lng - -43.172896) < 0.0001) ||
          (c.notes || '').includes('fallback detectado')

        const issues: string[] = []
        if (isFallbackPin) issues.push('Pin em Fallback Contingência (-22.9068, -43.1728)')
        if (hasPendingPin) issues.push('Sugestão de Pin enviada pelo Cliente (Aguardando Adoção)')
        if (isMissingCep) issues.push('Sem CEP')
        if (isMissingRef) issues.push('Sem número e sem Ponto de Referência')

        const isMissingAddress = !c.street?.trim() && !c.address?.trim() && (!c.lat || !c.lng)
        if (isMissingAddress) issues.push('Cadastro Incompleto (Sem endereço e sem pin)')

        const isIncomplete =
          isUrgent5 ||
          hasPendingPin ||
          isMissingCep ||
          isMissingRef ||
          isFallbackPin ||
          isMissingAddress

        return {
          customer: c,
          isUrgent5,
          hasPendingPin,
          isMissingCep,
          isMissingRef,
          isFallbackPin,
          isIncomplete,
          issues,
        }
      })
      .filter((item) => item.isIncomplete)
      .sort((a, b) => {
        // Prioridade 1: Urgent 5 canônicos
        if (a.isUrgent5 && !b.isUrgent5) return -1
        if (!a.isUrgent5 && b.isUrgent5) return 1
        // Prioridade 2: Pending pin enviado por cliente
        if (a.hasPendingPin && !b.hasPendingPin) return -1
        if (!a.hasPendingPin && b.hasPendingPin) return 1
        // Prioridade 3: Fallback pin
        if (a.isFallbackPin && !b.isFallbackPin) return -1
        if (!a.isFallbackPin && b.isFallbackPin) return 1
        return a.customer.name.localeCompare(b.customer.name)
      })
  }, [customers, URGENT_IDS])

  const filteredQueue = useMemo(() => {
    return incompleteQueue.filter((item) => {
      // Filtro de aba
      if (filterMode === 'urgent_5' && !item.isUrgent5) return false
      if (filterMode === 'pending_pin' && !item.hasPendingPin) return false
      if (filterMode === 'no_cep' && !item.isMissingCep) return false
      if (filterMode === 'no_ref' && !item.isMissingRef) return false

      // Busca texto
      if (!searchTerm.trim()) return true
      const term = searchTerm.toLowerCase()
      const c = item.customer
      return (
        (c.name || '').toLowerCase().includes(term) ||
        (c.street || '').toLowerCase().includes(term) ||
        (c.neighborhood || '').toLowerCase().includes(term) ||
        (c.phone || '').toLowerCase().includes(term) ||
        item.issues.some((iss) => iss.toLowerCase().includes(term))
      )
    })
  }, [incompleteQueue, filterMode, searchTerm])

  const handleCopyPublicPinLink = (customer: CustomerRecord) => {
    const origin = window.location.origin
    const url = `${origin}/pin/${customer.id}`
    navigator.clipboard.writeText(url)
    toast.success('Link público de pin copiado!', {
      description: `Envie ao cliente ${customer.name || ''} para ele marcar a localização exata.`,
    })
  }

  const handleOpenWhatsAppPin = (customer: CustomerRecord) => {
    const origin = window.location.origin
    const url = `${origin}/pin/${customer.id}`
    const phone = (customer.phone || '').replace(/\D/g, '')
    const msg = encodeURIComponent(
      `Olá ${customer.name || ''}, tudo bem? Para que seu pedido chegue certinho e sem atrasos, por favor confirme ou ajuste a localização do seu endereço clicando aqui: ${url}`,
    )
    const waUrl = phone ? `https://wa.me/55${phone}?text=${msg}` : `https://wa.me/?text=${msg}`
    window.open(waUrl, '_blank')
  }

  return (
    <div className="space-y-6">
      {/* ================= ITEM 14: WIDGET RELATÓRIO DE QUALIDADE DO CADASTRO ================= */}
      <Card className="border border-slate-200 bg-white shadow-brand rounded-card overflow-hidden">
        <CardHeader className="p-5 pb-3 border-b border-slate-100 bg-gradient-to-r from-blue-50/50 via-white to-amber-50/40">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0052CC] text-white shadow-brand">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="font-heading text-base sm:text-lg font-bold text-[#1a1a1a] flex items-center gap-2">
                  <span>Relatório de Qualidade do Cadastro</span>
                  <Badge className="bg-emerald-600 text-white text-[10px] font-bold">
                    Item 14 Rotaly
                  </Badge>
                </CardTitle>
                <p className="font-sans text-xs text-slate-500 mt-0.5">
                  Doutrina Moderna: pin calibrado por entregador é soberano; em áreas sem CEP o
                  endereço é garantido pelo pin + ponto de referência.
                </p>
              </div>
            </div>

            {onRefresh && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRefresh}
                className="h-8 gap-1.5 text-xs text-slate-700 border-slate-200"
              >
                Atualizar Métricas
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* KPI 1: % Pin Calibrado por Entregador */}
            <div className="p-4 rounded-xl border border-blue-200/80 bg-blue-50/40 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-blue-900">
                  Pin Calibrado (Entregador)
                </span>
                <Compass className="h-4 w-4 text-[#0052CC]" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-heading text-2xl font-black text-[#0052CC]">
                  {metrics.calibratedCouriersPercent}%
                </span>
                <span className="text-xs text-slate-600 font-semibold">
                  ({metrics.calibratedCouriersCount}/{metrics.total})
                </span>
              </div>
              <p className="text-[11px] text-slate-500 leading-tight">
                Pins calibrados in loco pelo entregador via GPS (soberano sobre geocoder).
              </p>
            </div>

            {/* KPI 2: % Sem Número com Referência Preenchida */}
            <div className="p-4 rounded-xl border border-emerald-200/80 bg-emerald-50/40 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-900">
                  Sem Número c/ Referência
                </span>
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-heading text-2xl font-black text-emerald-600">
                  {metrics.noNumberWithRefPercent}%
                </span>
                <span className="text-xs text-slate-600 font-semibold">
                  ({metrics.noNumberWithRefCount}/{metrics.noNumberCount})
                </span>
              </div>
              <p className="text-[11px] text-slate-500 leading-tight">
                Dos {metrics.noNumberCount} clientes sem número/lote, {metrics.noNumberWithRefCount}{' '}
                possuem ponto de referência preenchido.
              </p>
            </div>

            {/* KPI 3: % Sem CEP (Operação Normal em Comunidades) */}
            <div className="p-4 rounded-xl border border-amber-200/80 bg-amber-50/40 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-900">
                  Clientes Sem CEP
                </span>
                <MapPin className="h-4 w-4 text-amber-600" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-heading text-2xl font-black text-amber-600">
                  {metrics.noCepPercent}%
                </span>
                <span className="text-xs text-slate-600 font-semibold">
                  ({metrics.noCepCount}/{metrics.total})
                </span>
              </div>
              <p className="text-[11px] text-slate-500 leading-tight">
                Áreas sem CEP mapeado; atendidas via pin soberano + Plus Code Rotaly.
              </p>
            </div>

            {/* KPI 4: Fila Urgente / Adoção Pendente */}
            <div className="p-4 rounded-xl border border-purple-200/80 bg-purple-50/40 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-purple-900">
                  Fila Cadastro Incompleto
                </span>
                <AlertTriangle className="h-4 w-4 text-purple-600" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-heading text-2xl font-black text-purple-700">
                  {incompleteQueue.length}
                </span>
                <span className="text-xs text-slate-600 font-semibold">
                  {metrics.withPendingClientPinCount > 0 &&
                    `(${metrics.withPendingClientPinCount} sugestão do cliente)`}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 leading-tight">
                Clientes requerendo calibração de pin, referência ou validação de CEP.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ================= ITEM 15: FILA CADASTRO INCOMPLETO (CALIBRAÇÃO URGENTE) ================= */}
      <Card className="border border-slate-200 bg-white shadow-brand rounded-card overflow-hidden">
        <CardHeader className="p-5 pb-3 border-b border-slate-100 bg-slate-50/60">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="font-heading text-base sm:text-lg font-bold text-[#1a1a1a] flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                <span>Fila "Cadastro Incompleto" — Calibração Urgente</span>
                <Badge className="bg-amber-600 text-white text-xs px-2 py-0.5">
                  {incompleteQueue.length} cliente{incompleteQueue.length === 1 ? '' : 's'}
                </Badge>
              </CardTitle>
              <p className="font-sans text-xs text-slate-500 mt-0.5">
                Prioridade máxima: MARCIA CAMPOS (pin fallback contingência) e clientes sem CEP
                (CAROLINE, TEREZA, THATA, ALEX), além de pins enviados pelos clientes via link
                público.
              </p>
            </div>

            {/* Abas Rápidas de Filtro */}
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="inline-flex items-center p-0.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setFilterMode('all_incomplete')}
                  className={`px-2.5 py-1 rounded-md transition ${
                    filterMode === 'all_incomplete'
                      ? 'bg-[#0052CC] text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Todos ({incompleteQueue.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterMode('urgent_5')}
                  className={`px-2.5 py-1 rounded-md transition ${
                    filterMode === 'urgent_5'
                      ? 'bg-rose-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  🚨 5 Urgentes ({incompleteQueue.filter((i) => i.isUrgent5).length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterMode('pending_pin')}
                  className={`px-2.5 py-1 rounded-md transition ${
                    filterMode === 'pending_pin'
                      ? 'bg-purple-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  📍 Sugestão Cliente ({incompleteQueue.filter((i) => i.hasPendingPin).length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterMode('no_cep')}
                  className={`px-2.5 py-1 rounded-md transition ${
                    filterMode === 'no_cep'
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Sem CEP ({incompleteQueue.filter((i) => i.isMissingCep).length})
                </button>
              </div>
            </div>
          </div>

          {/* Campo de Busca */}
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <Input
              placeholder="Buscar por cliente, endereço, telefone ou pendência..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-8 pl-8 text-xs bg-white"
            />
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 uppercase tracking-wider font-semibold">
                  <th className="py-2.5 px-3">Cliente</th>
                  <th className="py-2.5 px-3">Endereço &amp; Referência</th>
                  <th className="py-2.5 px-3">Pendência / Motivo Urgente</th>
                  <th className="py-2.5 px-3">Plus Code &amp; Coordenadas</th>
                  <th className="py-2.5 px-3 text-right">Ações de Calibração</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredQueue.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-400 font-sans">
                      <CheckCircle2 className="h-6 w-6 text-emerald-500 mx-auto mb-1.5" />
                      Nenhum cliente com cadastro incompleto no filtro selecionado!
                    </td>
                  </tr>
                ) : (
                  filteredQueue.map(
                    ({ customer: c, isUrgent5, hasPendingPin, isMissingCep, issues }) => {
                      const pendingPinObj = c.pending_client_pin as Record<string, any> | undefined

                      return (
                        <tr
                          key={c.id}
                          className={`hover:bg-slate-50/80 transition-colors ${
                            isUrgent5 ? 'bg-rose-50/40' : hasPendingPin ? 'bg-purple-50/30' : ''
                          }`}
                        >
                          {/* 1. Nome & Contato */}
                          <td className="py-3 px-3 align-top">
                            <div className="flex items-center gap-2">
                              <div
                                className={`flex h-8 w-8 items-center justify-center rounded-full font-bold text-xs shrink-0 ${
                                  isUrgent5
                                    ? 'bg-rose-100 text-rose-700 border border-rose-300'
                                    : 'bg-blue-100 text-[#0052CC]'
                                }`}
                              >
                                {c.name ? c.name.slice(0, 2).toUpperCase() : 'CL'}
                              </div>
                              <div>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <p className="font-bold text-slate-900 text-xs">
                                    {c.name || 'Sem nome'}
                                  </p>
                                  {isUrgent5 && (
                                    <Badge className="bg-rose-600 text-white text-[9px] px-1 py-0 font-bold uppercase">
                                      Urgente #15
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                                  {c.phone || 'Sem telefone'}
                                </p>
                              </div>
                            </div>
                          </td>

                          {/* 2. Endereço & Ponto de Referência */}
                          <td className="py-3 px-3 align-top max-w-xs">
                            <p className="text-slate-800 font-medium leading-snug">
                              {c.address || c.street || 'Endereço a confirmar'}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              {c.postal_code ? (
                                <span className="text-[10px] font-mono text-slate-500">
                                  CEP: {c.postal_code}
                                </span>
                              ) : (
                                <span className="text-[10px] font-mono text-amber-700 bg-amber-100 px-1.5 py-0.2 rounded border border-amber-300 font-semibold">
                                  Sem CEP
                                </span>
                              )}
                              {c.neighborhood && (
                                <span className="text-[10px] text-slate-500">
                                  • {c.neighborhood}
                                </span>
                              )}
                            </div>

                            {/* Ponto de Referência em destaque */}
                            {c.reference_point ? (
                              <div className="mt-1.5 p-1.5 rounded-md bg-amber-50 border border-amber-300 text-amber-900 text-[11px] font-medium flex items-start gap-1">
                                <span className="text-amber-600 font-bold">Ref:</span>
                                <span className="font-bold text-slate-900">
                                  {c.reference_point}
                                </span>
                              </div>
                            ) : (
                              <p className="mt-1 text-[10px] text-rose-600 font-semibold flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3 shrink-0" />
                                Ponto de referência ausente
                              </p>
                            )}
                          </td>

                          {/* 3. Motivo da Pendência / Badges */}
                          <td className="py-3 px-3 align-top">
                            <div className="space-y-1">
                              {issues.map((issue, idx) => (
                                <Badge
                                  key={idx}
                                  variant="outline"
                                  className={`text-[10px] font-bold block w-fit ${
                                    issue.includes('Fallback')
                                      ? 'border-rose-400 bg-rose-50 text-rose-700'
                                      : issue.includes('Sugestão')
                                        ? 'border-purple-400 bg-purple-50 text-purple-700'
                                        : issue.includes('Sem CEP')
                                          ? 'border-amber-400 bg-amber-50 text-amber-800'
                                          : 'border-slate-300 bg-slate-50 text-slate-700'
                                  }`}
                                >
                                  {issue}
                                </Badge>
                              ))}

                              {/* Detalhe da sugestão do cliente */}
                              {pendingPinObj && pendingPinObj.lat && (
                                <div className="p-1.5 rounded bg-purple-100/70 border border-purple-300 text-[10px] text-purple-900 mt-1">
                                  <span className="font-bold">
                                    📍 Sugestão enviada pelo cliente:
                                  </span>{' '}
                                  {Number(pendingPinObj.lat).toFixed(5)},{' '}
                                  {Number(pendingPinObj.lng).toFixed(5)}
                                  {pendingPinObj.client_note && (
                                    <p className="italic text-purple-950 mt-0.5">
                                      "{pendingPinObj.client_note}"
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>

                          {/* 4. Coordenadas & Plus Code */}
                          <td className="py-3 px-3 align-top">
                            <div className="space-y-1">
                              {c.plus_code ? (
                                <Badge className="bg-blue-600 text-white font-mono text-[10px] font-bold">
                                  {formatPlusCodeDisplay(c.plus_code)}
                                </Badge>
                              ) : (
                                <span className="text-[10px] text-slate-400 italic">
                                  Sem Plus Code
                                </span>
                              )}
                              <p className="font-mono text-[10px] text-slate-500">
                                {typeof c.lat === 'number' && typeof c.lng === 'number'
                                  ? `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`
                                  : 'Sem coordenada'}
                              </p>
                            </div>
                          </td>

                          {/* 5. Ações */}
                          <td className="py-3 px-3 align-top text-right space-y-1">
                            <div className="flex flex-col sm:flex-row items-end sm:items-center justify-end gap-1">
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => onEditCustomer(c)}
                                className="h-7 px-2.5 text-xs bg-[#0052CC] hover:bg-[#003E99] text-white font-bold gap-1 shadow-xs"
                                title="Abrir o modal de edição para calibrar pin, preencher referência ou salvar dados"
                              >
                                <Edit3 className="h-3 w-3" />
                                Calibrar
                              </Button>

                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => handleCopyPublicPinLink(c)}
                                className="h-7 px-2 text-[11px] text-slate-700 border-slate-200 hover:bg-slate-100"
                                title="Copiar o link público /pin/:id para enviar ao cliente"
                              >
                                Link Pin
                              </Button>

                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => handleOpenWhatsAppPin(c)}
                                className="h-7 px-2 text-[11px] text-emerald-700 border-emerald-300 bg-emerald-50 hover:bg-emerald-100 font-semibold"
                                title="Abrir WhatsApp para pedir a localização exata do cliente"
                              >
                                <Phone className="h-3 w-3 text-emerald-600" />
                                WhatsApp
                              </Button>
                            </div>
                          </td>
                        </tr>
                      )
                    },
                  )
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

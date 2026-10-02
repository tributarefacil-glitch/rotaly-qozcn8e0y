import React, { useState, useEffect } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  MapPin,
  RefreshCw,
  Navigation,
  Clock,
  Sparkles,
  Search,
  ExternalLink,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { deliveryService } from '@/services/deliveryService'
import { AddressAlertRecord, AddressAlertStatus } from '@/types/delivery'

interface SuspiciousAddressesBoxProps {
  empresaId?: string
  isMaster?: boolean
  onAlertUpdated?: () => void
}

export const SuspiciousAddressesBox: React.FC<SuspiciousAddressesBoxProps> = ({
  empresaId,
  isMaster = false,
  onAlertUpdated,
}) => {
  const [alerts, setAlerts] = useState<AddressAlertRecord[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState<AddressAlertStatus | 'all'>('pendente')
  const [processingAlertId, setProcessingAlertId] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')

  const loadAlerts = async () => {
    try {
      setIsLoading(true)
      const data = await deliveryService.getAddressAlerts({
        empresaId: isMaster ? 'ALL' : empresaId,
        status: statusFilter,
      })
      setAlerts(data)
    } catch (err) {
      console.error('[SuspiciousAddressesBox] Erro ao carregar alertas:', err)
      toast.error('Erro ao carregar endereços suspeitos.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadAlerts()
  }, [empresaId, statusFilter, isMaster])

  const handleApprove = async (alert: AddressAlertRecord) => {
    try {
      setProcessingAlertId(alert.id)
      const res = await deliveryService.approveAddressAlert(alert.id)
      if (res.success) {
        toast.success(
          'Endereço aprovado! Cadastro atualizado e rotas viárias recalculadas na hora.',
        )
        await loadAlerts()
        if (onAlertUpdated) onAlertUpdated()
      }
    } catch (err) {
      console.error('[SuspiciousAddressesBox] Erro ao aprovar:', err)
      toast.error('Erro ao aprovar correção de endereço.')
    } finally {
      setProcessingAlertId(null)
    }
  }

  const handleReject = async (alert: AddressAlertRecord) => {
    const reason = window.prompt('Motivo da reprovação (opcional):')
    if (reason === null) return // Usuário cancelou o prompt

    try {
      setProcessingAlertId(alert.id)
      const res = await deliveryService.rejectAddressAlert(alert.id, reason || undefined)
      if (res.success) {
        toast.info('Alerta reprovado com sucesso. Cliente removido da fila pendente.')
        await loadAlerts()
        if (onAlertUpdated) onAlertUpdated()
      }
    } catch (err) {
      console.error('[SuspiciousAddressesBox] Erro ao reprovar:', err)
      toast.error('Erro ao reprovar alerta.')
    } finally {
      setProcessingAlertId(null)
    }
  }

  const filteredAlerts = alerts.filter((alert) => {
    if (!searchTerm.trim()) return true
    const term = searchTerm.toLowerCase()
    const custName = alert.expand?.customer?.name?.toLowerCase() || ''
    const notes = alert.notes?.toLowerCase() || ''
    const curAddr =
      (typeof alert.current_address === 'object' &&
        JSON.stringify(alert.current_address).toLowerCase()) ||
      ''
    const sugAddr =
      (typeof alert.suggested_address === 'object' &&
        JSON.stringify(alert.suggested_address).toLowerCase()) ||
      ''
    return (
      custName.includes(term) ||
      notes.includes(term) ||
      curAddr.includes(term) ||
      sugAddr.includes(term)
    )
  })

  const pendingCount = alerts.filter((a) => a.status === 'pendente').length

  return (
    <Card className="border-amber-300/80 bg-amber-50/30 dark:bg-amber-950/20 shadow-sm overflow-hidden">
      <CardHeader className="p-4 sm:p-5 border-b border-amber-200/80 dark:border-amber-900/50 bg-amber-100/40 dark:bg-amber-950/40">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500 text-white shadow-xs">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base sm:text-lg font-bold text-amber-950 dark:text-amber-100 flex items-center gap-2">
                <span>Endereços Suspeitos & Auditoria Anti-CEP</span>
                {statusFilter === 'pendente' && (
                  <Badge className="bg-amber-600 text-white hover:bg-amber-700 text-xs px-2 py-0.5">
                    {pendingCount} pendente{pendingCount === 1 ? '' : 's'}
                  </Badge>
                )}
              </CardTitle>
              <p className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-0.5">
                Detecção inteligente de CEPs divergentes, bairros trocados e pins marcados por
                entregadores via GPS.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex rounded-lg border border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-900 p-0.5 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setStatusFilter('pendente')}
                className={`px-2.5 py-1 rounded-md transition ${
                  statusFilter === 'pendente'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'text-amber-900 dark:text-amber-200 hover:bg-amber-100/50'
                }`}
              >
                Pendentes
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('aprovado')}
                className={`px-2.5 py-1 rounded-md transition ${
                  statusFilter === 'aprovado'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100'
                }`}
              >
                Aprovados
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('reprovado')}
                className={`px-2.5 py-1 rounded-md transition ${
                  statusFilter === 'reprovado'
                    ? 'bg-rose-600 text-white shadow-xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100'
                }`}
              >
                Reprovados
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`px-2.5 py-1 rounded-md transition ${
                  statusFilter === 'all'
                    ? 'bg-slate-800 text-white shadow-xs'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100'
                }`}
              >
                Todos
              </button>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={loadAlerts}
              disabled={isLoading}
              className="h-8 gap-1.5 text-xs border-amber-300 bg-white hover:bg-amber-100/50 text-amber-900"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Atualizar</span>
            </Button>
          </div>
        </div>

        {/* Busca rápida */}
        <div className="relative mt-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-amber-700/60 dark:text-amber-300/60" />
          <input
            type="text"
            placeholder="Filtrar por nome do cliente, rua, bairro, CEP ou motivo..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full h-8 pl-8 pr-3 text-xs rounded-lg border border-amber-300 bg-white text-slate-800 placeholder:text-amber-800/50 focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-3">
        {isLoading && alerts.length === 0 ? (
          <div className="py-10 text-center text-amber-800 flex flex-col items-center justify-center gap-2">
            <RefreshCw className="h-6 w-6 animate-spin text-amber-600" />
            <span className="text-xs font-semibold">Carregando auditoria de endereços...</span>
          </div>
        ) : filteredAlerts.length === 0 ? (
          <div className="py-8 text-center text-slate-500 flex flex-col items-center justify-center gap-1.5">
            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
              {statusFilter === 'pendente'
                ? 'Nenhum endereço suspeito pendente no momento!'
                : 'Nenhum alerta registrado com este filtro.'}
            </p>
            <p className="text-xs text-slate-500 max-w-md">
              A varredura anti-CEP e o botão de GPS dos entregadores alimentam esta caixa
              automaticamente assim que detectarem divergências.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
            {filteredAlerts.map((alert) => {
              const cust = alert.expand?.customer
              const custName = cust?.name || 'Cliente sem nome'
              const cur = (alert.current_address || {}) as Record<string, any>
              const sug = (alert.suggested_address || {}) as Record<string, any>
              const distMeters = alert.distance_meters || 0
              const distKm = (distMeters / 1000).toFixed(1)
              const isProcessing = processingAlertId === alert.id

              return (
                <div
                  key={alert.id}
                  className={`p-4 rounded-xl border transition-all flex flex-col justify-between gap-3 shadow-xs ${
                    alert.status === 'pendente'
                      ? 'border-amber-300 bg-white dark:bg-slate-900/90'
                      : alert.status === 'aprovado'
                        ? 'border-emerald-300 bg-emerald-50/40 dark:bg-emerald-950/20'
                        : 'border-slate-200 bg-slate-50 dark:bg-slate-900/40 opacity-75'
                  }`}
                >
                  <div className="space-y-2.5">
                    {/* Header do Card */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h4 className="font-heading font-bold text-sm text-[#002855] dark:text-white">
                            {custName}
                          </h4>
                          {isMaster && alert.expand?.company && (
                            <Badge
                              variant="outline"
                              className="text-[10px] border-slate-300 text-slate-600 bg-slate-100"
                            >
                              {alert.expand.company.nome_fantasia ||
                                alert.expand.company.nome_razao_social}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-slate-500">
                          <Clock className="h-3 w-3" />
                          <span>
                            {new Date(alert.created).toLocaleDateString('pt-BR', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <Badge
                          variant="outline"
                          className={`text-[10px] font-bold uppercase ${
                            alert.origin === 'varredura_cep'
                              ? 'border-blue-300 bg-blue-50 text-blue-700'
                              : 'border-purple-300 bg-purple-50 text-purple-700'
                          }`}
                        >
                          {alert.origin === 'varredura_cep'
                            ? '🔍 Varredura CEP'
                            : '📍 Pin Entregador'}
                        </Badge>
                        <Badge
                          className={`text-[10px] font-bold uppercase ${
                            alert.status === 'pendente'
                              ? 'bg-amber-500 text-white'
                              : alert.status === 'aprovado'
                                ? 'bg-emerald-600 text-white'
                                : 'bg-rose-600 text-white'
                          }`}
                        >
                          {alert.status}
                        </Badge>
                      </div>
                    </div>

                    {/* Destaque da Distância da Divergência */}
                    {distMeters > 0 && (
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-100/60 dark:bg-amber-950/40 border border-amber-300/80 text-amber-950 dark:text-amber-200 text-xs font-semibold">
                        <Navigation className="h-4 w-4 text-amber-600 shrink-0" />
                        <span>
                          Divergência detectada:{' '}
                          <strong className="text-rose-600 font-bold">
                            {distMeters >= 1000 ? `${distKm} km` : `${distMeters} metros`}
                          </strong>{' '}
                          de distância entre o pin atual e o ponto indicado.
                        </span>
                      </div>
                    )}

                    {/* Comparação: Endereço Cadastrado vs Correção Sugerida */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      {/* Endereço Cadastrado */}
                      <div className="p-2.5 rounded-lg border border-rose-200 bg-rose-50/50 dark:bg-rose-950/20 text-slate-800 dark:text-slate-200">
                        <div className="flex items-center gap-1 text-[11px] font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wider mb-1">
                          <XCircle className="h-3.5 w-3.5 text-rose-500" />
                          <span>Endereço Cadastrado</span>
                        </div>
                        <p className="font-medium leading-snug">
                          {cur.address ||
                            [cur.street, cur.neighborhood, cur.city, cur.state]
                              .filter(Boolean)
                              .join(', ') ||
                            cust?.address ||
                            'Não informado'}
                        </p>
                        <div className="mt-1.5 text-[11px] text-slate-600 dark:text-slate-400 space-y-0.5">
                          {cur.neighborhood && (
                            <p>
                              Bairro: <strong>{cur.neighborhood}</strong>
                            </p>
                          )}
                          {(cur.postal_code || cust?.postal_code) && (
                            <p>
                              CEP: <strong>{cur.postal_code || cust?.postal_code}</strong>
                            </p>
                          )}
                          {cur.lat && cur.lng && (
                            <p className="font-mono text-[10px] text-slate-500">
                              Pin: {Number(cur.lat).toFixed(4)}, {Number(cur.lng).toFixed(4)}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Correção Sugerida */}
                      <div className="p-2.5 rounded-lg border border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/30 text-slate-800 dark:text-slate-200">
                        <div className="flex items-center gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider mb-1">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                          <span>Correção Sugerida</span>
                        </div>
                        <p className="font-semibold text-emerald-950 dark:text-emerald-100 leading-snug">
                          {sug.address ||
                            [sug.street, sug.neighborhood, sug.city, sug.state]
                              .filter(Boolean)
                              .join(', ') ||
                            'Posição GPS do Entregador'}
                        </p>
                        <div className="mt-1.5 text-[11px] text-slate-600 dark:text-slate-400 space-y-0.5">
                          {sug.neighborhood && (
                            <p>
                              Bairro: <strong>{sug.neighborhood}</strong>
                            </p>
                          )}
                          {sug.postal_code && (
                            <p>
                              CEP: <strong>{sug.postal_code}</strong>
                            </p>
                          )}
                          {sug.lat && sug.lng && (
                            <p className="font-mono text-[10px] text-slate-500">
                              Pin: {Number(sug.lat).toFixed(4)}, {Number(sug.lng).toFixed(4)}
                              {sug.accuracy_meters
                                ? ` (precisão ~${Math.round(sug.accuracy_meters)}m)`
                                : ''}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Motivo / Notas */}
                    {alert.notes && (
                      <p className="text-[11px] text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 p-2 rounded-lg italic">
                        💬 {alert.notes}
                      </p>
                    )}
                  </div>

                  {/* Ações: Aprovar / Reprovar / Link Google Maps */}
                  <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      {sug.lat && sug.lng && (
                        <a
                          href={`https://www.google.com/maps?q=${sug.lat},${sug.lng}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-[#0052CC] hover:underline font-semibold"
                        >
                          <ExternalLink className="h-3 w-3" />
                          <span>Abrir no Maps</span>
                        </a>
                      )}
                    </div>

                    {alert.status === 'pendente' ? (
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handleReject(alert)}
                          disabled={isProcessing}
                          className="h-8 text-xs border-rose-300 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                        >
                          <XCircle className="h-3.5 w-3.5 mr-1 text-rose-600" />
                          Reprovar
                        </Button>

                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleApprove(alert)}
                          disabled={isProcessing}
                          className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-xs"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                          Aprovar &amp; Recalcular
                        </Button>
                      </div>
                    ) : (
                      <div className="text-[11px] text-slate-500 font-medium">
                        {alert.status === 'aprovado' ? '✓ Correção aplicada' : '✗ Alerta reprovado'}
                        {alert.reviewed_at && (
                          <span> em {new Date(alert.reviewed_at).toLocaleDateString('pt-BR')}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

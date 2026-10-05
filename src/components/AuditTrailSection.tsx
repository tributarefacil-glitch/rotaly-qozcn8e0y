import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  ShieldAlert,
  Search,
  RefreshCw,
  UserCheck,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  ArrowRight,
  Info,
  Calendar,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { deliveryService } from '@/services/deliveryService'
import { AuditTrailRecord, UserRecord } from '@/types/delivery'
import {
  formatDateInTz,
  formatTimeInTz,
  getCustomOperationalWindow,
  getOperationalWindow,
  isCurrentMonthInTz,
  parseSafeTimestamp,
} from '@/lib/operationalWindow'

interface AuditTrailSectionProps {
  couriers?: UserRecord[]
  currentCompanyId?: string
}

export const AuditTrailSection: React.FC<AuditTrailSectionProps> = ({
  couriers = [],
  currentCompanyId: _currentCompanyId,
}) => {
  const [items, setItems] = useState<AuditTrailRecord[]>([])
  const [totalItems, setTotalItems] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  const [isLoading, setIsLoading] = useState(false)

  // Filtros
  const [selectedCourierId, setSelectedCourierId] = useState<string>('all')
  const [selectedEntity, setSelectedEntity] = useState<string>('all')
  const [selectedAction, setSelectedAction] = useState<string>('all')
  const [selectedPeriod, setSelectedPeriod] = useState<string>('all') // 'today' | 'week' | 'month' | 'custom' | 'all'
  const [customStartDate, setCustomStartDate] = useState<string>('')
  const [customEndDate, setCustomEndDate] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')

  const perPage = 25

  const loadAuditData = useCallback(async () => {
    setIsLoading(true)
    try {
      // Montar filtro operacional De-Até
      const filterParts: string[] = []
      const now = new Date()
      const opWindow = getOperationalWindow(now)

      if (selectedPeriod === 'today') {
        filterParts.push(
          `created >= '${opWindow.startPbString}' && created <= '${opWindow.endPbString}'`,
        )
      } else if (selectedPeriod === 'week') {
        const sevenDaysAgoStart = opWindow.start - 6 * 24 * 60 * 60 * 1000
        const startStr = new Date(sevenDaysAgoStart).toISOString().replace('T', ' ')
        filterParts.push(`created >= '${startStr}'`)
      } else if (selectedPeriod === 'month') {
        // Ano e mês em SP
        const y = now.getFullYear()
        const m = String(now.getMonth() + 1).padStart(2, '0')
        filterParts.push(`created >= '${y}-${m}-01 00:00:00'`)
      } else if (selectedPeriod === 'custom' && customStartDate) {
        const customWindow = getCustomOperationalWindow(
          customStartDate,
          customEndDate || customStartDate,
        )
        filterParts.push(
          `created >= '${customWindow.startPbString}' && created <= '${customWindow.endPbString}'`,
        )
      }

      if (selectedAction !== 'all') {
        filterParts.push(`action = '${selectedAction}'`)
      }

      const res = await deliveryService.getAuditTrail({
        page: currentPage,
        perPage,
        courierId: selectedCourierId,
        entity: selectedEntity,
        filter: filterParts.length > 0 ? filterParts.join(' && ') : undefined,
      })

      setItems(res.items)
      setTotalItems(res.totalItems)
      setTotalPages(res.totalPages || 1)
    } catch (err) {
      console.warn('[AuditTrailSection] Falha ao carregar trilha:', err)
      setItems([])
    } finally {
      setIsLoading(false)
    }
  }, [
    currentPage,
    selectedCourierId,
    selectedEntity,
    selectedAction,
    selectedPeriod,
    customStartDate,
    customEndDate,
  ])

  useEffect(() => {
    loadAuditData()
  }, [loadAuditData])

  // Filtragem local complementar para busca textual
  const displayRows = useMemo(() => {
    if (!searchQuery.trim()) return items
    const q = searchQuery.toLowerCase().trim()
    return items.filter((item) => {
      const actorName = (item.expand?.actor_id?.name || item.actor_email || '').toLowerCase()
      const courierName = (item.expand?.courier_id?.name || '').toLowerCase()
      const entityStr = (item.entity || '').toLowerCase()
      const entityIdStr = (item.entity_id || '').toLowerCase()
      const diffStr = JSON.stringify(item.diff || item.after_data || '').toLowerCase()

      return (
        actorName.includes(q) ||
        courierName.includes(q) ||
        entityStr.includes(q) ||
        entityIdStr.includes(q) ||
        diffStr.includes(q)
      )
    })
  }, [items, searchQuery])

  // Helper de badge de ação
  const renderActionBadge = (action: string) => {
    switch (action?.toLowerCase()) {
      case 'create':
      case 'criação':
        return (
          <Badge className="bg-emerald-50 text-emerald-700 border-emerald-300 font-bold text-[10px]">
            Criação
          </Badge>
        )
      case 'update':
      case 'atualização':
        return (
          <Badge className="bg-blue-50 text-blue-700 border-blue-300 font-bold text-[10px]">
            Atualização
          </Badge>
        )
      case 'cancel':
      case 'cancelamento':
        return (
          <Badge className="bg-rose-50 text-rose-700 border-rose-300 font-bold text-[10px]">
            Cancelamento
          </Badge>
        )
      case 'delete':
      case 'exclusão':
        return (
          <Badge className="bg-slate-100 text-slate-700 border-slate-300 font-bold text-[10px]">
            Exclusão
          </Badge>
        )
      default:
        return (
          <Badge variant="outline" className="text-[10px] uppercase font-mono">
            {action || 'Ação'}
          </Badge>
        )
    }
  }

  // Helper para formatar De -> Para legível
  const renderDiffContent = (item: AuditTrailRecord) => {
    const diff = item.diff || {}
    const keys = Object.keys(diff)

    if (keys.length === 0) {
      if (item.action === 'cancel') {
        const reason = item.after_data?.cancel_reason || item.before_data?.cancel_reason
        return (
          <span className="text-[11px] text-rose-600 font-medium">
            Cancelado {reason ? `(Motivo: ${reason})` : ''}
          </span>
        )
      }
      if (item.action === 'create') {
        return (
          <span className="text-[11px] text-slate-500 italic">
            Registro inicial criado no sistema
          </span>
        )
      }
      return <span className="text-[11px] text-slate-400 italic">Sem alterações de campos</span>
    }

    return (
      <div className="space-y-1 font-mono text-[11px]">
        {keys.slice(0, 4).map((field) => {
          const change = diff[field]
          const oldVal = change?.from !== undefined ? String(change.from) : '—'
          const newVal = change?.to !== undefined ? String(change.to) : '—'

          return (
            <div key={field} className="flex items-center gap-1.5 flex-wrap">
              <span className="text-slate-500 font-sans font-semibold text-[10px] bg-slate-100 px-1 py-0.5 rounded">
                {field}:
              </span>
              <span className="text-slate-500 line-through truncate max-w-[120px]" title={oldVal}>
                {oldVal}
              </span>
              <ArrowRight className="h-3 w-3 text-slate-400 shrink-0" />
              <span className="text-slate-900 font-bold truncate max-w-[140px]" title={newVal}>
                {newVal}
              </span>
            </div>
          )
        })}
        {keys.length > 4 && (
          <span className="text-[10px] text-slate-400">+{keys.length - 4} outros campos</span>
        )}
      </div>
    )
  }

  // Exportar para CSV
  const handleExportCSV = () => {
    if (displayRows.length === 0) return
    const headers = [
      'Data/Hora (SP)',
      'Responsável',
      'Ação',
      'Entidade',
      'Entregador',
      'Diff / De -> Para',
    ]
    const rows = displayRows.map((r) => {
      const ts = parseSafeTimestamp(r.created) || new Date(r.created).getTime()
      const d = formatDateInTz(ts)
      const t = formatTimeInTz(ts)
      const actor = r.expand?.actor_id?.name || r.actor_email || 'Sistema'
      const courier = r.expand?.courier_id?.name || '-'
      const diffStr = JSON.stringify(r.diff || r.after_data || {})

      return [
        `"${d} ${t}"`,
        `"${actor}"`,
        `"${r.action}"`,
        `"${r.entity}"`,
        `"${courier}"`,
        `"${diffStr.replace(/"/g, '""')}"`,
      ]
    })

    const csvContent =
      'data:text/csv;charset=utf-8,\uFEFF' +
      [headers.join(';'), ...rows.map((row) => row.join(';'))].join('\n')

    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `trilha_auditoria_${new Date().toISOString().split('T')[0]}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="space-y-6">
      {/* CABEÇALHO */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <ShieldAlert className="h-6 w-6 text-[#0052CC]" />
              Trilha de Auditoria Geral (Audit Trail)
            </h3>
            <Badge
              variant="outline"
              className="border-indigo-400 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 text-xs font-bold"
            >
              Registro Imutável Read-Only
            </Badge>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Histórico cronológico de ações sensíveis (saldos de abertura, datas de corte, aprovações
            de KM e cancelamento de adiantamentos) gravadas automaticamente pelo servidor.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-center">
          <Button
            variant="outline"
            size="sm"
            onClick={loadAuditData}
            disabled={isLoading}
            className="h-9 gap-1.5 text-xs text-slate-700 border-slate-200 bg-white hover:bg-slate-50 rounded-xl"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 text-[#00A3FF] ${isLoading ? 'animate-spin' : ''}`}
            />
            Atualizar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            className="h-9 gap-1.5 text-xs text-emerald-700 border-emerald-200 bg-white hover:bg-emerald-50 rounded-xl"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Exportar CSV
          </Button>
        </div>
      </div>

      {/* FILTROS */}
      <Card className="border-slate-200/80 shadow-xs">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
            {/* Entregador */}
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-600">Entregador</Label>
              <Select
                value={selectedCourierId}
                onValueChange={(v) => {
                  setSelectedCourierId(v)
                  setCurrentPage(1)
                }}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Todos os entregadores" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">🛵 Todos os Entregadores</SelectItem>
                  {couriers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name || c.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Entidade */}
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-600">Entidade / Módulo</Label>
              <Select
                value={selectedEntity}
                onValueChange={(v) => {
                  setSelectedEntity(v)
                  setCurrentPage(1)
                }}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Todas as entidades" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">📂 Todas as Entidades</SelectItem>
                  <SelectItem value="users">👤 Entregadores (Saldo/Corte)</SelectItem>
                  <SelectItem value="route_km_approvals">🛣️ Aprovações de KM</SelectItem>
                  <SelectItem value="fuel_advances">⛽ Adiantamentos de Combustível</SelectItem>
                  <SelectItem value="orders">📦 Pedidos / Redireções</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Ação */}
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-600">Ação</Label>
              <Select
                value={selectedAction}
                onValueChange={(v) => {
                  setSelectedAction(v)
                  setCurrentPage(1)
                }}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Todas as ações" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">⚡ Todas as Ações</SelectItem>
                  <SelectItem value="create">Criação</SelectItem>
                  <SelectItem value="update">Atualização</SelectItem>
                  <SelectItem value="cancel">Cancelamento</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Período */}
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-600">Período Operacional</Label>
              <Select
                value={selectedPeriod}
                onValueChange={(v) => {
                  setSelectedPeriod(v)
                  setCurrentPage(1)
                }}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Selecione o período" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">🌐 Todo o Histórico</SelectItem>
                  <SelectItem value="today">☀️ Hoje</SelectItem>
                  <SelectItem value="week">🗓️ Últimos 7 dias</SelectItem>
                  <SelectItem value="month">📅 Este Mês</SelectItem>
                  <SelectItem value="custom">🔍 Personalizado (De – Até)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Busca Rápida */}
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-600">Buscar no registro</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  type="text"
                  placeholder="Responsável, e-mail, id..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9 pl-8 text-xs"
                />
              </div>
            </div>
          </div>

          {/* Campo Data Específica se Custom */}
          {selectedPeriod === 'custom' && (
            <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-slate-600">Data Inicial</Label>
                <Input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => {
                    setCustomStartDate(e.target.value)
                    setCurrentPage(1)
                  }}
                  className="h-9 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-slate-600">Data Final</Label>
                <Input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => {
                    setCustomEndDate(e.target.value)
                    setCurrentPage(1)
                  }}
                  className="h-9 text-xs font-mono"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* TABELA DE AUDITORIA */}
      <Card className="border-slate-200/80 shadow-sm overflow-hidden">
        <CardHeader className="p-4 pb-3 border-b bg-slate-50/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Info className="h-4 w-4 text-[#0052CC]" />
              Eventos da Trilha ({totalItems} total)
            </CardTitle>
            <CardDescription className="text-xs">
              Registros imutáveis com carimbo de data/hora (Fuso Horário Brasília /
              America/Sao_Paulo).
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100/70 text-slate-600 uppercase tracking-wider text-[11px] font-bold select-none">
                  <th className="py-3 px-4">Data / Hora (SP)</th>
                  <th className="py-3 px-3">Responsável</th>
                  <th className="py-3 px-3 text-center">Ação</th>
                  <th className="py-3 px-3">Entidade</th>
                  <th className="py-3 px-3">Entregador Afetado</th>
                  <th className="py-3 px-4">De → Para (Modificações)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {displayRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      <ShieldAlert className="h-10 w-10 mx-auto text-slate-300 mb-2" />
                      <p className="font-semibold text-slate-600">
                        Nenhum evento registrado na trilha de auditoria para os filtros
                        selecionados.
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        As modificações em saldos, cortes e aprovações de KM aparecerão
                        automaticamente aqui.
                      </p>
                    </td>
                  </tr>
                ) : (
                  displayRows.map((row) => {
                    const ts = parseSafeTimestamp(row.created) || new Date(row.created).getTime()
                    const dateStr = formatDateInTz(ts)
                    const timeStr = formatTimeInTz(ts)
                    const isSystemActor =
                      !row.actor_id ||
                      row.actor_name === 'Sistema' ||
                      row.metadata?.system_trigger === true ||
                      row.metadata?.actor_role === 'system'
                    const actorName = isSystemActor
                      ? 'Sistema'
                      : row.expand?.actor_id?.name || row.actor_name || row.actor_email || 'Usuário'
                    const courierName = row.expand?.courier_id?.name || '-'

                    return (
                      <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                        {/* Data / Hora */}
                        <td className="py-3 px-4 align-top whitespace-nowrap">
                          <div className="space-y-0.5">
                            <span className="font-mono font-bold text-slate-900 block">
                              {dateStr}
                            </span>
                            <span className="font-mono text-[10px] text-slate-500 block">
                              {timeStr}
                            </span>
                          </div>
                        </td>

                        {/* Responsável */}
                        <td className="py-3 px-3 align-top">
                          <div className="space-y-1">
                            {isSystemActor ? (
                              <Badge
                                variant="outline"
                                className="bg-slate-100 text-slate-700 border-slate-300 font-bold text-[10px] px-2 py-0.5 gap-1 inline-flex items-center"
                              >
                                ⚙️ Sistema
                              </Badge>
                            ) : (
                              <span className="font-semibold text-slate-900 block">
                                {actorName}
                              </span>
                            )}
                            {!isSystemActor && row.actor_email && row.actor_email !== actorName && (
                              <span className="text-[10px] text-slate-400 block font-mono">
                                {row.actor_email}
                              </span>
                            )}
                            {row.ip && (
                              <span className="text-[9px] text-slate-400 block font-mono">
                                IP: {row.ip}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Ação */}
                        <td className="py-3 px-3 align-top text-center">
                          {renderActionBadge(row.action)}
                        </td>

                        {/* Entidade */}
                        <td className="py-3 px-3 align-top">
                          <Badge
                            variant="outline"
                            className="font-mono text-[10px] text-slate-700 bg-slate-50"
                          >
                            {row.entity}
                          </Badge>
                          <span
                            className="block text-[9px] text-slate-400 font-mono mt-0.5 truncate max-w-[120px]"
                            title={row.entity_id}
                          >
                            id: {row.entity_id}
                          </span>
                        </td>

                        {/* Entregador */}
                        <td className="py-3 px-3 align-top">
                          {courierName !== '-' ? (
                            <span className="font-medium text-slate-800 flex items-center gap-1">
                              🛵 {courierName}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>

                        {/* De -> Para */}
                        <td className="py-3 px-4 align-top max-w-md">{renderDiffContent(row)}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* PAGINAÇÃO */}
          <div className="p-4 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              Página <strong>{currentPage}</strong> de <strong>{totalPages}</strong> ({totalItems}{' '}
              registros)
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1 || isLoading}
                className="h-8 gap-1 text-xs"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages || isLoading}
                className="h-8 gap-1 text-xs"
              >
                Próxima
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

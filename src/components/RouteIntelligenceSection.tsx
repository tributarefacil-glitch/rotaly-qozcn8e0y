import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  RouteIntelligenceSummary,
  fetchRouteIntelligenceAnalysis,
  RouteLegItem,
} from '@/services/routeIntelligenceService'
import {
  Brain,
  Sparkles,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  RefreshCw,
  Search,
  CheckCircle2,
  HelpCircle,
  Trophy,
  Filter,
  ArrowRight,
  ShieldCheck,
  Compass,
} from 'lucide-react'
import { UserRecord } from '@/types/delivery'

interface RouteIntelligenceSectionProps {
  couriers?: UserRecord[]
  empresaId?: string
}

export function RouteIntelligenceSection({
  couriers = [],
  empresaId,
}: RouteIntelligenceSectionProps) {
  // Estados de filtros
  const [selectedDateFilter, setSelectedDateFilter] = useState<
    'all' | 'today' | 'week' | 'month' | 'previous_month' | 'custom'
  >('month')
  const [customStartDate, setCustomStartDate] = useState<string>('')
  const [customEndDate, setCustomEndDate] = useState<string>('')
  const [selectedCourierId, setSelectedCourierId] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'better' | 'deviation' | 'insufficient' | 'equivalent'
  >('all')
  const [searchQuery, setSearchQuery] = useState<string>('')

  // Estados de carregamento e dados
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [summary, setSummary] = useState<RouteIntelligenceSummary | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Carregar dados
  const loadData = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)
    try {
      const res = await fetchRouteIntelligenceAnalysis({
        periodFilter: selectedDateFilter,
        customStartDate: customStartDate || undefined,
        customEndDate: customEndDate || undefined,
        courierId: selectedCourierId,
        statusFilter,
        empresaId,
        persistArchive: true,
      })
      setSummary(res)
    } catch (err: any) {
      console.error('[RouteIntelligenceSection] Erro ao carregar inteligência de rotas:', err)
      setErrorMessage(err?.message || 'Erro ao carregar análise de pernas de rota.')
    } finally {
      setIsLoading(false)
    }
  }, [
    selectedDateFilter,
    customStartDate,
    customEndDate,
    selectedCourierId,
    statusFilter,
    empresaId,
  ])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Filtragem local por texto de busca (nome do entregador, cliente, código ou lote)
  const filteredLegs = useMemo(() => {
    if (!summary?.legs) return []
    if (!searchQuery.trim()) return summary.legs

    const q = searchQuery.toLowerCase().trim()
    return summary.legs.filter((leg) => {
      return (
        (leg.courier_name && leg.courier_name.toLowerCase().includes(q)) ||
        leg.from_name.toLowerCase().includes(q) ||
        leg.to_name.toLowerCase().includes(q) ||
        (leg.tracking_code && leg.tracking_code.toLowerCase().includes(q)) ||
        leg.route_batch_key.toLowerCase().includes(q)
      )
    })
  }, [summary?.legs, searchQuery])

  // Entregadores elegíveis
  const eligibleCouriers = useMemo(() => {
    return couriers.filter((c) => c.role === 'courier' || !c.role)
  }, [couriers])

  return (
    <div className="space-y-6">
      {/* Cabeçalho da Seção */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-indigo-900 via-indigo-800 to-slate-900 p-6 rounded-2xl text-white shadow-md">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-500/20 rounded-xl border border-indigo-400/30">
              <Brain className="h-6 w-6 text-indigo-300" />
            </div>
            <div>
              <h2 className="text-xl font-bold flex items-center gap-2">
                Inteligência de Rotas (Etapa 1)
                <Badge
                  variant="outline"
                  className="bg-indigo-500/30 border-indigo-400/40 text-indigo-200 text-xs font-mono"
                >
                  Estilo iFood · Read-only
                </Badge>
              </h2>
              <p className="text-xs text-indigo-200/80">
                Aprender com as melhores rotas já executadas: comparativo perna a perna (Planejado
                Viário vs. Realizado GPS Saneado).
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-center">
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={isLoading}
            className="bg-white/10 hover:bg-white/20 text-white border-white/20 text-xs h-9"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
            Atualizar Análise
          </Button>
        </div>
      </div>

      {/* Alerta de Escopo Read-only */}
      <div className="bg-amber-50 border border-amber-200/80 rounded-xl p-3.5 flex items-start gap-3 text-xs text-amber-900">
        <ShieldCheck className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
        <div className="space-y-0.5">
          <p className="font-semibold text-amber-950">Regra do Rotaly: Insumo Estratégico Seguro</p>
          <p className="text-amber-800 leading-relaxed">
            Esta tela é puramente analítica. Nenhum cálculo de pagamento de combustível ou auditoria
            é alterado. A telemetria utiliza exclusivamente pings saneados (precisão &lt; 100m,
            deduplicação temporal e espacial).
          </p>
        </div>
      </div>

      {/* Cards de Resumo e Métricas Globais */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Candidatas a Rota Melhor */}
        <Card className="border-emerald-200 bg-emerald-50/40 shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-medium text-emerald-800 flex items-center justify-between">
              <span>Candidatas a Rota Melhor</span>
              <Sparkles className="h-4 w-4 text-emerald-600" />
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-emerald-950 font-mono">
              {summary ? summary.total_better_legs : 0}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-emerald-700">
              Pernas onde o entregador fez <strong>menos km</strong> que o planejado viário oficial.
            </p>
          </CardContent>
        </Card>

        {/* Card 2: Taxa de Otimização (Win Rate) */}
        <Card className="border-indigo-200 bg-indigo-50/40 shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-medium text-indigo-800 flex items-center justify-between">
              <span>Taxa de Superação</span>
              <Trophy className="h-4 w-4 text-indigo-600" />
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-indigo-950 font-mono">
              {summary ? `${summary.global_win_rate_pct}%` : '0%'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-indigo-700">
              Proporção de pernas válidas onde o trajeto real superou a estimativa do algoritmo.
            </p>
          </CardContent>
        </Card>

        {/* Card 3: Desvios ou Telemetria Furada */}
        <Card className="border-rose-200 bg-rose-50/40 shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-medium text-rose-800 flex items-center justify-between">
              <span>Desvios Excessivos</span>
              <TrendingUp className="h-4 w-4 text-rose-600" />
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-rose-950 font-mono">
              {summary ? summary.total_excess_deviation_legs : 0}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-rose-700">
              Pernas com realizado &gt; 35% do planejado (desvio pessoal ou ruído de sinal).
            </p>
          </CardContent>
        </Card>

        {/* Card 4: Dados Insuficientes */}
        <Card className="border-slate-200 bg-slate-50/40 shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-medium text-slate-700 flex items-center justify-between">
              <span>Dados Insuficientes</span>
              <HelpCircle className="h-4 w-4 text-slate-500" />
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-slate-900 font-mono">
              {summary ? summary.total_insufficient_data_legs : 0}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-slate-600">
              Pernas com menos de 3 pings válidos (desconsideradas para não aprender com ruído).
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Agregado por Entregador (Rank de Eficiência de Rotas) */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-500" />
            <div>
              <CardTitle className="text-sm font-semibold text-slate-900">
                Performance e Superação de Rotas por Entregador
              </CardTitle>
              <CardDescription className="text-xs text-slate-500">
                Total de pernas analisadas, pernas que superaram o planejado e km economizado no
                período.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/70 text-xs">
                  <TableHead className="font-semibold text-slate-700">Entregador</TableHead>
                  <TableHead className="text-center font-semibold text-slate-700">
                    Total Pernas
                  </TableHead>
                  <TableHead className="text-center font-semibold text-slate-700">
                    Pernas Válidas
                  </TableHead>
                  <TableHead className="text-center font-semibold text-emerald-700">
                    Venceu Planejado
                  </TableHead>
                  <TableHead className="text-center font-semibold text-rose-700">
                    Desvio Excessivo
                  </TableHead>
                  <TableHead className="text-center font-semibold text-slate-500">
                    Dados Insuficientes
                  </TableHead>
                  <TableHead className="text-right font-semibold text-indigo-700">
                    Taxa de Superação (%)
                  </TableHead>
                  <TableHead className="text-right font-semibold text-emerald-800">
                    KM Otimizado Salvo
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary && summary.aggregates.length > 0 ? (
                  summary.aggregates.map((agg) => (
                    <TableRow key={agg.courier_id} className="text-xs hover:bg-slate-50/80">
                      <TableCell className="font-semibold text-slate-900">
                        {agg.courier_name}
                      </TableCell>
                      <TableCell className="text-center font-mono">{agg.total_legs}</TableCell>
                      <TableCell className="text-center font-mono text-slate-700">
                        {agg.valid_legs}
                      </TableCell>
                      <TableCell className="text-center font-mono font-bold text-emerald-700">
                        {agg.better_legs > 0 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                            <Sparkles className="h-3 w-3" />
                            {agg.better_legs}
                          </span>
                        ) : (
                          '0'
                        )}
                      </TableCell>
                      <TableCell className="text-center font-mono text-rose-700">
                        {agg.excess_deviation_legs}
                      </TableCell>
                      <TableCell className="text-center font-mono text-slate-400">
                        {agg.insufficient_data_legs}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-indigo-700">
                        {agg.win_rate_pct}%
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-emerald-700">
                        {agg.net_km_saved > 0 ? `-${agg.net_km_saved} km` : '0.00 km'}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-6 text-xs text-slate-500">
                      {isLoading
                        ? 'Calculando agregados por entregador...'
                        : 'Nenhum dado encontrado para o período selecionado.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Painel de Filtros Operacionais */}
      <Card className="shadow-sm">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {/* Seletor de Período */}
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">Período</Label>
              <Select
                value={selectedDateFilter}
                onValueChange={(val: any) => setSelectedDateFilter(val)}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Selecione o período" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Hoje</SelectItem>
                  <SelectItem value="week">Últimos 7 dias</SelectItem>
                  <SelectItem value="month">Este Mês</SelectItem>
                  <SelectItem value="previous_month">Mês anterior</SelectItem>
                  <SelectItem value="custom">Personalizado (De – Até)</SelectItem>
                  <SelectItem value="all">Todo o Histórico</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Datas Customizadas */}
            {selectedDateFilter === 'custom' && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-slate-700">Data Inicial</Label>
                  <Input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-slate-700">Data Final</Label>
                  <Input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
              </>
            )}

            {/* Seletor de Entregador */}
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">Entregador</Label>
              <Select value={selectedCourierId} onValueChange={setSelectedCourierId}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Todos os entregadores" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os Entregadores</SelectItem>
                  {eligibleCouriers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name || c.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Filtro por Classificação de Perna */}
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">Tipo de Perna</Label>
              <Select value={statusFilter} onValueChange={(val: any) => setStatusFilter(val)}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Todas as pernas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as Pernas</SelectItem>
                  <SelectItem value="better">✨ Candidatas a Rota Melhor</SelectItem>
                  <SelectItem value="deviation">⚠️ Desvios Excessivos</SelectItem>
                  <SelectItem value="equivalent">➡️ Equivalentes (Dentro da margem)</SelectItem>
                  <SelectItem value="insufficient">❓ Dados Insuficientes</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Busca Rápida */}
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700">Buscar</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  type="text"
                  placeholder="Cliente, parada, lote..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9 pl-8 text-xs"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabela Detalhada por Perna de Rota */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Compass className="h-4 w-4 text-indigo-600" />
              Comparativo Perna a Perna: Planejado Viário vs. Realizado GPS
            </CardTitle>
            <CardDescription className="text-xs text-slate-500">
              Listagem ordenada por lote e sequência de perna (base → paradas → retorno à base).
            </CardDescription>
          </div>
          <div className="text-xs text-slate-500 font-mono">
            {filteredLegs.length} perna(s) listada(s)
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {errorMessage && (
            <div className="p-4 bg-rose-50 text-rose-800 text-xs border-b border-rose-200">
              {errorMessage}
            </div>
          )}

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/70 text-xs">
                  <TableHead className="font-semibold text-slate-700">Lote / Entregador</TableHead>
                  <TableHead className="text-center font-semibold text-slate-700">Perna</TableHead>
                  <TableHead className="font-semibold text-slate-700">
                    Trecho (Origem → Destino)
                  </TableHead>
                  <TableHead className="text-right font-semibold text-slate-700">
                    KM Planejado
                  </TableHead>
                  <TableHead className="text-right font-semibold text-slate-700">
                    KM Realizado
                  </TableHead>
                  <TableHead className="text-right font-semibold text-slate-700">
                    Diferença (KM)
                  </TableHead>
                  <TableHead className="text-right font-semibold text-slate-700">
                    Variação (%)
                  </TableHead>
                  <TableHead className="text-center font-semibold text-slate-700">
                    Pings Válidos
                  </TableHead>
                  <TableHead className="text-center font-semibold text-slate-700">
                    Diagnóstico
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLegs.length > 0 ? (
                  filteredLegs.map((leg, index) => {
                    const isCandidate = leg.analysis_status === 'candidate_better'
                    const isExcess = leg.analysis_status === 'excess_deviation'
                    const isInsufficient = leg.analysis_status === 'insufficient_data'

                    return (
                      <TableRow
                        key={`${leg.route_batch_key}_${leg.leg_index}_${index}`}
                        className={`text-xs transition-colors ${
                          isCandidate
                            ? 'bg-emerald-50/60 hover:bg-emerald-50 border-l-4 border-l-emerald-500'
                            : isExcess
                              ? 'bg-rose-50/40 hover:bg-rose-50/70 border-l-4 border-l-rose-500'
                              : isInsufficient
                                ? 'bg-slate-50/40 hover:bg-slate-50/80 text-slate-500'
                                : 'hover:bg-slate-50/80'
                        }`}
                      >
                        {/* Lote / Entregador */}
                        <TableCell className="py-2.5">
                          <div className="font-semibold text-slate-900">{leg.courier_name}</div>
                          <div className="text-[10px] text-slate-500 font-mono truncate max-w-[140px]">
                            {leg.route_batch_key}
                          </div>
                        </TableCell>

                        {/* Perna Index e Tipo */}
                        <TableCell className="text-center py-2.5">
                          <Badge
                            variant="secondary"
                            className="text-[10px] font-mono px-1.5 py-0 bg-slate-200 text-slate-700"
                          >
                            Perna {leg.leg_index}
                          </Badge>
                        </TableCell>

                        {/* Trecho */}
                        <TableCell className="py-2.5">
                          <div className="flex items-center gap-1.5 font-medium text-slate-800">
                            <span className="truncate max-w-[120px]">{leg.from_name}</span>
                            <ArrowRight className="h-3 w-3 text-slate-400 shrink-0" />
                            <span className="truncate max-w-[130px] font-semibold">
                              {leg.to_name}
                            </span>
                          </div>
                          {leg.tracking_code && (
                            <div className="text-[10px] text-slate-500 font-mono">
                              {leg.tracking_code}
                            </div>
                          )}
                        </TableCell>

                        {/* KM Planejado */}
                        <TableCell className="text-right font-mono py-2.5 text-slate-900 font-semibold">
                          {leg.km_planned.toFixed(2)} km
                        </TableCell>

                        {/* KM Realizado */}
                        <TableCell className="text-right font-mono py-2.5">
                          {isInsufficient || leg.km_realized === null ? (
                            <span className="text-slate-400 italic">--</span>
                          ) : (
                            <span
                              className={`font-semibold ${
                                isCandidate
                                  ? 'text-emerald-700 font-bold'
                                  : isExcess
                                    ? 'text-rose-700 font-bold'
                                    : 'text-slate-800'
                              }`}
                            >
                              {leg.km_realized.toFixed(2)} km
                            </span>
                          )}
                        </TableCell>

                        {/* Diferença */}
                        <TableCell className="text-right font-mono py-2.5">
                          {isInsufficient || leg.km_diff === null ? (
                            <span className="text-slate-400 italic">--</span>
                          ) : (
                            <span
                              className={`font-medium ${
                                leg.km_diff < 0
                                  ? 'text-emerald-700'
                                  : leg.km_diff > 0
                                    ? 'text-rose-700'
                                    : 'text-slate-600'
                              }`}
                            >
                              {leg.km_diff > 0
                                ? `+${leg.km_diff.toFixed(2)}`
                                : leg.km_diff.toFixed(2)}{' '}
                              km
                            </span>
                          )}
                        </TableCell>

                        {/* Variação % */}
                        <TableCell className="text-right font-mono py-2.5">
                          {isInsufficient || leg.diff_pct === null ? (
                            <span className="text-slate-400 italic">--</span>
                          ) : (
                            <span
                              className={`font-medium ${
                                leg.diff_pct < 0
                                  ? 'text-emerald-700'
                                  : leg.diff_pct > 0
                                    ? 'text-rose-700'
                                    : 'text-slate-600'
                              }`}
                            >
                              {leg.diff_pct > 0 ? `+${leg.diff_pct}%` : `${leg.diff_pct}%`}
                            </span>
                          )}
                        </TableCell>

                        {/* Pings Válidos */}
                        <TableCell className="text-center font-mono py-2.5">
                          <span
                            className={
                              leg.pings_count < 3 ? 'text-amber-600 font-bold' : 'text-slate-600'
                            }
                          >
                            {leg.pings_count}
                          </span>
                        </TableCell>

                        {/* Diagnóstico / Status */}
                        <TableCell className="text-center py-2.5">
                          {isCandidate && (
                            <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-semibold gap-1">
                              <Sparkles className="h-2.5 w-2.5" />
                              Rota Melhor Candidata
                            </Badge>
                          )}
                          {isExcess && (
                            <Badge
                              variant="destructive"
                              className="bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-semibold gap-1"
                            >
                              <TrendingUp className="h-2.5 w-2.5" />
                              Desvio Excessivo
                            </Badge>
                          )}
                          {isInsufficient && (
                            <Badge
                              variant="outline"
                              className="bg-slate-100 text-slate-500 border-slate-300 text-[10px] font-medium"
                            >
                              Dados Insuficientes
                            </Badge>
                          )}
                          {!isCandidate && !isExcess && !isInsufficient && (
                            <Badge
                              variant="secondary"
                              className="bg-slate-100 text-slate-700 text-[10px] font-normal"
                            >
                              Equivalente
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-10 text-xs text-slate-500">
                      {isLoading ? (
                        <div className="flex flex-col items-center gap-2">
                          <RefreshCw className="h-5 w-5 animate-spin text-indigo-600" />
                          <span>Processando inteligência de rotas e telemetria...</span>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <p className="font-semibold text-slate-700">Nenhuma perna encontrada</p>
                          <p className="text-slate-400">
                            Tente alterar os filtros de período, entregador ou tipo de perna.
                          </p>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

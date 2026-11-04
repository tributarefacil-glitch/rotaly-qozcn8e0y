import React, { useState, useEffect } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { MapPin, AlertTriangle, RefreshCw, Phone, Home, ShieldAlert } from 'lucide-react'
import { findSuspectPinPairs, SuspectPinClusterPair } from '@/services/suspectPinsService'

interface SuspectPinsPanelProps {
  empresaId?: string
  onEditCustomer?: (customerId: string) => void
}

export const SuspectPinsPanel: React.FC<SuspectPinsPanelProps> = ({
  empresaId,
  onEditCustomer,
}) => {
  const [pairs, setPairs] = useState<SuspectPinClusterPair[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date())

  const loadSuspectPins = async () => {
    setIsLoading(true)
    try {
      const data = await findSuspectPinPairs({ empresaId, thresholdMeters: 40 })
      setPairs(data)
      setLastRefreshed(new Date())
    } catch (err) {
      console.error('[SuspectPinsPanel] Erro ao carregar pins suspeitos:', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadSuspectPins()
  }, [empresaId])

  return (
    <Card className="shadow-sm border-amber-200 bg-white">
      <CardHeader className="pb-3 border-b border-amber-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="space-y-1">
          <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-600" />
            Pins Suspeitos &lt; 40 Metros (Auditoria de Precisão)
          </CardTitle>
          <CardDescription className="text-xs text-slate-500">
            Clientes distintos cujos pins estão praticamente colados (mesmo imóvel, duplicatas ou
            vizinhos). Exibição somente leitura para análise humana — o sistema não funde clientes
            automaticamente.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-300 text-xs">
            {pairs.length} par(es) detectado(s)
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={loadSuspectPins}
            disabled={isLoading}
            className="h-8 text-xs gap-1"
          >
            <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-3">
        <Alert className="bg-amber-50/70 border-amber-200 text-amber-900 py-2.5 px-3">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
          <AlertTitle className="text-xs font-semibold">
            Prevenção contra contaminação de IA
          </AlertTitle>
          <AlertDescription className="text-[11px] leading-relaxed">
            Pins a menos de 40 metros geram pernas irrealistas (como a de 0,07 km clara → DANIELLE)
            que foram excluídas do aprendizado de rota. Revise abaixo para corrigir números de porta
            e complementos.
          </AlertDescription>
        </Alert>

        {isLoading ? (
          <div className="py-8 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin text-amber-600" />
            Varrendo coordenadas de clientes da base...
          </div>
        ) : pairs.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500 space-y-1">
            <p className="font-semibold text-emerald-700 flex items-center justify-center gap-1.5">
              <MapPin className="h-4 w-4" />
              Nenhum pin suspeito (&lt; 40 metros) encontrado na base.
            </p>
            <p className="text-slate-400">
              Todos os clientes ativos possuem distâncias viáveis entre seus pins.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5 max-h-[480px] overflow-y-auto pr-1">
            {pairs.map((pair, index) => {
              const isExtremelyClose = pair.distanceMeters < 10
              return (
                <div
                  key={`${pair.customerA.id}_${pair.customerB.id}_${index}`}
                  className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 flex-1">
                    {/* Cliente A */}
                    <div className="p-2.5 rounded bg-white border border-slate-100 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900 truncate">
                          {pair.customerA.name}
                        </span>
                        <Badge variant="secondary" className="text-[10px] font-mono">
                          ID: {pair.customerA.id.slice(-6)}
                        </Badge>
                      </div>
                      <div className="text-slate-600 text-[11px] flex items-start gap-1">
                        <Home className="h-3 w-3 text-slate-400 shrink-0 mt-0.5" />
                        <span className="truncate">
                          {pair.customerA.address || 'Sem endereço textual'}
                        </span>
                      </div>
                      <div className="text-slate-500 text-[11px] flex items-center gap-1">
                        <Phone className="h-3 w-3 text-slate-400 shrink-0" />
                        <span>
                          {pair.customerA.phone || pair.customerA.phone2 || 'Sem telefone'}
                        </span>
                      </div>
                      {onEditCustomer && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onEditCustomer(pair.customerA.id)}
                          className="h-6 px-1.5 text-[10px] text-indigo-600 hover:text-indigo-800"
                        >
                          Editar Cliente
                        </Button>
                      )}
                    </div>

                    {/* Cliente B */}
                    <div className="p-2.5 rounded bg-white border border-slate-100 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900 truncate">
                          {pair.customerB.name}
                        </span>
                        <Badge variant="secondary" className="text-[10px] font-mono">
                          ID: {pair.customerB.id.slice(-6)}
                        </Badge>
                      </div>
                      <div className="text-slate-600 text-[11px] flex items-start gap-1">
                        <Home className="h-3 w-3 text-slate-400 shrink-0 mt-0.5" />
                        <span className="truncate">
                          {pair.customerB.address || 'Sem endereço textual'}
                        </span>
                      </div>
                      <div className="text-slate-500 text-[11px] flex items-center gap-1">
                        <Phone className="h-3 w-3 text-slate-400 shrink-0" />
                        <span>
                          {pair.customerB.phone || pair.customerB.phone2 || 'Sem telefone'}
                        </span>
                      </div>
                      {onEditCustomer && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onEditCustomer(pair.customerB.id)}
                          className="h-6 px-1.5 text-[10px] text-indigo-600 hover:text-indigo-800"
                        >
                          Editar Cliente
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Badge de Distância entre os pins */}
                  <div className="flex md:flex-col items-center justify-between md:justify-center gap-1.5 shrink-0 px-2 py-1 md:min-w-[120px]">
                    <span className="text-[10px] text-slate-500 uppercase font-semibold">
                      Distância
                    </span>
                    <Badge
                      className={`text-xs font-mono font-bold ${
                        isExtremelyClose ? 'bg-rose-600 text-white' : 'bg-amber-500 text-white'
                      }`}
                    >
                      {pair.distanceMeters} m
                    </Badge>
                    <span className="text-[10px] text-slate-400">
                      {isExtremelyClose ? 'Praticamente idênticos' : 'Mesmo quarteirão/lote'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="text-[10px] text-slate-400 text-right">
          Última varredura: {lastRefreshed.toLocaleTimeString('pt-BR')}
        </div>
      </CardContent>
    </Card>
  )
}
export default SuspectPinsPanel

import React, { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import type { CustomerRecord } from '@/types/delivery'
import {
  reverseGeocodeGoogleRestApi,
  fallbackReverseGeocode,
  normalizeTextForComparison,
} from '@/lib/googleMaps'
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  ExternalLink,
  ShieldCheck,
  Edit,
} from 'lucide-react'
import { toast } from 'sonner'

export interface SuspectCustomerItem {
  customer: CustomerRecord
  recordedCity: string
  returnedCity?: string
  returnedAddress?: string
  distanceDeltaKm?: number
  reason: string
}

interface CustomerAddressAuditModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  customers: CustomerRecord[]
  onEditCustomer: (customer: CustomerRecord) => void
}

export function CustomerAddressAuditModal({
  open,
  onOpenChange,
  customers,
  onEditCustomer,
}: CustomerAddressAuditModalProps) {
  const [isRunningAudit, setIsRunningAudit] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [suspects, setSuspects] = useState<SuspectCustomerItem[]>([])
  const [hasRunOnce, setHasRunOnce] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  const handleStartAudit = async () => {
    // Filtrar clientes que possuem coordenadas gravadas
    const candidates = customers.filter(
      (c) => typeof c.lat === 'number' && typeof c.lng === 'number' && (c.lat !== 0 || c.lng !== 0),
    )

    if (candidates.length === 0) {
      toast.info('Nenhum cliente com coordenadas cadastradas para auditar.')
      return
    }

    setIsRunningAudit(true)
    setProgress({ current: 0, total: candidates.length })
    const detected: SuspectCustomerItem[] = []

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i]
      setProgress({ current: i + 1, total: candidates.length })

      const cLat = Number(c.lat)
      const cLng = Number(c.lng)
      const recordedCity = (c.city || '').trim()
      const recordedAddress = (c.address || c.street || '').toLowerCase()

      // 1. Checagem rápida de fallback comum conhecido (Centro do RJ: -22.906847, -43.172896)
      if (Math.abs(cLat - -22.906847) < 0.0005 && Math.abs(cLng - -43.172896) < 0.0005) {
        if (!recordedAddress.includes('centro') || !recordedCity.toLowerCase().includes('rio')) {
          detected.push({
            customer: c,
            recordedCity: recordedCity || 'Não informada',
            returnedCity: 'Centro do Rio de Janeiro (Fallback)',
            reason: 'Coordenada genérica de fallback (Centro RJ) detectada.',
          })
          continue
        }
      }

      // 2. Consulta leve de reverse geocode da coordenada gravada
      try {
        let revResult = await reverseGeocodeGoogleRestApi(cLat, cLng, undefined, {
          timeoutMs: 3000,
        })
        if (!revResult) {
          revResult = await fallbackReverseGeocode(cLat, cLng, { timeoutMs: 3000 })
        }

        if (revResult) {
          const retCity = revResult.city || ''
          const normRec = normalizeTextForComparison(recordedCity)
          const normRet = normalizeTextForComparison(retCity)
          const normAddr = normalizeTextForComparison(revResult.formattedAddress)

          // Se a cidade cadastrada é diferente da cidade retornada pelo reverse geocoding
          if (normRec && normRet && !normRet.includes(normRec) && !normRec.includes(normRet)) {
            // Verificar se o endereço gravado citava a cidade retornada
            if (!normAddr.includes(normRec)) {
              detected.push({
                customer: c,
                recordedCity: c.city || 'Indefinida',
                returnedCity: retCity || 'Não identificada',
                returnedAddress: revResult.formattedAddress,
                reason: `Cidade divergente: cadastro indica "${c.city}", mas a coordenada gravada cai em "${retCity}".`,
              })
            }
          }
        }
      } catch (err) {
        console.warn(`[Audit] Erro ao checar cliente ${c.name}:`, err)
      }

      // Pequena pausa para respeitar quotas/rate limits
      if (i % 5 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 80))
      }
    }

    setSuspects(detected)
    setIsRunningAudit(false)
    setHasRunOnce(true)

    if (detected.length === 0) {
      toast.success('Auditoria concluída! Nenhuma divergência crítica encontrada.')
    } else {
      toast.warning(`Auditoria concluída: ${detected.length} endereço(s) suspeito(s) para revisão.`)
    }
  }

  const filteredSuspects = suspects.filter((s) => {
    if (!searchTerm.trim()) return true
    const term = searchTerm.toLowerCase()
    return (
      (s.customer.name && s.customer.name.toLowerCase().includes(term)) ||
      (s.customer.address && s.customer.address.toLowerCase().includes(term)) ||
      (s.reason && s.reason.toLowerCase().includes(term)) ||
      (s.returnedCity && s.returnedCity.toLowerCase().includes(term))
    )
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-[#0E1738] text-white border-[#1E2B58] p-5 sm:p-6 shadow-brand-dark">
        <DialogHeader className="pb-3 border-b border-[#1E2B58]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-black text-white font-heading">
                Verificação de Endereços no Mapa (Auditoria Anti-Descalibração)
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-400">
                Identifica cadastros onde as coordenadas geocodificadas caíram em cidades ou bairros
                diferentes do endereço preenchido.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Caixa explicativa de blindagem */}
          <div className="p-3.5 rounded-xl bg-[#0A1128] border border-[#1E2B58] text-xs text-slate-300 space-y-1.5">
            <p className="font-semibold text-white flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
              Regra de Segurança: Nenhuma coordenada é regravada em massa automaticamente
            </p>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              O utilitário apenas lista divergências para confirmação manual da equipe. Ao clicar em
              &quot;Revisar Cadastro&quot;, o modal de edição abrirá com o mini-mapa interativo para
              que o operador confirme o pino correto com total precisão.
            </p>
          </div>

          {/* Painel de Ação e Progresso */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 rounded-xl bg-[#070D1E] border border-[#1E2B58]">
            <div className="text-xs text-slate-300">
              <span>Total de clientes na base: </span>
              <strong className="text-white">{customers.length}</strong>
              {isRunningAudit && (
                <span className="ml-3 text-[#60A5FA] font-medium inline-flex items-center gap-1">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Verificando {progress.current} de {progress.total}...
                </span>
              )}
            </div>

            <Button
              type="button"
              disabled={isRunningAudit}
              onClick={handleStartAudit}
              className="h-8 px-4 text-xs font-bold bg-[#0052CC] hover:bg-[#003E99] text-white flex items-center gap-1.5 shadow-sm"
            >
              {isRunningAudit ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Auditando...
                </>
              ) : (
                <>
                  <RefreshCw className="h-3.5 w-3.5" />
                  {hasRunOnce ? 'Repetir Verificação' : 'Iniciar Verificação'}
                </>
              )}
            </Button>
          </div>

          {/* Barra de Busca de Suspeitos */}
          {hasRunOnce && suspects.length > 0 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <Input
                placeholder="Filtrar suspeitos por nome, endereço ou motivo..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 h-8 text-xs bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500 rounded-lg"
              />
            </div>
          )}

          {/* Lista de Resultados da Auditoria */}
          {hasRunOnce && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300 font-heading">
                  Resultados Encontrados ({suspects.length})
                </span>
                {suspects.length === 0 ? (
                  <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[10px]">
                    100% Calibrado
                  </Badge>
                ) : (
                  <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40 text-[10px]">
                    Requer Atenção
                  </Badge>
                )}
              </div>

              {suspects.length === 0 ? (
                <div className="py-8 text-center text-slate-400 rounded-xl bg-[#0A1128] border border-[#1E2B58] space-y-1">
                  <CheckCircle2 className="h-8 w-8 mx-auto text-emerald-400 mb-1" />
                  <p className="text-xs font-semibold text-white">Nenhum endereço suspeito!</p>
                  <p className="text-[11px] text-slate-400">
                    Todas as coordenadas cadastradas coincidem com as cidades informadas.
                  </p>
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {filteredSuspects.map((item) => (
                    <div
                      key={item.customer.id}
                      className="p-3 rounded-xl bg-[#0A1128] border border-[#1E2B58] hover:border-amber-500/50 transition-all space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h4 className="font-bold text-xs text-white">{item.customer.name}</h4>
                          <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                            <MapPin className="h-3 w-3 text-[#FF6B35] shrink-0" />
                            {item.customer.address || item.customer.street || 'Sem endereço'}
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            onOpenChange(false)
                            onEditCustomer(item.customer)
                          }}
                          className="h-7 px-2.5 text-[11px] font-bold bg-[#0052CC] hover:bg-[#003E99] text-white flex items-center gap-1"
                        >
                          <Edit className="h-3 w-3" />
                          Revisar Cadastro
                        </Button>
                      </div>

                      <div className="p-2 rounded-lg bg-[#070D1E] border border-amber-500/30 text-[11px] text-amber-200/90 space-y-1">
                        <p className="font-semibold text-amber-300">{item.reason}</p>
                        {item.returnedAddress && (
                          <p className="text-slate-400">
                            Local retornado pelo mapa:{' '}
                            <span className="text-slate-300 font-mono text-[10px]">
                              {item.returnedAddress}
                            </span>
                          </p>
                        )}
                        <div className="flex items-center gap-3 pt-1 text-[10px]">
                          <span className="text-slate-400">
                            Coordenada:{' '}
                            <span className="font-mono text-slate-200">
                              {item.customer.lat?.toFixed(5)}, {item.customer.lng?.toFixed(5)}
                            </span>
                          </span>
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${item.customer.lat},${item.customer.lng}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#60A5FA] hover:underline inline-flex items-center gap-0.5"
                          >
                            Ver no Google Maps <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="pt-3 border-t border-[#1E2B58]">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-[#1E2B58] text-slate-300 hover:bg-[#1E2B58] hover:text-white text-xs h-8"
          >
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

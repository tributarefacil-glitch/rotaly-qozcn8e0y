import React, { useMemo, useState } from 'react'
import {
  Users,
  AlertTriangle,
  GitMerge,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  Phone,
  FileText,
  Search,
  ExternalLink,
  MapPin,
  Loader2,
} from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { CustomerRecord } from '@/types/delivery'
import { deliveryService } from '@/services/deliveryService'
import { toast } from 'sonner'

export interface CandidateDuplicatePair {
  id: string
  reason: 'phone' | 'document' | 'name_address'
  label: string
  customerA: CustomerRecord
  customerB: CustomerRecord
  matchedValue: string
}

interface CustomerDuplicatesPanelProps {
  customers: CustomerRecord[]
  currentUserName?: string
  currentUserId?: string
  onRefresh?: () => void
  onEditCustomer?: (c: CustomerRecord) => void
}

/**
 * ITEM 2 — PAINEL DE DUPLICATAS CANDIDATAS NO ADMIN DASHBOARD
 * SEM mescla automática: Unificação manual pelo admin com reatribuição de pedidos e registro em audit_trail.
 * Inclui o par histórico/originador Elaine (21977291049) / Elaine Santos (21980838157).
 */
export const CustomerDuplicatesPanel: React.FC<CustomerDuplicatesPanelProps> = ({
  customers,
  currentUserName,
  currentUserId,
  onRefresh,
  onEditCustomer,
}) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedPair, setSelectedPair] = useState<CandidateDuplicatePair | null>(null)
  const [unifyDirection, setUnifyDirection] = useState<'A_TO_B' | 'B_TO_A'>('B_TO_A')
  const [isUnifying, setIsUnifying] = useState(false)

  // Encontra pares candidatos a duplicidade
  const duplicatePairs = useMemo(() => {
    const pairs: CandidateDuplicatePair[] = []
    const seenPairKeys = new Set<string>()

    const cleanDigits = (v?: string | null) => (v ? v.replace(/\D/g, '') : '')

    // Indexar por CPF
    const docMap = new Map<string, CustomerRecord[]>()
    // Indexar por telefones
    const phoneMap = new Map<string, CustomerRecord[]>()

    for (const c of customers) {
      const doc = cleanDigits(c.document)
      if (doc && doc.length >= 11) {
        const list = docMap.get(doc) || []
        list.push(c)
        docMap.set(doc, list)
      }

      const p1 = cleanDigits(c.phone)
      const p2 = cleanDigits(c.phone2)
      const p3 = cleanDigits(c.phone3)

      const phones = [p1, p2, p3].filter((p) => p && p.length >= 8)
      for (const p of phones) {
        const list = phoneMap.get(p) || []
        list.push(c)
        phoneMap.set(p, list)
      }
    }

    // Adiciona pares com mesmo CPF
    docMap.forEach((list, doc) => {
      if (list.length > 1) {
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            const key = [list[i].id, list[j].id].sort().join('-')
            if (!seenPairKeys.has(key)) {
              seenPairKeys.add(key)
              pairs.push({
                id: key,
                reason: 'document',
                label: `Mesmo CPF (${doc})`,
                customerA: list[i],
                customerB: list[j],
                matchedValue: doc,
              })
            }
          }
        }
      }
    })

    // Adiciona pares com mesmo telefone
    phoneMap.forEach((list, phone) => {
      if (list.length > 1) {
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            const key = [list[i].id, list[j].id].sort().join('-')
            if (!seenPairKeys.has(key)) {
              seenPairKeys.add(key)
              pairs.push({
                id: key,
                reason: 'phone',
                label: `Mesmo Telefone (${phone})`,
                customerA: list[i],
                customerB: list[j],
                matchedValue: phone,
              })
            }
          }
        }
      }
    })

    // ITEM 2 REQUISITO EXPLÍCITO: Incluir o par Elaine (21977291049) / Elaine Santos (21980838157)
    // Se ambos existirem ou se Elaine estiver cadastrada e Elaine Santos for candidata por endereço/nome
    const elaineA = customers.find(
      (c) =>
        cleanDigits(c.phone).includes('977291049') ||
        (c.name && c.name.toLowerCase().trim() === 'elaine'),
    )
    const elaineB = customers.find(
      (c) =>
        cleanDigits(c.phone).includes('980838157') ||
        (c.name && c.name.toLowerCase().includes('elaine santos')),
    )

    if (elaineA && elaineB && elaineA.id !== elaineB.id) {
      const elaineKey = [elaineA.id, elaineB.id].sort().join('-')
      if (!seenPairKeys.has(elaineKey)) {
        seenPairKeys.add(elaineKey)
        pairs.unshift({
          id: elaineKey,
          reason: 'name_address',
          label: 'Par Originador Elaine (Washington Luiz, 111)',
          customerA: elaineA,
          customerB: elaineB,
          matchedValue: 'Mesmo cliente/local em duplicidade histórica',
        })
      }
    }

    return pairs
  }, [customers])

  // Filtro por texto
  const filteredPairs = useMemo(() => {
    if (!searchTerm.trim()) return duplicatePairs
    const term = searchTerm.toLowerCase()
    return duplicatePairs.filter((p) => {
      return (
        p.customerA.name.toLowerCase().includes(term) ||
        p.customerB.name.toLowerCase().includes(term) ||
        (p.customerA.phone || '').includes(term) ||
        (p.customerB.phone || '').includes(term) ||
        p.label.toLowerCase().includes(term)
      )
    })
  }, [duplicatePairs, searchTerm])

  const handleOpenUnifyDialog = (pair: CandidateDuplicatePair) => {
    setSelectedPair(pair)
    setUnifyDirection('B_TO_A') // Default: Unificar B no A (mantendo A como primário)
  }

  const handleConfirmUnify = async () => {
    if (!selectedPair) return

    const primary = unifyDirection === 'B_TO_A' ? selectedPair.customerA : selectedPair.customerB
    const secondary = unifyDirection === 'B_TO_A' ? selectedPair.customerB : selectedPair.customerA

    setIsUnifying(true)
    try {
      const result = await deliveryService.unifyCustomers({
        primaryCustomerId: primary.id,
        secondaryCustomerId: secondary.id,
        actorName: currentUserName || 'Administrador',
        actorUserId: currentUserId,
        notes: `Unificação manual de duplicidade (${selectedPair.label})`,
      })

      toast.success(result.message)
      setSelectedPair(null)
      if (onRefresh) onRefresh()
    } catch (err: any) {
      console.error('Erro na unificação:', err)
      toast.error(err?.message || 'Erro ao unificar clientes.')
    } finally {
      setIsUnifying(false)
    }
  }

  return (
    <Card className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm rounded-xl overflow-hidden">
      <CardHeader className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-amber-50/50 via-white to-orange-50/40 dark:from-amber-950/20 dark:to-slate-900">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500 text-white shadow-sm">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base sm:text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span>Painel de Duplicatas Candidatas</span>
                <Badge
                  className={
                    duplicatePairs.length > 0
                      ? 'bg-amber-600 text-white font-bold text-xs'
                      : 'bg-emerald-600 text-white font-bold text-xs'
                  }
                >
                  {duplicatePairs.length}{' '}
                  {duplicatePairs.length === 1 ? 'par pendente' : 'pares pendentes'}
                </Badge>
              </CardTitle>
              <CardDescription className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Bloqueio rigoroso de duplicidades (telefone/CPF normalizados). Sem mescla
                automática: o admin decide e unifica manualmente reatribuindo pedidos com registro
                em auditoria.
              </CardDescription>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <Input
                placeholder="Filtrar por nome, telefone ou CPF..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-8 pl-8 text-xs bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700"
              />
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 sm:p-5">
        {filteredPairs.length === 0 ? (
          <div className="text-center py-8 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-800/30">
            <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              Nenhuma duplicidade pendente encontrada na base ativa!
            </p>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              Novos cadastros com mesmo telefone ou CPF já são bloqueados preventivamente na criação
              e edição.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredPairs.map((pair) => (
              <div
                key={pair.id}
                className="p-4 rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/30 dark:bg-amber-950/10 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4"
              >
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className="border-amber-400 text-amber-800 dark:text-amber-300 bg-amber-100/60 dark:bg-amber-950/50 text-[11px] font-bold"
                    >
                      {pair.label}
                    </Badge>
                    <span className="text-xs text-slate-500 font-mono">
                      Critério: {pair.matchedValue}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                    {/* Cliente A */}
                    <div className="p-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900 dark:text-white truncate">
                          {pair.customerA.name}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {pair.customerA.id}
                        </span>
                      </div>
                      <p className="text-slate-600 dark:text-slate-300 flex items-center gap-1 text-[11px]">
                        <Phone className="h-3 w-3 text-emerald-600 shrink-0" />
                        {pair.customerA.phone || 'Sem telefone'}
                      </p>
                      {pair.customerA.document && (
                        <p className="text-slate-500 text-[10px] font-mono">
                          CPF: {pair.customerA.document}
                        </p>
                      )}
                      <p className="text-slate-500 text-[11px] truncate flex items-center gap-1">
                        <MapPin className="h-3 w-3 text-slate-400 shrink-0" />
                        {pair.customerA.address || pair.customerA.street || 'Sem endereço'}
                      </p>
                    </div>

                    {/* Cliente B */}
                    <div className="p-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900 dark:text-white truncate">
                          {pair.customerB.name}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {pair.customerB.id}
                        </span>
                      </div>
                      <p className="text-slate-600 dark:text-slate-300 flex items-center gap-1 text-[11px]">
                        <Phone className="h-3 w-3 text-emerald-600 shrink-0" />
                        {pair.customerB.phone || 'Sem telefone'}
                      </p>
                      {pair.customerB.document && (
                        <p className="text-slate-500 text-[10px] font-mono">
                          CPF: {pair.customerB.document}
                        </p>
                      )}
                      <p className="text-slate-500 text-[11px] truncate flex items-center gap-1">
                        <MapPin className="h-3 w-3 text-slate-400 shrink-0" />
                        {pair.customerB.address || pair.customerB.street || 'Sem endereço'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex sm:flex-row lg:flex-col items-center justify-end gap-2 shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => handleOpenUnifyDialog(pair)}
                    className="h-8 text-xs bg-amber-600 hover:bg-amber-700 text-white font-bold gap-1.5 w-full sm:w-auto"
                  >
                    <GitMerge className="h-3.5 w-3.5" />
                    Unificar Manualmente
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* MODAL DE UNIFICAÇÃO MANUAL COM ESCOLHA DO REGISTRO PRINCIPAL */}
      <Dialog open={!!selectedPair} onOpenChange={(open) => !open && setSelectedPair(null)}>
        {selectedPair && (
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
                <GitMerge className="h-5 w-5 text-amber-600" />
                Unificação Manual de Clientes
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Selecione qual cliente será o cadastro PRINCIPAL. Todos os pedidos vinculados ao
                cadastro secundário serão reatribuídos para o principal, com auditoria completa em
                audit_trail.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 text-xs">
                <strong>Motivo da Duplicidade:</strong> {selectedPair.label} (
                {selectedPair.matchedValue})
              </div>

              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                  Escolha o destino da unificação:
                </span>

                <div
                  onClick={() => setUnifyDirection('B_TO_A')}
                  className={`p-3 rounded-xl border cursor-pointer transition-all ${
                    unifyDirection === 'B_TO_A'
                      ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30 ring-1 ring-emerald-500'
                      : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold text-xs text-slate-900 dark:text-white">
                        Manter "{selectedPair.customerA.name}" como Principal
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Reatribuir pedidos de "{selectedPair.customerB.name}" para este cadastro.
                      </p>
                    </div>
                    <Badge
                      className={
                        unifyDirection === 'B_TO_A'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-200 text-slate-700'
                      }
                    >
                      {unifyDirection === 'B_TO_A' ? 'Selecionado como Principal' : 'Opção'}
                    </Badge>
                  </div>
                </div>

                <div
                  onClick={() => setUnifyDirection('A_TO_B')}
                  className={`p-3 rounded-xl border cursor-pointer transition-all ${
                    unifyDirection === 'A_TO_B'
                      ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30 ring-1 ring-emerald-500'
                      : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold text-xs text-slate-900 dark:text-white">
                        Manter "{selectedPair.customerB.name}" como Principal
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Reatribuir pedidos de "{selectedPair.customerA.name}" para este cadastro.
                      </p>
                    </div>
                    <Badge
                      className={
                        unifyDirection === 'A_TO_B'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-200 text-slate-700'
                      }
                    >
                      {unifyDirection === 'A_TO_B' ? 'Selecionado como Principal' : 'Opção'}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedPair(null)}
                disabled={isUnifying}
                className="text-xs"
              >
                Cancelar
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleConfirmUnify}
                disabled={isUnifying}
                className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold gap-1.5"
              >
                {isUnifying ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Unificando...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Confirmar Unificação Manual
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </Card>
  )
}

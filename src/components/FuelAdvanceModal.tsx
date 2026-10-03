import React, { useState, useMemo, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Wallet,
  Ban,
  SlidersHorizontal,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  CreditCard,
  PlusCircle,
  HelpCircle,
  TrendingUp,
  TrendingDown,
} from 'lucide-react'
import { toast } from 'sonner'
import { deliveryService } from '@/services/deliveryService'
import { fuelAccountService } from '@/services/fuelAccountService'
import { getErrorMessage } from '@/lib/pocketbase/errors'
import type {
  UserRecord,
  FuelAdvanceRecord,
  FuelPaymentMethod,
  OrderRecord,
  AppSettingsRecord,
  LocationRecord,
  OffRouteEventRecord,
} from '@/types/delivery'

export interface FuelAdvanceModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  couriers: UserRecord[]
  advances: FuelAdvanceRecord[]
  orders?: OrderRecord[]
  settings?: Partial<AppSettingsRecord> | null
  locations?: LocationRecord[]
  offRouteEvents?: OffRouteEventRecord[]
  userRole?: string
  currentUserId?: string
  onSuccess?: () => Promise<void> | void
  initialCourierId?: string
}

export const FuelAdvanceModal: React.FC<FuelAdvanceModalProps> = ({
  open,
  onOpenChange,
  couriers,
  advances,
  orders = [],
  settings = null,
  locations = [],
  offRouteEvents = [],
  userRole = 'admin',
  currentUserId,
  onSuccess,
  initialCourierId = '',
}) => {
  const isAdminOrMaster = userRole === 'admin' || userRole === 'master'

  // Tab state
  const [activeTab, setActiveTab] = useState<'create' | 'cancel' | 'adjust'>('create')

  // Shared courier selection
  const [selectedCourierId, setSelectedCourierId] = useState<string>(initialCourierId)

  // Sync initialCourierId when modal opens
  useEffect(() => {
    if (open) {
      if (initialCourierId) {
        setSelectedCourierId(initialCourierId)
      } else if (!selectedCourierId && couriers.length > 0) {
        setSelectedCourierId(couriers[0].id)
      }
    }
  }, [open, initialCourierId, couriers])

  // ================= TAB 1: LANÇAR ADIANTAMENTO =================
  const [createAmount, setCreateAmount] = useState('')
  const [createDate, setCreateDate] = useState(() => new Date().toISOString().split('T')[0])
  const [createPaymentMethod, setCreatePaymentMethod] = useState<FuelPaymentMethod>('pix')
  const [createNotes, setCreateNotes] = useState('')
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false)

  // ================= TAB 2: CANCELAR ADIANTAMENTO =================
  const [selectedAdvanceIdToCancel, setSelectedAdvanceIdToCancel] = useState<string>('')
  const [cancellationReason, setCancellationReason] = useState('')
  const [isConfirmCancelDialogOpen, setIsConfirmCancelDialogOpen] = useState(false)
  const [isSubmittingCancel, setIsSubmittingCancel] = useState(false)

  // ================= TAB 3: AJUSTAR SALDO =================
  const [adjustmentMode, setAdjustmentMode] = useState<'target' | 'delta'>('target')
  const [targetBalanceInput, setTargetBalanceInput] = useState('')
  const [deltaAmountInput, setDeltaAmountInput] = useState('')
  const [adjustmentReason, setAdjustmentReason] = useState('')
  const [adjustmentPaymentMethod, setAdjustmentPaymentMethod] = useState<FuelPaymentMethod>('outro')
  const [isSubmittingAdjustment, setIsSubmittingAdjustment] = useState(false)

  // Current selected courier object
  const currentCourier = useMemo(() => {
    return couriers.find((c) => c.id === selectedCourierId) || null
  }, [couriers, selectedCourierId])

  // Real-time calculation of current courier balance using official engine
  const currentCourierAccount = useMemo(() => {
    if (!currentCourier) return null
    return fuelAccountService.calculateAccountForCourier({
      courier: currentCourier,
      advances,
      orders,
      settings,
      locations,
      offRouteEvents,
      periodFilter: 'month',
    })
  }, [currentCourier, advances, orders, settings, locations, offRouteEvents])

  const currentBalance = currentCourierAccount ? currentCourierAccount.balance : 0

  // Filter active advances of selected courier for Tab 2
  const activeAdvancesForSelectedCourier = useMemo(() => {
    if (!selectedCourierId) return []
    return advances.filter((adv) => {
      const isThisCourier = adv.courier_id === selectedCourierId
      const isActive = adv.status === 'active' || !adv.status
      const isAdvance = adv.entry_type === 'advance' || !adv.entry_type
      return isThisCourier && isActive && isAdvance
    })
  }, [advances, selectedCourierId])

  // The advance chosen to cancel
  const advanceToCancel = useMemo(() => {
    return advances.find((a) => a.id === selectedAdvanceIdToCancel) || null
  }, [advances, selectedAdvanceIdToCancel])

  // Preview balances for Cancel tab
  const cancelNewBalance = useMemo(() => {
    if (!advanceToCancel) return currentBalance
    const advAmount = Number(advanceToCancel.amount) || 0
    return Number((currentBalance - advAmount).toFixed(2))
  }, [currentBalance, advanceToCancel])

  // Preview balances for Adjustment tab
  const computedAdjustment = useMemo(() => {
    let delta = 0
    let target = currentBalance

    if (adjustmentMode === 'target') {
      const parsedTarget = parseFloat(targetBalanceInput.replace(',', '.'))
      if (!isNaN(parsedTarget)) {
        target = parsedTarget
        delta = Number((target - currentBalance).toFixed(2))
      }
    } else {
      const parsedDelta = parseFloat(deltaAmountInput.replace(',', '.'))
      if (!isNaN(parsedDelta)) {
        delta = parsedDelta
        target = Number((currentBalance + delta).toFixed(2))
      }
    }

    return { delta, target }
  }, [adjustmentMode, targetBalanceInput, deltaAmountInput, currentBalance])

  // -------------------------------------------------------------
  // HANDLERS
  // -------------------------------------------------------------

  // Reset internal forms when closed
  const handleDialogClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      setCreateAmount('')
      setCreateNotes('')
      setSelectedAdvanceIdToCancel('')
      setCancellationReason('')
      setTargetBalanceInput('')
      setDeltaAmountInput('')
      setAdjustmentReason('')
      setIsConfirmCancelDialogOpen(false)
    }
    onOpenChange(nextOpen)
  }

  // 1. Submit Create Fuel Advance
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedCourierId) {
      toast.error('Selecione o entregador.')
      return
    }

    const amountNum = parseFloat(createAmount.replace(',', '.'))
    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error('Informe um valor de adiantamento válido.')
      return
    }

    setIsSubmittingCreate(true)
    try {
      await deliveryService.createFuelAdvance({
        courier_id: selectedCourierId,
        amount: amountNum,
        date: createDate,
        payment_method: createPaymentMethod,
        notes: createNotes.trim(),
        created_by: currentUserId,
      })

      const courierName = currentCourier?.name || 'o entregador'
      toast.success(
        `Adiantamento de R$ ${amountNum.toFixed(2)} cadastrado com sucesso para ${courierName}!`,
      )

      setCreateAmount('')
      setCreateNotes('')
      handleDialogClose(false)

      if (onSuccess) {
        await onSuccess()
      }
    } catch (err) {
      console.error('Erro ao cadastrar adiantamento:', err)
      toast.error('Erro ao cadastrar adiantamento de combustível.')
    } finally {
      setIsSubmittingCreate(false)
    }
  }

  // 2. Submit Cancel Fuel Advance
  const handleCancelSubmit = async () => {
    if (!advanceToCancel) {
      toast.error('Selecione o adiantamento que deseja cancelar.')
      return
    }

    if (!cancellationReason.trim()) {
      toast.error('A justificativa de cancelamento é obrigatória.')
      return
    }

    setIsSubmittingCancel(true)
    try {
      await deliveryService.cancelFuelAdvance({
        id: advanceToCancel.id,
        cancellationReason: cancellationReason.trim(),
        cancelledBy: currentUserId || '',
        previousBalance: currentBalance,
      })

      const courierName = currentCourier?.name || 'o entregador'
      toast.success(
        `Adiantamento cancelado — saldo de ${courierName} atualizado para R$ ${cancelNewBalance.toFixed(2)}!`,
      )

      setIsConfirmCancelDialogOpen(false)
      setSelectedAdvanceIdToCancel('')
      setCancellationReason('')
      handleDialogClose(false)

      if (onSuccess) {
        await onSuccess()
      }
    } catch (err) {
      console.error('Erro ao cancelar adiantamento:', err)
      toast.error('Erro ao cancelar adiantamento de combustível.')
    } finally {
      setIsSubmittingCancel(false)
    }
  }

  // 3. Submit Balance Adjustment
  const handleAdjustmentSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedCourierId) {
      toast.error('Selecione o entregador.')
      return
    }

    const { delta, target } = computedAdjustment
    if (delta === 0) {
      toast.error('O ajuste precisa alterar o saldo atual (delta diferente de zero).')
      return
    }

    if (!adjustmentReason.trim()) {
      toast.error('Informe a justificativa obrigatória do ajuste.')
      return
    }

    setIsSubmittingAdjustment(true)
    try {
      await deliveryService.createBalanceAdjustment({
        courierId: selectedCourierId,
        amountDelta: delta,
        targetBalance: target,
        previousBalance: currentBalance,
        reason: adjustmentReason.trim(),
        createdBy: currentUserId || '',
        paymentMethod: adjustmentPaymentMethod,
      })

      const courierName = currentCourier?.name || 'o entregador'
      toast.success(
        `Saldo ajustado com sucesso para ${courierName}! Novo saldo: R$ ${target.toFixed(2)}`,
      )

      setTargetBalanceInput('')
      setDeltaAmountInput('')
      setAdjustmentReason('')
      handleDialogClose(false)

      if (onSuccess) {
        await onSuccess()
      }
    } catch (err) {
      console.error('Erro ao ajustar saldo:', err)
      const errorMsg = getErrorMessage(err)
      toast.error(
        errorMsg
          ? `Erro ao realizar ajuste de saldo: ${errorMsg}`
          : 'Erro ao realizar ajuste de saldo.',
      )
    } finally {
      setIsSubmittingAdjustment(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleDialogClose}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
              <Wallet className="h-5 w-5 text-emerald-600" />
              Gestão Financeira de Combustível do Entregador
            </DialogTitle>
            <DialogDescription className="text-xs">
              Lançamentos, cancelamento de pagamentos antecipados e ajuste de saldo de conta
              corrente.
            </DialogDescription>
          </DialogHeader>

          {/* Seletor de entregador unificado */}
          <div className="space-y-1.5 pt-1 pb-2 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Entregador Beneficiário *
              </label>
              {currentCourier && (
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-slate-500">Saldo Atual (Mês):</span>
                  <Badge
                    variant="outline"
                    className={`font-mono font-bold text-xs ${
                      currentBalance >= 0
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                        : 'border-rose-300 bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
                    }`}
                  >
                    R$ {currentBalance.toFixed(2)}
                  </Badge>
                </div>
              )}
            </div>
            <Select
              value={selectedCourierId}
              onValueChange={(val) => {
                setSelectedCourierId(val)
                setSelectedAdvanceIdToCancel('')
              }}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Selecione o entregador" />
              </SelectTrigger>
              <SelectContent>
                {couriers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    🛵 {c.name || c.email} ({c.vehicle_plate || 'Sem placa'} •{' '}
                    {c.vehicle_type || 'moto'})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as 'create' | 'cancel' | 'adjust')}
            className="w-full pt-1"
          >
            <TabsList className="grid grid-cols-3 bg-slate-100 dark:bg-slate-800 h-9 p-1 rounded-lg">
              <TabsTrigger
                value="create"
                className="text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-emerald-700 dark:data-[state=active]:bg-slate-900 dark:data-[state=active]:text-emerald-400 gap-1.5"
              >
                <PlusCircle className="h-3.5 w-3.5" />
                Lançar
              </TabsTrigger>

              <TabsTrigger
                value="cancel"
                disabled={!isAdminOrMaster}
                className="text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-rose-700 dark:data-[state=active]:bg-slate-900 dark:data-[state=active]:text-rose-400 gap-1.5 disabled:opacity-50"
                title={!isAdminOrMaster ? 'Apenas administradores podem cancelar' : ''}
              >
                <Ban className="h-3.5 w-3.5" />
                Cancelar {!isAdminOrMaster && '(Admin)'}
              </TabsTrigger>

              <TabsTrigger
                value="adjust"
                disabled={!isAdminOrMaster}
                className="text-xs font-semibold data-[state=active]:bg-white data-[state=active]:text-blue-700 dark:data-[state=active]:bg-slate-900 dark:data-[state=active]:text-blue-400 gap-1.5 disabled:opacity-50"
                title={!isAdminOrMaster ? 'Apenas administradores podem ajustar saldo' : ''}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Ajustar Saldo {!isAdminOrMaster && '(Admin)'}
              </TabsTrigger>
            </TabsList>

            {/* ================= ABA 1: LANÇAR ADIANTAMENTO ================= */}
            <TabsContent value="create" className="pt-3">
              <form onSubmit={handleCreateSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Valor Pago (R$) *
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                        R$
                      </span>
                      <Input
                        type="number"
                        step="0.01"
                        min="0.01"
                        placeholder="0,00"
                        value={createAmount}
                        onChange={(e) => setCreateAmount(e.target.value)}
                        className="h-9 pl-9 font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Data do Pagamento *
                    </label>
                    <Input
                      type="date"
                      value={createDate}
                      onChange={(e) => setCreateDate(e.target.value)}
                      className="h-9 text-xs"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Forma de Pagamento
                  </label>
                  <Select
                    value={createPaymentMethod}
                    onValueChange={(v: FuelPaymentMethod) => setCreatePaymentMethod(v)}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pix">PIX Instantâneo</SelectItem>
                      <SelectItem value="dinheiro">Dinheiro em Espécie</SelectItem>
                      <SelectItem value="transferencia">Transferência / TED</SelectItem>
                      <SelectItem value="outro">Outro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Observações / Descrição
                  </label>
                  <Input
                    placeholder="Ex: Adiantamento semanal de gasolina ou abastecimento extra"
                    value={createNotes}
                    onChange={(e) => setCreateNotes(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>

                {/* Prévia do saldo futuro */}
                {createAmount && !isNaN(parseFloat(createAmount.replace(',', '.'))) && (
                  <div className="p-3 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 text-xs flex items-center justify-between">
                    <span className="text-emerald-800 dark:text-emerald-300 font-medium">
                      Prévia do Saldo com este Adiantamento:
                    </span>
                    <div className="flex items-center gap-2 font-mono font-bold">
                      <span className="text-slate-500">R$ {currentBalance.toFixed(2)}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-emerald-600" />
                      <span className="text-emerald-700 dark:text-emerald-400">
                        R${' '}
                        {(currentBalance + parseFloat(createAmount.replace(',', '.'))).toFixed(2)}
                      </span>
                    </div>
                  </div>
                )}

                <DialogFooter className="pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleDialogClose(false)}
                    className="h-9 text-xs"
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    disabled={isSubmittingCreate || !selectedCourierId}
                    className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5 shadow-md shadow-emerald-600/20"
                  >
                    {isSubmittingCreate ? 'Gravando...' : 'Confirmar Adiantamento'}
                  </Button>
                </DialogFooter>
              </form>
            </TabsContent>

            {/* ================= ABA 2: CANCELAR ADIANTAMENTO ================= */}
            <TabsContent value="cancel" className="pt-3 space-y-4">
              <div className="p-2.5 rounded-lg bg-rose-50/80 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-xs text-rose-800 dark:text-rose-300 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                <p>
                  O estorno cancela o registro de adiantamento sem apagar o histórico de auditoria.
                  O valor será imediatamente <strong>subtraído</strong> da conta corrente do
                  entregador.
                </p>
              </div>

              {activeAdvancesForSelectedCourier.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500 border border-dashed rounded-lg">
                  <Ban className="h-8 w-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                  Nenhum adiantamento ativo encontrado para este entregador.
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Selecione o Adiantamento a Estornar *
                    </label>
                    <div className="max-h-48 overflow-y-auto space-y-1.5 border border-slate-200 dark:border-slate-800 rounded-lg p-1.5">
                      {activeAdvancesForSelectedCourier.map((adv) => {
                        const isSelected = selectedAdvanceIdToCancel === adv.id
                        const amountNum = Number(adv.amount || 0)
                        return (
                          <div
                            key={adv.id}
                            onClick={() => setSelectedAdvanceIdToCancel(adv.id)}
                            className={`p-2.5 rounded-md border text-xs cursor-pointer transition flex items-center justify-between ${
                              isSelected
                                ? 'border-rose-500 bg-rose-50/70 dark:bg-rose-950/40 text-rose-900 dark:text-rose-100 font-medium'
                                : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                            }`}
                          >
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-rose-600 dark:text-rose-400">
                                  R$ {amountNum.toFixed(2)}
                                </span>
                                <Badge
                                  variant="outline"
                                  className="text-[10px] uppercase font-mono"
                                >
                                  {adv.payment_method || 'PIX'}
                                </Badge>
                              </div>
                              <p className="text-[11px] text-slate-500 truncate max-w-[280px]">
                                {adv.notes || 'Adiantamento de combustível'}
                              </p>
                            </div>
                            <div className="text-right text-[11px] text-slate-400 flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              <span>
                                {adv.date
                                  ? new Date(adv.date).toLocaleDateString('pt-BR')
                                  : new Date(adv.created).toLocaleDateString('pt-BR')}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {advanceToCancel && (
                    <>
                      {/* Prévia do Saldo com Estorno */}
                      <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-600 dark:text-slate-400">
                            Valor do Adiantamento a Estornar:
                          </span>
                          <span className="font-mono font-bold text-rose-600">
                            - R$ {Number(advanceToCancel.amount || 0).toFixed(2)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between pt-1 border-t border-slate-200 dark:border-slate-800">
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            Impacto no Saldo:
                          </span>
                          <div className="flex items-center gap-2 font-mono font-bold">
                            <span className="text-slate-500">R$ {currentBalance.toFixed(2)}</span>
                            <ArrowRight className="h-3.5 w-3.5 text-rose-500" />
                            <span
                              className={
                                cancelNewBalance >= 0 ? 'text-emerald-600' : 'text-rose-600'
                              }
                            >
                              R$ {cancelNewBalance.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                          Justificativa do Cancelamento *
                          <span className="text-[10px] text-rose-500 font-normal">
                            (obrigatório para auditoria)
                          </span>
                        </label>
                        <Textarea
                          placeholder="Informe detalhadamente o motivo do estorno (ex: adiantamento lançado em duplicidade, comprovante inválido...)"
                          value={cancellationReason}
                          onChange={(e) => setCancellationReason(e.target.value)}
                          className="text-xs min-h-[70px]"
                          required
                        />
                      </div>
                    </>
                  )}

                  <DialogFooter className="pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleDialogClose(false)}
                      className="h-9 text-xs"
                    >
                      Voltar
                    </Button>
                    <Button
                      type="button"
                      disabled={
                        !selectedAdvanceIdToCancel ||
                        !cancellationReason.trim() ||
                        isSubmittingCancel
                      }
                      onClick={() => setIsConfirmCancelDialogOpen(true)}
                      className="h-9 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs gap-1.5 shadow-md shadow-rose-600/20"
                    >
                      Estornar / Cancelar Adiantamento
                    </Button>
                  </DialogFooter>
                </div>
              )}
            </TabsContent>

            {/* ================= ABA 3: AJUSTAR SALDO ================= */}
            <TabsContent value="adjust" className="pt-3 space-y-4">
              <form onSubmit={handleAdjustmentSubmit} className="space-y-4">
                <div className="p-2.5 rounded-lg bg-blue-50/80 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 text-xs text-blue-800 dark:text-blue-300 flex items-start gap-2">
                  <CreditCard className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                  <p>
                    O ajuste direto cria um lançamento especial de compensação na conta corrente.
                    Pode ser usado para fixar o saldo no valor correto ou lançar um crédito/débito
                    avulso com rastreabilidade total.
                  </p>
                </div>

                {/* Modo de ajuste */}
                <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setAdjustmentMode('target')
                      setDeltaAmountInput('')
                    }}
                    className={`h-8 rounded-md text-xs font-semibold transition flex items-center justify-center gap-1.5 ${
                      adjustmentMode === 'target'
                        ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                    }`}
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    Definir Saldo Final Alvo
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAdjustmentMode('delta')
                      setTargetBalanceInput('')
                    }}
                    className={`h-8 rounded-md text-xs font-semibold transition flex items-center justify-center gap-1.5 ${
                      adjustmentMode === 'delta'
                        ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                    }`}
                  >
                    <TrendingUp className="h-3.5 w-3.5" />
                    Crédito / Débito Avulso
                  </button>
                </div>

                {adjustmentMode === 'target' ? (
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                      <span>Novo Saldo Alvo da Conta Corrente (R$) *</span>
                      <span className="text-[11px] text-slate-500 font-normal">
                        Atual: R$ {currentBalance.toFixed(2)}
                      </span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                        R$
                      </span>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0,00"
                        value={targetBalanceInput}
                        onChange={(e) => setTargetBalanceInput(e.target.value)}
                        className="h-9 pl-9 font-mono text-xs font-bold text-blue-600 dark:text-blue-400"
                        required
                      />
                    </div>
                    <p className="text-[11px] text-slate-500">
                      O sistema criará automaticamente uma entrada de ajuste para que o saldo passe
                      a ser exatamente o valor digitado.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                      <span>Valor do Ajuste (R$) *</span>
                      <span className="text-[11px] text-slate-500 font-normal">
                        Positivo = Crédito, Negativo = Débito
                      </span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                        R$
                      </span>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="Ex: 50.00 ou -30.00"
                        value={deltaAmountInput}
                        onChange={(e) => setDeltaAmountInput(e.target.value)}
                        className="h-9 pl-9 font-mono text-xs font-bold text-blue-600 dark:text-blue-400"
                        required
                      />
                    </div>
                  </div>
                )}

                {/* Prévia do Ajuste */}
                {computedAdjustment.delta !== 0 && (
                  <div className="p-3 rounded-lg bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-blue-800 dark:text-blue-300 font-medium flex items-center gap-1.5">
                        {computedAdjustment.delta > 0 ? (
                          <>
                            <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
                            Crédito a ser aplicado:
                          </>
                        ) : (
                          <>
                            <TrendingDown className="h-3.5 w-3.5 text-rose-600" />
                            Débito a ser aplicado:
                          </>
                        )}
                      </span>
                      <span
                        className={`font-mono font-bold ${
                          computedAdjustment.delta > 0 ? 'text-emerald-600' : 'text-rose-600'
                        }`}
                      >
                        {computedAdjustment.delta > 0 ? '+' : ''} R${' '}
                        {computedAdjustment.delta.toFixed(2)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-blue-200/60 dark:border-blue-800">
                      <span className="text-slate-600 dark:text-slate-400 font-semibold">
                        Saldo Resultante:
                      </span>
                      <div className="flex items-center gap-2 font-mono font-bold">
                        <span className="text-slate-500">R$ {currentBalance.toFixed(2)}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-blue-600" />
                        <span
                          className={
                            computedAdjustment.target >= 0 ? 'text-emerald-600' : 'text-rose-600'
                          }
                        >
                          R$ {computedAdjustment.target.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Forma de Registro
                    </label>
                    <Select
                      value={adjustmentPaymentMethod}
                      onValueChange={(v: FuelPaymentMethod) => setAdjustmentPaymentMethod(v)}
                    >
                      <SelectTrigger className="h-9 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="outro">Ajuste Contábil / Outro</SelectItem>
                        <SelectItem value="pix">PIX</SelectItem>
                        <SelectItem value="dinheiro">Dinheiro</SelectItem>
                        <SelectItem value="transferencia">Transferência</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                      Justificativa Obrigatória *
                    </label>
                    <Input
                      placeholder="Ex: Correção de saldo inicial, compensação manual..."
                      value={adjustmentReason}
                      onChange={(e) => setAdjustmentReason(e.target.value)}
                      className="h-9 text-xs"
                      required
                    />
                  </div>
                </div>

                <DialogFooter className="pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleDialogClose(false)}
                    className="h-9 text-xs"
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      isSubmittingAdjustment ||
                      computedAdjustment.delta === 0 ||
                      !adjustmentReason.trim() ||
                      !selectedCourierId
                    }
                    className="h-9 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs gap-1.5 shadow-md shadow-blue-600/20"
                  >
                    {isSubmittingAdjustment ? 'Gravando Ajuste...' : 'Aplicar Ajuste de Saldo'}
                  </Button>
                </DialogFooter>
              </form>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* CONFIRMAÇÃO SECUNDÁRIA DE CANCELAMENTO (ESTORNO) */}
      <AlertDialog open={isConfirmCancelDialogOpen} onOpenChange={setIsConfirmCancelDialogOpen}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-rose-600 text-base font-bold">
              <AlertTriangle className="h-5 w-5" />
              Confirmar Estorno de Adiantamento?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs space-y-2 text-slate-600 dark:text-slate-300">
              <p>
                Esta operação irá cancelar permanentemente o adiantamento de{' '}
                <strong className="text-rose-600 font-mono">
                  R$ {Number(advanceToCancel?.amount || 0).toFixed(2)}
                </strong>{' '}
                do entregador <strong>{currentCourier?.name || 'selecionado'}</strong>.
              </p>
              <div className="p-2.5 rounded-md bg-slate-100 dark:bg-slate-900 border text-xs">
                <div>
                  <strong>Saldo Anterior:</strong> R$ {currentBalance.toFixed(2)}
                </div>
                <div>
                  <strong>Novo Saldo após Estorno:</strong> R$ {cancelNewBalance.toFixed(2)}
                </div>
                <div className="mt-1 pt-1 border-t text-[11px] text-slate-500">
                  <strong>Motivo:</strong> {cancellationReason}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmittingCancel} className="text-xs">
              Voltar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isSubmittingCancel}
              onClick={handleCancelSubmit}
              className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs"
            >
              {isSubmittingCancel ? 'Estornando...' : 'Sim, Confirmar Estorno'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

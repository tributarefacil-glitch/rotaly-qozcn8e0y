import React, { useState, useEffect } from 'react'
import {
  BarChart3,
  TrendingUp,
  Clock,
  Truck,
  Users,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  UserPlus,
  ArrowUpRight,
  RefreshCw,
  Bell,
  Sparkles,
  Search,
  Filter,
  FileText,
  Camera,
  Check,
  XCircle,
  Eye,
  Phone,
  Mail,
  Car,
  AlertCircle,
  Ban,
  UserCheck,
  Download,
  ExternalLink,
} from 'lucide-react'
import { Header } from '@/components/Header'
import { Sidebar } from '@/components/Sidebar'
import { AiLogisticsAssistant } from '@/components/AiLogisticsAssistant'
import { deliveryService } from '@/services/deliveryService'
import type { OrderRecord, UserRecord, NotificationRecord, VehicleType } from '@/types/delivery'
import { getErrorMessage } from '@/lib/pocketbase/errors'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import pb from '@/lib/pocketbase/client'

export default function AdminDashboard() {
  const [orders, setOrders] = useState<OrderRecord[]>([])
  const [users, setUsers] = useState<UserRecord[]>([])
  const [notifications, setNotifications] = useState<NotificationRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Filter & Search states for Users lists
  const [activeTab, setActiveTab] = useState<'overview' | 'couriers' | 'sellers'>('overview')
  const [searchCouriers, setSearchCouriers] = useState('')
  const [courierStatusFilter, setCourierStatusFilter] = useState<string>('all')
  const [searchSellers, setSearchSellers] = useState('')

  // View Documents Modal state
  const [selectedUserForDocs, setSelectedUserForDocs] = useState<UserRecord | null>(null)
  const [isDocsModalOpen, setIsDocsModalOpen] = useState(false)

  // New user modal state
  const [isNewUserModalOpen, setIsNewUserModalOpen] = useState(false)
  const [newUserName, setNewUserName] = useState('')
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserPhone, setNewUserPhone] = useState('')
  const [newUserPassword, setNewUserPassword] = useState('Skip@Pass')
  const [newUserRole, setNewUserRole] = useState<'seller' | 'courier'>('courier')
  const [newUserVehicleType, setNewUserVehicleType] = useState<VehicleType>('moto')
  const [newUserVehicleModel, setNewUserVehicleModel] = useState('')
  const [newUserVehiclePlate, setNewUserVehiclePlate] = useState('')
  const [isCreatingUser, setIsCreatingUser] = useState(false)

  // Status changing state
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null)

  const loadData = async () => {
    try {
      setIsLoading(true)
      const [ordersData, usersData, notifsData] = await Promise.all([
        deliveryService.getOrders(),
        deliveryService.getAllUsers(),
        deliveryService.getNotifications(),
      ])
      setOrders(ordersData)
      setUsers(usersData)
      setNotifications(notifsData)
    } catch (err) {
      console.error('Error loading admin data:', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // Change user status (approve pending -> active, deactivate active -> inactive, activate inactive -> active)
  const handleUpdateUserStatus = async (
    targetUser: UserRecord,
    newStatus: 'active' | 'inactive' | 'pending',
  ) => {
    setUpdatingUserId(targetUser.id)
    try {
      await deliveryService.updateUser(targetUser.id, {
        status: newStatus,
      })

      // Update state locally
      setUsers((prev) =>
        prev.map((u) => (u.id === targetUser.id ? { ...u, status: newStatus } : u)),
      )

      if (newStatus === 'active') {
        toast.success(`Cadastro de ${targetUser.name || 'usuário'} aprovado e ativado!`)
      } else if (newStatus === 'inactive') {
        toast.warning(`Usuário ${targetUser.name || 'usuário'} desativado/bloqueado.`)
      } else {
        toast.info(`Status alterado para ${newStatus}.`)
      }

      // If document modal was open for this user, update selected user
      if (selectedUserForDocs && selectedUserForDocs.id === targetUser.id) {
        setSelectedUserForDocs((prev) => (prev ? { ...prev, status: newStatus } : null))
      }
    } catch (err: unknown) {
      console.error('Error updating status:', err)
      toast.error('Falha ao atualizar status do usuário.')
    } finally {
      setUpdatingUserId(null)
    }
  }

  const handleOpenDocsModal = (user: UserRecord) => {
    setSelectedUserForDocs(user)
    setIsDocsModalOpen(true)
  }

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedName = newUserName.trim()
    const trimmedEmail = newUserEmail.trim().toLowerCase()
    const trimmedPhone = newUserPhone.trim()

    if (!trimmedName || !trimmedEmail) {
      toast.error('Preencha nome e e-mail.')
      return
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(trimmedEmail)) {
      toast.error('Por favor, insira um e-mail válido.')
      return
    }

    if (!newUserPassword || newUserPassword.length < 8) {
      toast.error('A senha deve ter pelo menos 8 caracteres.')
      return
    }

    setIsCreatingUser(true)
    try {
      await deliveryService.createUser({
        name: trimmedName,
        email: trimmedEmail,
        phone: trimmedPhone,
        password: newUserPassword,
        passwordConfirm: newUserPassword,
        role: newUserRole,
        status: 'active',
        ...(newUserRole === 'courier'
          ? {
              vehicle_type: newUserVehicleType,
              vehicle_model: newUserVehicleModel.trim(),
              vehicle_plate: newUserVehiclePlate.trim().toUpperCase(),
            }
          : {}),
      })

      toast.success(
        `Usuário ${trimmedName} (${newUserRole === 'courier' ? 'Entregador' : 'Vendedor'}) cadastrado com sucesso!`,
      )
      setIsNewUserModalOpen(false)
      setNewUserName('')
      setNewUserEmail('')
      setNewUserPhone('')
      setNewUserPassword('Skip@Pass')
      setNewUserVehicleModel('')
      setNewUserVehiclePlate('')
      loadData()
    } catch (err: unknown) {
      console.error('Error creating user:', err)
      const msg = getErrorMessage(err, 'Falha ao cadastrar novo usuário.')
      toast.error(msg)
    } finally {
      setIsCreatingUser(false)
    }
  }

  // Filtered lists
  const couriers = users.filter((u) => u.role === 'courier')
  const sellers = users.filter((u) => u.role === 'seller')

  const pendingCouriers = couriers.filter((c) => c.status === 'pending')
  const activeCouriers = couriers.filter(
    (c) => c.status === 'active' || c.status === 'idle' || c.status === 'busy',
  )
  const inactiveCouriers = couriers.filter((c) => c.status === 'inactive')

  const filteredCouriers = couriers.filter((c) => {
    const matchesSearch =
      c.name?.toLowerCase().includes(searchCouriers.toLowerCase()) ||
      c.email?.toLowerCase().includes(searchCouriers.toLowerCase()) ||
      c.vehicle_plate?.toLowerCase().includes(searchCouriers.toLowerCase()) ||
      c.phone?.includes(searchCouriers)

    if (!matchesSearch) return false

    if (courierStatusFilter === 'pending') return c.status === 'pending'
    if (courierStatusFilter === 'active')
      return c.status === 'active' || c.status === 'idle' || c.status === 'busy'
    if (courierStatusFilter === 'inactive') return c.status === 'inactive'

    return true
  })

  const filteredSellers = sellers.filter((s) => {
    return (
      s.name?.toLowerCase().includes(searchSellers.toLowerCase()) ||
      s.email?.toLowerCase().includes(searchSellers.toLowerCase()) ||
      s.phone?.includes(searchSellers)
    )
  })

  // Calculate High-level Metrics
  const totalOrders = orders.length
  const deliveredOrders = orders.filter((o) => o.status === 'delivered')
  const inTransitOrders = orders.filter((o) => o.status === 'in_transit')
  const pendingOrders = orders.filter((o) => o.status === 'pending')

  const totalSales = orders
    .filter((o) => o.status !== 'cancelled')
    .reduce((acc, o) => acc + (Number(o.total_price) || 0), 0)

  const successRate =
    totalOrders > 0 ? Math.round((deliveredOrders.length / totalOrders) * 100) : 100
  const busyCouriers = activeCouriers.filter(
    (c) => c.status === 'busy' || inTransitOrders.some((o) => o.courier_id === c.id),
  )
  const courierUtilizationRate =
    activeCouriers.length > 0 ? Math.round((busyCouriers.length / activeCouriers.length) * 100) : 0

  const daysOfWeek = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Hoje']
  const volumeByDay = [14, 18, 22, 19, 28, 35, orders.length]
  const maxDayVolume = Math.max(...volumeByDay, 40)

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
      <Header />

      <div className="flex flex-1">
        <Sidebar />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 space-y-6 overflow-y-auto max-w-[1600px] mx-auto w-full">
          {/* Header Title & Actions */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-6 w-6 text-blue-600" />
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                  Painel de Controle & Gestão de Acesso
                </h1>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
                Controle global de entregadores, vendedores, aprovações de documentos e telemetria.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={loadData}
                className="h-9 gap-1.5 text-xs"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                Atualizar
              </Button>
              <Button
                onClick={() => setIsNewUserModalOpen(true)}
                className="h-9 gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-md shadow-blue-500/25"
              >
                <UserPlus className="h-4 w-4" />
                Cadastrar Usuário
              </Button>
            </div>
          </div>

          {/* MAIN TABS (Overview, Entregadores, Vendedores) */}
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as 'overview' | 'couriers' | 'sellers')}
            className="space-y-6"
          >
            <TabsList className="bg-slate-200/80 dark:bg-slate-900 p-1 border border-slate-300/60 dark:border-slate-800 rounded-xl">
              <TabsTrigger
                value="overview"
                className="text-xs font-semibold data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800"
              >
                <BarChart3 className="h-3.5 w-3.5 mr-1.5" />
                Visão Geral & KPIs
              </TabsTrigger>
              <TabsTrigger
                value="couriers"
                className="text-xs font-semibold data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 relative"
              >
                <Truck className="h-3.5 w-3.5 mr-1.5" />
                Gestão de Entregadores ({couriers.length})
                {pendingCouriers.length > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.2 rounded-full bg-amber-500 text-slate-950 text-[10px] font-bold">
                    {pendingCouriers.length} pendentes
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="sellers"
                className="text-xs font-semibold data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800"
              >
                <Users className="h-3.5 w-3.5 mr-1.5" />
                Gestão de Vendedores ({sellers.length})
              </TabsTrigger>
            </TabsList>

            {/* TAB 1: OVERVIEW */}
            <TabsContent value="overview" className="space-y-6">
              {/* KPI CARDS */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* KPI 1: Total Sales */}
                <Card className="border-slate-200/80 dark:border-slate-800 shadow-sm">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Vendas Totais (Mês)
                      </span>
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600">
                        <DollarSign className="h-4 w-4" />
                      </div>
                    </div>
                    <p className="text-2xl font-black text-slate-900 dark:text-white mt-2">
                      R$ {totalSales.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </p>
                    <div className="flex items-center gap-1.5 mt-2 text-xs font-medium text-emerald-600">
                      <TrendingUp className="h-3.5 w-3.5" />
                      <span>+18.4% em relação à semana anterior</span>
                    </div>
                  </CardContent>
                </Card>

                {/* KPI 2: Average Delivery Time */}
                <Card className="border-slate-200/80 dark:border-slate-800 shadow-sm">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Tempo Médio de Entrega
                      </span>
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600">
                        <Clock className="h-4 w-4" />
                      </div>
                    </div>
                    <p className="text-2xl font-black text-slate-900 dark:text-white mt-2">
                      27.4 min
                    </p>
                    <div className="flex items-center gap-1.5 mt-2 text-xs font-medium text-emerald-600">
                      <TrendingUp className="h-3.5 w-3.5" />
                      <span>-4.2 min (otimização de rota ativa)</span>
                    </div>
                  </CardContent>
                </Card>

                {/* KPI 3: Courier Utilization Rate */}
                <Card className="border-slate-200/80 dark:border-slate-800 shadow-sm">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Entregadores Ativos
                      </span>
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-500/10 text-purple-600">
                        <Truck className="h-4 w-4" />
                      </div>
                    </div>
                    <p className="text-2xl font-black text-slate-900 dark:text-white mt-2">
                      {activeCouriers.length}
                    </p>
                    <div className="flex items-center gap-1.5 mt-2 text-xs text-amber-600 font-medium">
                      <span>{pendingCouriers.length} aguardando aprovação</span>
                    </div>
                  </CardContent>
                </Card>

                {/* KPI 4: Success Delivery Rate */}
                <Card className="border-slate-200/80 dark:border-slate-800 shadow-sm">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Taxa de Sucesso (SLA)
                      </span>
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
                        <CheckCircle2 className="h-4 w-4" />
                      </div>
                    </div>
                    <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-2">
                      {successRate}%
                    </p>
                    <div className="flex items-center gap-1.5 mt-2 text-xs font-medium text-emerald-600">
                      <span>99.2% dentro do horário estimado</span>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Pending Approvals Alert Banner */}
              {pendingCouriers.length > 0 && (
                <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
                  <div className="flex items-center gap-3.5">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500 text-slate-950 font-bold shrink-0">
                      <AlertCircle className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                        {pendingCouriers.length}{' '}
                        {pendingCouriers.length === 1
                          ? 'novo entregador aguarda aprovação de documentos'
                          : 'novos entregadores aguardam aprovação de documentos'}
                      </h3>
                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                        Verifique a CNH e a foto de selfie para liberar o acesso ao aplicativo.
                      </p>
                    </div>
                  </div>

                  <Button
                    onClick={() => {
                      setActiveTab('couriers')
                      setCourierStatusFilter('pending')
                    }}
                    className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs shrink-0 shadow-md shadow-amber-500/20"
                  >
                    Analisar Cadastros Pendentes →
                  </Button>
                </div>
              )}

              {/* CHARTS ROW (Weekly Trends + Status Distribution) */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Chart 1 */}
                <Card className="lg:col-span-8 border-slate-200/80 dark:border-slate-800 shadow-sm">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base font-bold text-slate-900 dark:text-white">
                          Tendência Semanal de Volume de Entregas
                        </CardTitle>
                        <CardDescription className="text-xs">
                          Distribuição diária de pedidos despachados e concluídos.
                        </CardDescription>
                      </div>
                      <Badge
                        variant="outline"
                        className="text-xs text-blue-600 bg-blue-50 border-blue-200"
                      >
                        Meta: 25/dia
                      </Badge>
                    </div>
                  </CardHeader>

                  <CardContent className="pt-4">
                    <div className="h-56 w-full flex items-end justify-between gap-2 pt-6 pb-2 px-2">
                      {volumeByDay.map((val, idx) => {
                        const heightPercent = Math.max(15, (val / maxDayVolume) * 100)
                        const isToday = idx === volumeByDay.length - 1

                        return (
                          <div
                            key={idx}
                            className="flex-1 flex flex-col items-center gap-2 h-full justify-end group"
                          >
                            <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity">
                              {val}
                            </span>
                            <div
                              className={`w-full max-w-[48px] rounded-t-xl transition-all duration-500 ease-out ${
                                isToday
                                  ? 'bg-gradient-to-t from-blue-600 to-indigo-500 shadow-lg shadow-blue-500/30'
                                  : 'bg-slate-200 group-hover:bg-blue-400 dark:bg-slate-800 dark:group-hover:bg-slate-700'
                              }`}
                              style={{ height: `${heightPercent}%` }}
                            />
                            <span className="text-[10px] text-slate-500 font-medium truncate">
                              {daysOfWeek[idx]}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </CardContent>
                </Card>

                {/* Chart 2 */}
                <Card className="lg:col-span-4 border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col justify-between">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base font-bold text-slate-900 dark:text-white">
                      Status dos Pedidos
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Proporção de entregas na operação atual.
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="space-y-3 pt-2">
                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900">
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full bg-emerald-500"></span>
                        <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                          Entregues
                        </span>
                      </div>
                      <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                        {deliveredOrders.length} (
                        {totalOrders > 0
                          ? Math.round((deliveredOrders.length / totalOrders) * 100)
                          : 0}
                        %)
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900">
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full bg-amber-500"></span>
                        <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                          Em Trânsito
                        </span>
                      </div>
                      <span className="text-xs font-bold text-amber-700 dark:text-amber-300">
                        {inTransitOrders.length} (
                        {totalOrders > 0
                          ? Math.round((inTransitOrders.length / totalOrders) * 100)
                          : 0}
                        %)
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900">
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full bg-blue-500"></span>
                        <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                          Pendentes
                        </span>
                      </div>
                      <span className="text-xs font-bold text-blue-700 dark:text-blue-300">
                        {pendingOrders.length} (
                        {totalOrders > 0
                          ? Math.round((pendingOrders.length / totalOrders) * 100)
                          : 0}
                        %)
                      </span>
                    </div>

                    <div className="pt-2">
                      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div
                          style={{
                            width: `${(deliveredOrders.length / Math.max(1, totalOrders)) * 100}%`,
                          }}
                          className="bg-emerald-500"
                        />
                        <div
                          style={{
                            width: `${(inTransitOrders.length / Math.max(1, totalOrders)) * 100}%`,
                          }}
                          className="bg-amber-500"
                        />
                        <div
                          style={{
                            width: `${(pendingOrders.length / Math.max(1, totalOrders)) * 100}%`,
                          }}
                          className="bg-blue-500"
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* TAB 2: COURIERS MANAGEMENT */}
            <TabsContent value="couriers" className="space-y-4">
              <Card className="border-slate-200/80 dark:border-slate-800 shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <Truck className="h-5 w-5 text-purple-600" />
                        Gestão de Entregadores & Credenciamento
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Aprove novos cadastros, bloqueie acessos e visualize documentos enviados
                        (RG/CNH e selfies).
                      </CardDescription>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {/* Filter by status */}
                      <Select
                        value={courierStatusFilter}
                        onValueChange={(v) => setCourierStatusFilter(v)}
                      >
                        <SelectTrigger className="h-9 w-[150px] text-xs">
                          <SelectValue placeholder="Filtrar Status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todos os Status</SelectItem>
                          <SelectItem value="pending">
                            🟡 Pendentes ({pendingCouriers.length})
                          </SelectItem>
                          <SelectItem value="active">
                            🟢 Ativos ({activeCouriers.length})
                          </SelectItem>
                          <SelectItem value="inactive">
                            ⚪ Inativos ({inactiveCouriers.length})
                          </SelectItem>
                        </SelectContent>
                      </Select>

                      {/* Search box */}
                      <div className="relative w-48 sm:w-64">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                        <Input
                          placeholder="Buscar por nome, placa, e-mail..."
                          value={searchCouriers}
                          onChange={(e) => setSearchCouriers(e.target.value)}
                          className="h-9 pl-8 text-xs"
                        />
                      </div>
                    </div>
                  </div>
                </CardHeader>

                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900 uppercase tracking-wider">
                          <th className="py-3 px-3 font-semibold">Entregador</th>
                          <th className="py-3 px-3 font-semibold">Contato</th>
                          <th className="py-3 px-3 font-semibold">Veículo & Placa</th>
                          <th className="py-3 px-3 font-semibold">Status</th>
                          <th className="py-3 px-3 font-semibold">Documentos</th>
                          <th className="py-3 px-3 font-semibold text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {filteredCouriers.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-8 text-center text-slate-500">
                              Nenhum entregador encontrado com os filtros selecionados.
                            </td>
                          </tr>
                        ) : (
                          filteredCouriers.map((c) => {
                            const isPending = c.status === 'pending'
                            const isInactive = c.status === 'inactive'
                            const isActive =
                              c.status === 'active' || c.status === 'idle' || c.status === 'busy'

                            return (
                              <tr
                                key={c.id}
                                className="hover:bg-slate-50/60 dark:hover:bg-slate-800/50 transition-colors"
                              >
                                <td className="py-3 px-3 font-semibold text-slate-900 dark:text-white">
                                  <div className="flex items-center gap-2.5">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-950 text-purple-600 dark:text-purple-300 font-bold text-xs uppercase">
                                      {c.name ? c.name.slice(0, 2) : 'EN'}
                                    </div>
                                    <div>
                                      <p className="font-bold text-slate-900 dark:text-white">
                                        {c.name || 'Sem nome'}
                                      </p>
                                      <p className="text-[11px] text-slate-500">{c.email}</p>
                                    </div>
                                  </div>
                                </td>

                                <td className="py-3 px-3 text-slate-600 dark:text-slate-300">
                                  <div className="flex items-center gap-1.5">
                                    <Phone className="h-3.5 w-3.5 text-slate-400" />
                                    <span>{c.phone || 'Não informado'}</span>
                                  </div>
                                </td>

                                <td className="py-3 px-3">
                                  <div>
                                    <p className="font-medium text-slate-800 dark:text-slate-200">
                                      {c.vehicle_model || 'Modelo N/D'}{' '}
                                      {c.vehicle_year ? `(${c.vehicle_year})` : ''}
                                    </p>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                      <Badge
                                        variant="outline"
                                        className="text-[9px] px-1 py-0 uppercase font-mono tracking-wider bg-slate-100 dark:bg-slate-800"
                                      >
                                        {c.vehicle_plate || 'SEM PLACA'}
                                      </Badge>
                                      <span className="text-[10px] text-slate-400 capitalize">
                                        {c.vehicle_type || 'moto'}
                                      </span>
                                    </div>
                                  </div>
                                </td>

                                <td className="py-3 px-3">
                                  {isPending && (
                                    <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700 text-[10px] font-bold">
                                      🟡 Pendente
                                    </Badge>
                                  )}
                                  {isActive && (
                                    <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700 text-[10px] font-bold">
                                      🟢 Ativo
                                    </Badge>
                                  )}
                                  {isInactive && (
                                    <Badge className="bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700 text-[10px] font-bold">
                                      ⚪ Inativo
                                    </Badge>
                                  )}
                                </td>

                                <td className="py-3 px-3">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleOpenDocsModal(c)}
                                    className="h-7 text-[11px] gap-1 text-blue-600 border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/30 hover:bg-blue-100"
                                  >
                                    <Eye className="h-3 w-3" />
                                    Ver Docs & Selfie
                                  </Button>
                                </td>

                                <td className="py-3 px-3 text-right">
                                  <div className="flex items-center justify-end gap-1.5">
                                    {isPending && (
                                      <Button
                                        size="sm"
                                        onClick={() => handleUpdateUserStatus(c, 'active')}
                                        disabled={updatingUserId === c.id}
                                        className="h-7 px-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] gap-1 shadow-sm"
                                      >
                                        <Check className="h-3 w-3" />
                                        Aprovar
                                      </Button>
                                    )}

                                    {isActive && (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleUpdateUserStatus(c, 'inactive')}
                                        disabled={updatingUserId === c.id}
                                        className="h-7 px-2 text-rose-600 border-rose-200 dark:border-rose-900 hover:bg-rose-50 text-[11px] gap-1"
                                      >
                                        <Ban className="h-3 w-3" />
                                        Bloquear
                                      </Button>
                                    )}

                                    {isInactive && (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleUpdateUserStatus(c, 'active')}
                                        disabled={updatingUserId === c.id}
                                        className="h-7 px-2 text-emerald-600 border-emerald-200 dark:border-emerald-900 hover:bg-emerald-50 text-[11px] gap-1"
                                      >
                                        <UserCheck className="h-3 w-3" />
                                        Reativar
                                      </Button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB 3: SELLERS MANAGEMENT */}
            <TabsContent value="sellers" className="space-y-4">
              <Card className="border-slate-200/80 dark:border-slate-800 shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <Users className="h-5 w-5 text-blue-600" />
                        Gestão de Vendedores & Embarcadores
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Controle de contas comerciais que cadastram e despacham pedidos na
                        plataforma.
                      </CardDescription>
                    </div>

                    <div className="relative w-48 sm:w-64">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                      <Input
                        placeholder="Buscar vendedor por nome ou e-mail..."
                        value={searchSellers}
                        onChange={(e) => setSearchSellers(e.target.value)}
                        className="h-9 pl-8 text-xs"
                      />
                    </div>
                  </div>
                </CardHeader>

                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900 uppercase tracking-wider">
                          <th className="py-3 px-3 font-semibold">Vendedor / Estabelecimento</th>
                          <th className="py-3 px-3 font-semibold">Contato</th>
                          <th className="py-3 px-3 font-semibold">Status</th>
                          <th className="py-3 px-3 font-semibold">Cadastrado em</th>
                          <th className="py-3 px-3 font-semibold text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {filteredSellers.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-8 text-center text-slate-500">
                              Nenhum vendedor encontrado.
                            </td>
                          </tr>
                        ) : (
                          filteredSellers.map((s) => {
                            const isInactive = s.status === 'inactive'
                            const isActive = s.status !== 'inactive'

                            return (
                              <tr
                                key={s.id}
                                className="hover:bg-slate-50/60 dark:hover:bg-slate-800/50 transition-colors"
                              >
                                <td className="py-3 px-3 font-semibold text-slate-900 dark:text-white">
                                  <div className="flex items-center gap-2.5">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-300 font-bold text-xs uppercase">
                                      {s.name ? s.name.slice(0, 2) : 'VD'}
                                    </div>
                                    <div>
                                      <p className="font-bold text-slate-900 dark:text-white">
                                        {s.name || 'Sem nome'}
                                      </p>
                                      <p className="text-[11px] text-slate-500">{s.email}</p>
                                    </div>
                                  </div>
                                </td>

                                <td className="py-3 px-3 text-slate-600 dark:text-slate-300">
                                  <div className="flex items-center gap-1.5">
                                    <Phone className="h-3.5 w-3.5 text-slate-400" />
                                    <span>{s.phone || 'Não informado'}</span>
                                  </div>
                                </td>

                                <td className="py-3 px-3">
                                  {isActive ? (
                                    <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700 text-[10px] font-bold">
                                      🟢 Ativo
                                    </Badge>
                                  ) : (
                                    <Badge className="bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700 text-[10px] font-bold">
                                      ⚪ Inativo
                                    </Badge>
                                  )}
                                </td>

                                <td className="py-3 px-3 text-slate-500 text-[11px]">
                                  {new Date(s.created).toLocaleDateString('pt-BR')}
                                </td>

                                <td className="py-3 px-3 text-right">
                                  <div className="flex items-center justify-end gap-1.5">
                                    {isActive ? (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleUpdateUserStatus(s, 'inactive')}
                                        disabled={updatingUserId === s.id}
                                        className="h-7 px-2 text-rose-600 border-rose-200 dark:border-rose-900 hover:bg-rose-50 text-[11px] gap-1"
                                      >
                                        <Ban className="h-3 w-3" />
                                        Bloquear
                                      </Button>
                                    ) : (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleUpdateUserStatus(s, 'active')}
                                        disabled={updatingUserId === s.id}
                                        className="h-7 px-2 text-emerald-600 border-emerald-200 dark:border-emerald-900 hover:bg-emerald-50 text-[11px] gap-1"
                                      >
                                        <UserCheck className="h-3 w-3" />
                                        Reativar
                                      </Button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </main>
      </div>

      {/* Floating AI Assistant */}
      <AiLogisticsAssistant />

      {/* ================= MODAL: VIEW DOCUMENTS & SELFIE ================= */}
      <Dialog open={isDocsModalOpen} onOpenChange={setIsDocsModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
              <FileText className="h-5 w-5 text-blue-600" />
              Documentos de Validação do Entregador
            </DialogTitle>
            <DialogDescription className="text-xs">
              Conferência de RG/CNH, selfie e dados do veículo para aprovação de cadastro.
            </DialogDescription>
          </DialogHeader>

          {selectedUserForDocs && (
            <div className="space-y-4 py-2">
              {/* User summary bar */}
              <div className="p-3.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-semibold">
                    Nome:
                  </span>
                  <span className="font-bold text-slate-900 dark:text-white">
                    {selectedUserForDocs.name || 'Sem nome'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-semibold">
                    E-mail:
                  </span>
                  <span className="font-semibold truncate block">{selectedUserForDocs.email}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-semibold">
                    Placa / Veículo:
                  </span>
                  <span className="font-mono font-bold text-purple-600 dark:text-purple-400">
                    {selectedUserForDocs.vehicle_plate || 'N/D'} (
                    {selectedUserForDocs.vehicle_model || 'Veículo'})
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-semibold">
                    Status Atual:
                  </span>
                  <Badge
                    className={`text-[10px] font-bold ${
                      selectedUserForDocs.status === 'pending'
                        ? 'bg-amber-500/15 text-amber-600'
                        : selectedUserForDocs.status === 'inactive'
                          ? 'bg-slate-500/15 text-slate-600'
                          : 'bg-emerald-500/15 text-emerald-600'
                    }`}
                  >
                    {selectedUserForDocs.status || 'Ativo'}
                  </Badge>
                </div>
              </div>

              {/* Uploaded Files Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* RG / CNH Document */}
                <div className="space-y-2 border border-slate-200 dark:border-slate-800 rounded-xl p-3 bg-slate-50/50 dark:bg-slate-900/50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <FileText className="h-4 w-4 text-purple-500" />
                      Documento (RG / CNH)
                    </span>
                    {selectedUserForDocs.documents && selectedUserForDocs.documents.length > 0 ? (
                      <Badge variant="outline" className="text-[10px] text-emerald-600">
                        Enviado
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-slate-400">
                        Não anexado
                      </Badge>
                    )}
                  </div>

                  {selectedUserForDocs.documents && selectedUserForDocs.documents.length > 0 ? (
                    <div className="space-y-2">
                      {selectedUserForDocs.documents.map((docName, idx) => {
                        const fileUrl = pb.files.getURL(selectedUserForDocs, docName)
                        return (
                          <div
                            key={idx}
                            className="relative group rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 bg-black/10"
                          >
                            <img
                              src={fileUrl}
                              alt="Documento CNH"
                              className="w-full h-44 object-contain rounded-lg"
                              onError={(e) => {
                                // Fallback icon if PDF or render issue
                                e.currentTarget.style.display = 'none'
                              }}
                            />
                            <div className="p-2 flex items-center justify-between bg-white dark:bg-slate-900 text-xs">
                              <span className="truncate max-w-[150px] text-slate-600 dark:text-slate-300">
                                {docName}
                              </span>
                              <a
                                href={fileUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1 text-blue-600 hover:underline font-semibold"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                Abrir Original
                              </a>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="h-40 flex flex-col items-center justify-center text-slate-400 text-xs rounded-lg border border-dashed border-slate-300 dark:border-slate-800">
                      <FileText className="h-8 w-8 text-slate-300 mb-1" />
                      <span>Nenhum documento anexado</span>
                    </div>
                  )}
                </div>

                {/* Selfie Photo */}
                <div className="space-y-2 border border-slate-200 dark:border-slate-800 rounded-xl p-3 bg-slate-50/50 dark:bg-slate-900/50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <Camera className="h-4 w-4 text-purple-500" />
                      Selfie do Entregador
                    </span>
                    {selectedUserForDocs.selfie ? (
                      <Badge variant="outline" className="text-[10px] text-emerald-600">
                        Enviada
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-slate-400">
                        Não anexada
                      </Badge>
                    )}
                  </div>

                  {selectedUserForDocs.selfie ? (
                    <div className="relative group rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 bg-black/10">
                      {(() => {
                        const selfieUrl = pb.files.getURL(
                          selectedUserForDocs,
                          selectedUserForDocs.selfie,
                        )
                        return (
                          <>
                            <img
                              src={selfieUrl}
                              alt="Selfie do Entregador"
                              className="w-full h-44 object-contain rounded-lg"
                            />
                            <div className="p-2 flex items-center justify-between bg-white dark:bg-slate-900 text-xs">
                              <span className="truncate max-w-[150px] text-slate-600 dark:text-slate-300">
                                {selectedUserForDocs.selfie}
                              </span>
                              <a
                                href={selfieUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1 text-blue-600 hover:underline font-semibold"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                Abrir Foto
                              </a>
                            </div>
                          </>
                        )
                      })()}
                    </div>
                  ) : (
                    <div className="h-40 flex flex-col items-center justify-center text-slate-400 text-xs rounded-lg border border-dashed border-slate-300 dark:border-slate-800">
                      <Camera className="h-8 w-8 text-slate-300 mb-1" />
                      <span>Nenhuma selfie anexada</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="pt-2 flex flex-col sm:flex-row gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsDocsModalOpen(false)}
              className="text-xs"
            >
              Fechar
            </Button>

            {selectedUserForDocs && (
              <>
                {selectedUserForDocs.status === 'pending' ? (
                  <Button
                    onClick={() => {
                      handleUpdateUserStatus(selectedUserForDocs, 'active')
                      setIsDocsModalOpen(false)
                    }}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5"
                  >
                    <Check className="h-4 w-4" />
                    Aprovar e Ativar Entregador
                  </Button>
                ) : selectedUserForDocs.status === 'active' ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      handleUpdateUserStatus(selectedUserForDocs, 'inactive')
                      setIsDocsModalOpen(false)
                    }}
                    className="text-rose-600 border-rose-300 hover:bg-rose-50 text-xs gap-1.5"
                  >
                    <Ban className="h-4 w-4" />
                    Bloquear Cadastro
                  </Button>
                ) : (
                  <Button
                    onClick={() => {
                      handleUpdateUserStatus(selectedUserForDocs, 'active')
                      setIsDocsModalOpen(false)
                    }}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5"
                  >
                    <UserCheck className="h-4 w-4" />
                    Reativar Cadastro
                  </Button>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================= MODAL: CREATE USER ================= */}
      <Dialog open={isNewUserModalOpen} onOpenChange={setIsNewUserModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
              <UserPlus className="h-5 w-5 text-blue-600" />
              Cadastrar Novo Usuário na Equipe
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleCreateUser} className="space-y-3.5 py-2">
            <div>
              <Label className="text-xs font-semibold">Nome Completo</Label>
              <Input
                placeholder="Ex: Roberto Silva"
                value={newUserName}
                onChange={(e) => setNewUserName(e.target.value)}
                className="mt-1 text-xs"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-semibold">E-mail</Label>
                <Input
                  type="email"
                  placeholder="roberto@logistica.com"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  className="mt-1 text-xs"
                  required
                />
              </div>

              <div>
                <Label className="text-xs font-semibold">Telefone</Label>
                <Input
                  type="tel"
                  placeholder="(11) 99999-9999"
                  value={newUserPhone}
                  onChange={(e) => setNewUserPhone(e.target.value)}
                  className="mt-1 text-xs"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs font-semibold">Perfil de Acesso</Label>
              <Select
                value={newUserRole}
                onValueChange={(v) => setNewUserRole(v as 'seller' | 'courier')}
              >
                <SelectTrigger className="mt-1 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="courier">🛵 Entregador (App Mobile & GPS)</SelectItem>
                  <SelectItem value="seller">🏪 Vendedor (Painel & Registro de Vendas)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {newUserRole === 'courier' && (
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block uppercase">
                  Dados do Veículo
                </span>

                <div>
                  <Label className="text-[11px] font-semibold">Tipo de Veículo</Label>
                  <Select
                    value={newUserVehicleType}
                    onValueChange={(v) => setNewUserVehicleType(v as VehicleType)}
                  >
                    <SelectTrigger className="mt-1 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="moto">🏍️ Moto</SelectItem>
                      <SelectItem value="carro">🚗 Carro</SelectItem>
                      <SelectItem value="van">🚐 Van</SelectItem>
                      <SelectItem value="caminhao">🚚 Caminhão</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[11px] font-semibold">Modelo</Label>
                    <Input
                      placeholder="Ex: Honda CG 160"
                      value={newUserVehicleModel}
                      onChange={(e) => setNewUserVehicleModel(e.target.value)}
                      className="mt-1 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] font-semibold">Placa</Label>
                    <Input
                      placeholder="ABC1D23"
                      value={newUserVehiclePlate}
                      onChange={(e) => setNewUserVehiclePlate(e.target.value)}
                      className="mt-1 text-xs uppercase font-mono"
                    />
                  </div>
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Senha Inicial</Label>
                <span className="text-[10px] text-slate-500">Mínimo 8 caracteres</span>
              </div>
              <Input
                type="password"
                value={newUserPassword}
                onChange={(e) => setNewUserPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                className="mt-1 text-xs"
                minLength={8}
                required
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setIsNewUserModalOpen(false)}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isCreatingUser}
                className="bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs"
              >
                {isCreatingUser ? 'Criando...' : 'Salvar Usuário'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

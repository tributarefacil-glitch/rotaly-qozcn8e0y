import React, { useState, useEffect, useMemo } from 'react'
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
  Settings,
  Fuel,
  Gauge,
  PieChart,
  Save,
  MapPinOff,
  UserX,
  Wallet,
  CreditCard,
  PlusCircle,
  Trash2,
  Calendar,
  Compass,
  Star,
  Receipt,
  ArrowDownRight,
  ArrowUpDown,
  Edit3,
} from 'lucide-react'
import { Header } from '@/components/Header'
import { Sidebar } from '@/components/Sidebar'
import { AiLogisticsAssistant } from '@/components/AiLogisticsAssistant'
import { ControlTower } from '@/components/ControlTower'
import { ReportsSection } from '@/components/ReportsSection'
import { CourierDeliveryHistoryModal } from '@/components/CourierDeliveryHistoryModal'
import { CreateSellerModal } from '@/components/CreateSellerModal'
import { EditSellerModal } from '@/components/EditSellerModal'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { deliveryService } from '@/services/deliveryService'
import { calculateRealKmForOrder } from '@/lib/telemetryKmEngine'
import { calculateCourierFuelMetrics } from '@/hooks/useCourierFuelMetrics'
import type {
  OrderRecord,
  UserRecord,
  NotificationRecord,
  LocationRecord,
  VehicleType,
  AppSettingsRecord,
  FuelAdvanceRecord,
  ReviewRecord,
  OffRouteEventRecord,
  CourierFuelAccount,
  FuelPaymentMethod,
} from '@/types/delivery'
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

interface AdminDashboardProps {
  defaultTab?:
    | 'overview'
    | 'control-tower'
    | 'reports'
    | 'fuel'
    | 'deviations'
    | 'settings'
    | 'couriers'
    | 'sellers'
}

export default function AdminDashboard({ defaultTab = 'overview' }: AdminDashboardProps) {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [orders, setOrders] = useState<OrderRecord[]>([])
  const [users, setUsers] = useState<UserRecord[]>([])
  const [locations, setLocations] = useState<LocationRecord[]>([])
  const [notifications, setNotifications] = useState<NotificationRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedCourierId, setSelectedCourierId] = useState<string | null>(null)
  const [selectedCourierForHistory, setSelectedCourierForHistory] = useState<UserRecord | null>(
    null,
  )
  const [isCourierHistoryModalOpen, setIsCourierHistoryModalOpen] = useState(false)

  // Ler query param ?tab=deviations se existir
  const queryParams = new URLSearchParams(location.search)
  const tabFromQuery = queryParams.get('tab') as
    | 'overview'
    | 'control-tower'
    | 'reports'
    | 'fuel'
    | 'deviations'
    | 'settings'
    | 'couriers'
    | 'sellers'
    | null

  const [activeTab, setActiveTab] = useState<
    | 'overview'
    | 'control-tower'
    | 'reports'
    | 'fuel'
    | 'deviations'
    | 'settings'
    | 'couriers'
    | 'sellers'
  >(tabFromQuery || defaultTab)

  useEffect(() => {
    const qTab = new URLSearchParams(location.search).get('tab') as any
    if (
      qTab &&
      [
        'overview',
        'control-tower',
        'reports',
        'fuel',
        'deviations',
        'settings',
        'couriers',
        'sellers',
      ].includes(qTab)
    ) {
      setActiveTab(qTab)
    } else if (defaultTab) {
      setActiveTab(defaultTab)
    }
  }, [location.search, defaultTab])

  const [searchCouriers, setSearchCouriers] = useState('')
  const [courierStatusFilter, setCourierStatusFilter] = useState<string>('all')
  const [searchSellers, setSearchSellers] = useState('')

  // Settings State: Moto, Carro e Caminhão (Preço do litro e consumo km/L)
  const [settings, setSettings] = useState<AppSettingsRecord | null>(null)
  const [motoPriceInput, setMotoPriceInput] = useState('5.59')
  const [motoConsInput, setMotoConsInput] = useState('35.0')
  const [carroPriceInput, setCarroPriceInput] = useState('5.59')
  const [carroConsInput, setCarroConsInput] = useState('12.0')
  const [caminhaoPriceInput, setCaminhaoPriceInput] = useState('5.59')
  const [caminhaoConsInput, setCaminhaoConsInput] = useState('7.0')
  const [isSavingSettings, setIsSavingSettings] = useState(false)
  const [savingCategory, setSavingCategory] = useState<string | null>(null)

  // Fuel Advances & Current Accounts State (REQUISITO 5)
  const [fuelAdvances, setFuelAdvances] = useState<FuelAdvanceRecord[]>([])
  const [fuelAccounts, setFuelAccounts] = useState<CourierFuelAccount[]>([])
  const [selectedCourierForFuelFilter, setSelectedCourierForFuelFilter] = useState<string>('all')
  const [fuelPeriodFilter, setFuelPeriodFilter] = useState<'all' | 'month' | 'week'>('all')
  const [isNewFuelAdvanceModalOpen, setIsNewFuelAdvanceModalOpen] = useState(false)
  const [advanceCourierId, setAdvanceCourierId] = useState('')
  const [advanceAmount, setAdvanceAmount] = useState('')
  const [advanceDate, setAdvanceDate] = useState(new Date().toISOString().split('T')[0])
  const [advancePaymentMethod, setAdvancePaymentMethod] = useState<FuelPaymentMethod>('pix')
  const [advanceNotes, setAdvanceNotes] = useState('')
  const [isCreatingAdvance, setIsCreatingAdvance] = useState(false)

  // Off-Route & Deviations State (REQUISITO 2)
  const [offRouteEvents, setOffRouteEvents] = useState<OffRouteEventRecord[]>([])
  const [offRouteFilterType, setOffRouteFilterType] = useState<string>('all')
  const [offRouteCourierFilter, setOffRouteCourierFilter] = useState<string>('all')

  // Reviews State (REQUISITO 4)
  const [reviews, setReviews] = useState<ReviewRecord[]>([])

  // Report Period Filter
  const [reportPeriod, setReportPeriod] = useState<'all' | 'today' | 'week' | 'month'>('all')

  // View Documents Modal state
  const [selectedUserForDocs, setSelectedUserForDocs] = useState<UserRecord | null>(null)
  const [isDocsModalOpen, setIsDocsModalOpen] = useState(false)

  // Seller Modals state
  const [isCreateSellerModalOpen, setIsCreateSellerModalOpen] = useState(false)
  const [isEditSellerModalOpen, setIsEditSellerModalOpen] = useState(false)
  const [selectedSellerForEdit, setSelectedSellerForEdit] = useState<UserRecord | null>(null)

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
      const [
        ordersData,
        usersData,
        notifsData,
        appSettings,
        advancesData,
        accountsData,
        eventsData,
        reviewsData,
        locationsData,
      ] = await Promise.all([
        deliveryService.getOrders('', '-created', 'customer_id,courier_id,seller_id'),
        deliveryService.getAllUsers(),
        deliveryService.getNotifications(),
        deliveryService.getSettings(),
        deliveryService.getFuelAdvances(),
        deliveryService.getCourierFuelAccounts(),
        deliveryService.getOffRouteEvents(),
        deliveryService.getReviews(),
        deliveryService.getLatestLocations(),
      ])
      setOrders(ordersData)
      setUsers(usersData)
      setNotifications(notifsData)
      setSettings(appSettings)
      setFuelAdvances(advancesData)
      // Recalcula as contas correntes com base no filtro de período atual e dados completos
      const couriersList = usersData.filter((u) => u.role === 'courier') as UserRecord[]
      const calculatedAccounts = couriersList.map((courier) => {
        const metrics = calculateCourierFuelMetrics({
          courier,
          advances: advancesData,
          orders: ordersData,
          locations: locationsData,
          offRouteEvents: eventsData,
          settings: appSettings,
          periodFilter: fuelPeriodFilter,
        })
        return (
          metrics.fuelAccount ||
          deliveryService.getCourierFuelAccount(
            courier,
            advancesData,
            ordersData,
            appSettings,
            fuelPeriodFilter,
            locationsData,
            eventsData,
          )
        )
      })
      setFuelAccounts(calculatedAccounts)
      setOffRouteEvents(eventsData)
      setReviews(reviewsData)
      setLocations(locationsData)
      const fallbackPrice = appSettings.fuel_price_per_liter || 5.59
      setMotoPriceInput(String(appSettings.moto_fuel_price ?? fallbackPrice))
      setMotoConsInput(
        String(appSettings.moto_consumption_kml ?? appSettings.fuel_consumption_kml ?? 35.0),
      )
      setCarroPriceInput(String(appSettings.carro_fuel_price ?? fallbackPrice))
      setCarroConsInput(String(appSettings.carro_consumption_kml ?? 12.0))
      setCaminhaoPriceInput(String(appSettings.caminhao_fuel_price ?? fallbackPrice))
      setCaminhaoConsInput(String(appSettings.caminhao_consumption_kml ?? 7.0))
    } catch (err) {
      console.error('Error loading admin data:', err)
    } finally {
      setIsLoading(false)
    }
  }

  // Create Fuel Advance
  const handleCreateFuelAdvance = async (e: React.FormEvent) => {
    e.preventDefault()
    const amountNum = parseFloat(advanceAmount.replace(',', '.'))
    if (!advanceCourierId) {
      toast.error('Selecione o entregador.')
      return
    }
    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error('Informe um valor de adiantamento válido.')
      return
    }

    setIsCreatingAdvance(true)
    try {
      await deliveryService.createFuelAdvance({
        courier_id: advanceCourierId,
        amount: amountNum,
        date: advanceDate,
        payment_method: advancePaymentMethod,
        notes: advanceNotes.trim(),
        created_by: pb.authStore.record?.id,
      })

      const courier = users.find((u) => u.id === advanceCourierId)
      toast.success(
        `Adiantamento de R$ ${amountNum.toFixed(2)} cadastrado para ${courier?.name || 'o entregador'}!`,
      )

      setIsNewFuelAdvanceModalOpen(false)
      setAdvanceAmount('')
      setAdvanceNotes('')
      loadData()
    } catch (err) {
      console.error('Error creating fuel advance:', err)
      toast.error('Erro ao cadastrar adiantamento de combustível.')
    } finally {
      setIsCreatingAdvance(false)
    }
  }

  // Delete Fuel Advance
  const handleDeleteFuelAdvance = async (id: string) => {
    if (!window.confirm('Tem certeza que deseja excluir este registro de adiantamento?')) return
    try {
      await deliveryService.deleteFuelAdvance(id)
      toast.success('Adiantamento excluído com sucesso.')
      loadData()
    } catch (err) {
      console.error('Error deleting advance:', err)
      toast.error('Erro ao excluir adiantamento.')
    }
  }

  // Delete User (REQUISITO 6)
  const handleDeleteUser = async (targetUser: UserRecord) => {
    const roleLabel = targetUser.role === 'courier' ? 'entregador' : 'vendedor'
    if (
      !window.confirm(
        `Tem certeza que deseja EXCLUIR permanentemente o ${roleLabel} "${targetUser.name || targetUser.email}"? Esta ação não pode ser desfeita.`,
      )
    )
      return

    try {
      await deliveryService.deleteUser(targetUser.id)
      toast.success(`Usuário ${targetUser.name || targetUser.email} excluído com sucesso.`)
      loadData()
    } catch (err) {
      console.error('Error deleting user:', err)
      toast.error('Erro ao excluir usuário. Verifique se há registros vinculados.')
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // Save Admin Settings (all categories in batch)
  const handleSaveAllFuelSettings = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    setIsSavingSettings(true)
    try {
      const motoPrice = parseFloat(motoPriceInput.replace(',', '.'))
      const motoCons = parseFloat(motoConsInput.replace(',', '.'))
      const carroPrice = parseFloat(carroPriceInput.replace(',', '.'))
      const carroCons = parseFloat(carroConsInput.replace(',', '.'))
      const caminhaoPrice = parseFloat(caminhaoPriceInput.replace(',', '.'))
      const caminhaoCons = parseFloat(caminhaoConsInput.replace(',', '.'))

      if (isNaN(motoPrice) || motoPrice <= 0 || isNaN(motoCons) || motoCons <= 0) {
        toast.error('Preencha valores válidos para MOTO.')
        setIsSavingSettings(false)
        return
      }
      if (isNaN(carroPrice) || carroPrice <= 0 || isNaN(carroCons) || carroCons <= 0) {
        toast.error('Preencha valores válidos para CARRO.')
        setIsSavingSettings(false)
        return
      }
      if (isNaN(caminhaoPrice) || caminhaoPrice <= 0 || isNaN(caminhaoCons) || caminhaoCons <= 0) {
        toast.error('Preencha valores válidos para CAMINHÃO.')
        setIsSavingSettings(false)
        return
      }

      const updated = await deliveryService.updateSettings({
        fuel_price_per_liter: motoPrice,
        fuel_consumption_kml: motoCons,
        moto_fuel_price: motoPrice,
        moto_consumption_kml: motoCons,
        carro_fuel_price: carroPrice,
        carro_consumption_kml: carroCons,
        caminhao_fuel_price: caminhaoPrice,
        caminhao_consumption_kml: caminhaoCons,
      })

      setSettings(updated as AppSettingsRecord)
      toast.success('Todos os parâmetros de combustível (Moto, Carro, Caminhão) foram salvos!')
    } catch (err) {
      console.error('Error saving settings:', err)
      toast.error('Erro ao salvar configurações.')
    } finally {
      setIsSavingSettings(false)
    }
  }

  // Save specific category individually
  const handleSaveIndividualCategory = async (category: 'moto' | 'carro' | 'caminhao') => {
    setSavingCategory(category)
    try {
      let price = 0
      let cons = 0
      const payload: Partial<AppSettingsRecord> = {}

      if (category === 'moto') {
        price = parseFloat(motoPriceInput.replace(',', '.'))
        cons = parseFloat(motoConsInput.replace(',', '.'))
        payload.moto_fuel_price = price
        payload.moto_consumption_kml = cons
        // also keep default fields synchronized with moto
        payload.fuel_price_per_liter = price
        payload.fuel_consumption_kml = cons
      } else if (category === 'carro') {
        price = parseFloat(carroPriceInput.replace(',', '.'))
        cons = parseFloat(carroConsInput.replace(',', '.'))
        payload.carro_fuel_price = price
        payload.carro_consumption_kml = cons
      } else {
        price = parseFloat(caminhaoPriceInput.replace(',', '.'))
        cons = parseFloat(caminhaoConsInput.replace(',', '.'))
        payload.caminhao_fuel_price = price
        payload.caminhao_consumption_kml = cons
      }

      if (isNaN(price) || price <= 0 || isNaN(cons) || cons <= 0) {
        toast.error(`Informe valores válidos de preço e consumo para ${category.toUpperCase()}.`)
        setSavingCategory(null)
        return
      }

      const updated = await deliveryService.updateSettings(payload)
      setSettings(updated as AppSettingsRecord)
      const label = category === 'moto' ? 'Moto' : category === 'carro' ? 'Carro' : 'Caminhão'
      toast.success(`Parâmetros de ${label} salvos com sucesso!`)
    } catch (err) {
      console.error('Error saving category settings:', err)
      toast.error('Erro ao salvar parâmetros da categoria.')
    } finally {
      setSavingCategory(null)
    }
  }

  // Change user vehicle type (Admin quick edit)
  const handleUpdateCourierVehicleType = async (
    courier: UserRecord,
    newVehicleType: 'moto' | 'carro' | 'caminhao' | 'bicicleta',
  ) => {
    try {
      await deliveryService.updateUser(courier.id, {
        vehicle_type: newVehicleType,
      })
      setUsers((prev) =>
        prev.map((u) => (u.id === courier.id ? { ...u, vehicle_type: newVehicleType } : u)),
      )
      const label =
        newVehicleType === 'bicicleta'
          ? 'BICICLETA'
          : newVehicleType === 'carro'
            ? 'CARRO'
            : newVehicleType === 'caminhao'
              ? 'CAMINHÃO'
              : 'MOTO'
      toast.success(`Tipo de veículo de ${courier.name || 'Entregador'} alterado para ${label}!`)
      loadData()
    } catch (err) {
      console.error('Error updating courier vehicle type:', err)
      toast.error('Erro ao atualizar tipo de veículo do entregador.')
    }
  }

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
      const msg = getErrorMessage(err)
      toast.error(msg || 'Falha ao cadastrar novo usuário.')
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

  // REQUISITO 4 & 5: Configurações e Relatórios por tipo de veículo do entregador
  // Filter orders by report period
  const filteredReportOrders = orders.filter((o) => {
    if (reportPeriod === 'all') return true
    const date = new Date(o.created)
    const now = new Date()
    if (reportPeriod === 'today') {
      return date.toDateString() === now.toDateString()
    }
    if (reportPeriod === 'week') {
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      return date >= oneWeekAgo
    }
    if (reportPeriod === 'month') {
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()
    }
    return true
  })

  // Basic Metrics
  const totalOrders = orders.length
  const reportTotalOrders = filteredReportOrders.length
  const deliveredOrders = filteredReportOrders.filter((o) => o.status === 'delivered')
  const addressErrorOrders = filteredReportOrders.filter((o) => o.status === 'address_error')
  const clientAbsentOrders = filteredReportOrders.filter((o) => o.status === 'client_absent')
  const inTransitOrders = filteredReportOrders.filter((o) => o.status === 'in_transit')
  const pendingOrders = filteredReportOrders.filter((o) => o.status === 'pending')
  const cancelledOrders = filteredReportOrders.filter((o) => o.status === 'cancelled')

  // Total Value / Revenue
  const reportTotalValue = filteredReportOrders
    .filter((o) => o.status !== 'cancelled')
    .reduce((acc, o) => acc + (Number(o.total_price) || 0), 0)

  const reportDeliveredValue = deliveredOrders.reduce(
    (acc, o) => acc + (Number(o.total_price) || 0),
    0,
  )

  // REQUISITO 1: Quilometragem e consumo por veículo — somar distance_km + return_trip_km para todas as ordens com
  // route_started === true OU status in_transit / delivered / address_error / client_absent (rotas parciais de retorno incluídas)
  let totalKmRodada = 0
  let totalFuelCostCalculated = 0

  filteredReportOrders.forEach((o) => {
    if (
      o.route_started === true ||
      o.status === 'delivered' ||
      o.status === 'in_transit' ||
      o.status === 'address_error' ||
      o.status === 'client_absent'
    ) {
      const realTelemetry = calculateRealKmForOrder({
        order: o,
        allCourierLocations: locations,
        courierEvents: offRouteEvents,
        allCourierOrders: orders,
      })

      const orderKm = realTelemetry.officialRealKm
      totalKmRodada += orderKm

      // Obter veículo do entregador
      const courier = users.find((u) => u.id === o.courier_id) || o.expand?.courier_id
      const vehicleType = courier?.vehicle_type || 'moto'
      const { pricePerLiter, consumptionKml } = deliveryService.getVehicleFuelParams(
        settings,
        vehicleType,
      )

      if (consumptionKml > 0) {
        totalFuelCostCalculated += (orderKm * pricePerLiter) / consumptionKml
      }
    }
  })

  // Recalcular fuelAccounts reativamente sempre que mudar o filtro de período, pedidos ou adiantamentos
  const currentFuelAccounts = useMemo(() => {
    return couriers.map((courier) => {
      const metrics = calculateCourierFuelMetrics({
        courier,
        advances: fuelAdvances,
        orders,
        locations,
        offRouteEvents,
        settings,
        periodFilter: fuelPeriodFilter,
      })
      return (
        metrics.fuelAccount ||
        deliveryService.getCourierFuelAccount(
          courier,
          fuelAdvances,
          orders,
          settings,
          fuelPeriodFilter,
          locations,
          offRouteEvents,
        )
      )
    })
  }, [couriers, fuelAdvances, orders, settings, fuelPeriodFilter, locations, offRouteEvents])

  // Filtered Fuel Advances by Courier & Period (REQUISITO 5)
  const filteredFuelAdvances = fuelAdvances.filter((adv) => {
    if (selectedCourierForFuelFilter !== 'all' && adv.courier_id !== selectedCourierForFuelFilter) {
      return false
    }
    if (fuelPeriodFilter === 'month') {
      const advDate = new Date(adv.date)
      const now = new Date()
      return advDate.getMonth() === now.getMonth() && advDate.getFullYear() === now.getFullYear()
    }
    if (fuelPeriodFilter === 'week') {
      const advDate = new Date(adv.date)
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      return advDate >= oneWeekAgo
    }
    return true
  })

  // Filtered Off Route Events (REQUISITO 2)
  const filteredOffRouteEvents = offRouteEvents.filter((ev) => {
    if (offRouteFilterType !== 'all' && ev.event_type !== offRouteFilterType) return false
    if (offRouteCourierFilter !== 'all' && ev.courier_id !== offRouteCourierFilter) return false
    return true
  })

  const totalSales = orders
    .filter((o) => o.status !== 'cancelled')
    .reduce((acc, o) => acc + (Number(o.total_price) || 0), 0)

  const successRate =
    totalOrders > 0
      ? Math.round((orders.filter((o) => o.status === 'delivered').length / totalOrders) * 100)
      : 100
  const busyCouriers = activeCouriers.filter(
    (c) => c.status === 'busy' || inTransitOrders.some((o) => o.courier_id === c.id),
  )
  const courierUtilizationRate =
    activeCouriers.length > 0 ? Math.round((busyCouriers.length / activeCouriers.length) * 100) : 0

  const daysOfWeek = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Hoje']
  const volumeByDay = [14, 18, 22, 19, 28, 35, orders.length]
  const maxDayVolume = Math.max(...volumeByDay, 40)

  return (
    <div className="min-h-screen bg-[#070D1E] text-slate-100 flex flex-col font-sans">
      <Header />

      <div className="flex flex-1">
        <Sidebar />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 space-y-6 overflow-y-auto max-w-[1600px] mx-auto w-full">
          {/* Header Title & Actions */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="h-6 w-6 text-[#60A5FA]" />
                <h1 className="font-heading text-2xl sm:text-3xl font-black tracking-tight text-white">
                  Painel Executivo &amp; Gestão LOGHYPE
                </h1>
              </div>
              <p className="font-sans text-xs sm:text-sm text-slate-400 mt-1">
                Controle global de entregadores, vendedores, aprovações de documentos e telemetria.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={loadData}
                className="h-9 gap-1.5 text-xs text-slate-700 border-slate-200 hover:bg-slate-50 rounded-input"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 text-[#0052CC] ${isLoading ? 'animate-spin' : ''}`}
                />
                Atualizar
              </Button>
              <Button
                onClick={() => setIsNewUserModalOpen(true)}
                className="h-9 gap-2 bg-[#0052CC] hover:bg-[#003E99] text-white font-bold text-xs shadow-brand rounded-input transition duration-100"
              >
                <UserPlus className="h-4 w-4 text-[#FF6B35]" />
                Cadastrar Usuário
              </Button>
            </div>
          </div>

          {/* MAIN TABS (Overview, Relatórios, Configurações, Entregadores, Vendedores) */}
          <Tabs
            value={activeTab}
            onValueChange={(v) =>
              setActiveTab(v as 'overview' | 'reports' | 'settings' | 'couriers' | 'sellers')
            }
            className="space-y-6"
          >
            <TabsList className="bg-[#0A1128] p-1 border border-[#1E2B58] rounded-xl flex flex-wrap gap-1 font-heading">
              <TabsTrigger
                value="overview"
                className="text-xs font-semibold text-slate-300 data-[state=active]:bg-[#0052CC] data-[state=active]:text-white data-[state=active]:shadow-brand rounded-lg"
              >
                <BarChart3 className="h-3.5 w-3.5 mr-1.5 text-[#60A5FA]" />
                Visão Geral
              </TabsTrigger>
              <TabsTrigger
                value="control-tower"
                className="text-xs font-semibold text-slate-300 data-[state=active]:bg-[#0052CC] data-[state=active]:text-white data-[state=active]:shadow-brand rounded-lg"
              >
                <Compass className="h-3.5 w-3.5 mr-1.5 text-[#22C55E]" />
                Torre de Controle
              </TabsTrigger>
              <TabsTrigger
                value="reports"
                className="text-xs font-semibold text-slate-300 data-[state=active]:bg-[#0052CC] data-[state=active]:text-white data-[state=active]:shadow-brand rounded-lg"
              >
                <PieChart className="h-3.5 w-3.5 mr-1.5 text-[#60A5FA]" />
                Relatórios Operacionais
              </TabsTrigger>
              <TabsTrigger
                value="fuel"
                className="text-xs font-semibold text-slate-300 data-[state=active]:bg-[#0052CC] data-[state=active]:text-white data-[state=active]:shadow-brand rounded-lg"
              >
                <Wallet className="h-3.5 w-3.5 mr-1.5 text-[#22C55E]" />
                Controle de Combustível
              </TabsTrigger>
              <TabsTrigger
                value="deviations"
                className="text-xs font-semibold text-slate-300 data-[state=active]:bg-[#0052CC] data-[state=active]:text-white data-[state=active]:shadow-brand rounded-lg text-[#FF6B35]"
              >
                <AlertTriangle className="h-3.5 w-3.5 mr-1.5 text-[#FF6B35]" />
                Desvios &amp; Paradas ({offRouteEvents.length})
              </TabsTrigger>
              <TabsTrigger
                value="settings"
                className="text-xs font-semibold text-slate-300 data-[state=active]:bg-[#0052CC] data-[state=active]:text-white data-[state=active]:shadow-brand rounded-lg"
              >
                <Settings className="h-3.5 w-3.5 mr-1.5 text-slate-400" />
                Parâmetros R$/L
              </TabsTrigger>
              <TabsTrigger
                value="couriers"
                className="text-xs font-semibold text-slate-300 data-[state=active]:bg-[#0052CC] data-[state=active]:text-white data-[state=active]:shadow-brand rounded-lg relative"
              >
                <Truck className="h-3.5 w-3.5 mr-1.5 text-[#FF6B35]" />
                Entregadores ({couriers.length})
                {pendingCouriers.length > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.2 rounded-full bg-[#FF6B35] text-white text-[10px] font-bold">
                    {pendingCouriers.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="sellers"
                className="text-xs font-semibold text-slate-300 data-[state=active]:bg-[#0052CC] data-[state=active]:text-white data-[state=active]:shadow-brand rounded-lg"
              >
                <Users className="h-3.5 w-3.5 mr-1.5 text-[#60A5FA]" />
                Vendedores ({sellers.length})
              </TabsTrigger>
            </TabsList>

            {/* MÓDULO 1: TORRE DE CONTROLE NA ABA DO ADMIN */}
            <TabsContent value="control-tower" className="space-y-6">
              <ControlTower
                orders={orders}
                couriers={couriers}
                onRefresh={loadData}
                userRole="admin"
              />
            </TabsContent>

            {/* TAB: CONTROLE DE COMBUSTÍVEL & CONTA CORRENTE EM TEMPO REAL (REQUISITO 5) */}
            <TabsContent value="fuel" className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Wallet className="h-5 w-5 text-emerald-600" />
                    Controle Financeiro de Combustível (Pagamento Antecipado)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Conta corrente por entregador em tempo real:{' '}
                    <strong>Valor Recebido (Adiantamentos)</strong> menos{' '}
                    <strong>Gasto em Rotas Oficiais</strong>.
                  </p>
                </div>

                <Button
                  onClick={() => setIsNewFuelAdvanceModalOpen(true)}
                  className="h-9 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/25 self-start sm:self-center"
                >
                  <PlusCircle className="h-4 w-4" />
                  Cadastrar Adiantamento / Pagamento
                </Button>
              </div>

              {/* CARDS DE CONTA CORRENTE DOS ENTREGADORES */}
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <CreditCard className="h-4 w-4 text-emerald-500" />
                    Conta Corrente dos Entregadores (Saldo em Tempo Real)
                  </h4>
                  <p className="text-xs text-slate-400">
                    💡 Clique em qualquer card para abrir o{' '}
                    <strong className="text-blue-500">
                      Histórico Completo de Entregas, KM, Combustível e Telemetria
                    </strong>
                    .
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {currentFuelAccounts.map((acc) => {
                    const isPositive = acc.balance >= 0
                    return (
                      <Card
                        key={acc.courier.id}
                        onClick={() => {
                          setSelectedCourierForHistory(acc.courier)
                          setIsCourierHistoryModalOpen(true)
                        }}
                        className="border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden cursor-pointer hover:border-[#0052CC]/60 hover:shadow-md transition-all group"
                      >
                        <div
                          className={`absolute top-0 left-0 right-0 h-1.5 ${
                            isPositive ? 'bg-emerald-500' : 'bg-rose-500'
                          }`}
                        />
                        <CardHeader className="p-4 pb-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-950 text-purple-600 dark:text-purple-300 font-bold text-xs">
                                {acc.courier.name
                                  ? acc.courier.name.slice(0, 2).toUpperCase()
                                  : 'EN'}
                              </div>
                              <div>
                                <CardTitle className="text-sm font-bold text-slate-900 dark:text-white">
                                  {acc.courier.name || 'Entregador'}
                                </CardTitle>
                                <p className="text-[10px] text-slate-500 flex items-center gap-1">
                                  <span>{acc.courier.vehicle_plate || 'Sem placa'}</span> •{' '}
                                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                                    {acc.courier.vehicle_model ||
                                      (acc.courier.vehicle_type === 'carro'
                                        ? 'Carro'
                                        : acc.courier.vehicle_type === 'caminhao'
                                          ? 'Caminhão'
                                          : acc.courier.vehicle_type === 'bicycle' ||
                                              acc.courier.vehicle_type === 'bicicleta'
                                            ? 'Bicicleta'
                                            : 'Moto')}
                                  </span>
                                  <Badge
                                    variant="outline"
                                    className="text-[9px] px-1 py-0 uppercase font-mono font-bold ml-0.5"
                                  >
                                    {deliveryService.normalizeVehicleCategory(
                                      acc.courier.vehicle_type,
                                    ) === 'bicicleta'
                                      ? '🚲 Bicicleta'
                                      : deliveryService.normalizeVehicleCategory(
                                          acc.courier.vehicle_type,
                                        )}
                                  </Badge>
                                </p>
                              </div>
                            </div>
                            <Badge
                              className={`text-[10px] font-bold ${
                                isPositive
                                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-300'
                                  : 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-300'
                              }`}
                            >
                              {isPositive ? 'Crédito Disponível' : 'Saldo Devedor / A Repor'}
                            </Badge>
                          </div>
                        </CardHeader>

                        <CardContent className="p-4 pt-2 space-y-3 text-xs">
                          {/* Saldo Principal */}
                          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border flex items-center justify-between">
                            <div>
                              <span className="text-[10px] uppercase font-bold text-slate-500 block">
                                Saldo da Conta Corrente
                              </span>
                              <span
                                className={`text-xl font-black font-mono ${
                                  isPositive
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-rose-600 dark:text-rose-400'
                                }`}
                              >
                                R$ {acc.balance.toFixed(2)}
                              </span>
                            </div>
                            <div className="text-right">
                              <span className="text-[10px] text-slate-400 block">
                                {acc.advanceCount} adiantamento(s)
                              </span>
                              <span className="text-[10px] text-slate-400 block">
                                {acc.deliveriesCount} entregas
                              </span>
                            </div>
                          </div>

                          {/* Detalhamento: Recebido vs Gasto */}
                          <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <div className="p-2 rounded-lg bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-900/40">
                              <span className="text-emerald-700 dark:text-emerald-400 block font-medium">
                                (+) Total Adiantado
                              </span>
                              <span className="font-bold text-emerald-800 dark:text-emerald-300 font-mono text-sm">
                                R$ {acc.totalAdvances.toFixed(2)}
                              </span>
                            </div>

                            <div className="p-2 rounded-lg bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40">
                              <span className="text-amber-700 dark:text-amber-400 block font-medium">
                                {deliveryService.normalizeVehicleCategory(
                                  acc.courier.vehicle_type,
                                ) === 'bicicleta'
                                  ? 'Km Rodado (Sem Combustível)'
                                  : '(-) Gasto Rota Oficial'}
                              </span>
                              <span className="font-bold text-amber-800 dark:text-amber-300 font-mono text-sm">
                                {deliveryService.normalizeVehicleCategory(
                                  acc.courier.vehicle_type,
                                ) === 'bicicleta'
                                  ? `${acc.totalRouteKm.toFixed(1)} km`
                                  : `R$ ${acc.totalSpent.toFixed(2)}`}
                              </span>
                              <span className="text-[9px] text-slate-400 block mt-0.5">
                                {deliveryService.normalizeVehicleCategory(
                                  acc.courier.vehicle_type,
                                ) === 'bicicleta'
                                  ? 'Telemetria GPS apurada'
                                  : `${acc.totalRouteKm.toFixed(1)} km roteirizados`}
                              </span>
                            </div>
                          </div>

                          {/* Dica / Botão de clique para histórico */}
                          <div className="pt-1 flex items-center justify-between text-[11px] text-[#0052CC] dark:text-[#60A5FA] font-medium group-hover:underline">
                            <span>Ver histórico detalhado de entregas & telemetria</span>
                            <span>→</span>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              </div>

              {/* HISTÓRICO DE PAGAMENTOS / ADIANTAMENTOS CADASTRADOS */}
              <Card className="border-slate-200/80 dark:border-slate-800 shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <Receipt className="h-4 w-4 text-emerald-600" />
                        Histórico de Pagamentos e Adiantamentos ({filteredFuelAdvances.length})
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Lançamentos cadastrados pelo administrador com filtro por entregador e
                        período.
                      </CardDescription>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {/* Filter by Courier */}
                      <Select
                        value={selectedCourierForFuelFilter}
                        onValueChange={setSelectedCourierForFuelFilter}
                      >
                        <SelectTrigger className="h-8 w-44 text-xs">
                          <SelectValue placeholder="Filtrar Entregador" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todos os Entregadores</SelectItem>
                          {couriers.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              🛵 {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {/* Filter by Period */}
                      <Select
                        value={fuelPeriodFilter}
                        onValueChange={(v: 'all' | 'month' | 'week') => setFuelPeriodFilter(v)}
                      >
                        <SelectTrigger className="h-8 w-32 text-xs">
                          <SelectValue placeholder="Período" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">Todo Histórico</SelectItem>
                          <SelectItem value="month">Este Mês</SelectItem>
                          <SelectItem value="week">Últimos 7 dias</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardHeader>

                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900 uppercase tracking-wider">
                          <th className="py-2.5 px-3 font-semibold">Data</th>
                          <th className="py-2.5 px-3 font-semibold">Entregador</th>
                          <th className="py-2.5 px-3 font-semibold">Forma de Pagamento</th>
                          <th className="py-2.5 px-3 font-semibold">Observações / Motivo</th>
                          <th className="py-2.5 px-3 font-semibold text-right">Valor Pago</th>
                          <th className="py-2.5 px-3 font-semibold text-right">Ação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {filteredFuelAdvances.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-6 text-center text-slate-400">
                              Nenhum adiantamento cadastrado para os filtros selecionados.
                            </td>
                          </tr>
                        ) : (
                          filteredFuelAdvances.map((adv) => {
                            const courier = users.find((u) => u.id === adv.courier_id)
                            return (
                              <tr
                                key={adv.id}
                                className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
                              >
                                <td className="py-2.5 px-3 font-mono text-slate-700 dark:text-slate-300">
                                  {adv.date ? new Date(adv.date).toLocaleDateString('pt-BR') : '-'}
                                </td>
                                <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-white">
                                  {courier?.name || 'Entregador'}
                                </td>
                                <td className="py-2.5 px-3">
                                  <Badge
                                    variant="outline"
                                    className="uppercase font-mono text-[10px] bg-slate-100 dark:bg-slate-800"
                                  >
                                    {adv.payment_method || 'PIX'}
                                  </Badge>
                                </td>
                                <td className="py-2.5 px-3 text-slate-500 text-[11px] max-w-xs truncate">
                                  {adv.notes || 'Adiantamento de combustível para rotas'}
                                </td>
                                <td className="py-2.5 px-3 text-right font-black text-emerald-600 dark:text-emerald-400 font-mono text-sm">
                                  R$ {Number(adv.amount || 0).toFixed(2)}
                                </td>
                                <td className="py-2.5 px-3 text-right">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleDeleteFuelAdvance(adv.id)}
                                    className="h-7 w-7 p-0 text-slate-400 hover:text-rose-600"
                                    title="Excluir adiantamento"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
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

            {/* TAB: RELATÓRIO DE DESVIOS E PARADAS FORA DE ROTA (REQUISITO 2) */}
            <TabsContent value="deviations" className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                    Relatório de Desvios de Rota e Paradas Não Previstas
                  </h3>
                  <p className="text-xs text-slate-500">
                    Ocorrências automáticas de telemetria:{' '}
                    <strong>desvios superiores a 300 metros</strong> (não contabilizados no consumo
                    de combustível) e <strong>paradas fora dos pontos previstos</strong> após o
                    entregador iniciar a rota.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Select value={offRouteFilterType} onValueChange={setOffRouteFilterType}>
                    <SelectTrigger className="h-8 w-44 text-xs">
                      <SelectValue placeholder="Tipo de Ocorrência" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas as Ocorrências</SelectItem>
                      <SelectItem value="route_deviation">
                        🚨 Desvio de Rota (&gt;300m - Sem KM)
                      </SelectItem>
                      <SelectItem value="unexpected_stop">🛑 Parada Não Prevista</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={offRouteCourierFilter} onValueChange={setOffRouteCourierFilter}>
                    <SelectTrigger className="h-8 w-44 text-xs">
                      <SelectValue placeholder="Filtrar Entregador" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os Entregadores</SelectItem>
                      {couriers.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          🛵 {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* SUMMARY STATS */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-600">
                      <AlertTriangle className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 font-medium">Total de Ocorrências</p>
                      <h4 className="text-2xl font-black text-slate-900 dark:text-white">
                        {offRouteEvents.length}
                      </h4>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 text-rose-600">
                      <Compass className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 font-medium">
                        Desvios &gt; 300m (Sem KM)
                      </p>
                      <h4 className="text-2xl font-black text-rose-600">
                        {offRouteEvents.filter((e) => e.event_type === 'route_deviation').length}
                      </h4>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600">
                      <Clock className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 font-medium">Paradas Fora do Ponto</p>
                      <h4 className="text-2xl font-black text-blue-600">
                        {offRouteEvents.filter((e) => e.event_type === 'unexpected_stop').length}
                      </h4>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* TABELA DE EVENTOS */}
              <Card className="border-slate-200/80 dark:border-slate-800 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-bold text-slate-900 dark:text-white">
                    Histórico Detalhado de Telemetria & Alertas ({filteredOffRouteEvents.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900 uppercase tracking-wider">
                          <th className="py-3 px-3 font-semibold">Data / Hora</th>
                          <th className="py-3 px-3 font-semibold">Entregador</th>
                          <th className="py-3 px-3 font-semibold">Tipo de Evento</th>
                          <th className="py-3 px-3 font-semibold">Desvio / Detalhe</th>
                          <th className="py-3 px-3 font-semibold">Coordenadas GPS</th>
                          <th className="py-3 px-3 font-semibold">Observação do Sistema</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {filteredOffRouteEvents.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-8 text-center text-slate-400">
                              Nenhuma ocorrência de desvio ou parada registrada.
                            </td>
                          </tr>
                        ) : (
                          filteredOffRouteEvents.map((ev) => {
                            const courier = users.find((u) => u.id === ev.courier_id)
                            return (
                              <tr
                                key={ev.id}
                                className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
                              >
                                <td className="py-3 px-3 font-mono text-slate-600 dark:text-slate-300">
                                  {new Date(ev.created).toLocaleString('pt-BR')}
                                </td>
                                <td className="py-3 px-3 font-semibold text-slate-900 dark:text-white">
                                  {courier?.name || 'Entregador'}
                                </td>
                                <td className="py-3 px-3">
                                  {ev.event_type === 'route_deviation' ? (
                                    <Badge className="bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-300 text-[10px] font-bold">
                                      🚨 Desvio de Rota
                                    </Badge>
                                  ) : (
                                    <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-300 text-[10px] font-bold">
                                      🛑 Parada Fora do Ponto
                                    </Badge>
                                  )}
                                </td>
                                <td className="py-3 px-3 font-semibold">
                                  {ev.distance_deviation_meters ? (
                                    <span className="text-rose-600 font-mono">
                                      +{ev.distance_deviation_meters} metros
                                    </span>
                                  ) : ev.stop_duration_seconds ? (
                                    <span className="text-amber-600 font-mono">
                                      ~{Math.round(ev.stop_duration_seconds / 60)} min parado
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">-</span>
                                  )}
                                </td>
                                <td className="py-3 px-3 font-mono text-slate-500 text-[11px]">
                                  {ev.lat?.toFixed(5)}, {ev.lng?.toFixed(5)}
                                </td>
                                <td className="py-3 px-3 text-slate-500 text-[11px]">
                                  {ev.notes ||
                                    'Alerta disparado para vendedor e entregador com sinal sonoro.'}
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

            {/* TAB: RELATÓRIOS COMPLETOS (MÓDULO 4) */}
            <TabsContent value="reports" className="space-y-6">
              <ReportsSection
                orders={orders}
                couriers={couriers}
                settings={settings}
                offRouteEvents={offRouteEvents}
                locations={locations}
              />
            </TabsContent>

            {/* TAB: CONFIGURAÇÕES DO ADMINISTRADOR (PARÂMETROS DE COMBUSTÍVEL POR TIPO DE VEÍCULO) */}
            <TabsContent value="settings" className="space-y-6">
              <Card className="border-slate-200 dark:border-slate-800 shadow-sm max-w-4xl">
                <CardHeader>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-base font-bold flex items-center gap-2 text-slate-900 dark:text-white">
                        <Fuel className="h-5 w-5 text-indigo-600" />
                        Configurações Operacionais &amp; Parâmetros de Combustível
                      </CardTitle>
                      <CardDescription className="text-xs">
                        Configure o preço do litro (R$/L) e o consumo médio (km/L) para cada
                        categoria de veículo. Os cálculos de custo de rota e conta corrente passam a
                        utilizar os parâmetros oficiais do entregador.
                      </CardDescription>
                    </div>
                    <Button
                      type="button"
                      onClick={() => handleSaveAllFuelSettings()}
                      disabled={isSavingSettings}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs gap-1.5 shrink-0 shadow-sm"
                    >
                      <Save className="h-4 w-4" />
                      {isSavingSettings ? 'Salvando Todos...' : 'Salvar Todos em Lote'}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Cards de cada tipo de veículo (Moto, Carro, Caminhão) */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* CARD 1: MOTO */}
                    <div className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20 p-4 space-y-4 flex flex-col justify-between">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between pb-2 border-b border-blue-200/60 dark:border-blue-800">
                          <div className="flex items-center gap-2">
                            <span className="text-2xl">🏍️</span>
                            <div>
                              <h3 className="font-bold text-sm text-slate-900 dark:text-white uppercase tracking-wider">
                                Moto
                              </h3>
                              <p className="text-[11px] text-slate-500">Scooter / Motocicleta</p>
                            </div>
                          </div>
                          <Badge className="bg-blue-600 text-white text-[10px] font-bold">
                            Padrão
                          </Badge>
                        </div>

                        {/* Preço Litro Moto */}
                        <div className="space-y-1">
                          <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                            <DollarSign className="h-3.5 w-3.5 text-emerald-600" />
                            Preço do Litro (R$/L)
                          </Label>
                          <div className="relative">
                            <span className="absolute left-3 top-2.5 text-xs font-bold text-slate-400">
                              R$
                            </span>
                            <Input
                              type="number"
                              step="0.01"
                              min="0.1"
                              value={motoPriceInput}
                              onChange={(e) => setMotoPriceInput(e.target.value)}
                              className="pl-9 font-mono font-bold text-xs bg-white dark:bg-slate-900"
                              placeholder="5.59"
                            />
                          </div>
                        </div>

                        {/* Consumo Moto */}
                        <div className="space-y-1">
                          <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                            <Gauge className="h-3.5 w-3.5 text-indigo-600" />
                            Consumo (km por Litro)
                          </Label>
                          <div className="relative">
                            <Input
                              type="number"
                              step="0.1"
                              min="0.1"
                              value={motoConsInput}
                              onChange={(e) => setMotoConsInput(e.target.value)}
                              className="font-mono font-bold text-xs pr-12 bg-white dark:bg-slate-900"
                              placeholder="35.0"
                            />
                            <span className="absolute right-3 top-2.5 text-xs font-semibold text-slate-400">
                              km/L
                            </span>
                          </div>
                        </div>

                        {/* Estimativa em tempo real */}
                        <div className="p-2.5 rounded-lg bg-white/80 dark:bg-slate-900/80 border text-[11px] text-slate-600 dark:text-slate-300">
                          <p className="font-semibold text-slate-700 dark:text-slate-200">
                            Custo por km:
                          </p>
                          <p className="font-mono font-bold text-blue-600 dark:text-blue-400">
                            R${' '}
                            {(
                              (parseFloat(motoPriceInput.replace(',', '.')) || 5.59) /
                              (parseFloat(motoConsInput.replace(',', '.')) || 35.0)
                            ).toFixed(4)}
                            /km
                          </p>
                          <p className="text-[10px] text-slate-500 mt-0.5">
                            Ex: 10 km = R${' '}
                            {(
                              (10 * (parseFloat(motoPriceInput.replace(',', '.')) || 5.59)) /
                              (parseFloat(motoConsInput.replace(',', '.')) || 35.0)
                            ).toFixed(2)}
                          </p>
                        </div>
                      </div>

                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleSaveIndividualCategory('moto')}
                        disabled={savingCategory === 'moto' || isSavingSettings}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs gap-1.5 mt-2"
                      >
                        <Save className="h-3.5 w-3.5" />
                        {savingCategory === 'moto' ? 'Salvando...' : 'Salvar Moto'}
                      </Button>
                    </div>

                    {/* CARD 2: CARRO */}
                    <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20 p-4 space-y-4 flex flex-col justify-between">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between pb-2 border-b border-emerald-200/60 dark:border-emerald-800">
                          <div className="flex items-center gap-2">
                            <span className="text-2xl">🚗</span>
                            <div>
                              <h3 className="font-bold text-sm text-slate-900 dark:text-white uppercase tracking-wider">
                                Carro
                              </h3>
                              <p className="text-[11px] text-slate-500">
                                Passeio / Utilitário Leve
                              </p>
                            </div>
                          </div>
                          <Badge className="bg-emerald-600 text-white text-[10px] font-bold">
                            Urbano
                          </Badge>
                        </div>

                        {/* Preço Litro Carro */}
                        <div className="space-y-1">
                          <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                            <DollarSign className="h-3.5 w-3.5 text-emerald-600" />
                            Preço do Litro (R$/L)
                          </Label>
                          <div className="relative">
                            <span className="absolute left-3 top-2.5 text-xs font-bold text-slate-400">
                              R$
                            </span>
                            <Input
                              type="number"
                              step="0.01"
                              min="0.1"
                              value={carroPriceInput}
                              onChange={(e) => setCarroPriceInput(e.target.value)}
                              className="pl-9 font-mono font-bold text-xs bg-white dark:bg-slate-900"
                              placeholder="5.59"
                            />
                          </div>
                        </div>

                        {/* Consumo Carro */}
                        <div className="space-y-1">
                          <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                            <Gauge className="h-3.5 w-3.5 text-emerald-600" />
                            Consumo (km por Litro)
                          </Label>
                          <div className="relative">
                            <Input
                              type="number"
                              step="0.1"
                              min="0.1"
                              value={carroConsInput}
                              onChange={(e) => setCarroConsInput(e.target.value)}
                              className="font-mono font-bold text-xs pr-12 bg-white dark:bg-slate-900"
                              placeholder="12.0"
                            />
                            <span className="absolute right-3 top-2.5 text-xs font-semibold text-slate-400">
                              km/L
                            </span>
                          </div>
                        </div>

                        {/* Estimativa em tempo real */}
                        <div className="p-2.5 rounded-lg bg-white/80 dark:bg-slate-900/80 border text-[11px] text-slate-600 dark:text-slate-300">
                          <p className="font-semibold text-slate-700 dark:text-slate-200">
                            Custo por km:
                          </p>
                          <p className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                            R${' '}
                            {(
                              (parseFloat(carroPriceInput.replace(',', '.')) || 5.59) /
                              (parseFloat(carroConsInput.replace(',', '.')) || 12.0)
                            ).toFixed(4)}
                            /km
                          </p>
                          <p className="text-[10px] text-slate-500 mt-0.5">
                            Ex: 10 km = R${' '}
                            {(
                              (10 * (parseFloat(carroPriceInput.replace(',', '.')) || 5.59)) /
                              (parseFloat(carroConsInput.replace(',', '.')) || 12.0)
                            ).toFixed(2)}
                          </p>
                        </div>
                      </div>

                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleSaveIndividualCategory('carro')}
                        disabled={savingCategory === 'carro' || isSavingSettings}
                        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5 mt-2"
                      >
                        <Save className="h-3.5 w-3.5" />
                        {savingCategory === 'carro' ? 'Salvando...' : 'Salvar Carro'}
                      </Button>
                    </div>

                    {/* CARD 3: CAMINHÃO */}
                    <div className="rounded-xl border border-orange-200 dark:border-orange-900/60 bg-orange-50/40 dark:bg-orange-950/20 p-4 space-y-4 flex flex-col justify-between">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between pb-2 border-b border-orange-200/60 dark:border-orange-800">
                          <div className="flex items-center gap-2">
                            <span className="text-2xl">🚚</span>
                            <div>
                              <h3 className="font-bold text-sm text-slate-900 dark:text-white uppercase tracking-wider">
                                Caminhão
                              </h3>
                              <p className="text-[11px] text-slate-500">VUC / Carga Pesada</p>
                            </div>
                          </div>
                          <Badge className="bg-orange-600 text-white text-[10px] font-bold">
                            Carga
                          </Badge>
                        </div>

                        {/* Preço Litro Caminhão */}
                        <div className="space-y-1">
                          <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                            <DollarSign className="h-3.5 w-3.5 text-orange-600" />
                            Preço do Litro (R$/L)
                          </Label>
                          <div className="relative">
                            <span className="absolute left-3 top-2.5 text-xs font-bold text-slate-400">
                              R$
                            </span>
                            <Input
                              type="number"
                              step="0.01"
                              min="0.1"
                              value={caminhaoPriceInput}
                              onChange={(e) => setCaminhaoPriceInput(e.target.value)}
                              className="pl-9 font-mono font-bold text-xs bg-white dark:bg-slate-900"
                              placeholder="5.59"
                            />
                          </div>
                        </div>

                        {/* Consumo Caminhão */}
                        <div className="space-y-1">
                          <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                            <Gauge className="h-3.5 w-3.5 text-orange-600" />
                            Consumo (km por Litro)
                          </Label>
                          <div className="relative">
                            <Input
                              type="number"
                              step="0.1"
                              min="0.1"
                              value={caminhaoConsInput}
                              onChange={(e) => setCaminhaoConsInput(e.target.value)}
                              className="font-mono font-bold text-xs pr-12 bg-white dark:bg-slate-900"
                              placeholder="7.0"
                            />
                            <span className="absolute right-3 top-2.5 text-xs font-semibold text-slate-400">
                              km/L
                            </span>
                          </div>
                        </div>

                        {/* Estimativa em tempo real */}
                        <div className="p-2.5 rounded-lg bg-white/80 dark:bg-slate-900/80 border text-[11px] text-slate-600 dark:text-slate-300">
                          <p className="font-semibold text-slate-700 dark:text-slate-200">
                            Custo por km:
                          </p>
                          <p className="font-mono font-bold text-orange-600 dark:text-orange-400">
                            R${' '}
                            {(
                              (parseFloat(caminhaoPriceInput.replace(',', '.')) || 5.59) /
                              (parseFloat(caminhaoConsInput.replace(',', '.')) || 7.0)
                            ).toFixed(4)}
                            /km
                          </p>
                          <p className="text-[10px] text-slate-500 mt-0.5">
                            Ex: 10 km = R${' '}
                            {(
                              (10 * (parseFloat(caminhaoPriceInput.replace(',', '.')) || 5.59)) /
                              (parseFloat(caminhaoConsInput.replace(',', '.')) || 7.0)
                            ).toFixed(2)}
                          </p>
                        </div>
                      </div>

                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleSaveIndividualCategory('caminhao')}
                        disabled={savingCategory === 'caminhao' || isSavingSettings}
                        className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs gap-1.5 mt-2"
                      >
                        <Save className="h-3.5 w-3.5" />
                        {savingCategory === 'caminhao' ? 'Salvando...' : 'Salvar Caminhão'}
                      </Button>
                    </div>
                  </div>

                  {/* Fórmula explicativa unificada */}
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border text-xs space-y-2 text-slate-600 dark:text-slate-300">
                    <p className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <Fuel className="h-4 w-4 text-amber-500" />
                      Fórmula de Cálculo Automática por Tipo de Veículo:
                    </p>
                    <p className="font-mono text-xs bg-white dark:bg-slate-900 p-2.5 rounded-lg border text-indigo-600 dark:text-indigo-400">
                      Custo (R$) = [ Distância Total (km) × Preço do Litro do Tipo (R$) ] ÷ Consumo
                      do Tipo (km/L)
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-[11px]">
                      <div className="p-2 rounded bg-white dark:bg-slate-900 border">
                        <span className="font-bold text-slate-700 dark:text-slate-300">
                          🏍️ Moto:
                        </span>{' '}
                        Consumo base <strong>{motoConsInput} km/L</strong> (preço R${' '}
                        {motoPriceInput}/L)
                      </div>
                      <div className="p-2 rounded bg-white dark:bg-slate-900 border">
                        <span className="font-bold text-slate-700 dark:text-slate-300">
                          🚗 Carro:
                        </span>{' '}
                        Consumo base <strong>{carroConsInput} km/L</strong> (preço R${' '}
                        {carroPriceInput}/L)
                      </div>
                      <div className="p-2 rounded bg-white dark:bg-slate-900 border">
                        <span className="font-bold text-slate-700 dark:text-slate-300">
                          🚚 Caminhão:
                        </span>{' '}
                        Consumo base <strong>{caminhaoConsInput} km/L</strong> (preço R${' '}
                        {caminhaoPriceInput}/L)
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-500 pt-1">
                      ℹ️ Caso um entregador não tenha veículo definido ou possua cadastro antigo, o
                      sistema aplica <strong>Moto (35 km/L)</strong> como fallback de segurança.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* TAB 1: OVERVIEW */}
            <TabsContent value="overview" className="space-y-6">
              {/* KPI CARDS */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* KPI 1: Total Sales */}
                <Card className="border border-slate-200 bg-white shadow-brand rounded-card">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <span className="font-heading text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Vendas Totais (Mês)
                      </span>
                      <div className="flex h-9 w-9 items-center justify-center rounded-card bg-blue-50 text-[#0052CC] border border-blue-100">
                        <DollarSign className="h-4 w-4" />
                      </div>
                    </div>
                    <p className="font-heading text-2xl font-black text-[#1a1a1a] mt-2">
                      R$ {totalSales.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </p>
                    <div className="flex items-center gap-1.5 mt-2 text-xs font-medium text-[#00AA44]">
                      <TrendingUp className="h-3.5 w-3.5" />
                      <span>+18.4% em relação à semana anterior</span>
                    </div>
                  </CardContent>
                </Card>

                {/* KPI 2: Average Delivery Time */}
                <Card className="border border-slate-200 bg-white shadow-brand rounded-card">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <span className="font-heading text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Tempo Médio de Entrega
                      </span>
                      <div className="flex h-9 w-9 items-center justify-center rounded-card bg-orange-50 text-[#FF6B35] border border-orange-100">
                        <Clock className="h-4 w-4" />
                      </div>
                    </div>
                    <p className="font-heading text-2xl font-black text-[#1a1a1a] mt-2">27.4 min</p>
                    <div className="flex items-center gap-1.5 mt-2 text-xs font-medium text-[#00AA44]">
                      <TrendingUp className="h-3.5 w-3.5" />
                      <span>-4.2 min (otimização de rota LOGHYPE)</span>
                    </div>
                  </CardContent>
                </Card>

                {/* KPI 3: Courier Utilization Rate */}
                <Card className="border border-slate-200 bg-white shadow-brand rounded-card">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <span className="font-heading text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Entregadores Ativos
                      </span>
                      <div className="flex h-9 w-9 items-center justify-center rounded-card bg-blue-50 text-[#0052CC] border border-blue-100">
                        <Truck className="h-4 w-4" />
                      </div>
                    </div>
                    <p className="font-heading text-2xl font-black text-[#0052CC] mt-2">
                      {activeCouriers.length}
                    </p>
                    <div className="flex items-center gap-1.5 mt-2 text-xs text-[#FF6B35] font-semibold">
                      <span>{pendingCouriers.length} aguardando aprovação</span>
                    </div>
                  </CardContent>
                </Card>

                {/* KPI 4: Success Delivery Rate */}
                <Card className="border border-slate-200 bg-white shadow-brand rounded-card">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <span className="font-heading text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Taxa de Sucesso (SLA)
                      </span>
                      <div className="flex h-9 w-9 items-center justify-center rounded-card bg-emerald-50 text-[#00AA44] border border-emerald-100">
                        <CheckCircle2 className="h-4 w-4" />
                      </div>
                    </div>
                    <p className="font-heading text-2xl font-black text-[#00AA44] mt-2">
                      {successRate}%
                    </p>
                    <div className="flex items-center gap-1.5 mt-2 text-xs font-medium text-[#00AA44]">
                      <span>99.2% dentro do horário estimado</span>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* CARD-RESUMO DE DESVIOS E PARADAS COM LINK EM 1 CLIQUE */}
              <div className="rounded-card border border-amber-500/30 bg-[#0E1738] p-5 shadow-brand-dark flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div className="flex h-11 w-11 items-center justify-center rounded-card bg-[#FF6B35]/20 border border-[#FF6B35]/40 text-[#FF6B35] font-bold shrink-0">
                    <AlertTriangle className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-heading text-sm font-bold text-white">
                        Monitoramento de Desvios & Paradas de Rota
                      </h3>
                      <Badge className="bg-[#FF6B35] text-white text-[10px] font-bold">
                        {offRouteEvents.length} ocorrência(s)
                      </Badge>
                    </div>
                    <p className="font-sans text-xs text-slate-300 mt-0.5">
                      {offRouteEvents.filter((e) => e.event_type === 'route_deviation').length}{' '}
                      desvio(s) &gt;300m e{' '}
                      {offRouteEvents.filter((e) => e.event_type === 'unexpected_stop').length}{' '}
                      parada(s) não previstas registradas via telemetria (rotas ativas e parciais).
                    </p>
                  </div>
                </div>

                <Button
                  onClick={() => {
                    setActiveTab('deviations')
                    navigate('/admin?tab=deviations')
                  }}
                  className="bg-gradient-to-r from-[#FF6B35] to-[#E5531E] hover:from-[#E5531E] hover:to-[#C0392B] text-white font-bold text-xs shrink-0 shadow-brand rounded-input"
                >
                  Ver Relatório de Desvios (1 Clique) →
                </Button>
              </div>

              {/* Pending Approvals Alert Banner */}
              {pendingCouriers.length > 0 && (
                <div className="rounded-card border border-orange-200 bg-orange-50/80 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-brand">
                  <div className="flex items-center gap-3.5">
                    <div className="flex h-11 w-11 items-center justify-center rounded-card bg-[#FF6B35] text-white font-bold shrink-0">
                      <AlertCircle className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="font-heading text-sm font-bold text-[#1a1a1a]">
                        {pendingCouriers.length}{' '}
                        {pendingCouriers.length === 1
                          ? 'novo entregador aguarda aprovação de documentos'
                          : 'novos entregadores aguardam aprovação de documentos'}
                      </h3>
                      <p className="font-sans text-xs text-slate-600 mt-0.5">
                        Verifique a CNH e a foto de selfie para liberar o acesso ao aplicativo
                        LOGHYPE.
                      </p>
                    </div>
                  </div>

                  <Button
                    onClick={() => {
                      setActiveTab('couriers')
                      setCourierStatusFilter('pending')
                    }}
                    className="bg-[#FF6B35] hover:bg-[#E5531E] text-white font-bold text-xs shrink-0 shadow-brand rounded-input"
                  >
                    Analisar Cadastros Pendentes →
                  </Button>
                </div>
              )}

              {/* CHARTS ROW (Weekly Trends + Status Distribution) */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Chart 1 */}
                <Card className="lg:col-span-8 border border-slate-200 bg-white shadow-brand rounded-card">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="font-heading text-base font-bold text-[#1a1a1a]">
                          Tendência Semanal de Volume de Entregas
                        </CardTitle>
                        <CardDescription className="text-xs text-slate-500 font-sans">
                          Distribuição diária de pedidos despachados e concluídos.
                        </CardDescription>
                      </div>
                      <Badge
                        variant="outline"
                        className="text-xs text-[#0052CC] bg-blue-50 border-blue-200 font-bold"
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
                            <span className="text-[11px] font-bold text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity font-mono">
                              {val}
                            </span>
                            <div
                              className={`w-full max-w-[48px] rounded-t-md transition-all duration-300 ${
                                isToday
                                  ? 'bg-[#0052CC] shadow-sm'
                                  : 'bg-[#FF6B35] group-hover:bg-[#E5531E]'
                              }`}
                              style={{ height: `${heightPercent}%` }}
                            />
                            <span className="text-[10px] text-slate-500 font-medium truncate font-heading">
                              {daysOfWeek[idx]}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </CardContent>
                </Card>

                {/* Chart 2 */}
                <Card className="lg:col-span-4 border border-slate-200 bg-white shadow-brand rounded-card flex flex-col justify-between">
                  <CardHeader className="pb-2">
                    <CardTitle className="font-heading text-base font-bold text-[#1a1a1a]">
                      Status dos Pedidos
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-500 font-sans">
                      Proporção de entregas na operação atual.
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="space-y-3 pt-2 font-sans">
                    <div className="flex items-center justify-between p-2.5 rounded-card bg-emerald-50/60 border border-emerald-200">
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full bg-[#00AA44]"></span>
                        <span className="text-xs font-semibold text-slate-800">Entregues</span>
                      </div>
                      <span className="text-xs font-bold text-[#00AA44]">
                        {deliveredOrders.length} (
                        {totalOrders > 0
                          ? Math.round((deliveredOrders.length / totalOrders) * 100)
                          : 0}
                        %)
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-2.5 rounded-card bg-orange-50/60 border border-orange-200">
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full bg-[#FF6B35]"></span>
                        <span className="text-xs font-semibold text-slate-800">Em Trânsito</span>
                      </div>
                      <span className="text-xs font-bold text-[#FF6B35]">
                        {inTransitOrders.length} (
                        {totalOrders > 0
                          ? Math.round((inTransitOrders.length / totalOrders) * 100)
                          : 0}
                        %)
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-2.5 rounded-card bg-blue-50/60 border border-blue-200">
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full bg-[#0052CC]"></span>
                        <span className="text-xs font-semibold text-slate-800">Pendentes</span>
                      </div>
                      <span className="text-xs font-bold text-[#0052CC]">
                        {pendingOrders.length} (
                        {totalOrders > 0
                          ? Math.round((pendingOrders.length / totalOrders) * 100)
                          : 0}
                        %)
                      </span>
                    </div>

                    <div className="pt-2">
                      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          style={{
                            width: `${(deliveredOrders.length / Math.max(1, totalOrders)) * 100}%`,
                          }}
                          className="bg-[#00AA44]"
                        />
                        <div
                          style={{
                            width: `${(inTransitOrders.length / Math.max(1, totalOrders)) * 100}%`,
                          }}
                          className="bg-[#FF6B35]"
                        />
                        <div
                          style={{
                            width: `${(pendingOrders.length / Math.max(1, totalOrders)) * 100}%`,
                          }}
                          className="bg-[#0052CC]"
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
                                    </div>
                                    <div className="mt-1.5">
                                      <Select
                                        value={deliveryService.normalizeVehicleCategory(
                                          c.vehicle_type,
                                        )}
                                        onValueChange={(
                                          val: 'moto' | 'carro' | 'caminhao' | 'bicicleta',
                                        ) => handleUpdateCourierVehicleType(c, val)}
                                      >
                                        <SelectTrigger className="h-6 w-32 text-[11px] font-bold px-2 py-0 border-slate-300">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="moto" className="text-xs">
                                            🏍️ Moto
                                          </SelectItem>
                                          <SelectItem value="carro" className="text-xs">
                                            🚗 Carro
                                          </SelectItem>
                                          <SelectItem value="caminhao" className="text-xs">
                                            🚚 Caminhão
                                          </SelectItem>
                                          <SelectItem value="bicicleta" className="text-xs">
                                            🚲 Bicicleta
                                          </SelectItem>
                                        </SelectContent>
                                      </Select>
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
                                  <div className="flex items-center gap-1.5">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleOpenDocsModal(c)}
                                      className="h-7 text-[11px] gap-1 text-blue-600 border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/30 hover:bg-blue-100"
                                    >
                                      <Eye className="h-3 w-3" />
                                      Docs
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        setSelectedCourierForHistory(c)
                                        setIsCourierHistoryModalOpen(true)
                                      }}
                                      className="h-7 text-[11px] gap-1 text-amber-500 border-amber-300 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20 hover:bg-amber-100"
                                      title="Ver histórico de entregas, km e combustível"
                                    >
                                      <Fuel className="h-3 w-3" />
                                      Histórico
                                    </Button>
                                  </div>
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

                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleDeleteUser(c)}
                                      className="h-7 px-2 text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                                      title="Excluir Entregador"
                                    >
                                      <Trash2 className="h-3 w-3 mr-0.5" />
                                      Excluir
                                    </Button>
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

                    <div className="flex items-center gap-2">
                      <div className="relative w-48 sm:w-64">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                        <Input
                          placeholder="Buscar vendedor por nome ou e-mail..."
                          value={searchSellers}
                          onChange={(e) => setSearchSellers(e.target.value)}
                          className="h-9 pl-8 text-xs"
                        />
                      </div>

                      <Button
                        onClick={() => setIsCreateSellerModalOpen(true)}
                        className="h-9 gap-1.5 bg-[#0052CC] hover:bg-[#003E99] text-white font-bold text-xs shadow-brand rounded-input transition duration-100 whitespace-nowrap"
                      >
                        <UserPlus className="h-3.5 w-3.5 text-[#FF6B35]" />
                        Novo Vendedor
                      </Button>
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
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        setSelectedSellerForEdit(s)
                                        setIsEditSellerModalOpen(true)
                                      }}
                                      className="h-7 px-2 text-blue-600 border-blue-200 dark:border-blue-900 hover:bg-blue-50 dark:hover:bg-blue-950/50 text-[11px] gap-1 font-semibold"
                                      title="Editar Dados do Vendedor"
                                    >
                                      <Edit3 className="h-3 w-3 text-blue-600" />
                                      Editar
                                    </Button>

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

                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleDeleteUser(s)}
                                      className="h-7 px-2 text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                                      title="Excluir Vendedor"
                                    >
                                      <Trash2 className="h-3 w-3 mr-0.5" />
                                      Excluir
                                    </Button>
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

      {/* ================= MODAL: CADASTRO DE ADIANTAMENTO DE COMBUSTÍVEL ================= */}
      <Dialog open={isNewFuelAdvanceModalOpen} onOpenChange={setIsNewFuelAdvanceModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
              <Wallet className="h-5 w-5 text-emerald-600" />
              Lançar Pagamento / Adiantamento de Combustível
            </DialogTitle>
            <DialogDescription className="text-xs">
              Cadastre o pagamento antecipado realizado ao entregador. Este valor será creditado na
              conta corrente do entregador.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateFuelAdvance} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Selecione o Entregador *
              </label>
              <Select value={advanceCourierId} onValueChange={setAdvanceCourierId} required>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Selecione o entregador beneficiário" />
                </SelectTrigger>
                <SelectContent>
                  {couriers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      🛵 {c.name} ({c.vehicle_plate || 'Sem placa'})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
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
                    value={advanceAmount}
                    onChange={(e) => setAdvanceAmount(e.target.value)}
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
                  value={advanceDate}
                  onChange={(e) => setAdvanceDate(e.target.value)}
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
                value={advancePaymentMethod}
                onValueChange={(v: FuelPaymentMethod) => setAdvancePaymentMethod(v)}
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
                Observações / Justificativa
              </label>
              <Input
                placeholder="Ex: Adiantamento semanal de gasolina ou abastecimento extra"
                value={advanceNotes}
                onChange={(e) => setAdvanceNotes(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsNewFuelAdvanceModalOpen(false)}
                className="h-9 text-xs"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isCreatingAdvance}
                className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5 shadow-md shadow-emerald-600/20"
              >
                {isCreatingAdvance ? 'Gravando...' : 'Confirmar Adiantamento'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
                  <SelectItem value="seller">🏪 Lojista (Painel & Registro de Vendas)</SelectItem>
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
                      <SelectItem value="moto">🏍️ Moto (35 km/L)</SelectItem>
                      <SelectItem value="carro">🚗 Carro (12 km/L)</SelectItem>
                      <SelectItem value="caminhao">🚚 Caminhão (7 km/L)</SelectItem>
                      <SelectItem value="bicicleta">🚲 Bicicleta</SelectItem>
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

      {/* MODAL DETALHADO DE HISTÓRICO DE ENTREGAS, KM, COMBUSTÍVEL E DESVIOS */}
      <CourierDeliveryHistoryModal
        isOpen={isCourierHistoryModalOpen}
        onClose={() => {
          setIsCourierHistoryModalOpen(false)
          setSelectedCourierForHistory(null)
        }}
        courier={selectedCourierForHistory}
        fuelAccount={
          selectedCourierForHistory
            ? currentFuelAccounts.find((a) => a.courier.id === selectedCourierForHistory.id) || null
            : null
        }
        orders={orders}
        offRouteEvents={offRouteEvents}
        locations={locations}
        settings={settings}
      />

      {/* ================= MODAL: CADASTRAR NOVO VENDEDOR ================= */}
      <CreateSellerModal
        open={isCreateSellerModalOpen}
        onOpenChange={setIsCreateSellerModalOpen}
        onSellerCreated={loadData}
      />

      {/* ================= MODAL: EDITAR VENDEDOR ================= */}
      <EditSellerModal
        seller={selectedSellerForEdit}
        open={isEditSellerModalOpen}
        onOpenChange={(open) => {
          setIsEditSellerModalOpen(open)
          if (!open) setSelectedSellerForEdit(null)
        }}
        onSellerUpdated={loadData}
        currentAdminId={user?.id}
      />
    </div>
  )
}

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
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
  MapPin,
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
  Route,
} from 'lucide-react'
import { Header } from '@/components/Header'
import { Sidebar } from '@/components/Sidebar'
import { AiLogisticsAssistant } from '@/components/AiLogisticsAssistant'
import { Suspense, lazy } from 'react'
import { CourierDeliveryHistoryModal } from '@/components/CourierDeliveryHistoryModal'
import { CreateSellerModal } from '@/components/CreateSellerModal'
import { EditSellerModal } from '@/components/EditSellerModal'
import { EditUserModal } from '@/components/EditUserModal'
import { SiteContentManager } from '@/components/SiteContentManager'
import { CreateCustomerModal } from '@/components/CreateCustomerModal'

// Lazy loading das seções pesadas com named exports
const ControlTower = lazy(() =>
  import('@/components/ControlTower').then((m) => ({ default: m.ControlTower })),
)
const ReportsSection = lazy(() =>
  import('@/components/ReportsSection').then((m) => ({ default: m.ReportsSection })),
)
const CustomerAddressAuditModal = lazy(() =>
  import('@/components/CustomerAddressAuditModal').then((m) => ({
    default: m.CustomerAddressAuditModal,
  })),
)
const KmAuditReport = lazy(() =>
  import('@/components/KmAuditReport').then((m) => ({ default: m.KmAuditReport })),
)
const AuditTrailSection = lazy(() =>
  import('@/components/AuditTrailSection').then((m) => ({ default: m.AuditTrailSection })),
)
const BatchReconciliationSection = lazy(() =>
  import('@/components/BatchReconciliationSection').then((m) => ({
    default: m.BatchReconciliationSection,
  })),
)

function SectionSkeleton() {
  return (
    <div className="space-y-4 p-4 animate-pulse">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="h-28 rounded-xl bg-slate-200 dark:bg-slate-800" />
        <div className="h-28 rounded-xl bg-slate-200 dark:bg-slate-800" />
        <div className="h-28 rounded-xl bg-slate-200 dark:bg-slate-800" />
      </div>
      <div className="h-64 rounded-xl bg-slate-200 dark:bg-slate-800" />
    </div>
  )
}
import { SuspiciousAddressesBox } from '@/components/SuspiciousAddressesBox'
import { CustomerQualityReport } from '@/components/CustomerQualityReport'
import { CustomerDuplicatesPanel } from '@/components/CustomerDuplicatesPanel'
import { FuelAdvanceModal } from '@/components/FuelAdvanceModal'
import { Globe, KeyRound, Lock, ShieldAlert } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChangePasswordModal } from '@/components/ChangePasswordModal'
import { useAuth } from '@/contexts/AuthContext'
import { useCompany } from '@/contexts/CompanyContext'
import { deliveryService } from '@/services/deliveryService'
import { fuelAccountService } from '@/services/fuelAccountService'
import { getMyCompany, type ResolvedCompany } from '@/lib/companyResolver'
import {
  getOperationalWindow,
  formatPbTimestamp,
  getOperationalMonthStart,
} from '@/lib/operationalWindow'
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
  CustomerRecord,
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
import { useRealtime } from '@/hooks/use-realtime'
import { APP_VERSION_LABEL } from '@/lib/version'

interface AdminDashboardProps {
  defaultTab?:
    | 'overview'
    | 'control-tower'
    | 'reports'
    | 'fuel'
    | 'km-audit'
    | 'batch-reconciliation'
    | 'deviations'
    | 'audit-trail'
    | 'settings'
    | 'site-content'
    | 'couriers'
    | 'sellers'
}

export default function AdminDashboard({ defaultTab = 'overview' }: AdminDashboardProps) {
  const { user } = useAuth()
  const { currentCompany } = useCompany()
  const location = useLocation()
  const navigate = useNavigate()
  const [resolvedCompany, setResolvedCompany] = useState<ResolvedCompany | null>(null)
  const [isLoadingCompanyGate, setIsLoadingCompanyGate] = useState(true)
  const [companyGateTimedOut, setCompanyGateTimedOut] = useState(false)
  const [resolvedCompanySource, setResolvedCompanySource] = useState<string>('')

  // Timeout defensivo de 8s para o portão da empresa: nunca travar a tela se a resolução atrasar
  useEffect(() => {
    if (!isLoadingCompanyGate) {
      setCompanyGateTimedOut(false)
      return
    }
    const timer = setTimeout(() => {
      setCompanyGateTimedOut(true)
    }, 8000)
    return () => clearTimeout(timer)
  }, [isLoadingCompanyGate])
  const [isDiagExpanded, setIsDiagExpanded] = useState(false)
  const [orders, setOrders] = useState<OrderRecord[]>([])
  const [users, setUsers] = useState<UserRecord[]>([])
  const [couriers, setCouriers] = useState<UserRecord[]>([])
  const [sellers, setSellers] = useState<UserRecord[]>([])
  const [locations, setLocations] = useState<LocationRecord[]>([])
  const [notifications, setNotifications] = useState<NotificationRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedCourierId, setSelectedCourierId] = useState<string | null>(null)
  const [selectedCourierForHistory, setSelectedCourierForHistory] = useState<UserRecord | null>(
    null,
  )
  const [isCourierHistoryModalOpen, setIsCourierHistoryModalOpen] = useState(false)

  // Ler query param ?tab=km-audit ou ?tab=deviations se existir
  const queryParams = new URLSearchParams(location.search)
  const tabFromQuery = queryParams.get('tab') as
    | 'overview'
    | 'control-tower'
    | 'reports'
    | 'fuel'
    | 'km-audit'
    | 'batch-reconciliation'
    | 'deviations'
    | 'audit-trail'
    | 'settings'
    | 'site-content'
    | 'couriers'
    | 'sellers'
    | 'customers'
    | null

  const [activeTab, setActiveTab] = useState<
    | 'overview'
    | 'control-tower'
    | 'reports'
    | 'fuel'
    | 'km-audit'
    | 'batch-reconciliation'
    | 'deviations'
    | 'audit-trail'
    | 'settings'
    | 'site-content'
    | 'couriers'
    | 'sellers'
    | 'customers'
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
        'km-audit',
        'batch-reconciliation',
        'deviations',
        'audit-trail',
        'settings',
        'site-content',
        'couriers',
        'sellers',
        'customers',
      ].includes(qTab)
    ) {
      setActiveTab(qTab)
    } else if (defaultTab) {
      setActiveTab(defaultTab)
    }
  }, [location.search, defaultTab])

  // Listener para evento rotaly:open-address-alerts e hash #enderecos-suspeitos
  useEffect(() => {
    const scrollToSuspiciousBox = () => {
      setActiveTab('overview')
      setTimeout(() => {
        const el = document.getElementById('suspicious-addresses-box')
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      }, 150)
    }

    const handleOpenAddressAlerts = () => {
      scrollToSuspiciousBox()
    }

    window.addEventListener('rotaly:open-address-alerts', handleOpenAddressAlerts)

    if (window.location.hash === '#enderecos-suspeitos') {
      scrollToSuspiciousBox()
    }

    return () => {
      window.removeEventListener('rotaly:open-address-alerts', handleOpenAddressAlerts)
    }
  }, [])

  const [searchCouriers, setSearchCouriers] = useState('')
  const [courierStatusFilter, setCourierStatusFilter] = useState<string>('all')
  const [searchSellers, setSearchSellers] = useState('')

  // Settings State: Moto, Carro e Caminhão (Preço do litro e consumo km/L)
  const [settings, setSettings] = useState<AppSettingsRecord | null>(null)

  // Draft unificado para os 10 campos de configurações operacionais
  interface SettingsDraft {
    motoPrice: string
    motoCons: string
    carroPrice: string
    carroCons: string
    caminhaoPrice: string
    caminhaoCons: string
    workStart: string
    lunchStart: string
    lunchEnd: string
    workEnd: string
  }

  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft>({
    motoPrice: '6.49',
    motoCons: '35.0',
    carroPrice: '6.49',
    carroCons: '12.0',
    caminhaoPrice: '6.49',
    caminhaoCons: '7.0',
    workStart: '08:00',
    lunchStart: '12:00',
    lunchEnd: '13:00',
    workEnd: '18:30',
  })

  // Aliases controlados para compatibilidade com os inputs e cálculos existentes
  const motoPriceInput = settingsDraft.motoPrice
  const motoConsInput = settingsDraft.motoCons
  const carroPriceInput = settingsDraft.carroPrice
  const carroConsInput = settingsDraft.carroCons
  const caminhaoPriceInput = settingsDraft.caminhaoPrice
  const caminhaoConsInput = settingsDraft.caminhaoCons
  const workStartTimeInput = settingsDraft.workStart
  const lunchStartTimeInput = settingsDraft.lunchStart
  const lunchEndTimeInput = settingsDraft.lunchEnd
  const workEndTimeInput = settingsDraft.workEnd

  // Rastreamento de quais campos foram modificados pelo usuário e estão "sujos" (pendentes de salvar)
  const dirtyFieldsRef = useRef<Set<keyof SettingsDraft>>(new Set())
  const isInitialSettingsLoadedRef = useRef<boolean>(false)

  const markFieldDirty = (field: keyof SettingsDraft) => {
    dirtyFieldsRef.current.add(field)
  }

  const setMotoPriceInput = (val: string) => {
    markFieldDirty('motoPrice')
    setSettingsDraft((prev) => ({ ...prev, motoPrice: val }))
  }
  const setMotoConsInput = (val: string) => {
    markFieldDirty('motoCons')
    setSettingsDraft((prev) => ({ ...prev, motoCons: val }))
  }
  const setCarroPriceInput = (val: string) => {
    markFieldDirty('carroPrice')
    setSettingsDraft((prev) => ({ ...prev, carroPrice: val }))
  }
  const setCarroConsInput = (val: string) => {
    markFieldDirty('carroCons')
    setSettingsDraft((prev) => ({ ...prev, carroCons: val }))
  }
  const setCaminhaoPriceInput = (val: string) => {
    markFieldDirty('caminhaoPrice')
    setSettingsDraft((prev) => ({ ...prev, caminhaoPrice: val }))
  }
  const setCaminhaoConsInput = (val: string) => {
    markFieldDirty('caminhaoCons')
    setSettingsDraft((prev) => ({ ...prev, caminhaoCons: val }))
  }
  const setWorkStartTimeInput = (val: string) => {
    markFieldDirty('workStart')
    setSettingsDraft((prev) => ({ ...prev, workStart: val }))
  }
  const setLunchStartTimeInput = (val: string) => {
    markFieldDirty('lunchStart')
    setSettingsDraft((prev) => ({ ...prev, lunchStart: val }))
  }
  const setLunchEndTimeInput = (val: string) => {
    markFieldDirty('lunchEnd')
    setSettingsDraft((prev) => ({ ...prev, lunchEnd: val }))
  }
  const setWorkEndTimeInput = (val: string) => {
    markFieldDirty('workEnd')
    setSettingsDraft((prev) => ({ ...prev, workEnd: val }))
  }

  // Helper para converter AppSettingsRecord em formato SettingsDraft com guarda defensiva
  const convertRecordToDraft = (appSettings?: AppSettingsRecord | null): SettingsDraft => {
    const fallbackPrice = appSettings?.fuel_price_per_liter ?? 6.49
    return {
      motoPrice: String(appSettings?.moto_fuel_price ?? fallbackPrice),
      motoCons: String(
        appSettings?.moto_consumption_kml ?? appSettings?.fuel_consumption_kml ?? 35.0,
      ),
      carroPrice: String(appSettings?.carro_fuel_price ?? fallbackPrice),
      carroCons: String(appSettings?.carro_consumption_kml ?? 12.0),
      caminhaoPrice: String(appSettings?.caminhao_fuel_price ?? fallbackPrice),
      caminhaoCons: String(appSettings?.caminhao_consumption_kml ?? 7.0),
      workStart: appSettings?.work_start_time || '08:00',
      lunchStart: appSettings?.lunch_start_time || '12:00',
      lunchEnd: appSettings?.lunch_end_time || '13:00',
      workEnd: appSettings?.work_end_time || '18:30',
    }
  }

  // Sincroniza campos do draft a partir do registro do servidor preservando campos com edições não salvas
  const syncDraftFromServer = (rec?: AppSettingsRecord | null, forceAll = false) => {
    const serverDraft = convertRecordToDraft(rec)
    setSettingsDraft((prev) => {
      const next = { ...prev }
      ;(Object.keys(serverDraft) as (keyof SettingsDraft)[]).forEach((key) => {
        if (forceAll || !dirtyFieldsRef.current.has(key)) {
          next[key] = serverDraft[key]
        }
      })
      return next
    })
    if (forceAll) {
      dirtyFieldsRef.current.clear()
    }
  }

  // Work Shift Settings (Jornada de Trabalho da Empresa)
  const [isSavingShiftSettings, setIsSavingShiftSettings] = useState(false)

  const [isSavingSettings, setIsSavingSettings] = useState(false)
  const [savingCategory, setSavingCategory] = useState<string | null>(null)

  // Fuel Advances & Current Accounts State (REQUISITO 5)
  const [fuelAdvances, setFuelAdvances] = useState<FuelAdvanceRecord[]>([])
  const [fuelAccounts, setFuelAccounts] = useState<CourierFuelAccount[]>([])
  const [fuelHistoryOrders, setFuelHistoryOrders] = useState<OrderRecord[]>([])
  const [isLoadingFuelOrders, setIsLoadingFuelOrders] = useState(false)
  const [loadedFuelPeriod, setLoadedFuelPeriod] = useState<string | null>(null)
  const fuelOrdersCacheRef = useRef<Map<string, { data: OrderRecord[]; timestamp: number }>>(
    new Map(),
  )
  const [selectedCourierForFuelFilter, setSelectedCourierForFuelFilter] = useState<string>('all')
  const [fuelPeriodFilter, setFuelPeriodFilter] = useState<'all' | 'month' | 'week' | 'today'>(
    'week',
  )
  const [isNewFuelAdvanceModalOpen, setIsNewFuelAdvanceModalOpen] = useState(false)
  const [advanceCourierId, setAdvanceCourierId] = useState('')

  // Off-Route & Deviations State (REQUISITO 2)
  const [offRouteEvents, setOffRouteEvents] = useState<OffRouteEventRecord[]>([])
  const [offRouteFilterType, setOffRouteFilterType] = useState<string>('all')
  const [offRouteCourierFilter, setOffRouteCourierFilter] = useState<string>('all')

  // Reviews State (REQUISITO 4)
  const [reviews, setReviews] = useState<ReviewRecord[]>([])

  // Report Period Filter
  const [reportPeriod, setReportPeriod] = useState<'all' | 'today' | 'week' | 'month'>('all')

  // Change Password Modal state (Admin logado)
  const [isChangePasswordModalOpen, setIsChangePasswordModalOpen] = useState(false)

  // View Documents Modal state
  const [selectedUserForDocs, setSelectedUserForDocs] = useState<UserRecord | null>(null)
  const [isDocsModalOpen, setIsDocsModalOpen] = useState(false)

  // Seller Modals state
  const [isCreateSellerModalOpen, setIsCreateSellerModalOpen] = useState(false)
  const [isEditSellerModalOpen, setIsEditSellerModalOpen] = useState(false)
  const [selectedSellerForEdit, setSelectedSellerForEdit] = useState<UserRecord | null>(null)

  // Edit User Modal state (Entregadores e Vendedores unificados com troca de senha e login)
  const [isEditUserModalOpen, setIsEditUserModalOpen] = useState(false)
  const [selectedUserForEdit, setSelectedUserForEdit] = useState<UserRecord | null>(null)

  // New user modal state
  const [isNewUserModalOpen, setIsNewUserModalOpen] = useState(false)
  const [isCustomerAddressAuditModalOpen, setIsCustomerAddressAuditModalOpen] = useState(false)
  const [isCreateCustomerModalOpen, setIsCreateCustomerModalOpen] = useState(false)
  const [customerToEdit, setCustomerToEdit] = useState<CustomerRecord | null>(null)
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [newUserName, setNewUserName] = useState('')
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserPhone, setNewUserPhone] = useState('')
  const [newUserPassword, setNewUserPassword] = useState('Skip@Pass')
  const [newUserRole, setNewUserRole] = useState<'seller' | 'courier'>('courier')
  const [newUserVehicleType, setNewUserVehicleType] = useState<VehicleType>('moto')
  const [newUserVehicleModel, setNewUserVehicleModel] = useState('')
  const [newUserVehiclePlate, setNewUserVehiclePlate] = useState('')
  const [isCreatingUser, setIsCreatingUser] = useState(false)
  const [isLinkingExistingUser, setIsLinkingExistingUser] = useState(false)
  const [existingUserPromptEmail, setExistingUserPromptEmail] = useState<string | null>(null)

  // Status changing state
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null)

  const loadData = async () => {
    try {
      setIsLoading(true)
      setLoadError(null)

      // Se a aba de combustível estiver ativa, recarrega o histórico de combustível também
      if (activeTab === 'fuel' || isCourierHistoryModalOpen) {
        fetchFuelHistoryOrders(true)
      }

      // A) Obter empresa do contexto ativo ou resolver dinamicamente
      const companyId = currentCompany?.id || (await deliveryService.getMatrizCompanyId()) || ''
      const companyName =
        currentCompany?.nome_fantasia || currentCompany?.nome_razao_social || 'Rotaly Operações'
      const resolvedInfo: ResolvedCompany = {
        id: companyId,
        name: companyName,
        source: 'single_company_matriz',
      }
      setResolvedCompanySource(companyName)
      setResolvedCompany(resolvedInfo)
      setIsLoadingCompanyGate(false)

      const currentOpWindow = getOperationalWindow(new Date())
      const windowStart =
        currentOpWindow.startPbString ||
        new Date(currentOpWindow.start).toISOString().replace('T', ' ')
      const windowEnd =
        currentOpWindow.endPbString || new Date(currentOpWindow.end).toISOString().replace('T', ' ')
      const ordersFilter = `(created >= '${windowStart}' && created <= '${windowEnd}') || (route_started = true && route_finished != true) || (route_released != true && (status = 'pending' || status = 'assigned'))`

      // ETAPA 1 (imediata): pedidos + entregadores + telemetria de locais com fallback seguro
      // Libera imediatamente a renderização dos cards do Kanban, mapa e entregadores
      const [ordersData, couriersData, locationsData] = await Promise.all([
        deliveryService
          .getOrders(ordersFilter, '-created', 'customer_id,courier_id,seller_id')
          .catch((err) => {
            console.warn('[AdminDashboard] Falha ao carregar pedidos:', err)
            return [] as OrderRecord[]
          }),
        deliveryService.getCouriers(companyId).catch((err) => {
          console.warn('[AdminDashboard] Falha ao carregar entregadores:', err)
          return [] as UserRecord[]
        }),
        deliveryService.getLatestLocations().catch(() => [] as LocationRecord[]),
      ])
      setOrders(ordersData)
      setCouriers(couriersData)
      setLocations(locationsData)
      setIsLoading(false)

      // ETAPA 2: usuários, vendedores, notificações, configurações, adiantamentos, eventos e avaliações
      // Cada query possui tratamento resiliente individual com fallback defensivo para nunca zerar listas
      const [
        usersData,
        sellersData,
        notifsData,
        appSettings,
        advancesData,
        eventsData,
        reviewsData,
        customersData,
      ] = await Promise.all([
        deliveryService.getAllUsers(companyId).catch((err) => {
          console.warn('[AdminDashboard] Falha ao carregar usuários:', err)
          return [] as UserRecord[]
        }),
        deliveryService.getSellers(companyId).catch((err) => {
          console.warn('[AdminDashboard] Falha ao carregar vendedores:', err)
          return [] as UserRecord[]
        }),
        deliveryService.getNotifications().catch(() => []),
        deliveryService.getSettings().catch(() => null),
        deliveryService
          .getFuelAdvances('', '-date,-created', 'courier_id,created_by', companyId)
          .catch((err) => {
            console.warn('[AdminDashboard] Falha ao carregar adiantamentos de combustível:', err)
            return [] as FuelAdvanceRecord[]
          }),
        deliveryService.getOffRouteEvents().catch(() => [] as OffRouteEventRecord[]),
        deliveryService.getReviews().catch(() => []),
        deliveryService.getCustomers().catch(() => []),
      ])

      setUsers(usersData)
      setSellers(sellersData)
      setNotifications(notifsData)
      setSettings(appSettings)
      setFuelAdvances(advancesData)
      setFuelAccounts([])
      setOffRouteEvents(eventsData)
      setReviews(reviewsData)
      setCustomers(customersData)

      // CORREÇÃO (B): sincroniza o draft a partir do servidor somente se ainda for carga inicial
      // ou apenas para campos que NÃO estejam "sujos" com edições do usuário
      if (!isInitialSettingsLoadedRef.current) {
        syncDraftFromServer(appSettings, true)
        isInitialSettingsLoadedRef.current = true
      } else {
        syncDraftFromServer(appSettings, false)
      }
    } catch (err) {
      console.error('Error loading admin data:', err)
      // Falhas secundárias não devem exibir banner vermelho intrusivo
      // O banner loadError global é reservado para falhas críticas de infraestrutura
      setLoadError(null)
      setIsLoading(false)
    }
  }

  // Delete Fuel Advance
  const handleDeleteFuelAdvance = async (id: string) => {
    if (!window.confirm('Tem certeza que deseja excluir este registro de adiantamento?')) return
    try {
      await deliveryService.deleteFuelAdvance(id)
      toast.success('Adiantamento excluído com sucesso.')
      await Promise.all([loadData(), fetchFuelHistoryOrders(true)])
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
  }, [currentCompany?.id])

  useEffect(() => {
    const handleCompanyChange = () => {
      loadData()
    }
    window.addEventListener('rotaly_company_changed', handleCompanyChange)
    return () => {
      window.removeEventListener('rotaly_company_changed', handleCompanyChange)
    }
  }, [])

  // CORREÇÃO (B): Sincronizar inputs controlados quando settings mudar do backend
  // SOMENTE para campos que NÃO estejam com edições pendentes locais do usuário
  useEffect(() => {
    if (settings) {
      if (!isInitialSettingsLoadedRef.current) {
        syncDraftFromServer(settings, true)
        isInitialSettingsLoadedRef.current = true
      } else {
        syncDraftFromServer(settings, false)
      }
    }
  }, [settings])

  // Assinar realtime da coleção app_settings para refletir qualquer alteração sem sobrescrever edições ativas
  useRealtime<AppSettingsRecord>('app_settings', (e) => {
    if (e.action === 'update' || e.action === 'create') {
      const rec = e.record
      setSettings(rec)
      syncDraftFromServer(rec, false)
    }
  })

  // Assinar realtime da coleção fuel_advances para refletir adiantamentos/cancelamentos/ajustes instantaneamente
  useRealtime<FuelAdvanceRecord>('fuel_advances', () => {
    loadData()
    if (activeTab === 'fuel' || isCourierHistoryModalOpen) {
      fetchFuelHistoryOrders(true)
    }
  })

  // Save Admin Settings (all categories in batch)
  // CORREÇÃO (C): Alinhado com recarregamento completo loadData(), sincronização total e limpeza de dirty
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

      const updated = (await deliveryService.updateSettings({
        fuel_price_per_liter: motoPrice,
        fuel_consumption_kml: motoCons,
        moto_fuel_price: motoPrice,
        moto_consumption_kml: motoCons,
        carro_fuel_price: carroPrice,
        carro_consumption_kml: carroCons,
        caminhao_fuel_price: caminhaoPrice,
        caminhao_consumption_kml: caminhaoCons,
      })) as AppSettingsRecord

      // Atualiza o estado oficial e sincroniza todos os 6 campos de combustível
      setSettings(updated)
      ;(
        [
          'motoPrice',
          'motoCons',
          'carroPrice',
          'carroCons',
          'caminhaoPrice',
          'caminhaoCons',
        ] as (keyof SettingsDraft)[]
      ).forEach((k) => dirtyFieldsRef.current.delete(k))
      syncDraftFromServer(updated, false)
      toast.success('Todos os parâmetros de combustível (Moto, Carro, Caminhão) foram salvos!')
      await loadData()
    } catch (err) {
      console.error('Error saving settings:', err)
      const errorMsg = getErrorMessage(err)
      toast.error(
        errorMsg ? `Erro ao salvar configurações: ${errorMsg}` : 'Erro ao salvar configurações.',
      )
    } finally {
      setIsSavingSettings(false)
    }
  }

  // Save Work Shift Settings (Jornada de Trabalho)
  const handleSaveWorkShiftSettings = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    setIsSavingShiftSettings(true)
    try {
      const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/
      if (!timeRegex.test(workStartTimeInput.trim())) {
        toast.error('Informe um horário de entrada válido no formato HH:mm (ex: 08:00).')
        setIsSavingShiftSettings(false)
        return
      }
      if (!timeRegex.test(lunchStartTimeInput.trim())) {
        toast.error('Informe um horário de saída para almoço válido no formato HH:mm (ex: 12:00).')
        setIsSavingShiftSettings(false)
        return
      }
      if (!timeRegex.test(lunchEndTimeInput.trim())) {
        toast.error('Informe um horário de volta do almoço válido no formato HH:mm (ex: 13:00).')
        setIsSavingShiftSettings(false)
        return
      }
      if (!timeRegex.test(workEndTimeInput.trim())) {
        toast.error('Informe um horário de fim de expediente válido no formato HH:mm (ex: 18:30).')
        setIsSavingShiftSettings(false)
        return
      }

      const updated = (await deliveryService.updateSettings({
        work_start_time: workStartTimeInput.trim(),
        lunch_start_time: lunchStartTimeInput.trim(),
        lunch_end_time: lunchEndTimeInput.trim(),
        work_end_time: workEndTimeInput.trim(),
      })) as AppSettingsRecord

      // Atualizar inputs com o retorno garantido do backend
      if (updated) {
        setSettings(updated)
        ;(['workStart', 'lunchStart', 'lunchEnd', 'workEnd'] as (keyof SettingsDraft)[]).forEach(
          (k) => dirtyFieldsRef.current.delete(k),
        )
        syncDraftFromServer(updated, false)
      }
      toast.success('Jornada de trabalho da empresa atualizada com sucesso!')
      await loadData()
    } catch (err: unknown) {
      console.error('Error saving work shift settings:', err)
      const errorMsg = getErrorMessage(err)
      toast.error(
        errorMsg ? `Erro ao salvar jornada: ${errorMsg}` : 'Erro ao salvar jornada de trabalho.',
      )
    } finally {
      setIsSavingShiftSettings(false)
    }
  }

  // Save specific category individually
  // CORREÇÃO (C): Alerta caso haja alterações pendentes em outros cards de veículos
  const handleSaveIndividualCategory = async (category: 'moto' | 'carro' | 'caminhao') => {
    // Verificar se há edições pendentes em outros cards
    const otherDirtyCategories: string[] = []
    if (
      category !== 'moto' &&
      (dirtyFieldsRef.current.has('motoPrice') || dirtyFieldsRef.current.has('motoCons'))
    ) {
      otherDirtyCategories.push('Moto')
    }
    if (
      category !== 'carro' &&
      (dirtyFieldsRef.current.has('carroPrice') || dirtyFieldsRef.current.has('carroCons'))
    ) {
      otherDirtyCategories.push('Carro')
    }
    if (
      category !== 'caminhao' &&
      (dirtyFieldsRef.current.has('caminhaoPrice') || dirtyFieldsRef.current.has('caminhaoCons'))
    ) {
      otherDirtyCategories.push('Caminhão')
    }

    if (otherDirtyCategories.length > 0) {
      toast.warning(
        `Atenção: alterações não salvas em ${otherDirtyCategories.join(' e ')} permanecerão locais. Use "Salvar Todos em Lote" para gravar tudo.`,
        { duration: 4500 },
      )
    }

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

      const updated = (await deliveryService.updateSettings(payload)) as AppSettingsRecord
      if (updated) {
        setSettings(updated)
        // Limpar dirty fields apenas da categoria salva
        if (category === 'moto') {
          dirtyFieldsRef.current.delete('motoPrice')
          dirtyFieldsRef.current.delete('motoCons')
        } else if (category === 'carro') {
          dirtyFieldsRef.current.delete('carroPrice')
          dirtyFieldsRef.current.delete('carroCons')
        } else {
          dirtyFieldsRef.current.delete('caminhaoPrice')
          dirtyFieldsRef.current.delete('caminhaoCons')
        }
        syncDraftFromServer(updated, false)
      }

      const label = category === 'moto' ? 'Moto' : category === 'carro' ? 'Carro' : 'Caminhão'
      toast.success(`Parâmetros de ${label} salvos com sucesso!`)
      await loadData()
    } catch (err: unknown) {
      console.error('Error saving category settings:', err)
      const errorMsg = getErrorMessage(err)
      toast.error(
        errorMsg
          ? `Erro ao salvar parâmetros da categoria: ${errorMsg}`
          : 'Erro ao salvar parâmetros da categoria.',
      )
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
    const senha = (newUserPassword || '').trim()

    if (!trimmedName || !trimmedEmail) {
      toast.error('Preencha nome e e-mail.')
      return
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(trimmedEmail)) {
      toast.error('Por favor, insira um e-mail válido.')
      return
    }

    if (!senha || senha.length < 8) {
      toast.error('A senha deve ter pelo menos 8 caracteres.')
      return
    }

    setExistingUserPromptEmail(null)
    setIsCreatingUser(true)
    try {
      const activeCompanyId =
        currentCompany?.id || (await deliveryService.getMatrizCompanyId()) || ''
      await deliveryService.createUser(
        {
          name: trimmedName,
          email: trimmedEmail,
          phone: trimmedPhone,
          password: senha,
          passwordConfirm: senha,
          role: newUserRole,
          status: 'active',
          ...(newUserRole === 'courier'
            ? {
                vehicle_type: newUserVehicleType,
                vehicle_model: newUserVehicleModel.trim(),
                vehicle_plate: newUserVehiclePlate.trim().toUpperCase(),
              }
            : {}),
        },
        activeCompanyId,
      )

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
      setExistingUserPromptEmail(null)
      loadData()
    } catch (err: unknown) {
      console.error('Error creating user:', err)
      const msg = getErrorMessage(err)
      toast.error(msg || 'Falha ao cadastrar novo usuário.')

      // Se falhar por e-mail já existente, ativa a opção de vincular usuário existente
      const errStr = String((err as any)?.message || '')
      const isUniqueError =
        msg.includes('já está cadastrado') ||
        errStr.toLowerCase().includes('unique') ||
        errStr.toLowerCase().includes('already exists')
      if (isUniqueError) {
        setExistingUserPromptEmail(trimmedEmail)
      }
    } finally {
      setIsCreatingUser(false)
    }
  }

  const handleLinkExistingUser = async () => {
    const emailToLink = (existingUserPromptEmail || newUserEmail).trim().toLowerCase()
    if (!emailToLink) {
      toast.error('Informe o e-mail do usuário a ser vinculado.')
      return
    }

    setIsLinkingExistingUser(true)
    try {
      const activeCompanyId =
        currentCompany?.id || (await deliveryService.getMatrizCompanyId()) || ''
      const res = await deliveryService.linkExistingUserToCompany({
        email: emailToLink,
        empresaId: activeCompanyId,
        role: newUserRole,
      })

      if (res.alreadyLinked) {
        toast.info(res.message)
      } else {
        toast.success(res.message)
      }

      setIsNewUserModalOpen(false)
      setNewUserName('')
      setNewUserEmail('')
      setNewUserPhone('')
      setNewUserPassword('Skip@Pass')
      setNewUserVehicleModel('')
      setNewUserVehiclePlate('')
      setExistingUserPromptEmail(null)
      loadData()
    } catch (err: unknown) {
      console.error('Error linking existing user:', err)
      const msg = getErrorMessage(err)
      toast.error(msg || 'Não foi possível vincular o usuário existente à empresa.')
    } finally {
      setIsLinkingExistingUser(false)
    }
  }

  // Deduplicação defensiva das listas de couriers e sellers por ID de usuário
  const deduplicatedCouriers = useMemo(() => {
    const map = new Map<string, UserRecord>()
    for (const c of couriers) {
      if (c && c.id && !map.has(c.id)) {
        map.set(c.id, c)
      }
    }
    return Array.from(map.values())
  }, [couriers])

  const deduplicatedSellers = useMemo(() => {
    const map = new Map<string, UserRecord>()
    for (const s of sellers) {
      if (s && s.id && !map.has(s.id)) {
        map.set(s.id, s)
      }
    }
    return Array.from(map.values())
  }, [sellers])

  // Filtered lists baseadas nos estados alimentados pela coleção membros
  const pendingCouriers = deduplicatedCouriers.filter((c) => c.status === 'pending')
  const activeCouriers = deduplicatedCouriers.filter(
    (c) => c.status === 'active' || c.status === 'idle' || c.status === 'busy',
  )
  const inactiveCouriers = deduplicatedCouriers.filter((c) => c.status === 'inactive')

  const filteredCouriers = deduplicatedCouriers.filter((c) => {
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

  const filteredSellers = deduplicatedSellers.filter((s) => {
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

  // Basic Metrics (excluindo erros de sistema neutralizados de cancelamentos/ocorrências)
  const isNeutralizedOrder = (o: OrderRecord) => {
    const notesLower = o.notes ? o.notes.toLowerCase() : ''
    return notesLower.includes('erro de sistema')
  }
  const cleanReportOrders = filteredReportOrders.filter((o) => !isNeutralizedOrder(o))
  const totalOrders = orders.filter((o) => !isNeutralizedOrder(o)).length
  const reportTotalOrders = cleanReportOrders.length
  const deliveredOrders = cleanReportOrders.filter((o) => o.status === 'delivered')
  const addressErrorOrders = cleanReportOrders.filter((o) => o.status === 'address_error')
  const clientAbsentOrders = cleanReportOrders.filter((o) => o.status === 'client_absent')
  const inTransitOrders = cleanReportOrders.filter((o) => o.status === 'in_transit')
  const pendingOrders = cleanReportOrders.filter((o) => o.status === 'pending')
  const cancelledOrders = cleanReportOrders.filter((o) => o.status === 'cancelled')

  // Total Value / Revenue
  const reportTotalValue = filteredReportOrders
    .filter((o) => o.status !== 'cancelled')
    .reduce((acc, o) => acc + (Number(o.total_price) || 0), 0)

  const reportDeliveredValue = deliveredOrders.reduce(
    (acc, o) => acc + (Number(o.total_price) || 0),
    0,
  )

  // REQUISITO 1: Quilometragem e consumo por veículo — cálculo LAZY executado apenas quando a aba de relatórios estiver aberta
  const isReportsTabActive = activeTab === 'reports'
  const { totalKmRodada, totalFuelCostCalculated } = useMemo(() => {
    let km = 0
    let fuel = 0
    if (!isReportsTabActive) {
      return { totalKmRodada: 0, totalFuelCostCalculated: 0 }
    }
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
        km += orderKm

        // Obter veículo do entregador
        const courier = users.find((u) => u.id === o.courier_id) || o.expand?.courier_id
        const vehicleType = courier?.vehicle_type || 'moto'
        const { pricePerLiter, consumptionKml, category } = deliveryService.getVehicleFuelParams(
          settings,
          vehicleType,
        )

        if (category !== 'bicicleta' && consumptionKml > 0 && pricePerLiter > 0) {
          fuel += (orderKm * pricePerLiter) / consumptionKml
        }
      }
    })
    return { totalKmRodada: km, totalFuelCostCalculated: fuel }
  }, [isReportsTabActive, filteredReportOrders, locations, offRouteEvents, orders, users, settings])

  // Carregamento sob demanda dos pedidos históricos de combustível com cache em memória (5 min)
  const isFuelViewActive = activeTab === 'fuel' || isCourierHistoryModalOpen

  // Versão de sincronização global para invalidar caches legados e forçar recarga imediata
  const FUEL_GLOBAL_VERSION = 'v0091_canonical_balance_sync'

  // Pool completo pós-corte para apuração do saldo canônico (independente do fuelPeriodFilter)
  const [allPostCutoffOrdersPool, setAllPostCutoffOrdersPool] = useState<OrderRecord[]>([])

  const fetchFuelHistoryOrders = useCallback(
    async (forceRefresh = false) => {
      const cacheKey = `${fuelPeriodFilter}_${FUEL_GLOBAL_VERSION}`
      const fullCacheKey = `full_post_cutoff_${FUEL_GLOBAL_VERSION}`
      const now = Date.now()
      const cached = fuelOrdersCacheRef.current.get(cacheKey)
      const cachedFull = fuelOrdersCacheRef.current.get(fullCacheKey)

      if (cachedFull && !forceRefresh) {
        setAllPostCutoffOrdersPool(cachedFull.data)
      }

      if (!forceRefresh && cached && now - cached.timestamp < 5 * 60 * 1000) {
        setFuelHistoryOrders(cached.data)
        setLoadedFuelPeriod(fuelPeriodFilter)
        return
      }

      let filter = ''
      const currentDate = new Date()

      const opWindow = getOperationalWindow(currentDate)

      if (fuelPeriodFilter === 'today') {
        // Pool amplo para cobrir route_finished_at, actual_arrival e created
        filter = `created >= '${opWindow.startPbString}' || route_finished_at >= '${opWindow.startPbString}' || actual_arrival >= '${opWindow.startPbString}'`
      } else if (fuelPeriodFilter === 'month') {
        const monthStart = getOperationalMonthStart(currentDate)
        filter = `created >= '${monthStart.pbString}' || route_finished_at >= '${monthStart.pbString}' || actual_arrival >= '${monthStart.pbString}'`
      } else if (fuelPeriodFilter === 'week') {
        const sevenDaysAgoStart = opWindow.start - 6 * 24 * 60 * 60 * 1000
        const startStr = new Date(sevenDaysAgoStart).toISOString().replace('T', ' ')
        filter = `created >= '${startStr}' || route_finished_at >= '${startStr}' || actual_arrival >= '${startStr}'`
      } else {
        filter = ''
      }

      setIsLoadingFuelOrders(true)
      try {
        // Busca paralela: pedidos do filtro + pedidos completos pós-corte se ainda não em cache
        const promises: [Promise<OrderRecord[]>, Promise<OrderRecord[]> | null] = [
          deliveryService.getOrdersInBatches(
            filter,
            '-created',
            'customer_id,courier_id,seller_id',
            200,
          ),
          !cachedFull || forceRefresh
            ? deliveryService.getOrdersInBatches(
                '', // histórico completo pós-corte
                '-created',
                'customer_id,courier_id,seller_id',
                300,
              )
            : null,
        ]

        const [fetched, fetchedFull] = await Promise.all(promises)
        fuelOrdersCacheRef.current.set(cacheKey, { data: fetched, timestamp: Date.now() })
        setFuelHistoryOrders(fetched)
        setLoadedFuelPeriod(fuelPeriodFilter)

        if (fetchedFull) {
          fuelOrdersCacheRef.current.set(fullCacheKey, { data: fetchedFull, timestamp: Date.now() })
          setAllPostCutoffOrdersPool(fetchedFull)
        }
      } catch (err) {
        console.error('Erro ao carregar pedidos de combustível do período:', err)
        // Fallback para orders do dia em caso de falha de rede
        setFuelHistoryOrders((prev) => (prev.length > 0 ? prev : orders))
        setLoadedFuelPeriod(fuelPeriodFilter)
      } finally {
        setIsLoadingFuelOrders(false)
      }
    },
    [fuelPeriodFilter, orders],
  )

  useEffect(() => {
    if (isFuelViewActive) {
      fetchFuelHistoryOrders()
    }
  }, [isFuelViewActive, fuelPeriodFilter, fetchFuelHistoryOrders])

  // Pedidos ativos para o cálculo de combustível: se já carregou ou está em cache, usa fuelHistoryOrders
  // Regra 2: fuelPeriodFilter alimenta APENAS "Gasto no Período" e "Km Rodado" (via activeFuelOrdersPool)
  const activeFuelOrdersPool =
    fuelHistoryOrders.length > 0 || loadedFuelPeriod === fuelPeriodFilter
      ? fuelHistoryOrders
      : orders

  // Pool completo pós-corte para o cálculo do saldo canônico
  const effectiveFullOrdersPool =
    allPostCutoffOrdersPool.length > 0
      ? allPostCutoffOrdersPool
      : fuelPeriodFilter === 'all'
        ? activeFuelOrdersPool
        : orders

  // Recalcular fuelAccounts com o motor único calculateCourierFuelMetrics via fuelAccountService / deliveryService
  // Regra 2: O card de saldo chama calculateAccountForCourier com o pool COMPLETO pós-corte (independente do filtro),
  // para receber o saldo canônico.
  const currentFuelAccounts = useMemo(() => {
    return couriers.map((courier) => {
      return fuelAccountService.calculateAccountForCourier({
        courier,
        advances: fuelAdvances,
        orders: activeFuelOrdersPool,
        settings,
        locations,
        offRouteEvents,
        periodFilter: fuelPeriodFilter,
        allPostCutoffOrders: effectiveFullOrdersPool,
      })
    })
  }, [
    couriers,
    fuelAdvances,
    activeFuelOrdersPool,
    effectiveFullOrdersPool,
    settings,
    locations,
    offRouteEvents,
    fuelPeriodFilter,
  ])

  // Filtered Fuel Advances by Courier & Period (REQUISITO 5)
  const filteredFuelAdvances = fuelAdvances.filter((adv) => {
    if (selectedCourierForFuelFilter !== 'all' && adv.courier_id !== selectedCourierForFuelFilter) {
      return false
    }
    const advDate = new Date(adv.date || adv.created)
    const now = new Date()
    const opWindow = getOperationalWindow(now)
    const advTs = advDate.getTime()
    if (fuelPeriodFilter === 'today') {
      return advTs >= opWindow.start && advTs <= opWindow.end
    }
    if (fuelPeriodFilter === 'month') {
      return advDate.getMonth() === now.getMonth() && advDate.getFullYear() === now.getFullYear()
    }
    if (fuelPeriodFilter === 'week') {
      const sevenDaysAgoStart = opWindow.start - 6 * 24 * 60 * 60 * 1000
      return advTs >= sevenDaysAgoStart
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
    <div className="min-h-screen bg-white text-[#002855] flex flex-col font-sans">
      <Header />

      {isLoadingCompanyGate ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-4 min-h-[60vh] bg-white">
          <div className="relative">
            <RefreshCw className="h-10 w-10 text-[#00A3FF] animate-spin" />
            <ShieldCheck className="h-5 w-5 text-[#002855] absolute -bottom-1 -right-1" />
          </div>
          <div className="text-center space-y-1 max-w-sm">
            <p className="text-sm font-semibold text-[#002855]">Carregando dados da empresa...</p>
            <p className="text-xs text-slate-500">
              Sincronizando filial ativa e vínculos operacionais
            </p>
            {companyGateTimedOut && (
              <div className="pt-3 space-y-2">
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 font-medium">
                  A sincronização da empresa demorou mais que o esperado.
                </p>
                <div className="flex justify-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setIsLoadingCompanyGate(false)
                    }}
                    className="text-xs"
                  >
                    Prosseguir mesmo assim
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setIsLoadingCompanyGate(true)
                      setCompanyGateTimedOut(false)
                      loadData()
                    }}
                    className="text-xs bg-[#00A3FF] text-white hover:bg-[#008CE0]"
                  >
                    Tentar novamente
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-1">
          <Sidebar />

          <main className="flex-1 p-4 sm:p-6 lg:p-8 space-y-6 overflow-y-auto max-w-[1600px] mx-auto w-full">
            {loadError && (
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="h-5 w-5 text-rose-500 shrink-0" />
                  <span className="text-sm font-medium">{loadError}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadData}
                  className="h-8 text-xs border-rose-300 text-rose-700 hover:bg-rose-100"
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  Tentar novamente
                </Button>
              </div>
            )}

            {/* Header Title & Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className="h-6 w-6 text-[#00A3FF]" />
                  <h1 className="font-heading text-2xl sm:text-3xl font-black tracking-tight text-[#002855]">
                    Painel Executivo &amp; Gestão Rotaly
                  </h1>
                </div>
                <p className="font-sans text-xs sm:text-sm text-slate-500 mt-1">
                  Controle global de entregadores, vendedores, aprovações de documentos e
                  telemetria.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadData}
                  className="h-9 gap-1.5 text-xs text-slate-700 border-slate-200 bg-white hover:bg-slate-50 rounded-xl"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 text-[#00A3FF] ${isLoading ? 'animate-spin' : ''}`}
                  />
                  Atualizar
                </Button>
                <Button
                  onClick={() => setIsChangePasswordModalOpen(true)}
                  variant="outline"
                  className="h-9 gap-2 text-xs border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 rounded-xl"
                >
                  <KeyRound className="h-4 w-4 text-amber-600" />
                  Trocar Senha
                </Button>
                <Button
                  onClick={() => setIsCustomerAddressAuditModalOpen(true)}
                  variant="outline"
                  className="h-9 gap-2 text-xs border-amber-400 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 rounded-xl font-semibold"
                >
                  <MapPin className="h-4 w-4 text-amber-600" />
                  Verificar Endereços no Mapa
                </Button>
                <Button
                  onClick={() => {
                    setCustomerToEdit(null)
                    setIsCreateCustomerModalOpen(true)
                  }}
                  className="h-9 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm rounded-xl transition duration-100"
                >
                  <UserPlus className="h-4 w-4 text-white" />
                  Cadastrar Cliente
                </Button>
                <Button
                  onClick={() => setIsNewUserModalOpen(true)}
                  className="h-9 gap-2 bg-[#00A3FF] hover:bg-[#008CE0] text-white font-bold text-xs shadow-sm rounded-xl transition duration-100"
                >
                  <UserPlus className="h-4 w-4 text-white" />
                  Cadastrar Usuário
                </Button>
              </div>
            </div>
            {/* MAIN TABS (Overview, Relatórios, Configurações, Entregadores, Vendedores, Clientes) */}
            <Tabs
              value={activeTab}
              onValueChange={(v) =>
                setActiveTab(
                  v as
                    | 'overview'
                    | 'control-tower'
                    | 'reports'
                    | 'fuel'
                    | 'km-audit'
                    | 'batch-reconciliation'
                    | 'deviations'
                    | 'audit-trail'
                    | 'settings'
                    | 'site-content'
                    | 'couriers'
                    | 'sellers'
                    | 'customers',
                )
              }
              className="space-y-6"
            >
              <TabsList className="bg-slate-100 p-1 border border-slate-200 rounded-xl flex flex-wrap gap-1 font-heading">
                <TabsTrigger
                  value="overview"
                  className="text-xs font-semibold text-slate-700 data-[state=active]:bg-white data-[state=active]:text-[#002855] data-[state=active]:shadow-xs rounded-lg"
                >
                  <BarChart3 className="h-3.5 w-3.5 mr-1.5 text-[#00A3FF]" />
                  Visão Geral
                </TabsTrigger>
                <TabsTrigger
                  value="control-tower"
                  className="text-xs font-semibold text-slate-700 data-[state=active]:bg-white data-[state=active]:text-[#002855] data-[state=active]:shadow-xs rounded-lg"
                >
                  <Compass className="h-3.5 w-3.5 mr-1.5 text-emerald-600" />
                  Torre de Controle
                </TabsTrigger>
                <TabsTrigger
                  value="reports"
                  className="text-xs font-semibold text-slate-700 data-[state=active]:bg-white data-[state=active]:text-[#002855] data-[state=active]:shadow-xs rounded-lg"
                >
                  <PieChart className="h-3.5 w-3.5 mr-1.5 text-[#00A3FF]" />
                  Relatórios Operacionais
                </TabsTrigger>
                <TabsTrigger
                  value="fuel"
                  className="text-xs font-semibold text-slate-700 data-[state=active]:bg-white data-[state=active]:text-[#002855] data-[state=active]:shadow-xs rounded-lg"
                >
                  <Wallet className="h-3.5 w-3.5 mr-1.5 text-emerald-600" />
                  Controle de Combustível
                </TabsTrigger>
                <TabsTrigger
                  value="km-audit"
                  className="text-xs font-semibold text-slate-700 data-[state=active]:bg-white data-[state=active]:text-[#002855] data-[state=active]:shadow-xs rounded-lg"
                >
                  <Route className="h-3.5 w-3.5 mr-1.5 text-[#0052CC]" />
                  Auditoria de KM
                </TabsTrigger>
                <TabsTrigger
                  value="batch-reconciliation"
                  className="text-xs font-semibold text-slate-700 data-[state=active]:bg-white data-[state=active]:text-[#002855] data-[state=active]:shadow-xs rounded-lg"
                >
                  <Compass className="h-3.5 w-3.5 mr-1.5 text-indigo-600" />
                  Reconciliação por Lote (3 Fontes)
                </TabsTrigger>
                <TabsTrigger
                  value="deviations"
                  className="text-xs font-semibold text-slate-700 data-[state=active]:bg-white data-[state=active]:text-[#002855] data-[state=active]:shadow-xs rounded-lg"
                >
                  <AlertTriangle className="h-3.5 w-3.5 mr-1.5 text-amber-500" />
                  Desvios &amp; Paradas ({offRouteEvents.length})
                </TabsTrigger>
                <TabsTrigger
                  value="audit-trail"
                  className="text-xs font-semibold text-slate-700 data-[state=active]:bg-white data-[state=active]:text-[#002855] data-[state=active]:shadow-xs rounded-lg"
                >
                  <ShieldAlert className="h-3.5 w-3.5 mr-1.5 text-[#0052CC]" />
                  Trilha de Auditoria
                </TabsTrigger>
                <TabsTrigger
                  value="settings"
                  className="text-xs font-semibold text-slate-700 data-[state=active]:bg-white data-[state=active]:text-[#002855] data-[state=active]:shadow-xs rounded-lg"
                >
                  <Settings className="h-3.5 w-3.5 mr-1.5 text-slate-400" />
                  Parâmetros R$/L
                </TabsTrigger>
                <TabsTrigger
                  value="site-content"
                  className="text-xs font-semibold text-slate-700 data-[state=active]:bg-white data-[state=active]:text-[#002855] data-[state=active]:shadow-xs rounded-lg"
                >
                  <Globe className="h-3.5 w-3.5 mr-1.5 text-[#00A3FF]" />
                  Conteúdo do Site
                </TabsTrigger>
                <TabsTrigger
                  value="couriers"
                  className="text-xs font-semibold text-slate-700 data-[state=active]:bg-white data-[state=active]:text-[#002855] data-[state=active]:shadow-xs rounded-lg relative"
                >
                  <Truck className="h-3.5 w-3.5 mr-1.5 text-[#00A3FF]" />
                  Entregadores ({deduplicatedCouriers.length})
                  {pendingCouriers.length > 0 && (
                    <span className="ml-1.5 px-1.5 py-0.2 rounded-full bg-[#00A3FF] text-white text-[10px] font-bold">
                      {pendingCouriers.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="sellers"
                  className="text-xs font-semibold text-slate-700 data-[state=active]:bg-white data-[state=active]:text-[#002855] data-[state=active]:shadow-xs rounded-lg"
                >
                  <Users className="h-3.5 w-3.5 mr-1.5 text-[#00A3FF]" />
                  Vendedores ({deduplicatedSellers.length})
                </TabsTrigger>
                <TabsTrigger
                  value="customers"
                  className="text-xs font-semibold text-slate-700 data-[state=active]:bg-white data-[state=active]:text-[#002855] data-[state=active]:shadow-xs rounded-lg"
                >
                  <MapPin className="h-3.5 w-3.5 mr-1.5 text-emerald-600" />
                  Clientes ({customers.length})
                </TabsTrigger>
              </TabsList>

              {/* MÓDULO 1: TORRE DE CONTROLE NA ABA DO ADMIN */}
              <TabsContent value="control-tower" className="space-y-6">
                <Suspense fallback={<SectionSkeleton />}>
                  <ControlTower
                    orders={orders}
                    couriers={couriers}
                    locations={locations}
                    settings={settings}
                    offRouteEvents={offRouteEvents}
                    onRefresh={loadData}
                    userRole="admin"
                  />
                </Suspense>
              </TabsContent>

              {/* TAB: CONTROLE DE COMBUSTÍVEL & CONTA CORRENTE EM TEMPO REAL (REQUISITO 5) */}
              <TabsContent value="fuel" className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <Wallet className="h-5 w-5 text-emerald-600" />
                      Controle Financeiro de Combustível (Pagamento Antecipado)
                      {isLoadingFuelOrders && (
                        <RefreshCw className="h-4 w-4 text-[#00A3FF] animate-spin ml-1" />
                      )}
                    </h3>
                    <p className="text-xs text-slate-500">
                      Conta corrente por entregador em tempo real:{' '}
                      <strong>Valor Recebido (Adiantamentos)</strong> menos{' '}
                      <strong>Gasto em Rotas Oficiais</strong>.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 self-start sm:self-center">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fetchFuelHistoryOrders(true)}
                      disabled={isLoadingFuelOrders}
                      className="h-9 gap-1.5 text-xs text-slate-700 border-slate-200 bg-white hover:bg-slate-50 rounded-xl"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 text-[#00A3FF] ${isLoadingFuelOrders ? 'animate-spin' : ''}`}
                      />
                      Atualizar Combustível
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        try {
                          toast.info('Verificando saldos e médias de 30 dias de combustível...')
                          const res = await fuelAccountService.triggerFuelBalanceCheck()
                          if (res.success) {
                            toast.success(
                              `Verificação concluída! ${res.alertsSent || 0} alerta(s) de recarga enviado(s) aos administradores (gatilho: 80% do saldo disponibilizado ou saldo negativo).`,
                            )
                          } else {
                            toast.error(`Aviso na verificação: ${res.error || 'Erro desconhecido'}`)
                          }
                        } catch (err) {
                          toast.error('Falha ao acionar verificação de saldo de combustível.')
                        }
                      }}
                      className="h-9 gap-1.5 text-xs text-amber-700 border-amber-200 bg-amber-50/50 hover:bg-amber-100/60 rounded-xl"
                      title="Dispara a verificação de saldo (gatilho: gasto atingiu 80% do saldo disponibilizado) e sugestão de recarga proporcional aos dias restantes do mês civil"
                    >
                      <Bell className="h-3.5 w-3.5 text-amber-600" />
                      Checar Alertas (80% do Saldo)
                    </Button>
                    <Button
                      onClick={() => setIsNewFuelAdvanceModalOpen(true)}
                      className="h-9 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/25"
                    >
                      <PlusCircle className="h-4 w-4" />
                      Cadastrar Adiantamento / Pagamento
                    </Button>
                  </div>
                </div>

                {/* CARDS DE CONTA CORRENTE DOS ENTREGADORES */}
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                        <CreditCard className="h-4 w-4 text-emerald-500" />
                        Conta Corrente dos Entregadores
                      </h4>
                      {/* ALTERNÂNCIA RÁPIDA DE PERÍODO NO TOPO DAS CONTAS CORRENTES */}
                      <div className="inline-flex items-center p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 text-xs">
                        <button
                          type="button"
                          onClick={() => setFuelPeriodFilter('today')}
                          className={`px-2.5 py-1 rounded-md font-bold transition-all ${
                            fuelPeriodFilter === 'today'
                              ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-xs'
                              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                          }`}
                        >
                          ☀️ Hoje
                        </button>
                        <button
                          type="button"
                          onClick={() => setFuelPeriodFilter('week')}
                          className={`px-2.5 py-1 rounded-md font-bold transition-all ${
                            fuelPeriodFilter === 'week'
                              ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-xs'
                              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                          }`}
                        >
                          🗓️ Últimos 7 dias
                        </button>
                        <button
                          type="button"
                          onClick={() => setFuelPeriodFilter('month')}
                          className={`px-2.5 py-1 rounded-md font-bold transition-all ${
                            fuelPeriodFilter === 'month'
                              ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-xs'
                              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                          }`}
                        >
                          📅 Mês (mês corrente)
                        </button>
                        <button
                          type="button"
                          onClick={() => setFuelPeriodFilter('all')}
                          className={`px-2.5 py-1 rounded-md font-bold transition-all ${
                            fuelPeriodFilter === 'all'
                              ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-xs'
                              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                          }`}
                        >
                          ♾️ Total desde o início (saldo acumulado)
                        </button>
                      </div>
                    </div>

                    <p className="text-xs text-slate-400">
                      💡 Clique em qualquer card para abrir o{' '}
                      <strong className="text-blue-500">
                        Histórico Completo de Entregas, KM, Combustível e Telemetria
                      </strong>
                      .
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 relative">
                    {isLoadingFuelOrders && (
                      <div className="col-span-full py-8 flex flex-col items-center justify-center gap-2 bg-slate-50/70 dark:bg-slate-900/40 rounded-xl border border-slate-200/80 dark:border-slate-800">
                        <RefreshCw className="h-6 w-6 text-[#00A3FF] animate-spin" />
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                          Carregando histórico de entregas e cálculo oficial de combustível...
                        </span>
                      </div>
                    )}
                    {currentFuelAccounts
                      .filter((acc) => acc && acc.courier && acc.courier.id)
                      .map((acc) => {
                        const balanceNum = Number(acc?.balance) || 0
                        const totalAdvancesNum = Number(acc?.totalAdvances) || 0
                        const totalSpentNum = Number(acc?.totalSpent) || 0
                        const totalRouteKmNum = Number(acc?.totalRouteKm) || 0
                        const isPositive = balanceNum >= 0
                        const courierName = String(acc?.courier?.name || 'Entregador')
                        const courierVehicleType = acc?.courier?.vehicle_type
                        const isBicycle =
                          deliveryService.normalizeVehicleCategory(courierVehicleType) ===
                          'bicicleta'

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
                                    {courierName.slice(0, 2).toUpperCase()}
                                  </div>
                                  <div>
                                    <CardTitle className="text-sm font-bold text-slate-900 dark:text-white">
                                      {courierName}
                                    </CardTitle>
                                    <p className="text-[10px] text-slate-500 flex items-center gap-1">
                                      <span>{acc.courier.vehicle_plate || 'Sem placa'}</span> •{' '}
                                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                                        {acc.courier.vehicle_model ||
                                          (courierVehicleType === 'carro'
                                            ? 'Carro'
                                            : courierVehicleType === 'caminhao'
                                              ? 'Caminhão'
                                              : courierVehicleType === 'bicycle' ||
                                                  courierVehicleType === 'bicicleta'
                                                ? 'Bicicleta'
                                                : 'Moto')}
                                      </span>
                                      <Badge
                                        variant="outline"
                                        className="text-[9px] px-1 py-0 uppercase font-mono font-bold ml-0.5"
                                      >
                                        {isBicycle
                                          ? '🚲 Bicicleta'
                                          : deliveryService.normalizeVehicleCategory(
                                              courierVehicleType,
                                            )}
                                      </Badge>
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <Badge
                                    className={`text-[10px] font-bold ${
                                      isPositive
                                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-300'
                                        : 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-300'
                                    }`}
                                  >
                                    {isPositive ? 'Crédito Disponível' : 'Saldo Devedor / A Repor'}
                                  </Badge>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    title="Editar entregador, saldo de abertura e data de corte"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setSelectedUserForEdit(acc.courier)
                                      setIsEditUserModalOpen(true)
                                    }}
                                    className="h-6 w-6 p-0 text-slate-400 hover:text-white hover:bg-slate-800 rounded-md"
                                  >
                                    <Edit3 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </div>
                            </CardHeader>
                            <CardContent className="p-4 pt-2 space-y-3 text-xs">
                              {/* Rótulo de Período Explícito */}
                              <div className="flex items-center justify-between">
                                <Badge
                                  variant="outline"
                                  className="text-[10px] font-bold border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                                >
                                  {fuelPeriodFilter === 'today'
                                    ? 'Período: Hoje'
                                    : fuelPeriodFilter === 'week'
                                      ? 'Período: Últimos 7 dias'
                                      : fuelPeriodFilter === 'month'
                                        ? 'Período: Mês (mês corrente)'
                                        : 'Período: Total desde o início (saldo acumulado)'}
                                </Badge>
                                {acc.carryOverBalance !== undefined &&
                                  acc.carryOverBalance !== 0 &&
                                  fuelPeriodFilter === 'month' && (
                                    <span
                                      className="text-[10px] font-mono text-slate-500"
                                      title="Saldo acumulado trazido do mês anterior"
                                    >
                                      Carry-over: R$ {acc.carryOverBalance.toFixed(2)}
                                    </span>
                                  )}
                              </div>

                              {/* Saldo Principal Canônico (Período-Independente) */}
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
                                    R$ {balanceNum.toFixed(2)}
                                  </span>
                                </div>
                                <div className="text-right">
                                  <span className="text-[10px] text-slate-400 block">
                                    {Number(acc?.advanceCount) || 0} adiantamento(s)
                                  </span>
                                  <span className="text-[10px] text-slate-400 block">
                                    {Number(acc?.deliveriesCount) || 0} entregas no período
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
                                    R$ {totalAdvancesNum.toFixed(2)}
                                  </span>
                                  <span className="text-[9px] text-slate-400 block mt-0.5">
                                    {Number(acc?.advanceCount) || 0} pós-corte
                                  </span>
                                </div>

                                <div className="p-2 rounded-lg bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40">
                                  <span className="text-amber-700 dark:text-amber-400 block font-medium">
                                    {isBicycle
                                      ? 'Km Rodado (Sem Combustível)'
                                      : '(-) Gasto no Período'}
                                  </span>
                                  <span className="font-bold text-amber-800 dark:text-amber-300 font-mono text-sm">
                                    {isBicycle
                                      ? `${totalRouteKmNum.toFixed(1)} km`
                                      : `R$ ${totalSpentNum.toFixed(2)}`}
                                  </span>
                                  <span className="text-[9px] text-slate-400 block mt-0.5">
                                    {isBicycle
                                      ? 'Telemetria apurada'
                                      : `${totalRouteKmNum.toFixed(1)} km • ${Number(acc?.deliveriesCount) || 0} entregas`}
                                  </span>
                                </div>
                              </div>

                              {/* FRENTE 2: SUGESTÃO DE RECARGA NO CARD DO ADMIN */}
                              {!isBicycle &&
                                acc.dailyAverage30d !== undefined &&
                                acc.dailyAverage30d > 0 && (
                                  <div className="p-2.5 rounded-lg bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 space-y-1 text-[11px]">
                                    <div className="flex items-center justify-between">
                                      <span className="text-[10px] font-bold uppercase tracking-wider text-blue-800 dark:text-blue-300 flex items-center gap-1">
                                        <Fuel className="h-3 w-3 text-[#0052CC]" />
                                        Sugestão de Recarga (Restante do Mês)
                                      </span>
                                      <Badge
                                        variant="outline"
                                        className="text-[9px] px-1.5 py-0 font-bold border-blue-300 bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300"
                                      >
                                        {acc.remainingIntervalLabel || 'Mês Civil'}
                                      </Badge>
                                    </div>
                                    <div className="flex items-baseline justify-between pt-0.5">
                                      <span className="text-[10px] text-slate-500">
                                        {acc.averageLabel || 'Média 30d'}:{' '}
                                        <strong>R$ {acc.dailyAverage30d.toFixed(2)}/dia</strong> •
                                        Projeção: R${' '}
                                        {(acc.projectionRemainingMonth || 0).toFixed(2)}
                                      </span>
                                      <span className="font-mono text-sm font-black text-blue-700 dark:text-blue-400">
                                        R$ {(acc.suggestedRecharge || 0).toFixed(2)}
                                      </span>
                                    </div>
                                  </div>
                                )}

                              {/* KM Oficial vs KM Desvios com Badge da Fonte Real (Odômetro / Rota Viária / GPS) */}
                              <div className="flex items-center justify-between pt-0.5 text-[10px]">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setSelectedCourierForHistory(acc.courier)
                                    setIsCourierHistoryModalOpen(true)
                                  }}
                                  className="inline-flex items-center"
                                >
                                  {' '}
                                  <Badge
                                    variant="outline"
                                    className={`text-[9px] px-1.5 py-0.2 font-bold hover:opacity-80 transition-opacity cursor-pointer ${
                                      acc.calculationSource === 'odometro'
                                        ? 'border-indigo-400 text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30'
                                        : acc.calculationSource === 'gps'
                                          ? 'border-emerald-400 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30'
                                          : 'border-blue-400 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30'
                                    }`}
                                  >
                                    📖 Histórico Viário de Rotas
                                  </Badge>
                                </button>
                                <span className="text-slate-500 font-mono">
                                  KM Oficial:{' '}
                                  <strong className="text-slate-700 dark:text-slate-200">
                                    {totalRouteKmNum.toFixed(1)} km
                                  </strong>
                                </span>
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
                            {deduplicatedCouriers.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                🛵 {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        {/* Filter by Period */}
                        <Select
                          value={fuelPeriodFilter}
                          onValueChange={(v: 'all' | 'month' | 'week' | 'today') =>
                            setFuelPeriodFilter(v)
                          }
                        >
                          <SelectTrigger className="h-8 w-44 text-xs">
                            <SelectValue placeholder="Período" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="week">🗓️ Últimos 7 dias</SelectItem>
                            <SelectItem value="today">☀️ Hoje</SelectItem>
                            <SelectItem value="month">📅 Mês (mês corrente)</SelectItem>
                            <SelectItem value="all">♾️ Total desde o início</SelectItem>
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
                                    {adv.date
                                      ? new Date(adv.date).toLocaleDateString('pt-BR')
                                      : '-'}
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

              {/* TAB: AUDITORIA DE KM POR ENTREGA & APROVAÇÕES DO ADMIN */}
              <TabsContent value="km-audit" className="space-y-6">
                <Suspense fallback={<SectionSkeleton />}>
                  <KmAuditReport
                    orders={orders}
                    fuelHistoryOrders={fuelHistoryOrders}
                    couriers={couriers}
                    locations={locations}
                    offRouteEvents={offRouteEvents}
                    settings={settings}
                    currentCompanyId={resolvedCompany?.id || currentCompany?.id}
                    onDataChange={loadData}
                  />
                </Suspense>
              </TabsContent>

              {/* TAB: RECONCILIAÇÃO POR LOTE (3 FONTES: VIÁRIO OFICIAL 1x, GPS TELEMETRIA, ODÔMETRO) */}
              <TabsContent value="batch-reconciliation" className="space-y-6">
                <Suspense fallback={<SectionSkeleton />}>
                  <BatchReconciliationSection
                    orders={orders}
                    couriers={couriers}
                    locations={locations}
                  />
                </Suspense>
              </TabsContent>

              {/* TAB: TRILHA DE AUDITORIA GERAL (AUDIT TRAIL READ-ONLY) */}
              <TabsContent value="audit-trail" className="space-y-6">
                <Suspense fallback={<SectionSkeleton />}>
                  <AuditTrailSection
                    couriers={couriers}
                    currentCompanyId={resolvedCompany?.id || currentCompany?.id}
                  />
                </Suspense>
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
                      <strong>desvios de rota &gt; 600 metros</strong> (auditoria de trajeto — o km
                      oficial da rota não é alterado) e{' '}
                      <strong>paradas fora dos pontos previstos</strong> após o entregador iniciar a
                      rota.
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
                          🚨 Desvio de Rota (&gt;600m - Auditoria)
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
                          Desvios &gt; 600m (Auditoria)
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
                <Suspense fallback={<SectionSkeleton />}>
                  <ReportsSection
                    orders={orders}
                    couriers={couriers}
                    sellers={sellers}
                    customers={customers}
                    settings={settings}
                    offRouteEvents={offRouteEvents}
                    locations={locations}
                  />
                </Suspense>
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
                          categoria de veículo. Os cálculos de custo de rota e conta corrente passam
                          a utilizar os parâmetros oficiais do entregador.
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
                                placeholder="6.49"
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
                                (parseFloat(motoPriceInput.replace(',', '.')) || 6.49) /
                                (parseFloat(motoConsInput.replace(',', '.')) || 35.0)
                              ).toFixed(4)}
                              /km
                            </p>
                            <p className="text-[10px] text-slate-500 mt-0.5">
                              Ex: 10 km = R${' '}
                              {(
                                (10 * (parseFloat(motoPriceInput.replace(',', '.')) || 6.49)) /
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
                                placeholder="6.49"
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
                                (parseFloat(carroPriceInput.replace(',', '.')) || 6.49) /
                                (parseFloat(carroConsInput.replace(',', '.')) || 12.0)
                              ).toFixed(4)}
                              /km
                            </p>
                            <p className="text-[10px] text-slate-500 mt-0.5">
                              Ex: 10 km = R${' '}
                              {(
                                (10 * (parseFloat(carroPriceInput.replace(',', '.')) || 6.49)) /
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
                                placeholder="6.49"
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
                                (parseFloat(caminhaoPriceInput.replace(',', '.')) || 6.49) /
                                (parseFloat(caminhaoConsInput.replace(',', '.')) || 7.0)
                              ).toFixed(4)}
                              /km
                            </p>
                            <p className="text-[10px] text-slate-500 mt-0.5">
                              Ex: 10 km = R${' '}
                              {(
                                (10 * (parseFloat(caminhaoPriceInput.replace(',', '.')) || 6.49)) /
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
                        Custo (R$) = [ Distância Total (km) × Preço do Litro do Tipo (R$) ] ÷
                        Consumo do Tipo (km/L)
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
                        ℹ️ Caso um entregador não tenha veículo definido ou possua cadastro antigo,
                        o sistema aplica <strong>Moto (35 km/L)</strong> como fallback de segurança.
                      </p>
                    </div>
                  </CardContent>
                </Card>

                {/* CARD: JORNADA DE TRABALHO DA EMPRESA */}
                <Card className="border-slate-200 dark:border-slate-800 shadow-sm max-w-4xl">
                  <CardHeader>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <CardTitle className="text-base font-bold flex items-center gap-2 text-slate-900 dark:text-white">
                          <Clock className="h-5 w-5 text-blue-600" />
                          Jornada de Trabalho da Empresa
                        </CardTitle>
                        <CardDescription className="text-xs">
                          Defina o horário padrão de entrada, intervalo de almoço e término do
                          expediente. Estes horários alimentam diretamente o motor de cálculo da
                          carga horária das rotas, projeção de volta à base e os alertas de jornada
                          na Torre de Controle e Otimizador.
                        </CardDescription>
                      </div>
                      <Button
                        type="button"
                        onClick={() => handleSaveWorkShiftSettings()}
                        disabled={isSavingShiftSettings}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs gap-1.5 shrink-0 shadow-sm"
                      >
                        <Save className="h-4 w-4" />
                        {isSavingShiftSettings
                          ? 'Salvando Jornada...'
                          : 'Salvar Jornada de Trabalho'}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Grid de 4 Horários: Entrada, Saída Almoço, Volta Almoço, Fim do Expediente */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      {/* 1. Entrada */}
                      <div className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/30 dark:bg-blue-950/20 p-4 space-y-2">
                        <Label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                          <span className="text-base">🟢</span>
                          Entrada (Início)
                        </Label>
                        <p className="text-[11px] text-slate-500">Início da jornada diária</p>
                        <Input
                          type="time"
                          value={workStartTimeInput}
                          onChange={(e) => setWorkStartTimeInput(e.target.value)}
                          className="font-mono font-bold text-sm bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-center"
                        />
                        <span className="text-[10px] text-slate-400 block text-center">
                          Ex: 08:00
                        </span>
                      </div>

                      {/* 2. Saída para Almoço */}
                      <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/30 dark:bg-amber-950/20 p-4 space-y-2">
                        <Label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                          <span className="text-base">🍽️</span>
                          Saída para Almoço
                        </Label>
                        <p className="text-[11px] text-slate-500">Início da pausa de almoço</p>
                        <Input
                          type="time"
                          value={lunchStartTimeInput}
                          onChange={(e) => setLunchStartTimeInput(e.target.value)}
                          className="font-mono font-bold text-sm bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-center"
                        />
                        <span className="text-[10px] text-slate-400 block text-center">
                          Ex: 12:00
                        </span>
                      </div>

                      {/* 3. Volta do Almoço */}
                      <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/30 dark:bg-amber-950/20 p-4 space-y-2">
                        <Label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                          <span className="text-base">☕</span>
                          Volta do Almoço
                        </Label>
                        <p className="text-[11px] text-slate-500">Término da pausa de almoço</p>
                        <Input
                          type="time"
                          value={lunchEndTimeInput}
                          onChange={(e) => setLunchEndTimeInput(e.target.value)}
                          className="font-mono font-bold text-sm bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-center"
                        />
                        <span className="text-[10px] text-slate-400 block text-center">
                          Ex: 13:00
                        </span>
                      </div>

                      {/* 4. Fim do Expediente */}
                      <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/30 dark:bg-rose-950/20 p-4 space-y-2">
                        <Label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                          <span className="text-base">🏁</span>
                          Fim do Expediente
                        </Label>
                        <p className="text-[11px] text-slate-500">
                          Horário limite da carga horária
                        </p>
                        <Input
                          type="time"
                          value={workEndTimeInput}
                          onChange={(e) => setWorkEndTimeInput(e.target.value)}
                          className="font-mono font-bold text-sm bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-center"
                        />
                        <span className="text-[10px] text-slate-400 block text-center">
                          Ex: 18:30
                        </span>
                      </div>
                    </div>

                    {/* Resumo da Jornada e Explicação das Regras */}
                    <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border text-xs space-y-2.5 text-slate-600 dark:text-slate-300">
                      <p className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        Como esses horários impactam os cálculos de rota:
                      </p>
                      <ul className="list-disc list-inside space-y-1 text-[11px] leading-relaxed">
                        <li>
                          <strong>Término Projetado &amp; Volta à Base:</strong> Se a rota do
                          entregador atravessar o intervalo de almoço (das{' '}
                          <span className="font-mono font-bold text-amber-700 dark:text-amber-400">
                            {lunchStartTimeInput || '12:00'}
                          </span>{' '}
                          às{' '}
                          <span className="font-mono font-bold text-amber-700 dark:text-amber-400">
                            {lunchEndTimeInput || '13:00'}
                          </span>
                          ), a duração da pausa é considerada no tempo total restante e no horário
                          estimado de chegada.
                        </li>
                        <li>
                          <strong>Badge de Carga Horária:</strong> Quando a previsão de término
                          ultrapassar{' '}
                          <span className="font-mono font-bold text-rose-700 dark:text-rose-400">
                            {workEndTimeInput || '18:30'}
                          </span>{' '}
                          ou a jornada efetiva diária for excedida, o sistema exibe o badge{' '}
                          <span className="font-bold text-amber-600">
                            &quot;⚠️ Passa da carga horária (+X min)&quot;
                          </span>
                          . Caso contrário, exibe{' '}
                          <span className="font-bold text-emerald-600">
                            &quot;✓ Dentro da carga horária&quot;
                          </span>
                          .
                        </li>
                        <li>
                          <strong>Aviso na Atribuição de Pedidos:</strong> Ao incluir novos clientes
                          em rotas ativas no Otimizador ou pelo Vendedor, o impacto na jornada é
                          projetado em tempo real comparando com estes parâmetros.
                        </li>
                      </ul>
                    </div>
                  </CardContent>
                </Card>

                {/* CARD: SEGURANÇA E ACESSO DO ADMINISTRADOR */}
                <Card className="border-slate-200 dark:border-slate-800 shadow-sm max-w-4xl bg-slate-900/60 border-indigo-900/30">
                  <CardHeader>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <CardTitle className="text-base font-bold flex items-center gap-2 text-white">
                          <Lock className="h-5 w-5 text-amber-400" />
                          Segurança da Conta &amp; Senha do Administrador
                        </CardTitle>
                        <CardDescription className="text-xs text-slate-400">
                          Atualize sua senha de acesso ao painel executivo Rotaly ({user?.email}). A
                          alteração exige confirmação da senha atual.
                        </CardDescription>
                      </div>
                      <Button
                        type="button"
                        onClick={() => setIsChangePasswordModalOpen(true)}
                        className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs gap-1.5 shrink-0 shadow-sm"
                      >
                        <KeyRound className="h-4 w-4 text-slate-950" />
                        Trocar Minha Senha
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="p-3.5 rounded-xl bg-[#0A1128] border border-[#1E2B58] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-300">
                      <div className="space-y-1">
                        <p className="font-bold text-white flex items-center gap-2">
                          <ShieldCheck className="h-4 w-4 text-emerald-400" />
                          Status de Proteção do Acesso
                        </p>
                        <p className="text-[11px] text-slate-400">
                          Recomendado atualizar a senha padrão de instalação para uma chave forte e
                          única.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className="text-emerald-400 border-emerald-500/40 bg-emerald-500/10 text-[11px]"
                        >
                          Admin Ativo
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* ATALHO PARA GESTÃO DE CONTEÚDO DO SITE DENTRO DA ABA DE CONFIGURAÇÕES */}
                <div className="pt-2">
                  <SiteContentManager />
                </div>
              </TabsContent>

              {/* TAB: CONTEÚDO DO SITE PÚBLICO (QUEM SOMOS & FALE CONOSCO) */}
              <TabsContent value="site-content" className="space-y-6">
                <SiteContentManager />
              </TabsContent>

              {/* TAB 1: OVERVIEW */}
              <TabsContent value="overview" className="space-y-6">
                {/* BANNER DE ENTREGAS COM APROVAÇÃO PENDENTE (>500M) */}
                {(() => {
                  const pendingGeofenceOrders = orders.filter(
                    (o) => o.entrega_geofence_flag === 'pendente_aprovacao_gt_500m',
                  )
                  if (pendingGeofenceOrders.length === 0) return null
                  return (
                    <div className="mb-6 rounded-card border-2 border-amber-500/70 bg-gradient-to-r from-amber-500/10 via-amber-950/20 to-slate-900 p-4 shadow-brand-dark">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-400 flex items-center justify-center shrink-0">
                            <AlertTriangle className="h-5 w-5" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-heading text-sm font-bold text-white">
                                Entregas com Aprovação Pendente (Distância &gt;500m do Pin)
                              </h3>
                              <Badge className="bg-amber-500 text-white text-[10px] font-bold">
                                {pendingGeofenceOrders.length} pedido(s)
                              </Badge>
                            </div>
                            <p className="text-xs text-amber-200/80 mt-0.5">
                              Entregas confirmadas na rua cujo GPS do entregador estava além de 500m
                              do pino. Analise na Torre de Controle ou na Caixa de Endereços
                              Suspeitos abaixo.
                            </p>
                          </div>
                        </div>

                        <Button
                          onClick={() => {
                            setActiveTab('control-tower')
                            navigate('/admin?tab=control-tower')
                          }}
                          className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs shrink-0 rounded-input shadow-sm"
                        >
                          Ver na Torre de Controle →
                        </Button>
                      </div>
                    </div>
                  )
                })()}

                {/* CAIXA DE AUDITORIA DE ENDEREÇOS SUSPEITOS & ANTI-CEP */}
                <div id="suspicious-addresses-box" className="mb-6">
                  <SuspiciousAddressesBox
                    empresaId={resolvedCompany?.id || currentCompany?.id}
                    isMaster={user?.role === 'master'}
                    onAlertUpdated={() => {
                      loadData()
                      window.dispatchEvent(new CustomEvent('rotaly:address-alerts-updated'))
                    }}
                  />
                </div>

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
                      <p className="font-heading text-2xl font-black text-[#1a1a1a] mt-2">
                        27.4 min
                      </p>
                      <div className="flex items-center gap-1.5 mt-2 text-xs font-medium text-[#00AA44]">
                        <TrendingUp className="h-3.5 w-3.5" />
                        <span>-4.2 min (otimização de rota Rotaly)</span>
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
                        desvio(s) &gt;600m e{' '}
                        {offRouteEvents.filter((e) => e.event_type === 'unexpected_stop').length}{' '}
                        parada(s) não previstas registradas via telemetria (rotas ativas e
                        parciais).
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
                          Rotaly.
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
                        <a
                          href="/guia-entregador"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-cyan-500/40 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 font-bold text-xs shadow-xs transition"
                          title="Abrir o Guia de Entrega Redirecionada formatado para impressão em PDF / WhatsApp"
                        >
                          <FileText className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
                          <span>Guia PDF Redireção</span>
                        </a>

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
                                {deduplicatedCouriers.length === 0
                                  ? 'Nenhum entregador vinculado na tabela de membros desta empresa.'
                                  : 'Nenhum entregador encontrado com os filtros selecionados.'}
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
                                        className="h-7 text-[11px] gap-1 text-amber-600 border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 hover:bg-amber-100 font-semibold"
                                        title="Auditoria & Histórico de KM, Combustível e Telemetria"
                                      >
                                        <Fuel className="h-3 w-3" />
                                        Auditoria
                                      </Button>
                                    </div>
                                  </td>

                                  <td className="py-3 px-3 text-right">
                                    <div className="flex items-center justify-end gap-1.5">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                          setSelectedUserForEdit(c)
                                          setIsEditUserModalOpen(true)
                                        }}
                                        className="h-7 px-2 text-[#0052CC] border-blue-200 dark:border-blue-900 hover:bg-blue-50 dark:hover:bg-blue-950/50 text-[11px] gap-1 font-semibold"
                                        title="Editar Cadastro, Trocar Senha e E-mail"
                                      >
                                        <Edit3 className="h-3 w-3 text-[#0052CC]" />
                                        Editar
                                      </Button>

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
                                {deduplicatedSellers.length === 0
                                  ? 'Nenhum vendedor cadastrado nesta empresa.'
                                  : 'Nenhum vendedor encontrado.'}
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
                                          setSelectedUserForEdit(s)
                                          setIsEditUserModalOpen(true)
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

              {/* ABA: CLIENTES (Com Geocodificação Google e Doutrina de Coordenada Travada) */}
              <TabsContent value="customers" className="space-y-6">
                {/* ITEM 2: PAINEL DE DUPLICATAS CANDIDATAS COM UNIFICAÇÃO MANUAL E AUDITORIA */}
                <CustomerDuplicatesPanel
                  customers={customers}
                  currentUserName={user?.name || user?.email || 'Administrador'}
                  currentUserId={user?.id}
                  onRefresh={loadData}
                  onEditCustomer={(c) => {
                    setCustomerToEdit(c)
                    setIsCreateCustomerModalOpen(true)
                  }}
                />

                {/* ITENS 14 & 15: RELATÓRIO DE QUALIDADE DO CADASTRO & FILA CADASTRO INCOMPLETO */}
                <CustomerQualityReport
                  customers={customers}
                  onEditCustomer={(c) => {
                    setCustomerToEdit(c)
                    setIsCreateCustomerModalOpen(true)
                  }}
                  onRefresh={loadData}
                />

                <Card className="border-slate-200/80 dark:border-slate-800 shadow-sm">
                  <CardHeader className="pb-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <CardTitle className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-emerald-600" />
                          Base de Clientes Cadastrados ({customers.length})
                        </CardTitle>
                        <CardDescription className="text-xs">
                          Doutrina Vuupt/Rotaly: Toda entrega nasce com coordenada calibrada via
                          Google e travada no cadastro.
                        </CardDescription>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setIsCustomerAddressAuditModalOpen(true)}
                          className="h-8 gap-1.5 text-xs text-amber-700 border-amber-300 bg-amber-50 hover:bg-amber-100"
                        >
                          <MapPin className="h-3.5 w-3.5 text-amber-600" />
                          Verificar Endereços no Mapa
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            setCustomerToEdit(null)
                            setIsCreateCustomerModalOpen(true)
                          }}
                          className="h-8 gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                        >
                          <PlusCircle className="h-3.5 w-3.5" />
                          Novo Cliente
                        </Button>
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900 uppercase tracking-wider">
                            <th className="py-2.5 px-3 font-semibold">Cliente</th>
                            <th className="py-2.5 px-3 font-semibold">Telefone / Doc</th>
                            <th className="py-2.5 px-3 font-semibold">Endereço</th>
                            <th className="py-2.5 px-3 font-semibold">Coordenada Google</th>
                            <th className="py-2.5 px-3 font-semibold text-right">Ação</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {customers.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="py-8 text-center text-slate-400">
                                Nenhum cliente cadastrado ainda.
                              </td>
                            </tr>
                          ) : (
                            customers.map((c) => {
                              const hasCoords =
                                typeof c.lat === 'number' &&
                                typeof c.lng === 'number' &&
                                !(c.lat === 0 && c.lng === 0) &&
                                !(
                                  Math.abs(c.lat - -22.906847) < 0.0001 &&
                                  Math.abs(c.lng - -43.172896) < 0.0001
                                )

                              return (
                                <tr
                                  key={c.id}
                                  className="hover:bg-slate-50/60 dark:hover:bg-slate-800/50 transition-colors"
                                >
                                  <td className="py-3 px-3 font-semibold text-slate-900 dark:text-white">
                                    <div className="flex items-center gap-2">
                                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-300 font-bold text-xs">
                                        {c.name ? c.name.slice(0, 2).toUpperCase() : 'CL'}
                                      </div>
                                      <div>
                                        <p className="font-bold text-slate-900 dark:text-white">
                                          {c.name || 'Sem nome'}
                                        </p>
                                        <p className="text-[11px] text-slate-500">
                                          {c.bairro || c.neighborhood || c.city || ''}
                                        </p>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="py-3 px-3 text-slate-600 dark:text-slate-300">
                                    <div>
                                      <p>{c.phone || 'Sem telefone'}</p>
                                      {c.document && (
                                        <p className="text-[10px] text-slate-400 font-mono">
                                          {c.document}
                                        </p>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-3 px-3 text-slate-600 dark:text-slate-300 max-w-xs truncate">
                                    {c.address || c.street || 'Não informado'}
                                  </td>
                                  <td className="py-3 px-3">
                                    {hasCoords ? (
                                      <div className="space-y-0.5">
                                        <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-300 text-[10px] font-bold">
                                          ✓ Calibrado Google
                                        </Badge>
                                        <p className="font-mono text-[10px] text-slate-400">
                                          {c.lat?.toFixed(5)}, {c.lng?.toFixed(5)}
                                        </p>
                                      </div>
                                    ) : (
                                      <Badge className="bg-rose-500/15 text-rose-600 border-rose-300 text-[10px] font-bold">
                                        Pendente Geocodificação
                                      </Badge>
                                    )}
                                  </td>
                                  <td className="py-3 px-3 text-right">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        setCustomerToEdit(c)
                                        setIsCreateCustomerModalOpen(true)
                                      }}
                                      className="h-7 px-2.5 text-blue-600 border-blue-200 hover:bg-blue-50 text-[11px] gap-1 font-semibold"
                                    >
                                      <Edit3 className="h-3 w-3" />
                                      Editar &amp; Calibrar
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
            </Tabs>

            {/* ================= RODAPÉ / DIAGNÓSTICO DO SISTEMA ================= */}
            <footer className="mt-8 border-t border-[#1E2B58]/60 pt-4 pb-6 text-slate-400">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-300">Rotaly Gestão Executiva</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-[#002855] font-mono font-bold">
                    {APP_VERSION_LABEL}
                  </span>
                  <span className="text-slate-500">•</span>
                  <span className="text-slate-400">
                    Operação Empresa Única (Rotaly Operações) • Servidor Central
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setIsDiagExpanded((prev) => !prev)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#0E1738] border border-[#1E2B58] text-[11px] text-slate-300 hover:text-white hover:bg-[#16224c] transition-colors"
                >
                  <span>
                    {isDiagExpanded ? 'Recolher Diagnóstico' : 'Ver Diagnóstico do Sistema'}
                  </span>
                  <span className="text-slate-400 font-mono">{isDiagExpanded ? '▲' : '▼'}</span>
                </button>
              </div>

              {isDiagExpanded && (
                <div className="mt-3 p-3.5 rounded-xl bg-[#070D1E] border border-[#1E2B58] text-xs text-slate-300 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="p-2.5 rounded-lg bg-[#0E1738] border border-[#1E2B58]/80 space-y-1">
                      <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                        Usuário Autenticado
                      </span>
                      <p className="font-semibold text-white truncate">
                        {user?.name || user?.email || 'N/A'}
                      </p>
                      <p className="font-mono text-[10px] text-slate-400 truncate">
                        ID: {user?.id || '—'}
                      </p>
                      <p className="text-[11px] text-[#60A5FA]">
                        Papel: <strong>{user?.role || '—'}</strong>
                      </p>
                    </div>

                    <div className="p-2.5 rounded-lg bg-[#0E1738] border border-[#1E2B58]/80 space-y-1">
                      <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                        Empresa Ativa
                      </span>
                      <p className="font-semibold text-white truncate">
                        {currentCompany?.nome_fantasia ||
                          currentCompany?.nome_razao_social ||
                          'Rotaly Operações'}
                      </p>
                      <p className="font-mono text-[10px] text-slate-400 truncate">
                        ID: {currentCompany?.id || '—'}
                      </p>
                      <p className="text-[10px] text-indigo-300 truncate font-mono">
                        Fonte: {resolvedCompanySource || 'Empresa Única (Matriz)'}
                      </p>
                      <p className="text-[11px] text-emerald-400">
                        Status: <strong>Ativa</strong>
                      </p>
                    </div>

                    <div className="p-2.5 rounded-lg bg-[#0E1738] border border-[#1E2B58]/80 space-y-1">
                      <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                        Contagens da Operação
                      </span>
                      <div className="flex flex-col text-[11px] space-y-0.5">
                        <span className="text-white">
                          Pedidos: <strong>{orders.length}</strong>
                        </span>
                        <span className="text-white">
                          Entregadores: <strong>{couriers.length}</strong>
                        </span>
                        <span className="text-white">
                          Vendedores: <strong>{sellers.length}</strong>
                        </span>
                        <span className="text-white">
                          Usuários: <strong>{users.length}</strong>
                        </span>
                      </div>
                    </div>

                    <div className="p-2.5 rounded-lg bg-[#0E1738] border border-[#1E2B58]/80 space-y-1 flex flex-col justify-between">
                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                          Sincronização
                        </span>
                        <p className="text-[11px] text-slate-300">
                          Última carga:{' '}
                          {new Intl.DateTimeFormat('pt-BR', {
                            timeZone: 'America/Sao_Paulo',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          }).format(new Date())}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => loadData()}
                        className="h-7 text-[11px] bg-[#0052CC] hover:bg-[#003E99] text-white font-bold w-full"
                      >
                        Recarregar Dados
                      </Button>
                    </div>
                  </div>

                  {/* Aviso amarelo com o motivo se contagens forem zero */}
                  {(orders.length === 0 || couriers.length === 0) && (
                    <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] flex items-start gap-2">
                      <span className="text-amber-400 text-base leading-none">⚠️</span>
                      <div>
                        <strong className="font-bold">Aviso de Operação Zerada:</strong>{' '}
                        {orders.length === 0 && 'Nenhum pedido retornado para a operação. '}
                        {couriers.length === 0 && 'Nenhum entregador cadastrado no sistema. '}
                        Operação unificada na Matriz <code>Rotaly Operações</code>.
                      </div>
                    </div>
                  )}
                </div>
              )}
            </footer>
          </main>
        </div>
      )}

      {/* ================= MODAL NOVO: GESTÃO FINANCEIRA DE COMBUSTÍVEL (LANÇAR / CANCELAR / AJUSTAR) ================= */}
      <FuelAdvanceModal
        open={isNewFuelAdvanceModalOpen}
        onOpenChange={setIsNewFuelAdvanceModalOpen}
        couriers={deduplicatedCouriers}
        advances={fuelAdvances}
        orders={activeFuelOrdersPool}
        settings={settings}
        locations={locations}
        offRouteEvents={offRouteEvents}
        userRole={user?.role}
        currentUserId={user?.id}
        initialCourierId={advanceCourierId}
        onSuccess={async () => {
          await Promise.all([loadData(), fetchFuelHistoryOrders(true)])
        }}
      />

      {/* Modal de Cadastro/Edição de Clientes com Geocodificação Google */}
      <CreateCustomerModal
        open={isCreateCustomerModalOpen}
        onOpenChange={(open) => {
          setIsCreateCustomerModalOpen(open)
          if (!open) {
            setCustomerToEdit(null)
          }
        }}
        customerToEdit={customerToEdit}
        onCustomerCreated={() => {
          loadData()
          setIsCreateCustomerModalOpen(false)
          setCustomerToEdit(null)
        }}
      />

      {/* Modal de Auditoria e Verificação de Endereços no Mapa (Doutrina Vuupt/Rotaly) */}
      {isCustomerAddressAuditModalOpen && (
        <Suspense fallback={null}>
          <CustomerAddressAuditModal
            open={isCustomerAddressAuditModalOpen}
            onOpenChange={setIsCustomerAddressAuditModalOpen}
            customers={customers}
            onEditCustomer={(c) => {
              setCustomerToEdit(c)
              setIsCreateCustomerModalOpen(true)
            }}
            onRefreshCustomers={loadData}
          />
        </Suspense>
      )}

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

            {existingUserPromptEmail && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-2">
                <div className="flex items-start gap-2">
                  <span className="text-amber-600 text-base leading-none">⚠️</span>
                  <div>
                    <strong className="font-semibold">Usuário já cadastrado no sistema</strong>
                    <p className="text-[11px] text-amber-800 mt-0.5">
                      O e-mail <strong>{existingUserPromptEmail}</strong> já pertence a uma conta
                      existente. Deseja vinculá-lo como{' '}
                      {newUserRole === 'courier' ? 'entregador' : 'vendedor'} desta empresa?
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  onClick={handleLinkExistingUser}
                  disabled={isLinkingExistingUser}
                  className="w-full h-8 text-xs bg-amber-600 hover:bg-amber-700 text-white font-semibold"
                >
                  {isLinkingExistingUser
                    ? 'Vinculando...'
                    : 'Vincular usuário existente à esta empresa'}
                </Button>
              </div>
            )}

            <DialogFooter className="pt-2 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsNewUserModalOpen(false)
                  setExistingUserPromptEmail(null)
                }}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isCreatingUser || isLinkingExistingUser}
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
            ? currentFuelAccounts.find(
                (a) => a && a.courier && a.courier.id === selectedCourierForHistory.id,
              ) || null
            : null
        }
        orders={activeFuelOrdersPool}
        offRouteEvents={offRouteEvents}
        locations={locations}
        settings={settings}
        initialPeriodFilter={fuelPeriodFilter}
        advances={fuelAdvances}
      />

      {/* ================= MODAL: CADASTRAR NOVO VENDEDOR ================= */}
      <CreateSellerModal
        open={isCreateSellerModalOpen}
        onOpenChange={setIsCreateSellerModalOpen}
        onSellerCreated={loadData}
      />

      {/* ================= MODAL: EDITAR USUÁRIO (ENTREGADOR OU VENDEDOR) ================= */}
      <EditUserModal
        user={selectedUserForEdit}
        open={isEditUserModalOpen}
        onOpenChange={(open) => {
          setIsEditUserModalOpen(open)
          if (!open) setSelectedUserForEdit(null)
        }}
        onUserUpdated={loadData}
        currentAdminId={user?.id}
      />

      {/* ================= MODAL: EDITAR VENDEDOR (LEGADO) ================= */}
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

      {/* ================= MODAL: TROCAR SENHA DO ADMIN LOGADO ================= */}
      <ChangePasswordModal
        open={isChangePasswordModalOpen}
        onOpenChange={setIsChangePasswordModalOpen}
      />
    </div>
  )
}

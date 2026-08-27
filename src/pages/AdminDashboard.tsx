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
} from 'lucide-react'
import { Header } from '@/components/Header'
import { Sidebar } from '@/components/Sidebar'
import { AiLogisticsAssistant } from '@/components/AiLogisticsAssistant'
import { deliveryService } from '@/services/deliveryService'
import type { OrderRecord, UserRecord, NotificationRecord } from '@/types/delivery'
import { getErrorMessage } from '@/lib/pocketbase/errors'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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

export default function AdminDashboard() {
  const [orders, setOrders] = useState<OrderRecord[]>([])
  const [users, setUsers] = useState<UserRecord[]>([])
  const [notifications, setNotifications] = useState<NotificationRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // New user modal state
  const [isNewUserModalOpen, setIsNewUserModalOpen] = useState(false)
  const [newUserName, setNewUserName] = useState('')
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserPassword, setNewUserPassword] = useState('Skip@Pass')
  const [newUserRole, setNewUserRole] = useState<'seller' | 'courier'>('courier')
  const [isCreatingUser, setIsCreatingUser] = useState(false)

  const loadData = async () => {
    try {
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

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedName = newUserName.trim()
    const trimmedEmail = newUserEmail.trim()

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
        password: newUserPassword,
        passwordConfirm: newUserPassword,
        role: newUserRole,
        status: 'active',
      })

      toast.success(
        `Usuário ${trimmedName} (${newUserRole === 'courier' ? 'Entregador' : 'Vendedor'}) cadastrado com sucesso!`,
      )
      setIsNewUserModalOpen(false)
      setNewUserName('')
      setNewUserEmail('')
      setNewUserPassword('Skip@Pass')
      loadData()
    } catch (err: unknown) {
      console.error('Error creating user:', err)
      const msg = getErrorMessage(err, 'Falha ao cadastrar novo usuário.')
      toast.error(msg)
    } finally {
      setIsCreatingUser(false)
    }
  }

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
  const activeCouriers = users.filter((u) => u.role === 'courier')
  const busyCouriers = activeCouriers.filter(
    (c) => c.status === 'busy' || inTransitOrders.some((o) => o.courier_id === c.id),
  )
  const courierUtilizationRate =
    activeCouriers.length > 0 ? Math.round((busyCouriers.length / activeCouriers.length) * 100) : 0

  // Mocked Weekly Volume Trends Data for Line Chart Visualization
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
                  Painel Executivo & Gerencial
                </h1>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
                Métricas globais de desempenho, controle de equipe, volume financeiro e log de
                alertas automáticos.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={loadData}
                className="h-9 gap-1.5 text-xs"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Atualizar Dados
              </Button>
              <Button
                onClick={() => setIsNewUserModalOpen(true)}
                className="h-9 gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-md shadow-blue-500/25"
              >
                <UserPlus className="h-4 w-4" />
                Cadastrar Membro
              </Button>
            </div>
          </div>

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
                <p className="text-2xl font-black text-slate-900 dark:text-white mt-2">27.4 min</p>
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
                    Utilização de Entregadores
                  </span>
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-500/10 text-purple-600">
                    <Truck className="h-4 w-4" />
                  </div>
                </div>
                <p className="text-2xl font-black text-slate-900 dark:text-white mt-2">
                  {courierUtilizationRate}%
                </p>
                <div className="flex items-center gap-1.5 mt-2 text-xs text-slate-500">
                  <span>
                    {busyCouriers.length} de {activeCouriers.length} entregadores em trânsito
                  </span>
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

          {/* CHARTS ROW (Weekly Trends + Status Distribution) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Chart 1: Weekly Volume Trends Line/Bar Graphic */}
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
                {/* SVG Line / Bar Chart Hybrid */}
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

            {/* Chart 2: Status Distribution (Doughnut style cards) */}
            <Card className="lg:col-span-4 border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col justify-between">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-bold text-slate-900 dark:text-white">
                  Distribuição de Status
                </CardTitle>
                <CardDescription className="text-xs">
                  Proporção de pedidos na operação atual.
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
                    {totalOrders > 0 ? Math.round((deliveredOrders.length / totalOrders) * 100) : 0}
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
                    {totalOrders > 0 ? Math.round((inTransitOrders.length / totalOrders) * 100) : 0}
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
                    {totalOrders > 0 ? Math.round((pendingOrders.length / totalOrders) * 100) : 0}%)
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

          {/* TEAM MANAGEMENT & SYSTEM ALERTS LOG */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Team / Users Management */}
            <div className="lg:col-span-7 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-blue-600" />
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    Gestão de Equipe ({users.length})
                  </h3>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsNewUserModalOpen(true)}
                  className="text-xs"
                >
                  + Novo Membro
                </Button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 uppercase tracking-wider">
                      <th className="py-2.5 px-3 font-semibold">Nome</th>
                      <th className="py-2.5 px-3 font-semibold">E-mail</th>
                      <th className="py-2.5 px-3 font-semibold">Perfil</th>
                      <th className="py-2.5 px-3 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {users.map((u) => (
                      <tr key={u.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/50">
                        <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-white">
                          {u.name || 'Sem nome'}
                        </td>
                        <td className="py-2.5 px-3 text-slate-500">{u.email}</td>
                        <td className="py-2.5 px-3">
                          <Badge
                            variant="outline"
                            className={`text-[10px] capitalize ${
                              u.role === 'admin'
                                ? 'bg-rose-50 text-rose-600 border-rose-200'
                                : u.role === 'seller'
                                  ? 'bg-blue-50 text-blue-600 border-blue-200'
                                  : 'bg-purple-50 text-purple-600 border-purple-200'
                            }`}
                          >
                            {u.role === 'courier'
                              ? '🛵 Entregador'
                              : u.role === 'seller'
                                ? '🏪 Vendedor'
                                : '🛡️ Admin'}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                            Ativo
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Real-time System Alert Log Feed */}
            <div className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    Feed de Alertas & Telemetria
                  </h3>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  Automático
                </Badge>
              </div>

              <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                {notifications.slice(0, 6).map((notif) => (
                  <div
                    key={notif.id}
                    className="p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                        {notif.type === 'off_route' && '⚠️ '}
                        {notif.type === 'delay' && '⏱️ '}
                        {notif.type === 'order' && '📦 '}
                        {notif.type === 'system' && '🔔 '}
                        {notif.title}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {new Date(notif.created).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="text-slate-600 dark:text-slate-300 leading-relaxed text-[11px]">
                      {notif.message}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Floating AI Assistant */}
      <AiLogisticsAssistant />

      {/* Create User Modal */}
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
              />
            </div>

            <div>
              <Label className="text-xs font-semibold">E-mail de Login</Label>
              <Input
                type="email"
                placeholder="roberto@logistica.com"
                value={newUserEmail}
                onChange={(e) => setNewUserEmail(e.target.value)}
                className="mt-1 text-xs"
              />
            </div>

            <div>
              <Label className="text-xs font-semibold">Perfil de Acesso (Role)</Label>
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

            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">Senha Inicial</Label>
                <span className="text-[10px] text-slate-500 dark:text-slate-400">
                  Mínimo 8 caracteres
                </span>
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

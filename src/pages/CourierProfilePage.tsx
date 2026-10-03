import React, { useState } from 'react'
import {
  User,
  Phone,
  Mail,
  Truck,
  CreditCard,
  ShieldCheck,
  MapPin,
  LogOut,
  Edit2,
  Check,
  X,
  Sparkles,
  Calendar,
  AlertCircle,
} from 'lucide-react'
import { Header } from '@/components/Header'
import { CourierBottomNav } from '@/components/CourierBottomNav'
import { useAuth } from '@/contexts/AuthContext'
import { deliveryService } from '@/services/deliveryService'
import { haversineDistanceMeters } from '@/lib/geo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'
import { Compass, BookOpen, ChevronRight } from 'lucide-react'
import { CourierRedirectionTutorialModal } from '@/components/CourierRedirectionTutorialModal'

export default function CourierProfilePage() {
  const { user, refreshUser, logout } = useAuth()
  const navigate = useNavigate()

  // Edição segura de telefone
  const [isEditingPhone, setIsEditingPhone] = useState(false)
  const [phoneNumber, setPhoneNumber] = useState(user?.phone || '')
  const [isSaving, setIsSaving] = useState(false)
  const [isTutorialOpen, setIsTutorialOpen] = useState(false)

  // Atualizar estado caso user mude
  React.useEffect(() => {
    if (user?.phone) {
      setPhoneNumber(user.phone)
    }
  }, [user?.phone])

  // Dedupe e lock de GPS na página de perfil
  const lastRecordedGpsRef = React.useRef<{ lat: number; lng: number; timestamp: number } | null>(
    null,
  )
  const isSendingLocationRef = React.useRef<boolean>(false)

  // Telemetria GPS com dedupe e lock
  React.useEffect(() => {
    if (!user?.id) return

    const updateLocation = async () => {
      if (typeof navigator !== 'undefined' && navigator.geolocation) {
        if (isSendingLocationRef.current) return

        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            const lat = pos.coords.latitude
            const lng = pos.coords.longitude
            const now = Date.now()
            const last = lastRecordedGpsRef.current

            if (last) {
              const timeDiff = (now - last.timestamp) / 1000
              // Haversine simples aproximado
              const R = 6371000
              const dLat = ((lat - last.lat) * Math.PI) / 180
              const dLon = ((lng - last.lng) * Math.PI) / 180
              const a =
                Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos((last.lat * Math.PI) / 180) *
                  Math.cos((lat * Math.PI) / 180) *
                  Math.sin(dLon / 2) *
                  Math.sin(dLon / 2)
              const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
              const dist = R * c

              if (timeDiff < 30 && dist < 20) return
            }

            if (isSendingLocationRef.current) return
            isSendingLocationRef.current = true

            let calculatedSpeed = 0
            if (
              typeof pos.coords.speed === 'number' &&
              !isNaN(pos.coords.speed) &&
              pos.coords.speed > 0
            ) {
              calculatedSpeed = Math.round(pos.coords.speed * 3.6)
            } else if (last) {
              const timeDiffSeconds = (now - last.timestamp) / 1000
              const dist = haversineDistanceMeters(last.lat, last.lng, lat, lng)
              if (dist < 2) {
                calculatedSpeed = 0
              } else if (timeDiffSeconds > 0 && timeDiffSeconds < 120) {
                calculatedSpeed = Math.round((dist / timeDiffSeconds) * 3.6)
              }
            }

            try {
              await deliveryService.updateCourierLocation(user.id, lat, lng, calculatedSpeed, 90)
              lastRecordedGpsRef.current = { lat, lng, timestamp: now }
            } catch (e) {
              console.error('Failed to post live location in profile page:', e)
            } finally {
              isSendingLocationRef.current = false
            }
          },
          () => {
            /* sem mock arbitrário */
          },
          { enableHighAccuracy: true, timeout: 10000 },
        )
      }
    }

    updateLocation()
    const interval = setInterval(updateLocation, 30000)
    return () => clearInterval(interval)
  }, [user])

  const handleSavePhone = async () => {
    if (!user?.id) return
    setIsSaving(true)
    try {
      await deliveryService.updateUser(user.id, {
        phone: phoneNumber.trim(),
      })
      await refreshUser()
      setIsEditingPhone(false)
      toast.success('Telefone atualizado com sucesso!')
    } catch (err) {
      console.error('Erro ao atualizar telefone:', err)
      toast.error('Não foi possível salvar o telefone. Tente novamente.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const vehicleCategory = deliveryService.normalizeVehicleCategory(user?.vehicle_type)

  const vehicleLabel =
    user?.vehicle_model ||
    (vehicleCategory === 'bicicleta'
      ? 'Bicicleta'
      : vehicleCategory === 'carro'
        ? 'Carro'
        : vehicleCategory === 'caminhao'
          ? 'Caminhão'
          : 'Moto')

  const statusMap = {
    active: {
      label: 'Ativo / Em Operação',
      color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    },
    idle: { label: 'Disponível / Base', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
    busy: {
      label: 'Ocupado / Em Rota',
      color: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    },
    pending: {
      label: 'Pendente de Aprovação',
      color: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
    },
    inactive: { label: 'Inativo', color: 'bg-rose-500/20 text-rose-400 border-rose-500/30' },
  }

  const currentStatus = user?.status ? statusMap[user.status] || statusMap.active : statusMap.active

  return (
    <div className="min-h-screen bg-white text-[#002855] flex flex-col pb-24 md:pb-8 font-sans antialiased">
      <Header />

      <main className="flex-1 max-w-xl mx-auto w-full p-4 space-y-4">
        {/* CABEÇALHO */}
        <div className="rounded-2xl border border-[#1E2B58] bg-[#0E1738] p-4 shadow-xl">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            App do Entregador
          </span>
          <h1 className="font-heading text-lg font-black text-white flex items-center gap-2">
            <User className="h-5 w-5 text-[#60A5FA]" />
            Meu Perfil &amp; Dados Cadastrais
          </h1>
        </div>

        {/* CARD FIXO: COMO USAR REDIREÇÃO (TUTORIAL ILUSTRADO REVISÁVEL A QUALQUER MOMENTO) */}
        <div className="rounded-2xl border border-amber-500/40 bg-gradient-to-br from-[#0E1738] to-[#121E46] p-4 shadow-xl relative overflow-hidden group">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/40 shrink-0">
                <Compass className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-heading text-sm font-bold text-white flex items-center gap-1.5">
                    Como usar redireção
                  </h3>
                  <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-[9px] px-1.5 py-0 font-bold">
                    Tutorial
                  </Badge>
                </div>
                <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                  Aprenda como registrar o Ponto A, abrir o GPS até o novo endereço, calcular o km
                  extra e atualizar o cadastro do cliente.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-3 pt-3 border-t border-[#1E2B58] flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-400 flex items-center gap-1">
              <BookOpen className="h-3.5 w-3.5 text-[#60A5FA]" /> 4 telas ilustradas
            </span>
            <Button
              type="button"
              size="sm"
              onClick={() => setIsTutorialOpen(true)}
              className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs h-8 px-3 rounded-lg shadow-sm flex items-center gap-1 transition"
            >
              <span>Ver tutorial ilustrado</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* CARD DE IDENTIDADE DO ENTREGADOR (MOVIDO DA MINHA ROTA PARA PERFIL - REQUISITO 1 & 4) */}
        <div className="rounded-2xl border border-[#1E2B58] bg-[#0E1738] p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0052CC] to-[#1D4ED8] text-white font-black text-lg shadow-brand border border-blue-400/30 shrink-0 font-heading">
                {user?.name ? user.name.slice(0, 2).toUpperCase() : 'EN'}
              </div>

              <div className="min-w-0">
                <h2 className="font-heading text-base font-bold text-white truncate">
                  {user?.name || 'Entregador'}
                </h2>
                <div className="flex items-center gap-1.5 flex-wrap text-xs text-slate-400 mt-0.5">
                  <span className="font-mono text-slate-300 font-semibold">
                    {user?.vehicle_plate || 'Sem placa'}
                  </span>
                  <span>•</span>
                  <span className="text-slate-300 truncate">{vehicleLabel}</span>
                  <Badge
                    variant="outline"
                    className="text-[9px] px-1.5 py-0 uppercase font-mono font-bold bg-[#0A1128] border-[#1E2B58] text-slate-300"
                  >
                    {vehicleCategory === 'bicicleta' ? '🚲 Bicicleta' : vehicleCategory}
                  </Badge>
                </div>
              </div>
            </div>

            <Badge className={`text-[10px] font-bold shrink-0 ${currentStatus.color}`}>
              {currentStatus.label}
            </Badge>
          </div>
        </div>

        {/* DADOS CADASTRAIS COMPLETOS (REQUISITO 4) */}
        <div className="rounded-2xl border border-[#1E2B58] bg-[#0E1738] p-5 shadow-xl space-y-4">
          <h3 className="text-xs font-bold font-heading uppercase tracking-wider text-slate-400 border-b border-[#1E2B58] pb-2">
            Informações Pessoais &amp; Contato
          </h3>

          {/* Nome Completo */}
          <div className="flex items-start gap-3 text-xs">
            <User className="h-4 w-4 text-[#60A5FA] mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Nome</span>
              <p className="font-semibold text-white truncate mt-0.5">
                {user?.name || 'Não informado'}
              </p>
            </div>
          </div>

          {/* E-mail de Acesso */}
          <div className="flex items-start gap-3 text-xs">
            <Mail className="h-4 w-4 text-[#60A5FA] mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">E-mail</span>
              <p className="font-semibold text-white truncate font-mono mt-0.5">
                {user?.email || 'Não informado'}
              </p>
            </div>
          </div>

          {/* Telefone / WhatsApp com Edição Segura */}
          <div className="flex items-start gap-3 text-xs">
            <Phone className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold text-slate-400">
                  Telefone / WhatsApp
                </span>
                {!isEditingPhone && (
                  <button
                    type="button"
                    onClick={() => setIsEditingPhone(true)}
                    className="text-[11px] text-[#60A5FA] hover:underline flex items-center gap-1 font-semibold"
                  >
                    <Edit2 className="h-3 w-3" />
                    Editar
                  </button>
                )}
              </div>

              {isEditingPhone ? (
                <div className="flex items-center gap-2 mt-1.5">
                  <Input
                    type="text"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="(00) 00000-0000"
                    className="h-8 text-xs bg-[#0A1128] border-[#1E2B58] text-white rounded-lg focus:border-[#60A5FA]"
                  />
                  <Button
                    size="sm"
                    onClick={handleSavePhone}
                    disabled={isSaving}
                    className="h-8 px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shrink-0"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setPhoneNumber(user?.phone || '')
                      setIsEditingPhone(false)
                    }}
                    className="h-8 px-2 text-slate-400 hover:text-white rounded-lg shrink-0"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <p className="font-semibold text-white font-mono mt-0.5">
                  {user?.phone || 'Nenhum telefone cadastrado'}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* DADOS DO VEÍCULO (REQUISITO 4) */}
        <div className="rounded-2xl border border-[#1E2B58] bg-[#0E1738] p-5 shadow-xl space-y-4">
          <h3 className="text-xs font-bold font-heading uppercase tracking-wider text-slate-400 border-b border-[#1E2B58] pb-2">
            Dados do Veículo &amp; Categoria
          </h3>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-[#0A1128] border border-[#1E2B58]">
              <span className="text-[10px] text-slate-400 uppercase font-bold block">
                Tipo / Categoria
              </span>
              <p className="font-heading text-sm font-bold text-white capitalize mt-0.5">
                {vehicleCategory === 'bicicleta' ? '🚲 Bicicleta' : vehicleCategory}
              </p>
            </div>

            <div className="p-3 rounded-xl bg-[#0A1128] border border-[#1E2B58]">
              <span className="text-[10px] text-slate-400 uppercase font-bold block">
                Placa do Veículo
              </span>
              <p className="font-mono text-sm font-bold text-[#FF6B35] uppercase mt-0.5">
                {user?.vehicle_plate || 'Não informada'}
              </p>
            </div>

            <div className="p-3 rounded-xl bg-[#0A1128] border border-[#1E2B58]">
              <span className="text-[10px] text-slate-400 uppercase font-bold block">
                Modelo / Descrição
              </span>
              <p className="font-heading text-xs font-bold text-slate-200 mt-0.5 truncate">
                {user?.vehicle_model || vehicleLabel}
              </p>
            </div>

            <div className="p-3 rounded-xl bg-[#0A1128] border border-[#1E2B58]">
              <span className="text-[10px] text-slate-400 uppercase font-bold block">
                Ano de Fabricação
              </span>
              <p className="font-mono text-xs font-bold text-slate-200 mt-0.5">
                {user?.vehicle_year || 'Não informado'}
              </p>
            </div>
          </div>
        </div>

        {/* BASE OPERACIONAL PADRÃO */}
        <div className="rounded-2xl border border-[#1E2B58] bg-[#0E1738] p-5 shadow-xl space-y-2">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-emerald-400 shrink-0" />
            <h3 className="text-xs font-bold font-heading uppercase tracking-wider text-slate-300">
              Base Operacional Rotaly
            </h3>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed pl-6">
            Polo Central: Av. Rio Branco, 156 - Centro, Rio de Janeiro - RJ (CEP: 20040-003)
          </p>
        </div>

        {/* BOTÃO DE LOGOUT / SAIR (REQUISITO 4) */}
        <div className="pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleLogout}
            className="w-full h-12 border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition"
          >
            <LogOut className="h-4 w-4 text-rose-400" />
            <span>Sair da Minha Conta Rotaly</span>
          </Button>
        </div>
      </main>

      {/* Navegação Inferior Mobile */}
      <CourierBottomNav />

      {/* Modal de Tutorial Ilustrado de Redireção */}
      <CourierRedirectionTutorialModal open={isTutorialOpen} onOpenChange={setIsTutorialOpen} />
    </div>
  )
}

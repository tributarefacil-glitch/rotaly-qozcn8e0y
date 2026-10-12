import React, { useState, useEffect, useMemo, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  UserPlus,
  Search,
  Edit2,
  X,
  Phone,
  FileText,
  Mail,
  Shield,
  Truck,
  Store,
  CheckCircle2,
  ArrowLeft,
  KeyRound,
  Eye,
  EyeOff,
  UserCheck,
  Ban,
  Car,
} from 'lucide-react'
import { toast } from 'sonner'
import { deliveryService } from '@/services/deliveryService'
import { getErrorMessage } from '@/lib/pocketbase/errors'
import type { UserRecord, VehicleType } from '@/types/delivery'
import { cn } from '@/lib/utils'

interface TeamUserManagementModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  users: UserRecord[]
  onUserSaved: () => void
  currentUserId?: string
}

// Utilitário para destacar texto pesquisado (<mark>)
function HighlightText({
  text,
  query,
  className,
}: {
  text: string
  query: string
  className?: string
}) {
  if (!text) return null
  const cleanQ = query.trim()
  if (!cleanQ) return <span className={className}>{text}</span>

  const regex = new RegExp(`(${cleanQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  const parts = text.split(regex)

  return (
    <span className={className}>
      {parts.map((part, i) =>
        part.toLowerCase() === cleanQ.toLowerCase() ? (
          <mark
            key={i}
            className="bg-amber-200 text-amber-950 font-bold px-0.5 rounded-sm dark:bg-amber-500/30 dark:text-amber-200"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </span>
  )
}

// Highlight específico para dígitos de telefone, CPF ou CNPJ
function HighlightDigits({
  text,
  digitsQuery,
  rawQuery,
  className,
}: {
  text: string
  digitsQuery: string
  rawQuery: string
  className?: string
}) {
  if (!text) return null
  if (rawQuery.trim() && text.toLowerCase().includes(rawQuery.toLowerCase().trim())) {
    return <HighlightText text={text} query={rawQuery} className={className} />
  }

  const textDigits = text.replace(/\D/g, '')
  if (digitsQuery && textDigits.includes(digitsQuery)) {
    return (
      <span className={cn('relative', className)}>
        <mark className="bg-amber-200 text-amber-950 font-bold px-0.5 rounded-sm dark:bg-amber-500/30 dark:text-amber-200">
          {text}
        </mark>
      </span>
    )
  }

  return <span className={className}>{text}</span>
}

// Máscara dinâmica de CPF / CNPJ para o input
function maskCpfCnpj(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 14)
  if (digits.length <= 11) {
    // CPF: 000.000.000-00
    return digits
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
  }
  // CNPJ: 00.000.000/0000-00
  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

// Máscara de telefone brasileiro (10 ou 11 dígitos)
function maskPhone(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 10) {
    return digits.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2')
  }
  return digits.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2')
}

export function TeamUserManagementModal({
  open,
  onOpenChange,
  users,
  onUserSaved,
  currentUserId,
}: TeamUserManagementModalProps) {
  // Tabs: 'create' | 'search' | 'edit'
  const [activeTab, setActiveTab] = useState<'create' | 'search' | 'edit'>('create')
  const [searchQuery, setSearchQuery] = useState('')
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null)

  // Form states (compartilhado entre criação e edição)
  const [formName, setFormName] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formPhone, setFormPhone] = useState('')
  const [formDocument, setFormDocument] = useState('')
  const [formRole, setFormRole] = useState<'admin' | 'seller' | 'courier'>('courier')
  const [formStatus, setFormStatus] = useState<'active' | 'inactive' | 'pending'>('active')
  const [formVehicleType, setFormVehicleType] = useState<VehicleType>('moto')
  const [formVehicleModel, setFormVehicleModel] = useState('')
  const [formVehiclePlate, setFormVehiclePlate] = useState('')
  const [formPassword, setFormPassword] = useState('Skip@Pass')
  const [showPassword, setShowPassword] = useState(false)
  const [isResettingPassword, setIsResettingPassword] = useState(false)
  const [newPasswordForEdit, setNewPasswordForEdit] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const searchInputRef = useRef<HTMLInputElement>(null)

  // Reseta form ao abrir ou voltar para 'create'
  const resetFormToCreate = () => {
    setActiveTab('create')
    setEditingUser(null)
    setFormName('')
    setFormEmail('')
    setFormPhone('')
    setFormDocument('')
    setFormRole('courier')
    setFormStatus('active')
    setFormVehicleType('moto')
    setFormVehicleModel('')
    setFormVehiclePlate('')
    setFormPassword('Skip@Pass')
    setIsResettingPassword(false)
    setNewPasswordForEdit('')
  }

  // Prepara edição de usuário
  const handleStartEdit = (userToEdit: UserRecord) => {
    setEditingUser(userToEdit)
    setFormName(userToEdit.name || '')
    setFormEmail(userToEdit.email || '')
    setFormPhone(userToEdit.phone ? maskPhone(userToEdit.phone) : '')
    setFormDocument(userToEdit.document ? maskCpfCnpj(userToEdit.document) : '')
    setFormRole((userToEdit.role as 'admin' | 'seller' | 'courier') || 'courier')
    setFormStatus(
      (userToEdit.status as 'active' | 'inactive' | 'pending') ||
        (userToEdit.status === 'idle' || userToEdit.status === 'busy' ? 'active' : 'active'),
    )
    setFormVehicleType(userToEdit.vehicle_type || 'moto')
    setFormVehicleModel(userToEdit.vehicle_model || '')
    setFormVehiclePlate(userToEdit.vehicle_plate || '')
    setIsResettingPassword(false)
    setNewPasswordForEdit('')
    setActiveTab('edit')
  }

  // Foco no input ao mudar de aba
  useEffect(() => {
    if (activeTab === 'search') {
      setTimeout(() => {
        searchInputRef.current?.focus()
      }, 80)
    }
  }, [activeTab])

  // Filtragem e Ranqueamento Inteligente por Nome, CPF, CNPJ e Telefone
  const filteredUsers = useMemo(() => {
    const raw = searchQuery.trim().toLowerCase()
    const digits = searchQuery.replace(/\D/g, '')

    if (!raw && !digits) {
      return users
    }

    interface ScoredUser {
      user: UserRecord
      score: number
      matchedField: 'name' | 'phone' | 'document' | 'email'
    }

    const scored: ScoredUser[] = []

    for (const u of users) {
      const name = (u.name || '').toLowerCase()
      const email = (u.email || '').toLowerCase()
      const doc = (u.document || '').toLowerCase()
      const docDigits = (u.document || '').replace(/\D/g, '')

      const phone = (u.phone || '').toLowerCase()
      const phoneDigits = (u.phone || '').replace(/\D/g, '')

      let highestScore = 0
      let bestField: 'name' | 'phone' | 'document' | 'email' = 'name'

      // 1. NOME
      if (raw && name) {
        if (name === raw) {
          highestScore = Math.max(highestScore, 1000)
          bestField = 'name'
        } else if (name.startsWith(raw)) {
          highestScore = Math.max(highestScore, 850)
          bestField = 'name'
        } else if (name.includes(` ${raw}`)) {
          highestScore = Math.max(highestScore, 700)
          bestField = 'name'
        } else if (name.includes(raw)) {
          highestScore = Math.max(highestScore, 500)
          bestField = 'name'
        }
      }

      // 2. DOCUMENTO (CPF / CNPJ) - ignora pontuação e máscara
      if (u.document) {
        if (raw && (doc === raw || doc.startsWith(raw))) {
          if (950 > highestScore) {
            highestScore = 950
            bestField = 'document'
          }
        } else if (digits && (docDigits === digits || docDigits.startsWith(digits))) {
          if (900 > highestScore) {
            highestScore = 900
            bestField = 'document'
          }
        } else if (raw && doc.includes(raw)) {
          if (650 > highestScore) {
            highestScore = 650
            bestField = 'document'
          }
        } else if (digits && docDigits.includes(digits)) {
          if (600 > highestScore) {
            highestScore = 600
            bestField = 'document'
          }
        }
      }

      // 3. TELEFONE - ignora pontuação e máscara
      if (u.phone) {
        if (digits && (phoneDigits === digits || phoneDigits.endsWith(digits))) {
          if (850 > highestScore) {
            highestScore = 850
            bestField = 'phone'
          }
        } else if (digits && (phoneDigits.startsWith(digits) || phoneDigits.includes(digits))) {
          if (700 > highestScore) {
            highestScore = 700
            bestField = 'phone'
          }
        } else if (raw && phone.includes(raw)) {
          if (600 > highestScore) {
            highestScore = 600
            bestField = 'phone'
          }
        }
      }

      // 4. E-MAIL
      if (raw && email) {
        if (email === raw) {
          if (800 > highestScore) {
            highestScore = 800
            bestField = 'email'
          }
        } else if (email.startsWith(raw) || email.includes(raw)) {
          if (550 > highestScore) {
            highestScore = 550
            bestField = 'email'
          }
        }
      }

      if (highestScore > 0) {
        scored.push({
          user: u,
          score: highestScore,
          matchedField: bestField,
        })
      }
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return (a.user.name || '').localeCompare(b.user.name || '')
    })

    return scored.map((s) => s.user)
  }, [users, searchQuery])

  // Submissão do Formulário (Criação ou Edição)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedName = formName.trim()
    const trimmedEmail = formEmail.trim().toLowerCase()
    const cleanPhone = formPhone.replace(/\D/g, '')
    const cleanDoc = formDocument.trim()

    if (!trimmedName || !trimmedEmail) {
      toast.error('Preencha nome completo e e-mail.')
      return
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(trimmedEmail)) {
      toast.error('Por favor, informe um e-mail válido.')
      return
    }

    // Proteção: não rebaixar a própria conta admin logada se for o admin logado
    if (editingUser && editingUser.id === currentUserId && formRole !== 'admin') {
      toast.error('Você não pode rebaixar o seu próprio perfil de Administrador.')
      return
    }

    setIsSubmitting(true)

    try {
      if (editingUser) {
        // === MODO EDIÇÃO ===
        const updatePayload: Parameters<typeof deliveryService.adminUpdateUser>[1] = {
          name: trimmedName,
          email: trimmedEmail,
          phone: cleanPhone || formPhone.trim(),
          document: cleanDoc,
          role: formRole,
          status: formStatus,
          ...(formRole === 'courier'
            ? {
                vehicle_type: formVehicleType,
                vehicle_model: formVehicleModel.trim(),
                vehicle_plate: formVehiclePlate.trim().toUpperCase(),
              }
            : {}),
        }

        // Se optou por redefinir senha (só incluir se digitado com >= 8 caracteres; omitir chaves quando vazio)
        const trimmedResetPass = newPasswordForEdit.trim()
        if (isResettingPassword && trimmedResetPass) {
          if (trimmedResetPass.length < 8) {
            toast.error('A nova senha deve ter no mínimo 8 caracteres.')
            setIsSubmitting(false)
            return
          }
          updatePayload.password = trimmedResetPass
        }
        delete (updatePayload as any).verified
        delete (updatePayload as any).passwordConfirm

        // Se for admin editando outro usuário, podemos tentar adminUpdateUser (que permite alterar senha sem senha antiga)
        // Se for o próprio usuário ou falhar a rota custom, fallback para updateUser
        try {
          if (editingUser.id !== currentUserId) {
            await deliveryService.adminUpdateUser(editingUser.id, updatePayload)
          } else {
            // Edição direta de si mesmo (sem alterar role e sem verified)
            const selfPayload: any = {
              name: trimmedName,
              email: trimmedEmail,
              phone: cleanPhone || formPhone.trim(),
              document: cleanDoc,
              ...(formRole === 'courier'
                ? {
                    vehicle_type: formVehicleType,
                    vehicle_model: formVehicleModel.trim(),
                    vehicle_plate: formVehiclePlate.trim().toUpperCase(),
                  }
                : {}),
            }
            if (updatePayload.password && updatePayload.password.length >= 8) {
              selfPayload.password = updatePayload.password
              selfPayload.passwordConfirm = updatePayload.password
            }
            delete selfPayload.verified
            await deliveryService.updateUser(editingUser.id, selfPayload)
          }
        } catch (apiErr: unknown) {
          console.warn('adminUpdateUser failed, trying standard updateUser:', apiErr)
          // Fallback para updateUser nativo do SDK (sem verified)
          const fallbackPayload: any = {
            name: trimmedName,
            email: trimmedEmail,
            phone: cleanPhone || formPhone.trim(),
            document: cleanDoc,
            role: formRole,
            status: formStatus,
            ...(formRole === 'courier'
              ? {
                  vehicle_type: formVehicleType,
                  vehicle_model: formVehicleModel.trim(),
                  vehicle_plate: formVehiclePlate.trim().toUpperCase(),
                }
              : {}),
          }
          if (updatePayload.password && updatePayload.password.length >= 8) {
            fallbackPayload.password = updatePayload.password
            fallbackPayload.passwordConfirm = updatePayload.password
          }
          delete fallbackPayload.verified
          await deliveryService.updateUser(editingUser.id, fallbackPayload)
        }

        toast.success(`Usuário "${trimmedName}" atualizado com sucesso!`)
        onUserSaved()
        setActiveTab('search')
        setEditingUser(null)
      } else {
        // === MODO CADASTRO DE NOVO USUÁRIO ===
        if (!formPassword || formPassword.length < 8) {
          toast.error('A senha deve ter no mínimo 8 caracteres.')
          setIsSubmitting(false)
          return
        }

        const createdUser = await deliveryService.createUser({
          name: trimmedName,
          email: trimmedEmail,
          phone: cleanPhone || formPhone.trim(),
          document: cleanDoc,
          password: formPassword,
          passwordConfirm: formPassword,
          role: formRole,
          status: 'active',
          ...(formRole === 'courier'
            ? {
                vehicle_type: formVehicleType,
                vehicle_model: formVehicleModel.trim(),
                vehicle_plate: formVehiclePlate.trim().toUpperCase(),
              }
            : {}),
        })

        // Vincular usuário cadastrado à empresa ativa
        try {
          const activeCompanyId = deliveryService.getActiveCompanyId()
          if (activeCompanyId && createdUser?.id) {
            await deliveryService.createMembro({
              empresa_id: activeCompanyId,
              user_id: createdUser.id,
              papel:
                formRole === 'courier'
                  ? 'entregador'
                  : formRole === 'seller'
                    ? 'vendedor'
                    : 'admin',
              ativo: true,
            })
          }
        } catch (mErr) {
          console.warn('Aviso ao vincular usuário à empresa ativa em membros:', mErr)
        }

        const roleLabel =
          formRole === 'courier'
            ? 'Entregador'
            : formRole === 'seller'
              ? 'Lojista'
              : 'Administrador'

        toast.success(`Usuário ${trimmedName} (${roleLabel}) cadastrado com sucesso!`)
        onUserSaved()
        resetFormToCreate()
        onOpenChange(false)
      }
    } catch (err: unknown) {
      console.error('Error saving user:', err)
      const msg = getErrorMessage(err)
      toast.error(msg || 'Falha ao salvar usuário. Verifique os dados informados.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const digitsQuery = searchQuery.replace(/\D/g, '')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
        {/* Header com Abas de Ação */}
        <div className="p-5 pb-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/80">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
              {activeTab === 'edit' ? (
                <>
                  <Edit2 className="h-5 w-5 text-amber-500" />
                  Editar Usuário da Equipe
                </>
              ) : activeTab === 'search' ? (
                <>
                  <Search className="h-5 w-5 text-blue-600" />
                  Buscar Usuários Cadastrados
                </>
              ) : (
                <>
                  <UserPlus className="h-5 w-5 text-blue-600" />
                  Cadastrar Novo Usuário na Equipe
                </>
              )}
            </DialogTitle>
          </div>

          <DialogDescription className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {activeTab === 'edit'
              ? `Atualize os dados cadastrais, documento (CPF/CNPJ) e veículo de ${editingUser?.name || 'usuário'}.`
              : activeTab === 'search'
                ? 'Busque por Nome, CPF, CNPJ ou Telefone e clique em Editar para atualizar qualquer usuário.'
                : 'Adicione novos entregadores, vendedores ou administradores à equipe.'}
          </DialogDescription>

          {/* Abas Superiores de Navegação */}
          <div className="flex items-center gap-2 mt-3 pt-2 border-t border-slate-200/80 dark:border-slate-800/80">
            <button
              type="button"
              onClick={resetFormToCreate}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                activeTab === 'create'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800',
              )}
            >
              <UserPlus className="h-3.5 w-3.5" />
              <span>Novo Cadastro</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('search')
                setEditingUser(null)
              }}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all relative',
                activeTab === 'search'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800',
              )}
            >
              <Search className="h-3.5 w-3.5" />
              <span>Buscar Usuários</span>
              <span className="ml-1 px-1.5 py-0.2 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 text-[10px] font-bold">
                {users.length}
              </span>
            </button>

            {activeTab === 'edit' && (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-300/40">
                <Edit2 className="h-3.5 w-3.5" />
                <span>Editando: {editingUser?.name?.split(' ')[0] || 'Usuário'}</span>
              </span>
            )}
          </div>
        </div>

        {/* CONTEÚDO PRINCIPAL: BUSCA vs FORMULÁRIO */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {activeTab === 'search' ? (
            /* ================= TELA DE BUSCA E LISTAGEM ================= */
            <div className="space-y-3.5">
              {/* Barra de Pesquisa por Nome, CPF, CNPJ e Telefone */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-blue-600 dark:text-blue-400" />
                <Input
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar por Nome, CPF, CNPJ ou Telefone..."
                  className="h-10 pl-9 pr-9 text-xs sm:text-sm bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 shadow-sm"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('')
                      searchInputRef.current?.focus()
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-slate-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Dica / Info de busca */}
              <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
                <span>
                  💡 Digite números com ou sem pontuação (ex: <em>21966174517</em> ou{' '}
                  <em>123.456.789-00</em>)
                </span>
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  {filteredUsers.length} {filteredUsers.length === 1 ? 'encontrado' : 'encontrados'}
                </span>
              </div>

              {/* Lista de Usuários Encontrados */}
              <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                {filteredUsers.length === 0 ? (
                  <div className="p-8 text-center rounded-xl border border-dashed border-slate-300 dark:border-slate-800 space-y-2">
                    <Search className="h-8 w-8 text-slate-300 mx-auto" />
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Nenhum usuário encontrado para &quot;{searchQuery}&quot;
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Verifique se digitou o nome, CPF, CNPJ ou telefone corretamente.
                    </p>
                    <Button
                      size="sm"
                      onClick={resetFormToCreate}
                      className="mt-2 text-xs bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                    >
                      <UserPlus className="h-3.5 w-3.5 mr-1" />
                      Cadastrar este usuário agora
                    </Button>
                  </div>
                ) : (
                  filteredUsers.map((u) => {
                    const roleLabel =
                      u.role === 'courier'
                        ? 'Entregador'
                        : u.role === 'seller'
                          ? 'Lojista'
                          : 'Administrador'
                    const roleIcon =
                      u.role === 'courier' ? (
                        <Truck className="h-3 w-3 text-emerald-500" />
                      ) : u.role === 'seller' ? (
                        <Store className="h-3 w-3 text-blue-500" />
                      ) : (
                        <Shield className="h-3 w-3 text-purple-500" />
                      )

                    const isInactive = u.status === 'inactive'

                    return (
                      <div
                        key={u.id}
                        className={cn(
                          'p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-sm hover:border-blue-300 dark:hover:border-blue-800 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3',
                          isInactive && 'opacity-75 bg-slate-50 dark:bg-slate-900/40',
                        )}
                      >
                        {/* Informações Principais */}
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white truncate">
                              <HighlightText text={u.name || 'Sem nome'} query={searchQuery} />
                            </span>

                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 gap-1 font-semibold border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                            >
                              {roleIcon}
                              <span>{roleLabel}</span>
                            </Badge>

                            {isInactive ? (
                              <Badge className="bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-300 text-[9px] px-1 py-0">
                                Inativo
                              </Badge>
                            ) : (
                              <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-300 text-[9px] px-1 py-0">
                                Ativo
                              </Badge>
                            )}

                            {u.id === currentUserId && (
                              <Badge className="bg-blue-500/15 text-blue-600 border-blue-300 text-[9px] px-1 py-0">
                                Você
                              </Badge>
                            )}
                          </div>

                          {/* Detalhes: E-mail, Telefone, CPF/CNPJ e Veículo */}
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                            <span className="flex items-center gap-1 truncate max-w-[200px]">
                              <Mail className="h-3 w-3 text-slate-400 shrink-0" />
                              <HighlightText text={u.email} query={searchQuery} />
                            </span>

                            {u.phone ? (
                              <span className="flex items-center gap-1 font-mono">
                                <Phone className="h-3 w-3 text-emerald-500 shrink-0" />
                                <HighlightDigits
                                  text={maskPhone(u.phone)}
                                  digitsQuery={digitsQuery}
                                  rawQuery={searchQuery}
                                />
                              </span>
                            ) : (
                              <span className="text-slate-400 italic">Sem telefone</span>
                            )}

                            {u.document ? (
                              <span className="flex items-center gap-1 font-mono">
                                <FileText className="h-3 w-3 text-blue-500 shrink-0" />
                                <span className="font-semibold text-slate-700 dark:text-slate-300">
                                  Doc:
                                </span>{' '}
                                <HighlightDigits
                                  text={maskCpfCnpj(u.document)}
                                  digitsQuery={digitsQuery}
                                  rawQuery={searchQuery}
                                />
                              </span>
                            ) : (
                              <span className="text-slate-400 italic">Sem CPF/CNPJ</span>
                            )}

                            {u.role === 'courier' && (
                              <span className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                                <Car className="h-3 w-3 text-amber-500 shrink-0" />
                                <span>{u.vehicle_model || u.vehicle_type || 'Moto'}</span>
                                {u.vehicle_plate && (
                                  <span className="font-mono font-bold uppercase text-[10px] px-1 py-0 rounded bg-slate-100 dark:bg-slate-800">
                                    {u.vehicle_plate}
                                  </span>
                                )}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Botão de Editar */}
                        <div className="shrink-0 flex items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => handleStartEdit(u)}
                            className="h-8 px-3 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-sm"
                          >
                            <Edit2 className="h-3 w-3" />
                            <span>Editar</span>
                          </Button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          ) : (
            /* ================= FORMULÁRIO DE CADASTRO OU EDIÇÃO ================= */
            <form onSubmit={handleSubmit} className="space-y-3.5">
              {activeTab === 'edit' && (
                <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-300/40 flex items-center justify-between text-xs text-amber-800 dark:text-amber-300">
                  <div className="flex items-center gap-2">
                    <Edit2 className="h-4 w-4 shrink-0 text-amber-600" />
                    <span>
                      Modo de edição ativo para{' '}
                      <strong>{editingUser?.name || 'este usuário'}</strong>
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setActiveTab('search')}
                    className="h-6 text-[11px] text-amber-800 hover:bg-amber-500/20"
                  >
                    <ArrowLeft className="h-3 w-3 mr-1" />
                    Voltar à busca
                  </Button>
                </div>
              )}

              {/* Nome Completo */}
              <div>
                <Label className="text-xs font-semibold">Nome Completo *</Label>
                <Input
                  placeholder="Ex: Roberto Silva"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="mt-1 text-xs"
                  required
                />
              </div>

              {/* E-mail e Telefone */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-semibold">E-mail *</Label>
                  <Input
                    type="email"
                    placeholder="roberto@logistica.com"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    className="mt-1 text-xs"
                    required
                  />
                </div>

                <div>
                  <Label className="text-xs font-semibold">Telefone / WhatsApp</Label>
                  <Input
                    type="tel"
                    placeholder="(11) 99999-9999"
                    value={formPhone}
                    onChange={(e) => setFormPhone(maskPhone(e.target.value))}
                    className="mt-1 text-xs font-mono"
                  />
                </div>
              </div>

              {/* CPF / CNPJ e Perfil de Acesso */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold">CPF ou CNPJ</Label>
                    <span className="text-[10px] text-slate-400">Com ou sem máscara</span>
                  </div>
                  <Input
                    placeholder="000.000.000-00 ou 00.000.000/0000-00"
                    value={formDocument}
                    onChange={(e) => setFormDocument(maskCpfCnpj(e.target.value))}
                    className="mt-1 text-xs font-mono"
                  />
                </div>

                <div>
                  <Label className="text-xs font-semibold">Perfil de Acesso</Label>
                  <Select
                    value={formRole}
                    onValueChange={(v) => setFormRole(v as 'admin' | 'seller' | 'courier')}
                    disabled={editingUser?.id === currentUserId}
                  >
                    <SelectTrigger className="mt-1 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="courier">🛵 Entregador (App Mobile & GPS)</SelectItem>
                      <SelectItem value="seller">
                        🏪 Lojista (Painel & Registro de Vendas)
                      </SelectItem>
                      <SelectItem value="admin">🛡️ Administrador (Acesso Total)</SelectItem>
                    </SelectContent>
                  </Select>
                  {editingUser?.id === currentUserId && (
                    <span className="text-[10px] text-slate-400 mt-0.5 block">
                      Você não pode alterar seu próprio perfil.
                    </span>
                  )}
                </div>
              </div>

              {/* Status (Apenas na edição) */}
              {activeTab === 'edit' && (
                <div>
                  <Label className="text-xs font-semibold">Status do Usuário</Label>
                  <Select
                    value={formStatus}
                    onValueChange={(v) => setFormStatus(v as 'active' | 'inactive' | 'pending')}
                  >
                    <SelectTrigger className="mt-1 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">🟢 Ativo (Acesso Liberado)</SelectItem>
                      <SelectItem value="inactive">⚪ Inativo / Bloqueado</SelectItem>
                      <SelectItem value="pending">🟡 Pendente de Aprovação</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Dados do Veículo (se Entregador) */}
              {formRole === 'courier' && (
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
                  <div className="flex items-center gap-1.5">
                    <Truck className="h-4 w-4 text-emerald-600" />
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase">
                      Dados do Veículo
                    </span>
                  </div>

                  <div>
                    <Label className="text-[11px] font-semibold">Tipo de Veículo</Label>
                    <Select
                      value={formVehicleType}
                      onValueChange={(v) => setFormVehicleType(v as VehicleType)}
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
                        value={formVehicleModel}
                        onChange={(e) => setFormVehicleModel(e.target.value)}
                        className="mt-1 text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-[11px] font-semibold">Placa</Label>
                      <Input
                        placeholder="ABC1D23"
                        value={formVehiclePlate}
                        onChange={(e) => setFormVehiclePlate(e.target.value)}
                        className="mt-1 text-xs uppercase font-mono"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Senha Inicial (no cadastro) OU Botão de Redefinir Senha (na edição) */}
              {activeTab === 'create' ? (
                <div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold">Senha Inicial *</Label>
                    <span className="text-[10px] text-slate-500">Mínimo 8 caracteres</span>
                  </div>
                  <div className="relative mt-1">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      value={formPassword}
                      onChange={(e) => setFormPassword(e.target.value)}
                      placeholder="Mínimo 8 caracteres"
                      className="text-xs pr-9"
                      minLength={8}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              ) : (
                /* Opção de Redefinir Senha do Usuário Existente */
                <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <KeyRound className="h-3.5 w-3.5 text-blue-600" />
                      <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                        Senha de Acesso
                      </span>
                    </div>
                    {!isResettingPassword ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setIsResettingPassword(true)}
                        className="h-7 text-xs text-blue-600 border-blue-200"
                      >
                        Redefinir Senha
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setIsResettingPassword(false)
                          setNewPasswordForEdit('')
                        }}
                        className="h-7 text-xs text-slate-500"
                      >
                        Cancelar
                      </Button>
                    )}
                  </div>

                  {isResettingPassword ? (
                    <div className="pt-1 space-y-1">
                      <div className="flex items-center justify-between">
                        <Label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                          Nova Senha
                        </Label>
                        <span className="text-[10px] text-slate-400">Mínimo 8 caracteres</span>
                      </div>
                      <Input
                        type="password"
                        placeholder="Digite a nova senha para este usuário..."
                        value={newPasswordForEdit}
                        onChange={(e) => setNewPasswordForEdit(e.target.value)}
                        className="h-8 text-xs"
                        minLength={8}
                      />
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-500">
                      A senha atual é criptografada e segura. Se o usuário esqueceu a senha, clique
                      em &quot;Redefinir Senha&quot;.
                    </p>
                  )}
                </div>
              )}

              {/* Botões do Rodapé do Formulário */}
              <DialogFooter className="pt-3 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (activeTab === 'edit') {
                      setActiveTab('search')
                    } else {
                      onOpenChange(false)
                    }
                  }}
                  className="text-xs"
                >
                  {activeTab === 'edit' ? 'Cancelar Edição' : 'Cancelar'}
                </Button>

                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs"
                >
                  {isSubmitting
                    ? 'Salvando...'
                    : activeTab === 'edit'
                      ? 'Salvar Alterações'
                      : 'Salvar Usuário'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </div>

        {/* Rodapé quando estiver na aba de busca */}
        {activeTab === 'search' && (
          <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs"
            >
              Fechar
            </Button>

            <Button
              type="button"
              size="sm"
              onClick={resetFormToCreate}
              className="bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs gap-1.5"
            >
              <UserPlus className="h-3.5 w-3.5" />
              <span>Cadastrar Novo Usuário</span>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
export default TeamUserManagementModal

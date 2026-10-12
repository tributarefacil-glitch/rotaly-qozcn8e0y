import React, { useState, useEffect } from 'react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { deliveryService } from '@/services/deliveryService'
import { getErrorMessage, extractFieldErrors } from '@/lib/pocketbase/errors'
import type { UserRecord, UserStatus } from '@/types/delivery'
import {
  Edit3,
  User,
  Mail,
  Phone,
  Lock,
  Eye,
  EyeOff,
  ShieldAlert,
  CheckCircle2,
  AlertCircle,
  Truck,
  Building2,
} from 'lucide-react'
import { toast } from 'sonner'

interface EditUserModalProps {
  user: UserRecord | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onUserUpdated: () => void
  currentAdminId?: string
}

export function EditUserModal({
  user,
  open,
  onOpenChange,
  onUserUpdated,
  currentAdminId,
}: EditUserModalProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [status, setStatus] = useState<UserStatus>('active')
  const [document, setDocument] = useState('')
  const [vehicleType, setVehicleType] = useState<string>('moto')
  const [vehicleModel, setVehicleModel] = useState('')
  const [vehiclePlate, setVehiclePlate] = useState('')

  // Conta Corrente: Saldo de Abertura e Data de Corte
  const [openingBalance, setOpeningBalance] = useState<string>('0')
  const [cutoffDate, setCutoffDate] = useState<string>('')

  // Senha e confirmação
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const [isSubmitting, setIsSubmitting] = useState(false)

  const isCourier = user?.role === 'courier'
  const isSeller = user?.role === 'seller'
  const roleLabel = isCourier ? 'Entregador' : isSeller ? 'Vendedor' : 'Usuário'

  useEffect(() => {
    if (user) {
      setName(user.name || '')
      setEmail(user.email || '')
      setPhone(user.phone || '')
      setStatus(user.status || 'active')
      setDocument(user.document || '')
      setVehicleType(user.vehicle_type || 'moto')
      setVehicleModel(user.vehicle_model || '')
      setVehiclePlate(user.vehicle_plate || '')
      setOpeningBalance(
        typeof user.opening_balance === 'number' ? String(user.opening_balance) : '0',
      )
      // Formata cutoff_date para YYYY-MM-DDTHH:mm se existir
      if (user.cutoff_date) {
        try {
          const d = new Date(user.cutoff_date)
          if (!isNaN(d.getTime())) {
            const pad = (n: number) => String(n).padStart(2, '0')
            const localIso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
            setCutoffDate(localIso)
          } else {
            setCutoffDate('')
          }
        } catch {
          setCutoffDate('')
        }
      } else {
        setCutoffDate('')
      }
      setNewPassword('')
      setConfirmPassword('')
      setShowPassword(false)
      setShowConfirmPassword(false)
    }
  }, [user])

  const isCurrentAdmin = !!user && !!currentAdminId && user.id === currentAdminId

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!user) return

    if (isCurrentAdmin) {
      toast.error(
        'Operação bloqueada: não é permitido alterar o usuário administrador por este painel.',
      )
      return
    }

    const trimmedName = name.trim()
    const trimmedEmail = email.trim().toLowerCase()
    const trimmedPhone = phone.trim()
    const trimmedDocument = document.trim()
    const trimmedPassword = newPassword.trim()
    const trimmedConfirmPassword = confirmPassword.trim()

    if (!trimmedName) {
      toast.error('O nome é obrigatório.')
      return
    }

    if (!trimmedEmail) {
      toast.error('O e-mail (login) é obrigatório.')
      return
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(trimmedEmail)) {
      toast.error('Por favor, informe um e-mail válido.')
      return
    }

    // Validação de senha: só valida se informou nova senha
    if (trimmedPassword || trimmedConfirmPassword) {
      if (trimmedPassword.length < 8) {
        toast.error('A nova senha deve ter no mínimo 8 caracteres.')
        return
      }
      if (trimmedPassword !== trimmedConfirmPassword) {
        toast.error('A confirmação da nova senha não confere.')
        return
      }
    }

    setIsSubmitting(true)
    try {
      const payload: {
        name?: string
        email?: string
        phone?: string
        document?: string
        status?: string
        password?: string
        vehicle_type?: string
        vehicle_model?: string
        vehicle_plate?: string
        opening_balance?: number
        cutoff_date?: string
      } = {}

      const hasNameChanged = trimmedName !== (user.name || '')
      const hasEmailChanged = trimmedEmail !== user.email?.toLowerCase()
      const hasPhoneChanged = trimmedPhone !== (user.phone || '')
      const hasDocumentChanged = trimmedDocument !== (user.document || '')
      const hasStatusChanged = status !== (user.status || 'active')

      if (hasNameChanged) payload.name = trimmedName
      if (hasEmailChanged) payload.email = trimmedEmail
      if (hasPhoneChanged) payload.phone = trimmedPhone
      if (hasDocumentChanged) payload.document = trimmedDocument
      if (hasStatusChanged) payload.status = status

      if (isCourier) {
        if (vehicleType !== (user.vehicle_type || 'moto')) {
          payload.vehicle_type = vehicleType
        }
        if (vehicleModel.trim() !== (user.vehicle_model || '')) {
          payload.vehicle_model = vehicleModel.trim()
        }
        if (vehiclePlate.trim().toUpperCase() !== (user.vehicle_plate || '')) {
          payload.vehicle_plate = vehiclePlate.trim().toUpperCase()
        }

        const parsedOpeningBalance = Number(parseFloat(openingBalance.replace(',', '.')))
        const validOpeningBalance = isNaN(parsedOpeningBalance) ? 0 : parsedOpeningBalance
        if (validOpeningBalance !== (user.opening_balance ?? 0)) {
          payload.opening_balance = validOpeningBalance
        }

        if (cutoffDate) {
          const isoCutoff = new Date(cutoffDate).toISOString()
          const currentCutoffIso = user.cutoff_date ? new Date(user.cutoff_date).toISOString() : ''
          if (isoCutoff !== currentCutoffIso) {
            payload.cutoff_date = isoCutoff
          }
        }
      }

      // Senha é opcional: só envia password se o admin digitou com >= 8 caracteres (omitir chaves quando vazio; NUNCA incluir verified)
      if (trimmedPassword && trimmedPassword.length >= 8) {
        payload.password = trimmedPassword
      }
      delete (payload as any).verified

      // Se nenhum campo foi alterado e nenhuma nova senha foi digitada
      if (Object.keys(payload).length === 0) {
        toast.info('Nenhuma alteração foi realizada.')
        onOpenChange(false)
        return
      }

      // Utiliza a rota administrativa segura (adminUpdateUser)
      await deliveryService.adminUpdateUser(user.id, payload)

      toast.success(`Cadastro de "${trimmedName}" (${roleLabel}) atualizado com sucesso!`)

      // Requisito 4: se o e-mail mudou, mostrar aviso em destaque
      if (hasEmailChanged) {
        toast.info(`Importante: O novo e-mail "${trimmedEmail}" passa a ser o login do usuário.`, {
          duration: 6000,
        })
      }

      setNewPassword('')
      setConfirmPassword('')
      onUserUpdated()
      onOpenChange(false)
    } catch (err: unknown) {
      console.error('Error updating user:', err)
      const fieldErrors = extractFieldErrors(err)

      if (fieldErrors.email) {
        const emailMsg = fieldErrors.email.toLowerCase()
        if (
          emailMsg.includes('unique') ||
          emailMsg.includes('already') ||
          emailMsg.includes('exist') ||
          emailMsg.includes('uso')
        ) {
          toast.error('Este e-mail já está em uso por outro usuário.')
        } else {
          toast.error(`E-mail inválido: ${fieldErrors.email}`)
        }
      } else if (fieldErrors.password || fieldErrors.passwordConfirm) {
        toast.error(
          'Erro na nova senha: ' +
            (fieldErrors.password ||
              fieldErrors.passwordConfirm ||
              'Mínimo de 6 caracteres exigidos.'),
        )
      } else if (fieldErrors.name) {
        toast.error(`Nome inválido: ${fieldErrors.name}`)
      } else {
        const msg = getErrorMessage(err)
        if (msg.includes('já está em uso') || msg.includes('already exists')) {
          toast.error('Este e-mail já está em uso por outro usuário.')
        } else if (msg.includes('Cannot be blank')) {
          toast.error('Campo obrigatório não pode ficar em branco.')
        } else if (msg.includes('Failed to update')) {
          toast.error('Falha ao atualizar cadastro do usuário. Verifique os dados informados.')
        } else {
          toast.error(msg || 'Falha ao salvar alterações do usuário.')
        }
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-[#0E1738] text-white border-[#1E2B58] p-5 sm:p-6 shadow-brand-dark">
        <DialogHeader className="pb-3 border-b border-[#1E2B58]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#0052CC]/20 border border-[#0052CC]/40 text-[#60A5FA]">
              {isCourier ? (
                <Truck className="h-5 w-5 text-[#FF6B35]" />
              ) : isSeller ? (
                <Building2 className="h-5 w-5 text-[#60A5FA]" />
              ) : (
                <Edit3 className="h-5 w-5 text-[#FF6B35]" />
              )}
            </div>
            <div>
              <DialogTitle className="text-lg font-black text-white font-heading">
                Editar Cadastro do {roleLabel}
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-400">
                Altere nome, e-mail de login, telefone, status e redefina a senha se necessário.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {isCurrentAdmin ? (
          <div className="py-6 text-center space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/30">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <p className="text-sm font-semibold text-rose-300">
              Edição não permitida para a conta de Administrador logada.
            </p>
            <p className="text-xs text-slate-400">
              Para alterar seus próprios dados ou senha, utilize o botão "Trocar Senha" no cabeçalho
              do painel.
            </p>
            <Button
              type="button"
              onClick={() => onOpenChange(false)}
              className="mt-2 bg-[#1E2B58] hover:bg-[#2A3B72] text-white text-xs"
            >
              Fechar
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} autoComplete="off" className="space-y-4 pt-3">
            {/* Nome Completo */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-[#60A5FA]" />
                Nome Completo <span className="text-[#FF6B35]">*</span>
              </Label>
              <Input
                placeholder="Ex: Marcos Fernando Barbosa"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
                className="h-9 text-xs bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500 focus:border-[#60A5FA]"
                required
              />
            </div>

            {/* Email de Login e Telefone */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5 text-[#60A5FA]" />
                  E-mail (Login) <span className="text-[#FF6B35]">*</span>
                </Label>
                <Input
                  type="email"
                  placeholder="usuario@rotaly.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="off"
                  className="h-9 text-xs bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500 focus:border-[#60A5FA]"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5 text-[#60A5FA]" />
                  Telefone / WhatsApp
                </Label>
                <Input
                  type="tel"
                  placeholder="(21) 99999-9999"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete="off"
                  className="h-9 text-xs bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500 focus:border-[#60A5FA]"
                />
              </div>
            </div>

            {/* Status da Conta e Documento (CPF) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-300">Status da Conta</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as UserStatus)}>
                  <SelectTrigger className="h-9 text-xs bg-[#070D1E] border-[#1E2B58] text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0E1738] border-[#1E2B58] text-white">
                    <SelectItem value="active" className="focus:bg-[#0052CC] focus:text-white">
                      🟢 Ativo (Acesso Liberado)
                    </SelectItem>
                    <SelectItem value="inactive" className="focus:bg-[#0052CC] focus:text-white">
                      ⚪ Inativo (Bloqueado)
                    </SelectItem>
                    <SelectItem value="pending" className="focus:bg-[#0052CC] focus:text-white">
                      🟡 Pendente (Aguardando Aprovação)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-300">CPF / Documento</Label>
                <Input
                  placeholder="000.000.000-00"
                  value={document}
                  onChange={(e) => setDocument(e.target.value)}
                  autoComplete="off"
                  className="h-9 text-xs bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500 focus:border-[#60A5FA]"
                />
              </div>
            </div>

            {/* Campos específicos de Entregador: Tipo de veículo, modelo e placa */}
            {isCourier && (
              <div className="p-3 rounded-lg bg-[#070D1E] border border-[#1E2B58] space-y-2.5">
                <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Truck className="h-3.5 w-3.5 text-[#FF6B35]" />
                  Dados do Veículo do Entregador
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-400">Tipo de Veículo</Label>
                    <Select value={vehicleType} onValueChange={setVehicleType}>
                      <SelectTrigger className="h-8 text-xs bg-[#0E1738] border-[#1E2B58] text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-[#0E1738] border-[#1E2B58] text-white">
                        <SelectItem value="moto">🏍️ Moto</SelectItem>
                        <SelectItem value="carro">🚗 Carro</SelectItem>
                        <SelectItem value="caminhao">🚚 Caminhão</SelectItem>
                        <SelectItem value="bicicleta">🚲 Bicicleta</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-400">Modelo</Label>
                    <Input
                      placeholder="Ex: Honda CG 160"
                      value={vehicleModel}
                      onChange={(e) => setVehicleModel(e.target.value)}
                      className="h-8 text-xs bg-[#0E1738] border-[#1E2B58] text-white placeholder:text-slate-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-400">Placa</Label>
                    <Input
                      placeholder="ABC1D23"
                      value={vehiclePlate}
                      onChange={(e) => setVehiclePlate(e.target.value.toUpperCase())}
                      className="h-8 text-xs bg-[#0E1738] border-[#1E2B58] text-white placeholder:text-slate-500 uppercase font-mono"
                    />
                  </div>
                </div>

                {/* Conta Corrente de Combustível: Saldo de Abertura & Data de Corte */}
                <div className="pt-2 border-t border-[#1E2B58]/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1">
                      ⛽ Conta Corrente: Saldo de Abertura &amp; Corte
                    </span>
                    <span className="text-[9px] text-slate-400">Congelamento de saldo oficial</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div className="space-y-1">
                      <Label className="text-[11px] text-slate-300">Saldo de Abertura (R$)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={openingBalance}
                        onChange={(e) => setOpeningBalance(e.target.value)}
                        className="h-8 text-xs bg-[#0E1738] border-[#1E2B58] text-white font-mono placeholder:text-slate-500"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-[11px] text-slate-300">Data e Hora de Corte</Label>
                      <Input
                        type="datetime-local"
                        value={cutoffDate}
                        onChange={(e) => setCutoffDate(e.target.value)}
                        className="h-8 text-xs bg-[#0E1738] border-[#1E2B58] text-white font-mono placeholder:text-slate-500"
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-400">
                    O saldo de abertura congela os lançamentos e pedidos anteriores ao corte. O
                    motor oficial calcula apenas pedidos a partir desta data.
                  </p>
                </div>
              </div>
            )}

            {/* SEÇÃO: Trocar Senha (Opcional com confirmação) */}
            <div className="p-3 rounded-lg bg-[#070D1E]/80 border border-[#1E2B58] space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400">
                  <Lock className="h-3.5 w-3.5" />
                  <span>Trocar Senha de Acesso</span>
                </div>
                <span className="text-[10px] text-slate-400 bg-[#1E2B58]/60 px-2 py-0.5 rounded">
                  Opcional — deixe em branco para manter a atual
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-300">Nova Senha</Label>
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Mínimo 8 caracteres"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      autoComplete="new-password"
                      className="h-9 text-xs pr-8 bg-[#0E1738] border-[#1E2B58] text-white placeholder:text-slate-500 focus:border-[#60A5FA]"
                      minLength={8}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                      tabIndex={-1}
                    >
                      {showPassword ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-300">
                    Confirmar Nova Senha
                  </Label>
                  <div className="relative">
                    <Input
                      type={showConfirmPassword ? 'text' : 'password'}
                      placeholder="Repita a nova senha"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                      className="h-9 text-xs pr-8 bg-[#0E1738] border-[#1E2B58] text-white placeholder:text-slate-500 focus:border-[#60A5FA]"
                      minLength={8}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                      tabIndex={-1}
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {newPassword && confirmPassword && newPassword !== confirmPassword && (
                <div className="flex items-center gap-1.5 text-[11px] text-rose-400 pt-0.5">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>As senhas digitadas não coincidem.</span>
                </div>
              )}
            </div>

            {user && (
              <div className="p-2.5 rounded-lg bg-[#070D1E] border border-[#1E2B58] flex items-center justify-between text-[11px] text-slate-400">
                <span>Identificador (ID):</span>
                <span className="font-mono text-slate-300">{user.id}</span>
              </div>
            )}

            <DialogFooter className="pt-3 border-t border-[#1E2B58] gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-[#1E2B58] text-slate-300 hover:bg-[#1E2B58] hover:text-white text-xs h-9"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="bg-[#0052CC] hover:bg-[#003E99] text-white font-bold text-xs h-9 min-w-[130px] shadow-brand gap-1.5"
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-[#22C55E]" />
                {isSubmitting ? 'Salvando...' : 'Salvar Alterações'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
export default EditUserModal

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
import { Edit3, Building2, Mail, Phone, ShieldAlert, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'

interface EditSellerModalProps {
  seller: UserRecord | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSellerUpdated: () => void
  currentAdminId?: string
}

export function EditSellerModal({
  seller,
  open,
  onOpenChange,
  onSellerUpdated,
  currentAdminId,
}: EditSellerModalProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [status, setStatus] = useState<UserStatus>('active')
  const [newPassword, setNewPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (seller) {
      setName(seller.name || '')
      setEmail(seller.email || '')
      setPhone(seller.phone || '')
      setStatus(seller.status || 'active')
      setNewPassword('')
    }
  }, [seller])

  const isCurrentAdmin = !!seller && !!currentAdminId && seller.id === currentAdminId

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!seller) return

    if (isCurrentAdmin) {
      toast.error(
        'Operação bloqueada: não é permitido alterar o usuário administrador por este painel.',
      )
      return
    }

    const trimmedName = name.trim()
    const trimmedEmail = email.trim().toLowerCase()
    const trimmedPhone = phone.trim()
    const trimmedPassword = newPassword.trim()

    if (!trimmedName) {
      toast.error('O nome do vendedor ou estabelecimento é obrigatório.')
      return
    }

    if (!trimmedEmail) {
      toast.error('O e-mail é obrigatório.')
      return
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(trimmedEmail)) {
      toast.error('Por favor, informe um e-mail válido.')
      return
    }

    // Só valida comprimento se uma nova senha tiver sido de fato informada
    if (trimmedPassword && trimmedPassword.length < 8) {
      toast.error('Se desejar redefinir a senha, ela deve ter no mínimo 8 caracteres.')
      return
    }

    setIsSubmitting(true)
    try {
      // Monta payload apenas com campos preenchidos e que foram alterados/informados
      const payload: {
        name?: string
        email?: string
        phone?: string
        status?: string
        password?: string
      } = {}

      if (trimmedName && trimmedName !== (seller.name || '')) {
        payload.name = trimmedName
      }

      if (trimmedEmail && trimmedEmail !== seller.email?.toLowerCase()) {
        payload.email = trimmedEmail
      }

      if (trimmedPhone !== (seller.phone || '')) {
        payload.phone = trimmedPhone
      }

      if (status !== (seller.status || 'active')) {
        payload.status = status
      }

      // NUNCA envia senha vazia: apenas se o admin digitou uma nova senha (>= 8 caracteres)
      if (trimmedPassword && trimmedPassword.length >= 8) {
        payload.password = trimmedPassword
      }

      // Se nenhum campo foi alterado e nenhuma nova senha foi digitada, encerra com aviso amigável
      if (Object.keys(payload).length === 0) {
        toast.info('Nenhuma alteração foi realizada.')
        onOpenChange(false)
        return
      }

      // Utiliza a rota administrativa segura (adminUpdateUser), que suporta redefinição
      // de senha por administrador sem exigir oldPassword.
      await deliveryService.adminUpdateUser(seller.id, payload)

      toast.success(`Dados do vendedor "${trimmedName}" atualizados com sucesso!`)
      setNewPassword('')
      onSellerUpdated()
      onOpenChange(false)
    } catch (err: unknown) {
      console.error('Error updating seller:', err)
      const fieldErrors = extractFieldErrors(err)

      if (fieldErrors.oldPassword) {
        toast.error('Não foi possível alterar a senha: senha antiga inválida ou não informada.')
      } else if (fieldErrors.email) {
        const emailMsg = fieldErrors.email.toLowerCase()
        if (
          emailMsg.includes('unique') ||
          emailMsg.includes('already') ||
          emailMsg.includes('exist')
        ) {
          toast.error('Este e-mail já está sendo utilizado por outro usuário.')
        } else {
          toast.error(`E-mail inválido: ${fieldErrors.email}`)
        }
      } else if (fieldErrors.password || fieldErrors.passwordConfirm) {
        toast.error(
          'Erro na nova senha: ' +
            (fieldErrors.password ||
              fieldErrors.passwordConfirm ||
              'Mínimo de 8 caracteres exigidos.'),
        )
      } else if (fieldErrors.name) {
        toast.error(`Nome inválido: ${fieldErrors.name}`)
      } else {
        const msg = getErrorMessage(err)
        // Mapeia mensagens cruas conhecidas em inglês para português
        if (msg.includes('Cannot be blank')) {
          toast.error('Campo obrigatório não pode ficar em branco.')
        } else if (msg.includes('Failed to update')) {
          toast.error('Falha ao atualizar dados do vendedor. Verifique os dados inseridos.')
        } else {
          toast.error(msg || 'Falha ao atualizar dados do vendedor.')
        }
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-[#0E1738] text-white border-[#1E2B58] p-5 sm:p-6 shadow-brand-dark">
        <DialogHeader className="pb-3 border-b border-[#1E2B58]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#0052CC]/20 border border-[#0052CC]/40 text-[#60A5FA]">
              <Edit3 className="h-5 w-5 text-[#FF6B35]" />
            </div>
            <div>
              <DialogTitle className="text-lg font-black text-white font-heading">
                Editar Dados do Vendedor
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-400">
                Altere informações comerciais, de contato e status do estabelecimento.
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
              Edição não permitida para o Administrador logado.
            </p>
            <p className="text-xs text-slate-400">
              Este registro corresponde à conta administrativa atualmente autenticada. Para editar
              seu próprio perfil, utilize as configurações de conta.
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
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-[#60A5FA]" />
                Nome / Estabelecimento <span className="text-[#FF6B35]">*</span>
              </Label>
              <Input
                placeholder="Ex: Pimenta Verde Cosméticos"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
                className="h-9 text-xs bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500 focus:border-[#60A5FA]"
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5 text-[#60A5FA]" />
                  E-mail <span className="text-[#FF6B35]">*</span>
                </Label>
                <Input
                  type="email"
                  placeholder="loja@rotaly.com"
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
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-slate-300">Nova Senha</Label>
                  <span className="text-[10px] text-slate-400">Opcional</span>
                </div>
                <Input
                  type="password"
                  placeholder="Deixar em branco para manter"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  name="edit_seller_new_password"
                  id="edit_seller_new_password"
                  className="h-9 text-xs bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500"
                  minLength={8}
                />
              </div>
            </div>

            {seller && (
              <div className="p-2.5 rounded-lg bg-[#070D1E] border border-[#1E2B58] flex items-center justify-between text-[11px] text-slate-400">
                <span>ID do Vendedor:</span>
                <span className="font-mono text-slate-300">{seller.id}</span>
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

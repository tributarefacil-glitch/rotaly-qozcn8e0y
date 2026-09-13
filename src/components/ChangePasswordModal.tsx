import React, { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { KeyRound, Eye, EyeOff, ShieldCheck, Check, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { deliveryService } from '@/services/deliveryService'
import { getErrorMessage } from '@/lib/pocketbase/errors'

interface ChangePasswordModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({ open, onOpenChange }) => {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const [isSubmitting, setIsSubmitting] = useState(false)

  const resetForm = () => {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setShowCurrentPassword(false)
    setShowNewPassword(false)
    setShowConfirmPassword(false)
    setIsSubmitting(false)
  }

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      resetForm()
    }
    onOpenChange(isOpen)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!currentPassword) {
      toast.error('Informe sua senha atual.')
      return
    }

    if (!newPassword) {
      toast.error('Informe a nova senha.')
      return
    }

    if (newPassword.length < 8) {
      toast.error('A nova senha deve ter pelo menos 8 caracteres.')
      return
    }

    if (newPassword === currentPassword) {
      toast.error('A nova senha deve ser diferente da senha atual.')
      return
    }

    if (newPassword !== confirmPassword) {
      toast.error('A confirmação da nova senha não confere.')
      return
    }

    setIsSubmitting(true)

    try {
      await deliveryService.changeMyPassword({
        currentPassword,
        newPassword,
        newPasswordConfirm: confirmPassword,
      })

      toast.success('Senha alterada com sucesso!')
      handleOpenChange(false)
    } catch (err: unknown) {
      const msg = getErrorMessage(err)
      // Se houver mensagem específica amigável
      if (
        msg.toLowerCase().includes('incorreta') ||
        msg.toLowerCase().includes('failed to authenticate') ||
        msg.toLowerCase().includes('invalid email or password')
      ) {
        toast.error('A senha atual informada está incorreta.')
      } else {
        toast.error(msg || 'Falha ao alterar senha. Verifique os dados informados.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const isMinLength = newPassword.length >= 8
  const isMatch = newPassword.length > 0 && newPassword === confirmPassword
  const isDifferentFromCurrent = newPassword.length > 0 && newPassword !== currentPassword
  const isFormValid =
    currentPassword.trim().length > 0 && isMinLength && isMatch && isDifferentFromCurrent

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md bg-white border border-slate-200 text-[#002855] shadow-xl">
        <DialogHeader className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 border border-blue-200 text-[#002855]">
              <KeyRound className="h-5 w-5 text-[#00A3FF]" />
            </div>
            <div>
              <DialogTitle className="font-heading text-lg font-bold text-[#002855]">
                Trocar Senha de Acesso
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Altere sua credencial de segurança da plataforma Rotaly
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Campo Senha Atual */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-200">Senha Atual</Label>
            <div className="relative">
              <Input
                type={showCurrentPassword ? 'text' : 'password'}
                placeholder="Digite sua senha atual"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="h-10 pr-10 text-xs sm:text-sm bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-[#00A3FF] focus:bg-white focus:ring-1 focus:ring-[#00A3FF]"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
                tabIndex={-1}
              >
                {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Campo Nova Senha */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-slate-200">Nova Senha</Label>
              <span className="text-[11px] text-slate-400">Mínimo 8 caracteres</span>
            </div>
            <div className="relative">
              <Input
                type={showNewPassword ? 'text' : 'password'}
                placeholder="Digite a nova senha segura"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="h-10 pr-10 text-xs sm:text-sm bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-[#00A3FF] focus:bg-white focus:ring-1 focus:ring-[#00A3FF]"
                autoComplete="new-password"
                minLength={8}
                required
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
                tabIndex={-1}
              >
                {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Campo Confirmar Nova Senha */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-200">Confirmar Nova Senha</Label>
            <div className="relative">
              <Input
                type={showConfirmPassword ? 'text' : 'password'}
                placeholder="Repita a nova senha"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="h-10 pr-10 text-xs sm:text-sm bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-[#00A3FF] focus:bg-white focus:ring-1 focus:ring-[#00A3FF]"
                autoComplete="new-password"
                minLength={8}
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
                tabIndex={-1}
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Dicas de Validação Visual */}
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5 text-[11px]">
            <div className="flex items-center gap-1.5">
              {isMinLength ? (
                <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              )}
              <span className={isMinLength ? 'text-emerald-300 font-medium' : 'text-slate-400'}>
                Pelo menos 8 caracteres
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {isMatch ? (
                <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              )}
              <span className={isMatch ? 'text-emerald-300 font-medium' : 'text-slate-400'}>
                Senhas coincidem
              </span>
            </div>
            {newPassword && !isDifferentFromCurrent && currentPassword && (
              <div className="flex items-center gap-1.5 text-amber-400">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span>A nova senha deve ser diferente da atual</span>
              </div>
            )}
          </div>

          <DialogFooter className="pt-2 gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isSubmitting}
              className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-[#002855]"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !isFormValid}
              className="bg-[#00A3FF] hover:bg-[#008CE0] text-white font-bold gap-1.5 shadow-sm"
            >
              {' '}
              <ShieldCheck className="h-4 w-4" />
              {isSubmitting ? 'Atualizando Senha...' : 'Salvar Nova Senha'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

import React, { useState } from 'react'
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
import { deliveryService } from '@/services/deliveryService'
import { getErrorMessage, extractFieldErrors } from '@/lib/pocketbase/errors'
import { Store, UserPlus, Lock, Mail, Phone, Building2, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'

interface CreateSellerModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSellerCreated: () => void
}

export function CreateSellerModal({ open, onOpenChange, onSellerCreated }: CreateSellerModalProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('Skip@Pass')
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const resetForm = () => {
    setName('')
    setEmail('')
    setPhone('')
    setPassword('Skip@Pass')
    setShowPassword(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const trimmedName = name.trim()
    const trimmedEmail = email.trim().toLowerCase()
    const trimmedPhone = phone.trim()

    if (!trimmedName || !trimmedEmail) {
      toast.error('Preencha o nome do vendedor ou estabelecimento e o e-mail.')
      return
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(trimmedEmail)) {
      toast.error('Por favor, informe um e-mail válido.')
      return
    }

    if (!password || password.length < 8) {
      toast.error('A senha deve conter no mínimo 8 caracteres.')
      return
    }

    setIsSubmitting(true)
    try {
      await deliveryService.createUser({
        name: trimmedName,
        email: trimmedEmail,
        phone: trimmedPhone,
        password,
        passwordConfirm: password,
        role: 'seller',
        status: 'active',
      })

      toast.success(`Vendedor/Estabelecimento "${trimmedName}" cadastrado com sucesso!`)
      resetForm()
      onSellerCreated()
      onOpenChange(false)
    } catch (err: unknown) {
      console.error('Error creating seller:', err)
      const fieldErrors = extractFieldErrors(err)
      if (fieldErrors.email) {
        toast.error(
          `E-mail indisponível: ${fieldErrors.email.toLowerCase().includes('unique') || fieldErrors.email.toLowerCase().includes('already') ? 'Este e-mail já está em uso por outro usuário.' : fieldErrors.email}`,
        )
      } else if (fieldErrors.password || fieldErrors.passwordConfirm) {
        toast.error('Senha fraca ou inválida. Use ao menos 8 caracteres.')
      } else {
        const msg = getErrorMessage(err)
        toast.error(msg || 'Falha ao cadastrar vendedor.')
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
              <Store className="h-5 w-5 text-[#FF6B35]" />
            </div>
            <div>
              <DialogTitle className="text-lg font-black text-white font-heading flex items-center gap-2">
                Cadastrar Novo Vendedor
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-400">
                Cadastre um vendedor ou estabelecimento comercial com acesso ao painel de despachos.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5 text-[#60A5FA]" />
              Nome / Estabelecimento <span className="text-[#FF6B35]">*</span>
            </Label>
            <Input
              placeholder="Ex: Pimenta Verde Cosméticos ou João da Silva"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9 text-xs bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500 focus:border-[#60A5FA]"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5 text-[#60A5FA]" />
                E-mail de Acesso <span className="text-[#FF6B35]">*</span>
              </Label>
              <Input
                type="email"
                placeholder="loja@loghype.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
                className="h-9 text-xs bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500 focus:border-[#60A5FA]"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 text-[#60A5FA]" />
                Senha Inicial de Acesso <span className="text-[#FF6B35]">*</span>
              </Label>
              <span className="text-[10px] text-slate-400">Mínimo 8 caracteres</span>
            </div>
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Skip@Pass"
                className="h-9 text-xs font-mono bg-[#070D1E] border-[#1E2B58] text-[#60A5FA] placeholder:text-slate-500 pr-9"
                minLength={8}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-[10px] text-slate-400">
              O vendedor receberá acesso como <strong>Lojista (seller)</strong> e status ativo para
              criar pedidos imediatamente.
            </p>
          </div>

          <DialogFooter className="pt-3 border-t border-[#1E2B58] gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                resetForm()
                onOpenChange(false)
              }}
              className="border-[#1E2B58] text-slate-300 hover:bg-[#1E2B58] hover:text-white text-xs h-9"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-[#0052CC] hover:bg-[#003E99] text-white font-bold text-xs h-9 min-w-[140px] shadow-brand gap-1.5"
            >
              <UserPlus className="h-3.5 w-3.5 text-[#FF6B35]" />
              {isSubmitting ? 'Cadastrando...' : 'Cadastrar Vendedor'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

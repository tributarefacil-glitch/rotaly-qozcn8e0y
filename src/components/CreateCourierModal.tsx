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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { deliveryService } from '@/services/deliveryService'
import { getErrorMessage } from '@/lib/pocketbase/errors'
import type { VehicleType } from '@/types/delivery'
import { Bike, Car, Truck, UserPlus, Upload, ShieldCheck, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'

interface CreateCourierModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCourierCreated: () => void
}

export function CreateCourierModal({
  open,
  onOpenChange,
  onCourierCreated,
}: CreateCourierModalProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('Skip@Pass')
  const [vehicleType, setVehicleType] = useState<VehicleType>('moto')
  const [vehicleModel, setVehicleModel] = useState('')
  const [vehiclePlate, setVehiclePlate] = useState('')
  const [vehicleYear, setVehicleYear] = useState<string>(new Date().getFullYear().toString())
  const [documentFile, setDocumentFile] = useState<File | null>(null)
  const [documentPreview, setDocumentPreview] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleDocumentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setDocumentFile(file)
      setDocumentPreview(URL.createObjectURL(file))
    }
  }

  const resetForm = () => {
    setName('')
    setEmail('')
    setPhone('')
    setPassword('Skip@Pass')
    setVehicleType('moto')
    setVehicleModel('')
    setVehiclePlate('')
    setVehicleYear(new Date().getFullYear().toString())
    setDocumentFile(null)
    setDocumentPreview(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const trimmedName = name.trim()
    const trimmedEmail = email.trim().toLowerCase()
    const trimmedPhone = phone.trim()

    if (!trimmedName || !trimmedEmail) {
      toast.error('Preencha nome completo e e-mail.')
      return
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(trimmedEmail)) {
      toast.error('Por favor, insira um e-mail válido.')
      return
    }

    if (!password || password.length < 8) {
      toast.error('A senha deve ter pelo menos 8 caracteres.')
      return
    }

    setIsSubmitting(true)
    try {
      if (documentFile) {
        // Enviar como FormData para anexar o documento/CNH
        const formData = new FormData()
        formData.append('name', trimmedName)
        formData.append('email', trimmedEmail)
        formData.append('phone', trimmedPhone)
        formData.append('password', password)
        formData.append('passwordConfirm', password)
        formData.append('role', 'courier')
        formData.append('status', 'active')
        formData.append('vehicle_type', vehicleType)
        formData.append('vehicle_model', vehicleModel.trim())
        formData.append('vehicle_plate', vehiclePlate.trim().toUpperCase())
        if (vehicleYear) {
          formData.append('vehicle_year', vehicleYear)
        }
        formData.append('documents', documentFile)

        await deliveryService.createUser(formData)
      } else {
        await deliveryService.createUser({
          name: trimmedName,
          email: trimmedEmail,
          phone: trimmedPhone,
          password,
          passwordConfirm: password,
          role: 'courier',
          status: 'active',
          vehicle_type: vehicleType,
          vehicle_model: vehicleModel.trim(),
          vehicle_plate: vehiclePlate.trim().toUpperCase(),
          vehicle_year: vehicleYear ? parseInt(vehicleYear, 10) : undefined,
        })
      }

      toast.success(`Entregador ${trimmedName} cadastrado com sucesso!`)
      resetForm()
      onCourierCreated()
      onOpenChange(false)
    } catch (err: unknown) {
      console.error('Error creating courier:', err)
      const msg = getErrorMessage(err)
      toast.error(msg || 'Falha ao cadastrar entregador.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto bg-[#0E1738] text-white border-[#1E2B58] p-5 sm:p-6 shadow-brand-dark">
        <DialogHeader className="pb-2 border-b border-[#1E2B58]">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-[#0052CC]/20 border border-[#0052CC]/40 text-[#60A5FA]">
              <UserPlus className="h-5 w-5 text-[#FF6B35]" />
            </div>
            <div>
              <DialogTitle className="text-lg font-black text-white font-heading">
                Cadastrar Novo Entregador
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-400">
                Cadastre um entregador da frota com acesso imediato ao aplicativo de entregas.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Dados Pessoais */}
          <div className="space-y-3">
            <div>
              <Label className="text-xs font-semibold text-slate-300">
                Nome Completo <span className="text-[#FF6B35]">*</span>
              </Label>
              <Input
                placeholder="Ex: Carlos Eduardo dos Santos"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 h-9 text-xs bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500 focus:border-[#60A5FA]"
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-semibold text-slate-300">
                  E-mail de Acesso <span className="text-[#FF6B35]">*</span>
                </Label>
                <Input
                  type="email"
                  placeholder="carlos@entregas.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 h-9 text-xs bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500 focus:border-[#60A5FA]"
                  required
                />
              </div>

              <div>
                <Label className="text-xs font-semibold text-slate-300">Telefone / WhatsApp</Label>
                <Input
                  type="tel"
                  placeholder="(11) 98765-4321"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="mt-1 h-9 text-xs bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500 focus:border-[#60A5FA]"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-slate-300">Senha Provisória</Label>
                <span className="text-[10px] text-slate-400">Mínimo 8 caracteres</span>
              </div>
              <Input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Skip@Pass"
                className="mt-1 h-9 text-xs font-mono bg-[#070D1E] border-[#1E2B58] text-[#60A5FA] placeholder:text-slate-500"
                minLength={8}
                required
              />
              <p className="text-[10px] text-slate-400 mt-0.5">
                O entregador poderá alterar a senha depois pelo aplicativo.
              </p>
            </div>
          </div>

          {/* Dados do Veículo */}
          <div className="p-3.5 rounded-xl bg-[#0A1128] border border-[#1E2B58] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#60A5FA] uppercase tracking-wider flex items-center gap-1.5 font-heading">
                <ShieldCheck className="h-4 w-4 text-[#22C55E]" />
                Veículo do Entregador
              </span>
              <span className="text-[10px] text-slate-400">Usado no cálculo de combustível</span>
            </div>

            <div>
              <Label className="text-xs font-semibold text-slate-300">Tipo de Veículo</Label>
              <Select value={vehicleType} onValueChange={(v) => setVehicleType(v as VehicleType)}>
                <SelectTrigger className="mt-1 h-9 text-xs bg-[#070D1E] border-[#1E2B58] text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0E1738] border-[#1E2B58] text-white">
                  <SelectItem value="moto" className="focus:bg-[#0052CC] focus:text-white">
                    <div className="flex items-center gap-2">
                      <Bike className="h-3.5 w-3.5 text-[#22C55E]" />
                      <span>🏍️ Moto (Média 35 km/L)</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="carro" className="focus:bg-[#0052CC] focus:text-white">
                    <div className="flex items-center gap-2">
                      <Car className="h-3.5 w-3.5 text-[#60A5FA]" />
                      <span>🚗 Carro / Utilitário (Média 12 km/L)</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="caminhao" className="focus:bg-[#0052CC] focus:text-white">
                    <div className="flex items-center gap-2">
                      <Truck className="h-3.5 w-3.5 text-[#FF6B35]" />
                      <span>🚚 Caminhão / VUC (Média 7 km/L)</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="bicicleta" className="focus:bg-[#0052CC] focus:text-white">
                    <div className="flex items-center gap-2">
                      <Bike className="h-3.5 w-3.5 text-emerald-400" />
                      <span>🚲 Bicicleta</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="sm:col-span-2">
                <Label className="text-[11px] font-semibold text-slate-300">
                  Modelo do Veículo
                </Label>
                <Input
                  placeholder="Ex: Honda CG 160 Fan"
                  value={vehicleModel}
                  onChange={(e) => setVehicleModel(e.target.value)}
                  className="mt-1 h-8 text-xs bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500"
                />
              </div>

              <div>
                <Label className="text-[11px] font-semibold text-slate-300">Placa</Label>
                <Input
                  placeholder="ABC1D23"
                  value={vehiclePlate}
                  onChange={(e) => setVehiclePlate(e.target.value.toUpperCase())}
                  className="mt-1 h-8 text-xs uppercase font-mono bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500"
                />
              </div>
            </div>
          </div>

          {/* Upload de Documento / CNH (Opcional no cadastro rápido pelo vendedor) */}
          <div className="p-3 rounded-xl bg-[#070D1E] border border-[#1E2B58] space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Upload className="h-3.5 w-3.5 text-[#60A5FA]" />
                Documento CNH / RG (Opcional)
              </Label>
              {documentFile && (
                <span className="text-[10px] text-[#22C55E] flex items-center gap-1 font-bold">
                  <CheckCircle2 className="h-3 w-3" /> Arquivo anexado
                </span>
              )}
            </div>

            {documentPreview ? (
              <div className="flex items-center gap-3 p-2 rounded-lg bg-[#0A1128] border border-[#1E2B58]">
                <img
                  src={documentPreview}
                  alt="Pré-visualização do documento"
                  className="h-12 w-12 object-cover rounded border border-[#1E2B58]"
                />
                <div className="flex-1 min-w-0 text-xs">
                  <p className="truncate font-semibold text-white">{documentFile?.name}</p>
                  <p className="text-[10px] text-slate-400">
                    {documentFile ? `${(documentFile.size / 1024).toFixed(0)} KB` : ''}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDocumentFile(null)
                    setDocumentPreview(null)
                  }}
                  className="h-7 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-950/40"
                >
                  Remover
                </Button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center p-3 border border-dashed border-[#1E2B58] hover:border-[#60A5FA] rounded-lg cursor-pointer bg-[#0A1128]/50 hover:bg-[#0A1128] transition group">
                <Upload className="h-5 w-5 text-slate-400 group-hover:text-[#60A5FA] mb-1" />
                <span className="text-xs text-slate-300 group-hover:text-white font-medium">
                  Clique para anexar foto da CNH ou documento
                </span>
                <span className="text-[10px] text-slate-500">
                  Formatos: JPG, PNG ou PDF (máx. 5MB)
                </span>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={handleDocumentChange}
                />
              </label>
            )}
          </div>

          <DialogFooter className="pt-2 gap-2">
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
              className="bg-[#0052CC] hover:bg-[#003E99] text-white font-bold text-xs h-9 min-w-[140px] shadow-brand"
            >
              {isSubmitting ? 'Salvando...' : 'Cadastrar Entregador'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

import React, { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  User,
  Truck,
  Store,
  ShieldCheck,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Upload,
  Camera,
  FileText,
  Lock,
  Mail,
  Phone,
  Car,
  AlertCircle,
  Eye,
  EyeOff,
  Sparkles,
} from 'lucide-react'
import { deliveryService } from '@/services/deliveryService'
import { getErrorMessage } from '@/lib/pocketbase/errors'
import { RotalyLogo } from '@/components/RotalyLogo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'

export default function RegisterPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const initialRoleParam = searchParams.get('role') === 'seller' ? 'seller' : 'courier'

  // Selected Profile
  const [profileType, setProfileType] = useState<'courier' | 'seller'>(initialRoleParam)

  // Stepper State (Step 1, 2, 3)
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [registrationComplete, setRegistrationComplete] = useState(false)

  // Password visibility toggles
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  // Step 1: Personal Data
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')

  // Step 2: Vehicle Data (Couriers only)
  const [vehicleType, setVehicleType] = useState<'moto' | 'carro' | 'van' | 'caminhao'>('moto')
  const [vehicleModel, setVehicleModel] = useState('')
  const [vehicleYear, setVehicleYear] = useState<string>(new Date().getFullYear().toString())

  // Step 3: Plate & Documents Upload (Couriers only)
  const [vehiclePlate, setVehiclePlate] = useState('')
  const [cnhFile, setCnhFile] = useState<File | null>(null)
  const [cnhPreview, setCnhPreview] = useState<string | null>(null)
  const [selfieFile, setSelfieFile] = useState<File | null>(null)
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null)

  // File change handlers
  const handleCnhChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      setCnhFile(file)
      setCnhPreview(URL.createObjectURL(file))
    }
  }

  const handleSelfieChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      setSelfieFile(file)
      setSelfiePreview(URL.createObjectURL(file))
    }
  }

  // Validate Step 1
  const validateStep1 = () => {
    const trimmedName = name.trim()
    const trimmedEmail = email.trim()
    const trimmedPhone = phone.trim()

    if (!trimmedName || !trimmedEmail || !trimmedPhone) {
      toast.error('Preencha nome completo, e-mail e telefone.')
      return false
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(trimmedEmail)) {
      toast.error('Informe um formato de e-mail válido.')
      return false
    }

    if (!password || password.length < 8) {
      toast.error('A senha deve ter pelo menos 8 caracteres.')
      return false
    }

    if (password !== passwordConfirm) {
      toast.error('As senhas digitadas não coincidem.')
      return false
    }

    return true
  }

  // Validate Step 2 (Vehicle)
  const validateStep2 = () => {
    if (!vehicleModel.trim()) {
      toast.error('Informe o modelo do veículo (ex: Honda CG 160, Fiat Fiorino).')
      return false
    }
    const year = parseInt(vehicleYear)
    if (isNaN(year) || year < 1980 || year > new Date().getFullYear() + 1) {
      toast.error('Informe um ano de veículo válido.')
      return false
    }
    return true
  }

  // Validate Step 3 (Plate & Documents)
  const validateStep3 = () => {
    if (!vehiclePlate.trim()) {
      toast.error('Informe a placa do veículo.')
      return false
    }
    if (!cnhFile) {
      toast.error('É obrigatório enviar o documento RG ou CNH.')
      return false
    }
    if (!selfieFile) {
      toast.error('É obrigatório enviar uma selfie com rosto visível.')
      return false
    }
    return true
  }

  // Next step handler
  const handleNext = () => {
    if (currentStep === 1) {
      if (!validateStep1()) return

      if (profileType === 'seller') {
        // Seller skips steps 2 and 3 and submits directly
        handleSubmitRegistration()
        return
      }
      setCurrentStep(2)
    } else if (currentStep === 2) {
      if (!validateStep2()) return
      setCurrentStep(3)
    }
  }

  // Final submit handler
  const handleSubmitRegistration = async () => {
    if (profileType === 'courier') {
      if (!validateStep1()) {
        setCurrentStep(1)
        return
      }
      if (!validateStep2()) {
        setCurrentStep(2)
        return
      }
      if (!validateStep3()) {
        return
      }
    } else {
      if (!validateStep1()) {
        setCurrentStep(1)
        return
      }
    }

    setIsSubmitting(true)
    try {
      // Use FormData to send file uploads to PocketBase
      const formData = new FormData()
      formData.append('email', email.trim().toLowerCase())
      formData.append('password', password)
      formData.append('passwordConfirm', passwordConfirm)
      formData.append('name', name.trim())
      formData.append('phone', phone.trim())
      formData.append('role', profileType)

      // Set initial status: couriers start as 'pending' awaiting document approval, sellers start as 'active'
      formData.append('status', profileType === 'courier' ? 'pending' : 'active')

      if (profileType === 'courier') {
        formData.append('vehicle_type', vehicleType)
        formData.append('vehicle_model', vehicleModel.trim())
        formData.append('vehicle_year', vehicleYear)
        formData.append('vehicle_plate', vehiclePlate.trim().toUpperCase())

        if (cnhFile) {
          formData.append('documents', cnhFile)
        }
        if (selfieFile) {
          formData.append('selfie', selfieFile)
        }
      }

      await deliveryService.createUser(formData)

      setRegistrationComplete(true)
      if (profileType === 'courier') {
        toast.success('Cadastro enviado com sucesso! Aguarde a aprovação do administrador.')
      } else {
        toast.success('Cadastro de Lojista criado com sucesso! Faça login para continuar.')
      }
    } catch (err: unknown) {
      console.error('Registration error:', err)
      const msg = getErrorMessage(err, 'Falha ao realizar cadastro.')
      toast.error(msg)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#070D1E] text-slate-100 flex flex-col justify-between selection:bg-[#0052CC] selection:text-white relative font-sans">
      {/* Header */}
      <header className="relative z-10 w-full border-b border-[#1E2B58] bg-[#0A1128]/90 backdrop-blur-md px-6 py-3.5 shadow-brand-dark">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link to="/" className="flex items-center hover:opacity-95">
            <RotalyLogo size="md" theme="dark" showTagline={false} />
          </Link>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/login')}
            className="text-xs text-[#60A5FA] hover:text-white hover:bg-[#121E46] font-bold gap-1.5 rounded-lg border border-[#1E2B58]"
          >
            <ArrowLeft className="h-4 w-4" />
            Já tenho conta (Fazer Login)
          </Button>
        </div>
      </header>
      {/* Main Container */}
      <main className="relative z-10 flex-1 max-w-2xl mx-auto w-full px-4 py-8 sm:py-12 flex flex-col justify-center">
        {registrationComplete ? (
          /* SUCCESS SCREEN AFTER REGISTRATION */
          <Card className="border-slate-800 bg-slate-900/90 text-white shadow-2xl backdrop-blur-xl">
            <CardContent className="p-8 text-center space-y-6">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-inner">
                <CheckCircle2 className="h-10 w-10" />
              </div>

              <div className="space-y-2">
                <h2 className="text-2xl sm:text-3xl font-black text-white">
                  {profileType === 'courier'
                    ? 'Cadastro Enviado para Aprovação!'
                    : 'Cadastro Concluído com Sucesso!'}
                </h2>
                <p className="text-slate-300 text-sm max-w-md mx-auto leading-relaxed">
                  {profileType === 'courier'
                    ? 'Seus dados e documentos foram enviados com sucesso para a equipe administrativa. Assim que seu cadastro for aprovado, você receberá acesso total ao aplicativo do entregador.'
                    : 'Sua conta de Lojista está pronta para uso. Acesse agora mesmo com seu e-mail e senha cadastrados.'}
                </p>
              </div>

              {profileType === 'courier' && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-300 text-left space-y-1 max-w-md mx-auto">
                  <p className="font-bold flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4" />
                    Status Inicial: Pendente de Validação
                  </p>
                  <p className="text-slate-300 text-[11px] leading-relaxed">
                    O administrador analisará sua CNH e selfie. Você pode verificar seu status
                    tentando fazer login a qualquer momento.
                  </p>
                </div>
              )}

              <div className="pt-2">
                <Button
                  onClick={() => navigate('/login')}
                  className="h-11 px-8 bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm shadow-lg shadow-blue-500/25"
                >
                  Ir para Tela de Login
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          /* MULTI-STEP REGISTRATION FORM */
          <Card className="border border-[#1E2B58] bg-[#0E1738] text-white shadow-brand-dark rounded-2xl">
            <CardHeader className="space-y-4 pb-4">
              {/* Profile Type Selector (Courier vs Seller) */}
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="font-heading text-2xl font-black text-white">
                    Criar Nova Conta
                  </CardTitle>
                  <CardDescription className="font-sans text-slate-400 text-xs">
                    Cadastre-se na Rotaly para começar a operar entregas.
                  </CardDescription>
                </div>

                <Badge
                  variant="outline"
                  className={`text-xs uppercase tracking-wider font-bold ${
                    profileType === 'courier'
                      ? 'border-[#0052CC]/30 bg-blue-50 text-[#0052CC]'
                      : 'border-[#FF6B35]/30 bg-orange-50 text-[#FF6B35]'
                  }`}
                >
                  {profileType === 'courier' ? '🛵 Entregador' : '🏪 Lojista'}
                </Badge>
              </div>

              {/* Profile Switcher Tabs */}
              {currentStep === 1 && (
                <div className="grid grid-cols-2 gap-2 p-1 rounded-card bg-[#F5F5F5] border border-slate-200">
                  <button
                    type="button"
                    onClick={() => setProfileType('courier')}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-input text-xs font-bold transition duration-200 ${
                      profileType === 'courier'
                        ? 'bg-[#0052CC] text-white shadow-brand'
                        : 'text-slate-600 hover:text-[#0052CC]'
                    }`}
                  >
                    <Truck className="h-4 w-4" />
                    Quero ser Entregador
                  </button>
                  <button
                    type="button"
                    onClick={() => setProfileType('seller')}
                    className={`flex items-center justify-center gap-2 py-2.5 rounded-input text-xs font-bold transition duration-200 ${
                      profileType === 'seller'
                        ? 'bg-[#FF6B35] text-white shadow-brand'
                        : 'text-slate-600 hover:text-[#FF6B35]'
                    }`}
                  >
                    <Store className="h-4 w-4" />
                    Quero ser Lojista
                  </button>
                </div>
              )}

              {/* STEPPER BAR (Only 3 steps for Courier, 1 step for Seller) */}
              {profileType === 'courier' ? (
                <div className="pt-2">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                          currentStep >= 1
                            ? 'bg-purple-600 text-white'
                            : 'bg-slate-800 text-slate-500'
                        }`}
                      >
                        1
                      </span>
                      <span
                        className={`text-xs font-semibold ${
                          currentStep === 1 ? 'text-white' : 'text-slate-400'
                        }`}
                      >
                        Dados Pessoais
                      </span>
                    </div>

                    <div className="h-[2px] flex-1 mx-3 bg-slate-800">
                      <div
                        className={`h-full transition-all ${
                          currentStep >= 2 ? 'bg-purple-600' : 'bg-transparent'
                        }`}
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                          currentStep >= 2
                            ? 'bg-purple-600 text-white'
                            : 'bg-slate-800 text-slate-500'
                        }`}
                      >
                        2
                      </span>
                      <span
                        className={`text-xs font-semibold ${
                          currentStep === 2 ? 'text-white' : 'text-slate-400'
                        }`}
                      >
                        Veículo
                      </span>
                    </div>

                    <div className="h-[2px] flex-1 mx-3 bg-slate-800">
                      <div
                        className={`h-full transition-all ${
                          currentStep >= 3 ? 'bg-purple-600' : 'bg-transparent'
                        }`}
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                          currentStep === 3
                            ? 'bg-purple-600 text-white'
                            : 'bg-slate-800 text-slate-500'
                        }`}
                      >
                        3
                      </span>
                      <span
                        className={`text-xs font-semibold ${
                          currentStep === 3 ? 'text-white' : 'text-slate-400'
                        }`}
                      >
                        Documentos
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-400 flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <span>Cadastro simplificado de Lojista (Etapa única)</span>
                </div>
              )}
            </CardHeader>

            <CardContent className="space-y-5 pt-2">
              {/* STEP 1: PERSONAL DATA */}
              {currentStep === 1 && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-300">Nome Completo</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                      <Input
                        type="text"
                        placeholder="Ex: João Carlos da Silva"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="bg-slate-950 border-slate-700 pl-9 text-xs text-white placeholder:text-slate-500"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-300">E-mail</Label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                        <Input
                          type="email"
                          placeholder="joao@exemplo.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="bg-slate-950 border-slate-700 pl-9 text-xs text-white placeholder:text-slate-500"
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-300">
                        Telefone / WhatsApp
                      </Label>
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                        <Input
                          type="tel"
                          placeholder="(11) 99999-9999"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          className="bg-slate-950 border-slate-700 pl-9 text-xs text-white placeholder:text-slate-500"
                          required
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-semibold text-slate-300">Senha</Label>
                        <span className="text-[10px] text-slate-500">Mín. 8 caracteres</span>
                      </div>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                        <Input
                          type={showPassword ? 'text' : 'password'}
                          placeholder="••••••••"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="bg-slate-950 border-slate-700 pl-9 pr-9 text-xs text-white placeholder:text-slate-500"
                          minLength={8}
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-300">
                        Confirmar Senha
                      </Label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                        <Input
                          type={showConfirmPassword ? 'text' : 'password'}
                          placeholder="••••••••"
                          value={passwordConfirm}
                          onChange={(e) => setPasswordConfirm(e.target.value)}
                          className="bg-slate-950 border-slate-700 pl-9 pr-9 text-xs text-white placeholder:text-slate-500"
                          minLength={8}
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                        >
                          {showConfirmPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 2: VEHICLE (COURIER ONLY) */}
              {currentStep === 2 && profileType === 'courier' && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-300">
                      Tipo de Veículo *{' '}
                      <span className="text-purple-400 font-normal">
                        (usado no cálculo de combustível)
                      </span>
                    </Label>
                    <Select
                      value={vehicleType}
                      onValueChange={(v) => setVehicleType(v as 'moto' | 'carro' | 'caminhao')}
                      required
                    >
                      <SelectTrigger className="bg-slate-950 border-slate-700 text-xs text-white">
                        <SelectValue placeholder="Selecione o tipo de veículo" />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-900 border-slate-800 text-white">
                        <SelectItem value="moto">🏍️ Moto (Média 35 km/L)</SelectItem>
                        <SelectItem value="carro">🚗 Carro (Média 12 km/L)</SelectItem>
                        <SelectItem value="caminhao">🚚 Caminhão (Média 7 km/L)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-300">
                        Modelo do Veículo
                      </Label>
                      <div className="relative">
                        <Car className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                        <Input
                          type="text"
                          placeholder="Ex: Honda CG 160 Fan"
                          value={vehicleModel}
                          onChange={(e) => setVehicleModel(e.target.value)}
                          className="bg-slate-950 border-slate-700 pl-9 text-xs text-white placeholder:text-slate-500"
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-300">
                        Ano de Fabricação
                      </Label>
                      <Input
                        type="number"
                        placeholder="2022"
                        value={vehicleYear}
                        onChange={(e) => setVehicleYear(e.target.value)}
                        className="bg-slate-950 border-slate-700 text-xs text-white placeholder:text-slate-500"
                        min={1980}
                        max={new Date().getFullYear() + 1}
                        required
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 3: PLATE & DOCUMENTS UPLOAD (COURIER ONLY) */}
              {currentStep === 3 && profileType === 'courier' && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-300">
                      Placa do Veículo (Mercosul ou Padrão)
                    </Label>
                    <Input
                      type="text"
                      placeholder="Ex: ABC1D23"
                      value={vehiclePlate}
                      onChange={(e) => setVehiclePlate(e.target.value)}
                      className="bg-slate-950 border-slate-700 text-xs text-white placeholder:text-slate-500 uppercase tracking-widest font-mono"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                    {/* Document Upload (RG / CNH) */}
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                        <FileText className="h-4 w-4 text-purple-400" />
                        Documento (RG ou CNH) *
                      </Label>

                      <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-700 hover:border-purple-500/80 rounded-xl p-4 bg-slate-950/60 cursor-pointer transition group">
                        {cnhPreview ? (
                          <div className="relative w-full h-24 flex items-center justify-center overflow-hidden rounded-lg">
                            <img
                              src={cnhPreview}
                              alt="Pré-visualização CNH"
                              className="w-full h-full object-cover rounded-lg"
                            />
                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                              <span className="text-[11px] font-bold text-white">
                                Alterar arquivo
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="text-center py-2 space-y-1">
                            <Upload className="h-6 w-6 text-slate-400 mx-auto group-hover:text-purple-400 transition" />
                            <p className="text-xs font-medium text-slate-300">
                              Clique para enviar RG/CNH
                            </p>
                            <p className="text-[10px] text-slate-500">
                              JPG, PNG ou PDF (Máx. 10MB)
                            </p>
                          </div>
                        )}
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          onChange={handleCnhChange}
                          className="hidden"
                          required
                        />
                      </label>
                      {cnhFile && (
                        <p className="text-[10px] text-emerald-400 truncate">
                          ✓ {cnhFile.name} ({(cnhFile.size / 1024).toFixed(0)} KB)
                        </p>
                      )}
                    </div>

                    {/* Selfie Upload */}
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                        <Camera className="h-4 w-4 text-purple-400" />
                        Selfie com Rosto Nítido *
                      </Label>

                      <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-700 hover:border-purple-500/80 rounded-xl p-4 bg-slate-950/60 cursor-pointer transition group">
                        {selfiePreview ? (
                          <div className="relative w-full h-24 flex items-center justify-center overflow-hidden rounded-lg">
                            <img
                              src={selfiePreview}
                              alt="Pré-visualização Selfie"
                              className="w-full h-full object-cover rounded-lg"
                            />
                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                              <span className="text-[11px] font-bold text-white">Alterar foto</span>
                            </div>
                          </div>
                        ) : (
                          <div className="text-center py-2 space-y-1">
                            <Camera className="h-6 w-6 text-slate-400 mx-auto group-hover:text-purple-400 transition" />
                            <p className="text-xs font-medium text-slate-300">
                              Clique para enviar Selfie
                            </p>
                            <p className="text-[10px] text-slate-500">
                              Foto nítida de rosto (Máx. 5MB)
                            </p>
                          </div>
                        )}
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleSelfieChange}
                          className="hidden"
                          required
                        />
                      </label>
                      {selfieFile && (
                        <p className="text-[10px] text-emerald-400 truncate">
                          ✓ {selfieFile.name} ({(selfieFile.size / 1024).toFixed(0)} KB)
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* STEP NAVIGATION BUTTONS */}
              <div className="flex items-center justify-between pt-4 border-t border-slate-800">
                {currentStep > 1 ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCurrentStep((prev) => (prev - 1) as 1 | 2)}
                    disabled={isSubmitting}
                    className="h-10 border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800 text-xs gap-1.5"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Voltar
                  </Button>
                ) : (
                  <div />
                )}

                {profileType === 'seller' || currentStep === 3 ? (
                  <Button
                    type="button"
                    onClick={handleSubmitRegistration}
                    disabled={isSubmitting}
                    className="h-10 px-6 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-purple-600/30 gap-2"
                  >
                    {isSubmitting ? 'Cadastrando...' : 'Finalizar Cadastro'}
                    <CheckCircle2 className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={handleNext}
                    className="h-10 px-6 bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-md shadow-purple-600/30 gap-2"
                  >
                    Continuar
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
      {/* Footer */}
      <footer className="border-t border-[#1E2B58] bg-[#0A1128] py-4 px-6 text-center text-xs text-slate-400 font-sans">
        <p>Rotaly — Entrega rápida, confiança garantida • Plataforma Segura</p>
      </footer>{' '}
    </div>
  )
}

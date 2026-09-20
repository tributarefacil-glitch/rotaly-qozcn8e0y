import React, { useState, useEffect } from 'react'
import {
  Building2,
  Plus,
  Users,
  Search,
  CheckCircle2,
  AlertCircle,
  Building,
  Phone,
  Mail,
  MapPin,
  FileText,
  Shield,
  UserPlus,
  Trash2,
  ArrowRight,
  Sparkles,
  Zap,
  Edit2,
  Lock,
  Layers,
  Bike,
  Package,
} from 'lucide-react'
import { Header } from '@/components/Header'
import { Sidebar } from '@/components/Sidebar'
import { useAuth } from '@/contexts/AuthContext'
import { useCompany } from '@/contexts/CompanyContext'
import { deliveryService } from '@/services/deliveryService'
import type { EmpresaRecord, MembroRecord, UserRecord, PlanoEmpresa } from '@/types/delivery'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import pb from '@/lib/pocketbase/client'

// Validação de CNPJ
export function validateCNPJ(cnpjRaw: string): boolean {
  const cnpj = cnpjRaw.replace(/\D/g, '')
  if (cnpj.length !== 14) return false
  if (/^(\d)\1+$/.test(cnpj)) return false

  let tamanho = cnpj.length - 2
  let numeros = cnpj.substring(0, tamanho)
  const digitos = cnpj.substring(tamanho)
  let soma = 0
  let pos = tamanho - 7

  for (let i = tamanho; i >= 1; i--) {
    soma += parseInt(numeros.charAt(tamanho - i), 10) * pos--
    if (pos < 2) pos = 9
  }

  let resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11)
  if (resultado !== parseInt(digitos.charAt(0), 10)) return false

  tamanho = tamanho + 1
  numeros = cnpj.substring(0, tamanho)
  soma = 0
  pos = tamanho - 7

  for (let i = tamanho; i >= 1; i--) {
    soma += parseInt(numeros.charAt(tamanho - i), 10) * pos--
    if (pos < 2) pos = 9
  }

  resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11)
  return resultado === parseInt(digitos.charAt(1), 10)
}

export function formatCNPJ(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 14)
  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 10) {
    return digits.replace(/^(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3')
  }
  return digits.replace(/^(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3')
}

export function formatCEP(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8)
  return digits.replace(/^(\d{5})(\d{0,3})/, '$1-$2')
}

// Limites padrão por plano
const PLANO_DEFAULTS: Record<
  PlanoEmpresa,
  { max_users: number; max_couriers: number; max_orders_month: number }
> = {
  basico: { max_users: 5, max_couriers: 3, max_orders_month: 300 },
  profissional: { max_users: 15, max_couriers: 10, max_orders_month: 2000 },
  enterprise: { max_users: 9999, max_couriers: 9999, max_orders_month: 999999 },
}

export const CompaniesPage: React.FC = () => {
  const { user } = useAuth()
  const { currentCompany, setCurrentCompany, refreshCompanyData } = useCompany()

  const isMaster = user?.role === 'master'

  const [empresas, setEmpresas] = useState<EmpresaRecord[]>([])
  const [membros, setMembros] = useState<MembroRecord[]>([])
  const [allUsers, setAllUsers] = useState<UserRecord[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  // Modal de Criação de Empresa
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [cnpjError, setCnpjError] = useState<string | null>(null)

  // Formulário de Nova Empresa + Admin da Empresa
  const [formData, setFormData] = useState({
    nome_razao_social: '',
    nome_fantasia: '',
    cnpj: '',
    logradouro: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: '',
    uf: 'RJ',
    cep: '',
    telefone: '',
    email: '',
    plano: 'profissional' as PlanoEmpresa,
    max_users: 15,
    max_couriers: 10,
    max_orders_month: 2000,
    // Dados do Primeiro Administrador da Loja
    admin_name: '',
    admin_email: '',
    admin_password: '',
    admin_phone: '',
  })

  // Modal de Edição de Empresa / Limites
  const [editingEmpresa, setEditingEmpresa] = useState<EmpresaRecord | null>(null)
  const [editFormData, setEditFormData] = useState({
    nome_razao_social: '',
    nome_fantasia: '',
    plano: 'profissional' as PlanoEmpresa,
    max_users: 15,
    max_couriers: 10,
    max_orders_month: 2000,
    ativa: true,
  })

  // Modal de Membros de uma Empresa
  const [selectedEmpresaForMembers, setSelectedEmpresaForMembers] = useState<EmpresaRecord | null>(
    null,
  )
  const [isCreateMemberOpen, setIsCreateMemberOpen] = useState(false)
  const [newMemberForm, setNewMemberForm] = useState({
    name: '',
    email: '',
    password: '',
    phone: '',
    role: 'seller' as 'admin' | 'seller' | 'courier',
    vehicle_type: 'moto',
    vehicle_plate: '',
  })
  const [isSavingMember, setIsSavingMember] = useState(false)

  const loadData = async () => {
    setIsLoading(true)
    try {
      const [empList, membList, usrList] = await Promise.all([
        deliveryService.getEmpresas('', 'nome_razao_social'),
        deliveryService.getMembros('', '-created', 'empresa_id,user_id'),
        deliveryService.getAllUsers('ALL'),
      ])
      setEmpresas(empList)
      setMembros(membList)
      setAllUsers(usrList)
    } catch (err) {
      console.error('Erro ao carregar dados multi-tenant:', err)
      toast.error('Erro ao carregar lista de empresas.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleCnpjChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCNPJ(e.target.value)
    setFormData((prev) => ({ ...prev, cnpj: formatted }))

    const raw = formatted.replace(/\D/g, '')
    if (raw.length === 14) {
      if (!validateCNPJ(raw)) {
        setCnpjError('CNPJ inválido (dígitos verificadores incorretos).')
      } else {
        setCnpjError(null)
      }
    } else if (raw.length > 0) {
      setCnpjError('O CNPJ deve ter 14 dígitos.')
    } else {
      setCnpjError(null)
    }
  }

  const handlePlanChange = (plano: PlanoEmpresa) => {
    const def = PLANO_DEFAULTS[plano]
    setFormData((prev) => ({
      ...prev,
      plano,
      max_users: def.max_users,
      max_couriers: def.max_couriers,
      max_orders_month: def.max_orders_month,
    }))
  }

  const handleCreateEmpresa = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.nome_razao_social.trim()) {
      toast.error('A Razão Social é obrigatória.')
      return
    }

    const cleanCnpj = formData.cnpj.replace(/\D/g, '')
    if (cleanCnpj) {
      if (!validateCNPJ(cleanCnpj)) {
        toast.error('CNPJ informado é inválido.')
        return
      }

      const exists = empresas.some((emp) => (emp.cnpj || '').replace(/\D/g, '') === cleanCnpj)
      if (exists) {
        toast.error('Já existe uma empresa cadastrada com este CNPJ.')
        return
      }
    }

    if (formData.admin_email && (!formData.admin_password || formData.admin_password.length < 8)) {
      toast.error('A senha do administrador da nova empresa deve ter no mínimo 8 caracteres.')
      return
    }

    setIsSubmitting(true)
    try {
      const enderecoCompleto = [
        formData.logradouro,
        formData.numero ? `nº ${formData.numero}` : '',
        formData.complemento,
        formData.bairro,
        formData.cidade,
        formData.uf,
        formData.cep ? `CEP: ${formData.cep}` : '',
      ]
        .filter(Boolean)
        .join(', ')

      // 1. Criar a Empresa
      const created = await deliveryService.createEmpresa({
        nome_razao_social: formData.nome_razao_social.trim(),
        nome_fantasia: formData.nome_fantasia.trim() || formData.nome_razao_social.trim(),
        cnpj: formData.cnpj,
        logradouro: formData.logradouro,
        numero: formData.numero,
        complemento: formData.complemento,
        bairro: formData.bairro,
        cidade: formData.cidade,
        uf: formData.uf,
        cep: formData.cep,
        endereco_completo: enderecoCompleto,
        telefone: formData.telefone,
        email: formData.email,
        plano: formData.plano,
        max_users: Number(formData.max_users) || 10,
        max_couriers: Number(formData.max_couriers) || 5,
        max_orders_month: Number(formData.max_orders_month) || 1000,
        ativa: true,
      })

      // 2. Se fornecido administrador da loja, criar a conta e vinculá-lo como admin
      if (formData.admin_email && formData.admin_password) {
        try {
          const createdUser = await deliveryService.createUser(
            {
              email: formData.admin_email.trim().toLowerCase(),
              password: formData.admin_password,
              passwordConfirm: formData.admin_password,
              name:
                formData.admin_name ||
                `Admin ${formData.nome_fantasia || formData.nome_razao_social}`,
              role: 'admin',
              status: 'active',
              phone: formData.admin_phone,
            },
            created.id,
          )

          // Garantir vínculo do admin
          await pb.collection('membros').create({
            user_id: createdUser.id,
            empresa_id: created.id,
            papel: 'admin',
            ativo: true,
          })
        } catch (admErr: any) {
          console.warn('Aviso na criação do admin da empresa:', admErr)
          toast.warning(
            `Empresa criada, mas verifique o admin: ${admErr?.message || 'Erro no usuário'}`,
          )
        }
      }

      toast.success('Nova empresa parceira cadastrada com sucesso!')
      setIsCreateOpen(false)
      setFormData({
        nome_razao_social: '',
        nome_fantasia: '',
        cnpj: '',
        logradouro: '',
        numero: '',
        complemento: '',
        bairro: '',
        cidade: '',
        uf: 'RJ',
        cep: '',
        telefone: '',
        email: '',
        plano: 'profissional',
        max_users: 15,
        max_couriers: 10,
        max_orders_month: 2000,
        admin_name: '',
        admin_email: '',
        admin_password: '',
        admin_phone: '',
      })
      await loadData()
      await refreshCompanyData()
    } catch (err: any) {
      console.error('Erro ao cadastrar empresa:', err)
      toast.error(err?.message || 'Não foi possível cadastrar a empresa.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleOpenEdit = (emp: EmpresaRecord) => {
    setEditingEmpresa(emp)
    setEditFormData({
      nome_razao_social: emp.nome_razao_social || '',
      nome_fantasia: emp.nome_fantasia || '',
      plano: (emp.plano as PlanoEmpresa) || 'profissional',
      max_users: emp.max_users || 15,
      max_couriers: emp.max_couriers || 10,
      max_orders_month: emp.max_orders_month || 2000,
      ativa: emp.ativa ?? true,
    })
  }

  const handleSaveEdit = async () => {
    if (!editingEmpresa) return
    setIsSubmitting(true)
    try {
      await pb.collection<EmpresaRecord>('empresas').update(editingEmpresa.id, {
        nome_razao_social: editFormData.nome_razao_social,
        nome_fantasia: editFormData.nome_fantasia,
        plano: editFormData.plano,
        max_users: Number(editFormData.max_users),
        max_couriers: Number(editFormData.max_couriers),
        max_orders_month: Number(editFormData.max_orders_month),
        ativa: editFormData.ativa,
      })
      toast.success('Empresa e limites atualizados!')
      setEditingEmpresa(null)
      await loadData()
      await refreshCompanyData()
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao atualizar dados da empresa.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCreateNewMember = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedEmpresaForMembers) return

    if (!newMemberForm.email || !newMemberForm.password) {
      toast.error('E-mail e senha são obrigatórios.')
      return
    }

    setIsSavingMember(true)
    try {
      const createdUser = await deliveryService.createUser(
        {
          name: newMemberForm.name,
          email: newMemberForm.email.trim().toLowerCase(),
          password: newMemberForm.password,
          passwordConfirm: newMemberForm.password,
          role: newMemberForm.role,
          phone: newMemberForm.phone,
          status: 'active',
          vehicle_type: newMemberForm.vehicle_type,
          vehicle_plate: newMemberForm.vehicle_plate,
        },
        selectedEmpresaForMembers.id,
      )

      toast.success(`Usuário ${createdUser.name || createdUser.email} criado e amarrado à empresa!`)
      setIsCreateMemberOpen(false)
      setNewMemberForm({
        name: '',
        email: '',
        password: '',
        phone: '',
        role: 'seller',
        vehicle_type: 'moto',
        vehicle_plate: '',
      })
      await loadData()
    } catch (err: any) {
      console.error('Erro ao criar membro:', err)
      toast.error(err?.message || 'Falha ao criar usuário na empresa.')
    } finally {
      setIsSavingMember(false)
    }
  }

  const handleRemoveMember = async (membroId: string) => {
    if (!confirm('Deseja realmente desvincular este usuário da empresa?')) return
    try {
      await deliveryService.deleteMembro(membroId)
      toast.success('Membro desvinculado com sucesso.')
      await loadData()
    } catch (err) {
      console.error('Erro ao remover membro:', err)
      toast.error('Não foi possível remover o membro.')
    }
  }

  const filteredEmpresas = empresas.filter((emp) => {
    const q = searchTerm.toLowerCase()
    return (
      emp.nome_razao_social.toLowerCase().includes(q) ||
      (emp.nome_fantasia && emp.nome_fantasia.toLowerCase().includes(q)) ||
      (emp.cnpj && emp.cnpj.includes(q)) ||
      (emp.cidade && emp.cidade.toLowerCase().includes(q)) ||
      (emp.plano && emp.plano.toLowerCase().includes(q))
    )
  })

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-50 text-[#002855] font-sans">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-y-auto">
        <Header />

        <main className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto w-full">
          {/* Top banner / Title */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-200 pb-6">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <div className="h-10 w-10 rounded-xl bg-[#002855] flex items-center justify-center text-white shadow-sm">
                  <Building2 className="h-5 w-5 text-[#00A3FF]" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="font-heading text-xl sm:text-2xl font-black tracking-tight text-[#002855]">
                      Gestão Master Multi-Tenant
                    </h1>
                    <Badge className="bg-amber-500 text-white text-[10px] uppercase font-bold tracking-wider">
                      SaaS Multilojas
                    </Badge>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-500">
                    Cadastre novas empresas, gerencie planos, limites operacionais e membros com
                    isolamento total de dados.
                  </p>
                </div>
              </div>
            </div>

            {isMaster && (
              <div className="flex items-center gap-3">
                <Button
                  onClick={() => setIsCreateOpen(true)}
                  className="h-10 px-4 bg-[#00A3FF] hover:bg-[#008CE0] text-white font-bold text-xs rounded-xl shadow-sm gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Nova Empresa Parceira
                </Button>
              </div>
            )}
          </div>

          {/* Active Company Banner */}
          {currentCompany && (
            <Card className="border border-slate-200 bg-white shadow-sm rounded-2xl overflow-hidden">
              <div className="h-1.5 w-full bg-gradient-to-r from-[#002855] via-[#00A3FF] to-[#002855]" />
              <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-[#002855]">
                    <Building className="h-6 w-6 text-[#00A3FF]" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#002855] bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
                        Contexto Atual Selecionado
                      </span>
                      <Badge
                        variant="outline"
                        className="text-[10px] font-bold border-blue-300 text-blue-700 uppercase"
                      >
                        Plano: {currentCompany.plano || 'enterprise'}
                      </Badge>
                      {currentCompany.ativa !== false ? (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Ativa
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200 flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" /> Desativada
                        </span>
                      )}
                    </div>
                    <h2 className="font-heading text-lg font-bold text-[#002855] mt-1">
                      {currentCompany.nome_fantasia || currentCompany.nome_razao_social}
                    </h2>
                    <p className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                      <span>{currentCompany.nome_razao_social}</span>
                      {currentCompany.cnpj && <span>• CNPJ: {currentCompany.cnpj}</span>}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="text-right mr-3 hidden sm:block">
                    <p className="text-[11px] font-medium text-slate-500">Limites do Plano</p>
                    <p className="text-xs font-bold text-[#002855]">
                      {currentCompany.max_users || 9999} usuários •{' '}
                      {currentCompany.max_couriers || 9999} entregadores
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSelectedEmpresaForMembers(currentCompany)}
                    className="border-slate-200 bg-slate-50 hover:bg-slate-100 text-[#002855] text-xs gap-1.5"
                  >
                    <Users className="h-3.5 w-3.5 text-[#00A3FF]" />
                    Gerenciar Membros
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Search bar */}
          <div className="flex items-center justify-between gap-4">
            <div className="relative max-w-md w-full">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                type="text"
                placeholder="Buscar por razão social, nome, CNPJ, plano ou cidade..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-10 pl-9 border-slate-200 bg-white text-xs text-[#002855] placeholder:text-slate-400 rounded-xl focus:border-[#00A3FF]"
              />
            </div>
            <div className="text-xs text-slate-500 font-medium">
              Total: <strong className="text-[#002855]">{filteredEmpresas.length}</strong>{' '}
              empresa(s)
            </div>
          </div>

          {/* Companies Grid */}
          {isLoading ? (
            <div className="py-20 text-center space-y-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#00A3FF] border-t-transparent mx-auto" />
              <p className="text-xs text-slate-400">Carregando empresas cadastradas...</p>
            </div>
          ) : filteredEmpresas.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center space-y-3">
              <Building2 className="h-10 w-10 text-slate-400 mx-auto" />
              <h3 className="font-heading text-sm font-bold text-[#002855]">
                Nenhuma empresa encontrada
              </h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Não localizamos nenhuma empresa com os critérios informados. Clique em "Nova Empresa
                Parceira" para cadastrar.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredEmpresas.map((emp) => {
                const isSelected = currentCompany?.id === emp.id
                const companyMembers = membros.filter((m) => m.empresa_id === emp.id)
                const isMatriz = emp.id === deliveryService.MATRIZ_EMPRESA_ID

                return (
                  <Card
                    key={emp.id}
                    className={`border transition-all rounded-2xl overflow-hidden flex flex-col justify-between ${
                      isSelected
                        ? 'border-[#00A3FF] bg-blue-50/20 shadow-md ring-1 ring-[#00A3FF]'
                        : 'border-slate-200 bg-white hover:border-slate-300 shadow-xs'
                    }`}
                  >
                    <div>
                      <div className="p-5 pb-3">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2">
                            <div className="h-9 w-9 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-[#002855]">
                              <Building2 className="h-4 w-4 text-[#00A3FF]" />
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <h3 className="font-heading text-sm font-bold text-[#002855] line-clamp-1">
                                  {emp.nome_fantasia || emp.nome_razao_social}
                                </h3>
                                {isMatriz && (
                                  <Badge className="bg-[#002855] text-white text-[9px] px-1.5 py-0 h-4">
                                    Matriz
                                  </Badge>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-500 line-clamp-1">
                                {emp.nome_razao_social}
                              </p>
                            </div>
                          </div>

                          <div className="flex flex-col items-end gap-1">
                            {isSelected && (
                              <Badge className="bg-[#00A3FF] text-white text-[10px] font-bold">
                                Ativa
                              </Badge>
                            )}
                            <Badge
                              variant="outline"
                              className="text-[10px] capitalize border-blue-200 bg-blue-50/50 text-[#002855]"
                            >
                              {emp.plano || 'profissional'}
                            </Badge>
                          </div>
                        </div>

                        {/* Limites do Plano */}
                        <div className="mt-3 p-2.5 rounded-xl bg-slate-50 border border-slate-100 grid grid-cols-3 gap-2 text-center text-xs">
                          <div>
                            <span className="text-[10px] text-slate-400 block">Usuários</span>
                            <span className="font-bold text-[#002855]">{emp.max_users || 10}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 block">Entregadores</span>
                            <span className="font-bold text-[#002855]">
                              {emp.max_couriers || 5}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 block">Ped./Mês</span>
                            <span className="font-bold text-[#002855]">
                              {emp.max_orders_month || 1000}
                            </span>
                          </div>
                        </div>

                        <div className="space-y-1.5 mt-3 text-xs text-slate-600">
                          {emp.cnpj && (
                            <div className="flex items-center gap-2">
                              <FileText className="h-3.5 w-3.5 text-slate-400" />
                              <span className="text-[11px] font-mono">{emp.cnpj}</span>
                            </div>
                          )}
                          {emp.telefone && (
                            <div className="flex items-center gap-2">
                              <Phone className="h-3.5 w-3.5 text-slate-400" />
                              <span className="text-[11px]">{emp.telefone}</span>
                            </div>
                          )}
                          {emp.email && (
                            <div className="flex items-center gap-2">
                              <Mail className="h-3.5 w-3.5 text-slate-400" />
                              <span className="text-[11px] truncate">{emp.email}</span>
                            </div>
                          )}
                          {emp.cidade && (
                            <div className="flex items-center gap-2">
                              <MapPin className="h-3.5 w-3.5 text-slate-400" />
                              <span className="text-[11px]">
                                {emp.cidade}
                                {emp.uf ? ` - ${emp.uf}` : ''}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="p-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedEmpresaForMembers(emp)}
                          className="text-xs text-[#002855] hover:bg-slate-200 gap-1.5 h-8 px-2.5"
                        >
                          <Users className="h-3.5 w-3.5 text-[#00A3FF]" />
                          Membros ({companyMembers.length})
                        </Button>

                        {isMaster && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleOpenEdit(emp)}
                            className="text-xs text-slate-500 hover:text-[#002855] hover:bg-slate-200 h-8 px-2"
                            title="Editar limites e plano"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>

                      {isMaster && !isSelected && (
                        <Button
                          size="sm"
                          onClick={() => {
                            setCurrentCompany(emp)
                            toast.success(
                              `Contexto alterado para ${emp.nome_fantasia || emp.nome_razao_social}`,
                            )
                          }}
                          className="h-8 text-xs bg-[#002855] hover:bg-[#001D3D] text-white gap-1 rounded-lg"
                        >
                          <span>Alternar Contexto</span>
                          <ArrowRight className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </main>
      </div>

      {/* Modal: Cadastro de Empresa + Limites + Admin Inicial */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-2xl bg-white border-slate-200 text-[#002855] p-6 max-h-[90vh] overflow-y-auto shadow-xl">
          <DialogHeader>
            <div className="flex items-center gap-2.5 mb-1">
              <div className="h-9 w-9 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-[#00A3FF]">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="font-heading text-lg font-bold text-[#002855]">
                  Cadastrar Nova Empresa Parceira (SaaS)
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500">
                  Cadastre uma loja cliente, defina o plano comercial e crie o usuário administrador
                  da empresa.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleCreateEmpresa} className="space-y-4 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs font-semibold text-slate-700">Razão Social *</Label>
                <Input
                  required
                  placeholder="Ex: Drogaria Santa Fé Ltda"
                  value={formData.nome_razao_social}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, nome_razao_social: e.target.value }))
                  }
                  className="h-9 border-slate-200 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Nome Fantasia</Label>
                <Input
                  placeholder="Ex: Farmácia Santa Fé"
                  value={formData.nome_fantasia}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, nome_fantasia: e.target.value }))
                  }
                  className="h-9 border-slate-200 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">CNPJ (com validação)</Label>
                <Input
                  placeholder="00.000.000/0000-00"
                  value={formData.cnpj}
                  onChange={handleCnpjChange}
                  maxLength={18}
                  className={`h-9 border-slate-200 text-xs font-mono ${
                    cnpjError ? 'border-rose-500' : ''
                  }`}
                />
                {cnpjError && (
                  <p className="text-[11px] text-rose-500 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> {cnpjError}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Telefone / WhatsApp</Label>
                <Input
                  placeholder="(21) 90000-0000"
                  value={formData.telefone}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, telefone: formatPhone(e.target.value) }))
                  }
                  maxLength={15}
                  className="h-9 border-slate-200 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">E-mail Comercial</Label>
                <Input
                  type="email"
                  placeholder="contato@empresa.com.br"
                  value={formData.email}
                  onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
                  className="h-9 border-slate-200 text-xs"
                />
              </div>
            </div>

            {/* SELEÇÃO DO PLANO E LIMITES */}
            <div className="border-t border-slate-200 pt-3">
              <span className="text-xs font-bold uppercase tracking-wider text-[#002855] flex items-center gap-1.5 mb-2">
                <Zap className="h-4 w-4 text-amber-500" /> Plano Comercial e Limites Operacionais
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Plano</Label>
                  <Select
                    value={formData.plano}
                    onValueChange={(val: PlanoEmpresa) => handlePlanChange(val)}
                  >
                    <SelectTrigger className="h-9 border-slate-200 text-xs">
                      <SelectValue placeholder="Selecione o plano" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="basico">Básico (Até 5 usuários)</SelectItem>
                      <SelectItem value="profissional">Profissional (Até 15 usuários)</SelectItem>
                      <SelectItem value="enterprise">Enterprise (Ilimitado)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Máx. Usuários</Label>
                  <Input
                    type="number"
                    min="1"
                    value={formData.max_users}
                    onChange={(e) =>
                      setFormData((p) => ({ ...p, max_users: Number(e.target.value) }))
                    }
                    className="h-9 border-slate-200 text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Máx. Entregadores</Label>
                  <Input
                    type="number"
                    min="1"
                    value={formData.max_couriers}
                    onChange={(e) =>
                      setFormData((p) => ({ ...p, max_couriers: Number(e.target.value) }))
                    }
                    className="h-9 border-slate-200 text-xs"
                  />
                </div>

                <div className="space-y-1.5 sm:col-span-3">
                  <Label className="text-xs font-semibold text-slate-700">
                    Máx. Pedidos por Mês
                  </Label>
                  <Input
                    type="number"
                    min="1"
                    value={formData.max_orders_month}
                    onChange={(e) =>
                      setFormData((p) => ({ ...p, max_orders_month: Number(e.target.value) }))
                    }
                    className="h-9 border-slate-200 text-xs"
                  />
                </div>
              </div>
            </div>

            {/* CRIAR PRIMEIRO ADMINISTRADOR DA LOJA */}
            <div className="border-t border-slate-200 pt-3">
              <span className="text-xs font-bold uppercase tracking-wider text-[#002855] flex items-center gap-1.5 mb-2">
                <Shield className="h-4 w-4 text-[#00A3FF]" /> Usuário Administrador da Loja
              </span>
              <p className="text-[11px] text-slate-500 mb-3">
                Será criado com perfil Admin amarrado exclusivamente a esta nova empresa.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Nome do Admin</Label>
                  <Input
                    placeholder="Ex: Carlos Oliveira"
                    value={formData.admin_name}
                    onChange={(e) => setFormData((p) => ({ ...p, admin_name: e.target.value }))}
                    className="h-9 border-slate-200 text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">WhatsApp do Admin</Label>
                  <Input
                    placeholder="(21) 98888-7777"
                    value={formData.admin_phone}
                    onChange={(e) =>
                      setFormData((p) => ({ ...p, admin_phone: formatPhone(e.target.value) }))
                    }
                    className="h-9 border-slate-200 text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">
                    E-mail de Login do Admin *
                  </Label>
                  <Input
                    type="email"
                    placeholder="admin@loja.com"
                    value={formData.admin_email}
                    onChange={(e) => setFormData((p) => ({ ...p, admin_email: e.target.value }))}
                    className="h-9 border-slate-200 text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">
                    Senha Provisória (mín. 8 dígitos) *
                  </Label>
                  <Input
                    type="password"
                    placeholder="••••••••"
                    value={formData.admin_password}
                    onChange={(e) => setFormData((p) => ({ ...p, admin_password: e.target.value }))}
                    className="h-9 border-slate-200 text-xs"
                  />
                </div>
              </div>
            </div>

            {/* ENDEREÇO */}
            <div className="border-t border-slate-200 pt-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2 block">
                Endereço Base / Operacional
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs font-semibold text-slate-700">
                    Logradouro (Rua / Av)
                  </Label>
                  <Input
                    placeholder="Rua das Lojas"
                    value={formData.logradouro}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, logradouro: e.target.value }))
                    }
                    className="h-9 border-slate-200 text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Número</Label>
                  <Input
                    placeholder="100"
                    value={formData.numero}
                    onChange={(e) => setFormData((prev) => ({ ...prev, numero: e.target.value }))}
                    className="h-9 border-slate-200 text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Bairro</Label>
                  <Input
                    placeholder="Centro"
                    value={formData.bairro}
                    onChange={(e) => setFormData((prev) => ({ ...prev, bairro: e.target.value }))}
                    className="h-9 border-slate-200 text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Cidade</Label>
                  <Input
                    placeholder="Rio de Janeiro"
                    value={formData.cidade}
                    onChange={(e) => setFormData((prev) => ({ ...prev, cidade: e.target.value }))}
                    className="h-9 border-slate-200 text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">UF</Label>
                  <Input
                    placeholder="RJ"
                    value={formData.uf}
                    maxLength={2}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, uf: e.target.value.toUpperCase() }))
                    }
                    className="h-9 border-slate-200 text-xs"
                  />
                </div>
              </div>
            </div>

            <DialogFooter className="pt-4 border-t border-slate-200">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreateOpen(false)}
                className="border-slate-200 text-slate-600 text-xs"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || !!cnpjError}
                className="bg-[#002855] hover:bg-[#001D3D] text-white text-xs font-bold"
              >
                {isSubmitting ? 'Salvando...' : 'Criar Empresa e Habilitar Acesso'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Editar Empresa / Plano / Limites */}
      <Dialog open={!!editingEmpresa} onOpenChange={(open) => !open && setEditingEmpresa(null)}>
        <DialogContent className="max-w-md bg-white border-slate-200 text-[#002855] p-6 shadow-xl">
          <DialogHeader>
            <DialogTitle className="font-heading text-lg font-bold text-[#002855]">
              Editar Empresa &amp; Limites do Plano
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Atualize o plano e os tetos operacionais desta empresa parceira.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">Nome Fantasia</Label>
              <Input
                value={editFormData.nome_fantasia}
                onChange={(e) => setEditFormData((p) => ({ ...p, nome_fantasia: e.target.value }))}
                className="h-9 border-slate-200 text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-700">Plano</Label>
              <Select
                value={editFormData.plano}
                onValueChange={(val: PlanoEmpresa) => {
                  const def = PLANO_DEFAULTS[val]
                  setEditFormData((p) => ({
                    ...p,
                    plano: val,
                    max_users: def.max_users,
                    max_couriers: def.max_couriers,
                    max_orders_month: def.max_orders_month,
                  }))
                }}
              >
                <SelectTrigger className="h-9 border-slate-200 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="basico">Básico</SelectItem>
                  <SelectItem value="profissional">Profissional</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Máx. Usuários</Label>
                <Input
                  type="number"
                  min="1"
                  value={editFormData.max_users}
                  onChange={(e) =>
                    setEditFormData((p) => ({ ...p, max_users: Number(e.target.value) }))
                  }
                  className="h-9 border-slate-200 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">Máx. Entregadores</Label>
                <Input
                  type="number"
                  min="1"
                  value={editFormData.max_couriers}
                  onChange={(e) =>
                    setEditFormData((p) => ({ ...p, max_couriers: Number(e.target.value) }))
                  }
                  className="h-9 border-slate-200 text-xs"
                />
              </div>

              <div className="space-y-1.5 col-span-2">
                <Label className="text-xs font-semibold text-slate-700">Máx. Pedidos / Mês</Label>
                <Input
                  type="number"
                  min="1"
                  value={editFormData.max_orders_month}
                  onChange={(e) =>
                    setEditFormData((p) => ({ ...p, max_orders_month: Number(e.target.value) }))
                  }
                  className="h-9 border-slate-200 text-xs"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="empresa-ativa"
                checked={editFormData.ativa}
                onChange={(e) => setEditFormData((p) => ({ ...p, ativa: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 text-[#00A3FF]"
              />
              <Label
                htmlFor="empresa-ativa"
                className="text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Empresa Ativa (permite login e operação dos membros)
              </Label>
            </div>
          </div>

          <DialogFooter className="pt-4 border-t border-slate-200">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditingEmpresa(null)}
              className="border-slate-200 text-slate-600 text-xs"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={isSubmitting}
              className="bg-[#002855] hover:bg-[#001D3D] text-white text-xs font-bold"
            >
              {isSubmitting ? 'Salvando...' : 'Salvar Alterações'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Gestão de Membros da Empresa + Cadastro de Novo Membro Direto */}
      <Dialog
        open={!!selectedEmpresaForMembers}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedEmpresaForMembers(null)
            setIsCreateMemberOpen(false)
          }
        }}
      >
        <DialogContent className="max-w-2xl bg-white border-slate-200 text-[#002855] p-6 max-h-[90vh] overflow-y-auto shadow-xl">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-[#00A3FF]">
                  <Users className="h-5 w-5" />
                </div>
                <div>
                  <DialogTitle className="font-heading text-lg font-bold text-[#002855]">
                    Membros da Empresa
                  </DialogTitle>
                  <DialogDescription className="text-xs text-slate-500">
                    {selectedEmpresaForMembers?.nome_fantasia ||
                      selectedEmpresaForMembers?.nome_razao_social}
                  </DialogDescription>
                </div>
              </div>

              <Button
                size="sm"
                onClick={() => setIsCreateMemberOpen(!isCreateMemberOpen)}
                className="bg-[#00A3FF] hover:bg-[#008CE0] text-white text-xs font-bold gap-1.5 h-8"
              >
                <Plus className="h-3.5 w-3.5" />
                {isCreateMemberOpen ? 'Ver Lista' : 'Novo Usuário na Loja'}
              </Button>
            </div>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {/* Formulário para criar novo usuário nesta empresa */}
            {isCreateMemberOpen ? (
              <form
                onSubmit={handleCreateNewMember}
                className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3"
              >
                <span className="text-xs font-bold text-[#002855] flex items-center gap-1.5">
                  <UserPlus className="h-4 w-4 text-[#00A3FF]" /> Cadastrar Usuário para esta Loja
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-slate-700">Nome Completo *</Label>
                    <Input
                      required
                      placeholder="Ex: João Silva"
                      value={newMemberForm.name}
                      onChange={(e) => setNewMemberForm((p) => ({ ...p, name: e.target.value }))}
                      className="h-8 border-slate-200 text-xs bg-white"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-slate-700">Papel / Função *</Label>
                    <Select
                      value={newMemberForm.role}
                      onValueChange={(val: any) => setNewMemberForm((p) => ({ ...p, role: val }))}
                    >
                      <SelectTrigger className="h-8 border-slate-200 text-xs bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="seller">Vendedor</SelectItem>
                        <SelectItem value="courier">Entregador</SelectItem>
                        <SelectItem value="admin">Administrador da Loja</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-slate-700">
                      E-mail de Login *
                    </Label>
                    <Input
                      type="email"
                      required
                      placeholder="joao@loja.com"
                      value={newMemberForm.email}
                      onChange={(e) => setNewMemberForm((p) => ({ ...p, email: e.target.value }))}
                      className="h-8 border-slate-200 text-xs bg-white"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-slate-700">
                      Senha (mín. 8 caracteres) *
                    </Label>
                    <Input
                      type="password"
                      required
                      placeholder="••••••••"
                      value={newMemberForm.password}
                      onChange={(e) =>
                        setNewMemberForm((p) => ({ ...p, password: e.target.value }))
                      }
                      className="h-8 border-slate-200 text-xs bg-white"
                    />
                  </div>

                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-xs font-semibold text-slate-700">
                      WhatsApp / Telefone
                    </Label>
                    <Input
                      placeholder="(21) 98888-8888"
                      value={newMemberForm.phone}
                      onChange={(e) =>
                        setNewMemberForm((p) => ({ ...p, phone: formatPhone(e.target.value) }))
                      }
                      className="h-8 border-slate-200 text-xs bg-white"
                    />
                  </div>

                  {newMemberForm.role === 'courier' && (
                    <>
                      <div className="space-y-1">
                        <Label className="text-xs font-semibold text-slate-700">
                          Tipo de Veículo
                        </Label>
                        <Select
                          value={newMemberForm.vehicle_type}
                          onValueChange={(val) =>
                            setNewMemberForm((p) => ({ ...p, vehicle_type: val }))
                          }
                        >
                          <SelectTrigger className="h-8 border-slate-200 text-xs bg-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="moto">Moto</SelectItem>
                            <SelectItem value="carro">Carro</SelectItem>
                            <SelectItem value="bicicleta">Bicicleta</SelectItem>
                            <SelectItem value="van">Van</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs font-semibold text-slate-700">
                          Placa do Veículo
                        </Label>
                        <Input
                          placeholder="ABC1D23"
                          value={newMemberForm.vehicle_plate}
                          onChange={(e) =>
                            setNewMemberForm((p) => ({
                              ...p,
                              vehicle_plate: e.target.value.toUpperCase(),
                            }))
                          }
                          className="h-8 border-slate-200 text-xs bg-white"
                        />
                      </div>
                    </>
                  )}
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setIsCreateMemberOpen(false)}
                    className="h-8 text-xs text-slate-500"
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    disabled={isSavingMember}
                    className="h-8 text-xs bg-[#002855] hover:bg-[#001D3D] text-white font-bold"
                  >
                    {isSavingMember ? 'Salvando...' : 'Cadastrar e Amarrar à Empresa'}
                  </Button>
                </div>
              </form>
            ) : null}

            {/* Lista de membros */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-700">
                Membros Vinculados (
                {membros.filter((m) => m.empresa_id === selectedEmpresaForMembers?.id).length})
              </span>

              <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl bg-white overflow-hidden max-h-80 overflow-y-auto">
                {membros
                  .filter((m) => m.empresa_id === selectedEmpresaForMembers?.id)
                  .map((m) => {
                    const usr = allUsers.find((u) => u.id === m.user_id)
                    return (
                      <div
                        key={m.id}
                        className="p-3 flex items-center justify-between gap-3 text-xs"
                      >
                        <div>
                          <p className="font-bold text-[#002855]">
                            {usr?.name || 'Usuário Rotaly'}
                          </p>
                          <p className="text-[11px] text-slate-500">{usr?.email}</p>
                          {usr?.phone && <p className="text-[10px] text-slate-400">{usr.phone}</p>}
                        </div>

                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className="text-[10px] border-slate-200 text-slate-700 capitalize bg-slate-50"
                          >
                            {m.papel || usr?.role || 'membro'}
                          </Badge>
                          {isMaster && (
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleRemoveMember(m.id)}
                              className="h-7 w-7 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg"
                              title="Desvincular membro"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })}

                {membros.filter((m) => m.empresa_id === selectedEmpresaForMembers?.id).length ===
                  0 && (
                  <div className="p-6 text-center text-xs text-slate-400">
                    Nenhum membro cadastrado nesta empresa ainda. Clique em "Novo Usuário na Loja"
                    para adicionar.
                  </div>
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="pt-4 border-t border-slate-200">
            <Button
              onClick={() => setSelectedEmpresaForMembers(null)}
              className="border-slate-200 bg-slate-100 hover:bg-slate-200 text-[#002855] text-xs font-semibold"
            >
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default CompaniesPage

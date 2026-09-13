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
} from 'lucide-react'
import { Header } from '@/components/Header'
import { Sidebar } from '@/components/Sidebar'
import { useAuth } from '@/contexts/AuthContext'
import { useCompany } from '@/contexts/CompanyContext'
import { deliveryService } from '@/services/deliveryService'
import type { EmpresaRecord, MembroRecord, UserRecord } from '@/types/delivery'
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

// Validação oficial de CNPJ brasileiro com dígitos verificadores
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

// Máscara de CNPJ
export function formatCNPJ(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 14)
  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

// Máscara de Telefone
export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 10) {
    return digits.replace(/^(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3')
  }
  return digits.replace(/^(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3')
}

// Máscara de CEP
export function formatCEP(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8)
  return digits.replace(/^(\d{5})(\d{0,3})/, '$1-$2')
}

export const CompaniesPage: React.FC = () => {
  const { user } = useAuth()
  const { currentCompany, setCurrentCompany, refreshCompanyData } = useCompany()

  const [empresas, setEmpresas] = useState<EmpresaRecord[]>([])
  const [membros, setMembros] = useState<MembroRecord[]>([])
  const [allUsers, setAllUsers] = useState<UserRecord[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  // Modal de Nova Empresa
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [cnpjError, setCnpjError] = useState<string | null>(null)

  // Formulário de Empresa
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
  })

  // Modal de Membros de uma Empresa
  const [selectedEmpresaForMembers, setSelectedEmpresaForMembers] = useState<EmpresaRecord | null>(
    null,
  )
  const [newMemberUserId, setNewMemberUserId] = useState('')
  const [newMemberPapel, setNewMemberPapel] = useState<
    'admin' | 'vendedor' | 'entregador' | 'gestor'
  >('vendedor')
  const [isAddingMember, setIsAddingMember] = useState(false)

  const loadData = async () => {
    setIsLoading(true)
    try {
      const [empList, membList, usrList] = await Promise.all([
        deliveryService.getEmpresas('', 'nome_razao_social'),
        deliveryService.getMembros('', '-created', 'empresa_id,user_id'),
        deliveryService.getAllUsers(),
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

      // Validar duplicidade de CNPJ
      const exists = empresas.some((emp) => (emp.cnpj || '').replace(/\D/g, '') === cleanCnpj)
      if (exists) {
        toast.error('Já existe uma empresa cadastrada com este CNPJ.')
        return
      }
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
        ativa: true,
      })

      // Vincular automaticamente o usuário criador como membro Admin da nova empresa
      if (user) {
        await deliveryService.createMembro({
          empresa_id: created.id,
          user_id: user.id,
          papel: 'admin',
          ativo: true,
        })
      }

      toast.success('Empresa cadastrada com sucesso!')
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
      })
      await loadData()
      await refreshCompanyData()
    } catch (err) {
      console.error('Erro ao cadastrar empresa:', err)
      toast.error('Não foi possível cadastrar a empresa.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleAddMember = async () => {
    if (!selectedEmpresaForMembers || !newMemberUserId) return
    setIsAddingMember(true)
    try {
      // Verificar se já é membro
      const already = membros.some(
        (m) => m.empresa_id === selectedEmpresaForMembers.id && m.user_id === newMemberUserId,
      )
      if (already) {
        toast.error('Este usuário já é membro desta empresa.')
        return
      }

      await deliveryService.createMembro({
        empresa_id: selectedEmpresaForMembers.id,
        user_id: newMemberUserId,
        papel: newMemberPapel,
        ativo: true,
      })

      // Criar também registro espelho em colaboradores para facilidade de gestão
      const targetUser = allUsers.find((u) => u.id === newMemberUserId)
      if (targetUser) {
        await deliveryService
          .createColaborador({
            empresa_id: selectedEmpresaForMembers.id,
            user_id: targetUser.id,
            nome: targetUser.name || 'Colaborador',
            email: targetUser.email || '',
            telefone: targetUser.phone || '',
            cpf: targetUser.document || '',
            cargo:
              newMemberPapel === 'entregador'
                ? 'entregador'
                : newMemberPapel === 'vendedor'
                  ? 'vendedor'
                  : 'administrativo',
            tipo_veiculo: targetUser.vehicle_type || '',
            placa_veiculo: targetUser.vehicle_plate || '',
            ativo: true,
          })
          .catch(() => {})
      }

      toast.success('Membro vinculado à empresa!')
      setNewMemberUserId('')
      await loadData()
    } catch (err) {
      console.error('Erro ao adicionar membro:', err)
      toast.error('Falha ao vincular membro.')
    } finally {
      setIsAddingMember(false)
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
      (emp.cidade && emp.cidade.toLowerCase().includes(q))
    )
  })

  return (
    <div className="flex h-screen w-full overflow-hidden bg-white text-[#002855] font-sans">
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
                  <h1 className="font-heading text-xl sm:text-2xl font-black tracking-tight text-[#002855]">
                    Gestão Multi-Tenant &amp; Empresas
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-500">
                    Isole e gerencie múltiplas operações com total conformidade e Row Level Security
                    no Rotaly.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={() => setIsCreateOpen(true)}
                className="h-10 px-4 bg-[#00A3FF] hover:bg-[#008CE0] text-white font-bold text-xs rounded-xl shadow-sm gap-2"
              >
                <Plus className="h-4 w-4" />
                Cadastrar Nova Empresa
              </Button>
            </div>
          </div>

          {/* Active Company Highlight Card */}
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
                        Empresa Ativa na Sessão
                      </span>
                      {currentCompany.ativa && (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Ativa
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
                  <Badge
                    variant="outline"
                    className="border-slate-200 text-slate-700 text-xs py-1 px-3"
                  >
                    {membros.filter((m) => m.empresa_id === currentCompany.id).length} membros
                    vinculados
                  </Badge>
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
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              type="text"
              placeholder="Buscar por razão social, nome fantasia, CNPJ ou cidade..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-10 pl-9 border-slate-200 bg-slate-50 text-xs text-[#002855] placeholder:text-slate-400 rounded-xl focus:bg-white focus:border-[#00A3FF]"
            />
          </div>

          {/* Companies Grid */}
          {isLoading ? (
            <div className="py-20 text-center space-y-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent mx-auto" />
              <p className="text-xs text-slate-400">Carregando empresas cadastradas...</p>
            </div>
          ) : filteredEmpresas.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#1E2B58] bg-[#0E1738]/50 p-12 text-center space-y-3">
              <Building2 className="h-10 w-10 text-slate-500 mx-auto" />
              <h3 className="font-heading text-sm font-bold text-white">
                Nenhuma empresa encontrada
              </h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Não localizamos nenhuma empresa com os critérios informados. Clique em "Cadastrar
                Nova Empresa" para criar.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredEmpresas.map((emp) => {
                const isSelected = currentCompany?.id === emp.id
                const companyMembers = membros.filter((m) => m.empresa_id === emp.id)

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
                              <h3 className="font-heading text-sm font-bold text-[#002855] line-clamp-1">
                                {emp.nome_fantasia || emp.nome_razao_social}
                              </h3>
                              <p className="text-[11px] text-slate-500 line-clamp-1">
                                {emp.nome_razao_social}
                              </p>
                            </div>
                          </div>

                          {isSelected ? (
                            <Badge className="bg-blue-600 text-white text-[10px] font-bold">
                              Ativa
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="border-[#1E2B58] text-slate-400 text-[10px]"
                            >
                              {companyMembers.length} membros
                            </Badge>
                          )}
                        </div>

                        <div className="space-y-1.5 mt-4 text-xs text-slate-300">
                          {emp.cnpj && (
                            <div className="flex items-center gap-2">
                              <FileText className="h-3.5 w-3.5 text-slate-500" />
                              <span className="text-[11px] font-mono">{emp.cnpj}</span>
                            </div>
                          )}
                          {emp.telefone && (
                            <div className="flex items-center gap-2">
                              <Phone className="h-3.5 w-3.5 text-slate-500" />
                              <span className="text-[11px]">{emp.telefone}</span>
                            </div>
                          )}
                          {emp.email && (
                            <div className="flex items-center gap-2">
                              <Mail className="h-3.5 w-3.5 text-slate-500" />
                              <span className="text-[11px] truncate">{emp.email}</span>
                            </div>
                          )}
                          {emp.cidade && (
                            <div className="flex items-center gap-2">
                              <MapPin className="h-3.5 w-3.5 text-slate-500" />
                              <span className="text-[11px]">
                                {emp.cidade}
                                {emp.uf ? ` - ${emp.uf}` : ''}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="p-4 pt-3 border-t border-[#1E2B58] bg-[#070D1E]/60 flex items-center justify-between gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedEmpresaForMembers(emp)}
                        className="text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 gap-1.5 h-8 px-2.5"
                      >
                        <Users className="h-3.5 w-3.5" />
                        Membros ({companyMembers.length})
                      </Button>

                      {!isSelected && (
                        <Button
                          size="sm"
                          onClick={() => {
                            setCurrentCompany(emp)
                            toast.success(
                              `Contexto alterado para ${emp.nome_fantasia || emp.nome_razao_social}`,
                            )
                          }}
                          className="h-8 text-xs bg-[#0052CC] hover:bg-[#003E99] text-white gap-1 rounded-lg"
                        >
                          <span>Selecionar</span>
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

      {/* Modal: Cadastro de Empresa */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-2xl bg-[#0E1738] border-[#1E2B58] text-white p-6 max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-2.5 mb-1">
              <div className="h-8 w-8 rounded-lg bg-[#FF6B35]/20 border border-[#FF6B35]/30 flex items-center justify-center text-[#FF6B35]">
                <Building2 className="h-4 w-4" />
              </div>
              <DialogTitle className="font-heading text-lg font-bold text-white">
                Cadastrar Nova Empresa
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-slate-400">
              Preencha os dados cadastrais da empresa para habilitar a estrutura multi-tenant.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateEmpresa} className="space-y-4 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs text-slate-300">Razão Social *</Label>
                <Input
                  required
                  placeholder="Ex: Pimenta Verde Cosméticos Eireli"
                  value={formData.nome_razao_social}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, nome_razao_social: e.target.value }))
                  }
                  className="h-9 border-[#1E2B58] bg-[#0A1128] text-xs text-white"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-slate-300">Nome Fantasia</Label>
                <Input
                  placeholder="Ex: Pimenta Verde Centro"
                  value={formData.nome_fantasia}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, nome_fantasia: e.target.value }))
                  }
                  className="h-9 border-[#1E2B58] bg-[#0A1128] text-xs text-white"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-slate-300">CNPJ (com máscara e validação)</Label>
                <Input
                  placeholder="00.000.000/0000-00"
                  value={formData.cnpj}
                  onChange={handleCnpjChange}
                  maxLength={18}
                  className={`h-9 border-[#1E2B58] bg-[#0A1128] text-xs text-white font-mono ${
                    cnpjError ? 'border-rose-500' : ''
                  }`}
                />
                {cnpjError && (
                  <p className="text-[11px] text-rose-400 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> {cnpjError}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-slate-300">Telefone / WhatsApp</Label>
                <Input
                  placeholder="(21) 90000-0000"
                  value={formData.telefone}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, telefone: formatPhone(e.target.value) }))
                  }
                  maxLength={15}
                  className="h-9 border-[#1E2B58] bg-[#0A1128] text-xs text-white"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-slate-300">E-mail de Contato</Label>
                <Input
                  type="email"
                  placeholder="contato@empresa.com.br"
                  value={formData.email}
                  onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
                  className="h-9 border-[#1E2B58] bg-[#0A1128] text-xs text-white"
                />
              </div>
            </div>

            <div className="border-t border-[#1E2B58] pt-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2 block">
                Endereço Operacional
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs text-slate-300">Logradouro (Rua / Av)</Label>
                  <Input
                    placeholder="Rua Manuel Vieira"
                    value={formData.logradouro}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, logradouro: e.target.value }))
                    }
                    className="h-9 border-[#1E2B58] bg-[#0A1128] text-xs text-white"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-300">Número</Label>
                  <Input
                    placeholder="196"
                    value={formData.numero}
                    onChange={(e) => setFormData((prev) => ({ ...prev, numero: e.target.value }))}
                    className="h-9 border-[#1E2B58] bg-[#0A1128] text-xs text-white"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-300">Complemento</Label>
                  <Input
                    placeholder="Galpão Cinza"
                    value={formData.complemento}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, complemento: e.target.value }))
                    }
                    className="h-9 border-[#1E2B58] bg-[#0A1128] text-xs text-white"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-300">Bairro</Label>
                  <Input
                    placeholder="Centro"
                    value={formData.bairro}
                    onChange={(e) => setFormData((prev) => ({ ...prev, bairro: e.target.value }))}
                    className="h-9 border-[#1E2B58] bg-[#0A1128] text-xs text-white"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-300">CEP</Label>
                  <Input
                    placeholder="25020-210"
                    value={formData.cep}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, cep: formatCEP(e.target.value) }))
                    }
                    maxLength={9}
                    className="h-9 border-[#1E2B58] bg-[#0A1128] text-xs text-white font-mono"
                  />
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs text-slate-300">Cidade</Label>
                  <Input
                    placeholder="Duque de Caxias"
                    value={formData.cidade}
                    onChange={(e) => setFormData((prev) => ({ ...prev, cidade: e.target.value }))}
                    className="h-9 border-[#1E2B58] bg-[#0A1128] text-xs text-white"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-300">UF (Estado)</Label>
                  <Input
                    placeholder="RJ"
                    value={formData.uf}
                    maxLength={2}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, uf: e.target.value.toUpperCase() }))
                    }
                    className="h-9 border-[#1E2B58] bg-[#0A1128] text-xs text-white"
                  />
                </div>
              </div>
            </div>

            <DialogFooter className="pt-4 border-t border-[#1E2B58]">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreateOpen(false)}
                className="border-[#1E2B58] bg-[#0A1128] hover:bg-[#121E46] text-slate-300 text-xs"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || !!cnpjError}
                className="bg-[#0052CC] hover:bg-[#003E99] text-white text-xs font-bold"
              >
                {isSubmitting ? 'Cadastrando...' : 'Salvar Empresa'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Gestão de Membros da Empresa */}
      <Dialog
        open={!!selectedEmpresaForMembers}
        onOpenChange={(open) => !open && setSelectedEmpresaForMembers(null)}
      >
        <DialogContent className="max-w-xl bg-[#0E1738] border-[#1E2B58] text-white p-6 max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-2.5 mb-1">
              <div className="h-8 w-8 rounded-lg bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
                <Users className="h-4 w-4" />
              </div>
              <DialogTitle className="font-heading text-lg font-bold text-white">
                Membros da Empresa
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-slate-400">
              {selectedEmpresaForMembers?.nome_fantasia ||
                selectedEmpresaForMembers?.nome_razao_social}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 pt-2">
            {/* Vincular novo membro */}
            <div className="rounded-xl border border-[#1E2B58] bg-[#0A1128] p-3.5 space-y-3">
              <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <UserPlus className="h-4 w-4 text-blue-400" /> Vincular Usuário Existente
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="sm:col-span-2">
                  <Select value={newMemberUserId} onValueChange={setNewMemberUserId}>
                    <SelectTrigger className="h-9 border-[#1E2B58] bg-[#0E1738] text-xs text-white">
                      <SelectValue placeholder="Selecione um usuário..." />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0E1738] border-[#1E2B58] text-white">
                      {allUsers.map((u) => (
                        <SelectItem key={u.id} value={u.id} className="text-xs">
                          {u.name || u.email} ({u.role || 'user'})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Select
                    value={newMemberPapel}
                    onValueChange={(val: any) => setNewMemberPapel(val)}
                  >
                    <SelectTrigger className="h-9 border-[#1E2B58] bg-[#0E1738] text-xs text-white">
                      <SelectValue placeholder="Papel" />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0E1738] border-[#1E2B58] text-white">
                      <SelectItem value="vendedor" className="text-xs">
                        Vendedor
                      </SelectItem>
                      <SelectItem value="entregador" className="text-xs">
                        Entregador
                      </SelectItem>
                      <SelectItem value="admin" className="text-xs">
                        Admin
                      </SelectItem>
                      <SelectItem value="gestor" className="text-xs">
                        Gestor
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button
                onClick={handleAddMember}
                disabled={!newMemberUserId || isAddingMember}
                className="w-full h-8 text-xs bg-[#0052CC] hover:bg-[#003E99] text-white font-semibold"
              >
                {isAddingMember ? 'Vinculando...' : 'Adicionar Membro à Empresa'}
              </Button>
            </div>

            {/* Lista de membros */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-300">
                Membros Atuais (
                {membros.filter((m) => m.empresa_id === selectedEmpresaForMembers?.id).length})
              </span>

              <div className="divide-y divide-[#1E2B58] border border-[#1E2B58] rounded-xl bg-[#0A1128] overflow-hidden max-h-64 overflow-y-auto">
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
                          <p className="font-bold text-white">{usr?.name || 'Usuário Rotaly'}</p>
                          <p className="text-[11px] text-slate-400">{usr?.email}</p>
                        </div>

                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className="text-[10px] border-[#1E2B58] text-slate-300 capitalize"
                          >
                            {m.papel || usr?.role || 'membro'}
                          </Badge>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleRemoveMember(m.id)}
                            className="h-7 w-7 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-lg"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    )
                  })}
              </div>
            </div>
          </div>

          <DialogFooter className="pt-4 border-t border-[#1E2B58]">
            <Button
              onClick={() => setSelectedEmpresaForMembers(null)}
              className="border-[#1E2B58] bg-[#0A1128] hover:bg-[#121E46] text-white text-xs"
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

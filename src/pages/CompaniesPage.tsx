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
  Bell,
  MapPin,
  FileText,
  Shield,
  UserPlus,
  Trash2,
  ArrowRight,
  Zap,
  Edit2,
  Lock,
  Unlock,
  MoreVertical,
  AlertTriangle,
  Loader2,
  Sparkles,
  UserCheck,
  KeyRound,
  ShieldAlert,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import pb from '@/lib/pocketbase/client'
import { lookupCnpj } from '@/services/cnpjService'

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
  const [matrizId, setMatrizId] = useState<string>('')
  const [searchTerm, setSearchTerm] = useState('')
  const [isLoading, setIsLoading] = useState(true)

  // Modal de Criação de Empresa
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLookingUpCnpj, setIsLookingUpCnpj] = useState(false)
  const [cnpjFeedback, setCnpjFeedback] = useState<{
    message: string
    type: 'success' | 'info' | 'error'
  } | null>(null)
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
    notifications_email: '',
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

  // Modal de Edição de Empresa / Limites / Dados Cadastrais / Membros
  const [editingEmpresa, setEditingEmpresa] = useState<EmpresaRecord | null>(null)
  const [editActiveTab, setEditActiveTab] = useState<'dados' | 'membros'>('dados')
  const [editFormData, setEditFormData] = useState({
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
    notifications_email: '',
    plano: 'profissional' as PlanoEmpresa,
    max_users: 15,
    max_couriers: 10,
    max_orders_month: 2000,
    ativa: true,
  })
  const [editCnpjError, setEditCnpjError] = useState<string | null>(null)

  // Gestão de Membros dentro do Modal de Edição
  const [isEditAddMemberOpen, setIsEditAddMemberOpen] = useState(false)
  const [memberAddMode, setMemberAddMode] = useState<'create' | 'link'>('create')
  const [selectedExistingUserId, setSelectedExistingUserId] = useState<string>('')
  const [existingUserRole, setExistingUserRole] = useState<'admin' | 'seller' | 'courier'>('seller')
  const [editNewMemberForm, setEditNewMemberForm] = useState({
    name: '',
    email: '',
    password: '',
    phone: '',
    role: 'seller' as 'admin' | 'seller' | 'courier',
    vehicle_type: 'moto',
    vehicle_plate: '',
  })
  const [isAddingMemberInEdit, setIsAddingMemberInEdit] = useState(false)

  // Edição de Membro individual (sub-modal ou formulário de edição)
  const [editingMember, setEditingMember] = useState<{
    membroId: string
    userId: string
    name: string
    email: string
    phone: string
    role: 'admin' | 'seller' | 'courier'
    vehicle_type?: string
    vehicle_plate?: string
  } | null>(null)
  const [isSavingMemberEdit, setIsSavingMemberEdit] = useState(false)

  // Confirmação de exclusão de vínculo de membro
  const [memberToDelete, setMemberToDelete] = useState<{
    membroId: string
    userId: string
    userName: string
    userRole: string
    empresaId: string
    companyName: string
  } | null>(null)
  const [isDeletingMemberLink, setIsDeletingMemberLink] = useState(false)

  // Modal de Bloqueio / Desbloqueio de Empresa
  const [toggleStatusTarget, setToggleStatusTarget] = useState<EmpresaRecord | null>(null)
  const [isTogglingStatus, setIsTogglingStatus] = useState(false)

  // Modal de Exclusão de Empresa (com confirmação explícita)
  const [deleteTarget, setDeleteTarget] = useState<EmpresaRecord | null>(null)
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)

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
      const [empList, membList, usrList, resolvedMatrizId] = await Promise.all([
        deliveryService.getEmpresas('', 'nome_razao_social'),
        deliveryService.getMembros('', '-created', 'empresa_id,user_id'),
        deliveryService.getAllUsers('ALL'),
        deliveryService.getMatrizCompanyId(),
      ])
      setEmpresas(empList)
      setMembros(membList)
      setAllUsers(usrList)
      setMatrizId(resolvedMatrizId || '')
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

  // Consulta automática na API de CNPJ (BrasilAPI com fallback para ReceitaWS)
  useEffect(() => {
    const rawCnpj = formData.cnpj.replace(/\D/g, '')
    if (rawCnpj.length !== 14 || !validateCNPJ(rawCnpj)) {
      setIsLookingUpCnpj(false)
      return
    }

    const abortController = new AbortController()

    const timer = setTimeout(async () => {
      setIsLookingUpCnpj(true)
      setCnpjFeedback(null)

      try {
        const result = await lookupCnpj(rawCnpj, {
          signal: abortController.signal,
          timeoutMs: 7000,
        })

        if (!result) {
          setCnpjFeedback({
            message:
              'CNPJ válido, mas dados não encontrados na Receita/BrasilAPI. Preencha manualmente.',
            type: 'info',
          })
          return
        }

        // Preencher preservando dados já digitados pelo usuário
        setFormData((prev) => {
          // Só atualiza se o CNPJ digitado ainda for o mesmo da consulta
          if (prev.cnpj.replace(/\D/g, '') !== rawCnpj) return prev

          return {
            ...prev,
            nome_razao_social: prev.nome_razao_social.trim() || result.nome_razao_social,
            nome_fantasia:
              prev.nome_fantasia.trim() || result.nome_fantasia || result.nome_razao_social,
            telefone: prev.telefone.trim() || result.telefone,
            email: prev.email.trim() || result.email,
            cep: prev.cep.trim() || result.cep,
            logradouro: prev.logradouro.trim() || result.logradouro,
            numero: prev.numero.trim() || result.numero,
            complemento: prev.complemento.trim() || result.complemento,
            bairro: prev.bairro.trim() || result.bairro,
            cidade: prev.cidade.trim() || result.cidade,
            uf: prev.uf.trim() && prev.uf !== 'RJ' ? prev.uf : result.uf || prev.uf,
          }
        })

        const razaoDisplay = result.nome_fantasia || result.nome_razao_social || 'Empresa'
        setCnpjFeedback({
          message: `Dados carregados automaticamente (${razaoDisplay}).`,
          type: 'success',
        })
        toast.success(`Dados da empresa "${razaoDisplay}" preenchidos via CNPJ!`)
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.warn('Erro ao consultar CNPJ:', err)
          setCnpjFeedback({
            message: 'Consulta pública indisponível no momento. Preencha os campos normalmente.',
            type: 'info',
          })
        }
      } finally {
        setIsLookingUpCnpj(false)
      }
    }, 400) // Debounce de 400ms

    return () => {
      clearTimeout(timer)
      abortController.abort()
    }
  }, [formData.cnpj])

  const handleCnpjChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCNPJ(e.target.value)
    setFormData((prev) => ({ ...prev, cnpj: formatted }))
    setCnpjFeedback(null)

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
        notifications_email: formData.notifications_email.trim(),
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
              verified: true,
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
      setCnpjFeedback(null)
      setCnpjError(null)
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
        notifications_email: '',
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
    setEditActiveTab('dados')
    setIsEditAddMemberOpen(false)
    setEditingMember(null)
    setMemberToDelete(null)
    setEditCnpjError(null)

    setEditFormData({
      nome_razao_social: emp.nome_razao_social || '',
      nome_fantasia: emp.nome_fantasia || '',
      cnpj: emp.cnpj || '',
      logradouro: emp.logradouro || '',
      numero: emp.numero || '',
      complemento: emp.complemento || '',
      bairro: emp.bairro || '',
      cidade: emp.cidade || '',
      uf: emp.uf || 'RJ',
      cep: emp.cep || '',
      telefone: emp.telefone || '',
      email: emp.email || '',
      notifications_email: emp.notifications_email || '',
      plano: (emp.plano as PlanoEmpresa) || 'profissional',
      max_users: emp.max_users || 15,
      max_couriers: emp.max_couriers || 10,
      max_orders_month: emp.max_orders_month || 2000,
      ativa: emp.ativa ?? true,
    })
  }

  const handleEditCnpjChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCNPJ(e.target.value)
    setEditFormData((prev) => ({ ...prev, cnpj: formatted }))

    const raw = formatted.replace(/\D/g, '')
    const originalRaw = (editingEmpresa?.cnpj || '').replace(/\D/g, '')
    const isMatriz = Boolean(matrizId && editingEmpresa?.id === matrizId)

    // Se for matriz ou idêntico ao original gravado, não marcar erro
    if (isMatriz || (originalRaw && raw === originalRaw)) {
      setEditCnpjError(null)
    } else if (raw.length === 14) {
      if (!validateCNPJ(raw)) {
        setEditCnpjError('CNPJ inválido (dígitos verificadores incorretos).')
      } else {
        setEditCnpjError(null)
      }
    } else if (raw.length > 0) {
      setEditCnpjError('O CNPJ deve ter 14 dígitos.')
    } else {
      setEditCnpjError(null)
    }
  }

  const handleSaveEdit = async () => {
    if (!editingEmpresa) return

    if (!editFormData.nome_razao_social.trim()) {
      toast.error('A Razão Social é obrigatória.')
      return
    }

    const isMatriz = Boolean(matrizId && editingEmpresa.id === matrizId)

    const cleanCnpj = editFormData.cnpj.replace(/\D/g, '')
    const originalCleanCnpj = (editingEmpresa.cnpj || '').replace(/\D/g, '')
    const isCnpjUnchanged = cleanCnpj === originalCleanCnpj

    // Validação de CNPJ apenas quando o campo NÃO está travado (não-Matriz) E foi alterado
    if (cleanCnpj && !isMatriz && !isCnpjUnchanged) {
      if (!validateCNPJ(cleanCnpj)) {
        toast.error('CNPJ informado é inválido.')
        return
      }

      // Validar duplicidade de CNPJ com outras empresas
      const exists = empresas.some(
        (emp) => emp.id !== editingEmpresa.id && (emp.cnpj || '').replace(/\D/g, '') === cleanCnpj,
      )
      if (exists) {
        toast.error('Já existe outra empresa cadastrada com este CNPJ.')
        return
      }
    }

    setIsSubmitting(true)
    try {
      const enderecoCompleto = [
        editFormData.logradouro,
        editFormData.numero ? `nº ${editFormData.numero}` : '',
        editFormData.complemento,
        editFormData.bairro,
        editFormData.cidade,
        editFormData.uf,
        editFormData.cep ? `CEP: ${editFormData.cep}` : '',
      ]
        .filter(Boolean)
        .join(', ')

      const updatePayload: Partial<EmpresaRecord> = {
        nome_razao_social: editFormData.nome_razao_social.trim(),
        nome_fantasia: editFormData.nome_fantasia.trim() || editFormData.nome_razao_social.trim(),
        // Se for a Matriz, preserva o CNPJ original para segurança
        cnpj: isMatriz ? editingEmpresa.cnpj : editFormData.cnpj,
        logradouro: editFormData.logradouro,
        numero: editFormData.numero,
        complemento: editFormData.complemento,
        bairro: editFormData.bairro,
        cidade: editFormData.cidade,
        uf: editFormData.uf,
        cep: editFormData.cep,
        endereco_completo: enderecoCompleto,
        telefone: editFormData.telefone,
        email: editFormData.email,
        notifications_email: editFormData.notifications_email.trim(),
        plano: isMatriz ? 'enterprise' : editFormData.plano,
        max_users: isMatriz ? 9999 : Number(editFormData.max_users),
        max_couriers: isMatriz ? 9999 : Number(editFormData.max_couriers),
        max_orders_month: isMatriz ? 999999 : Number(editFormData.max_orders_month),
        ativa: isMatriz ? true : editFormData.ativa,
      }

      await pb.collection<EmpresaRecord>('empresas').update(editingEmpresa.id, updatePayload)
      toast.success('Dados cadastrais e limites da empresa atualizados!')
      setEditingEmpresa(null)
      await loadData()
      await refreshCompanyData()
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao atualizar dados da empresa.')
    } finally {
      setIsSubmitting(false)
    }
  }

  // --- GESTÃO DE MEMBROS DENTRO DO MODAL DE EDIÇÃO ---

  // Adicionar membro na empresa em edição (novo usuário ou vincular existente)
  const handleAddMemberInEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingEmpresa) return

    const isMatriz = Boolean(matrizId && editingEmpresa.id === matrizId)

    // Se for a Matriz, apenas usuários com papel 'master' podem gerenciar membros
    if (isMatriz && !isMaster) {
      toast.error('Apenas o usuário Master pode cadastrar ou gerenciar membros da Matriz.')
      return
    }

    setIsAddingMemberInEdit(true)
    try {
      if (memberAddMode === 'create') {
        if (!editNewMemberForm.email || !editNewMemberForm.password) {
          toast.error('E-mail e senha são obrigatórios.')
          setIsAddingMemberInEdit(false)
          return
        }

        // Validar limites da empresa antes de criar
        const isCourier = editNewMemberForm.role === 'courier'
        const limitCheck = await deliveryService.checkUserLimit(editingEmpresa.id, isCourier)
        if (!limitCheck.allowed) {
          toast.error(limitCheck.message || 'Limite de usuários do plano atingido.')
          setIsAddingMemberInEdit(false)
          return
        }

        // Criar usuário novo via deliveryService.createUser (já cria membro vinculado)
        const createdUser = await deliveryService.createUser(
          {
            name: editNewMemberForm.name,
            email: editNewMemberForm.email.trim().toLowerCase(),
            password: editNewMemberForm.password,
            passwordConfirm: editNewMemberForm.password,
            role: editNewMemberForm.role,
            phone: editNewMemberForm.phone,
            status: 'active',
            vehicle_type: editNewMemberForm.vehicle_type,
            vehicle_plate: editNewMemberForm.vehicle_plate,
            verified: true,
          },
          editingEmpresa.id,
        )

        toast.success(
          `Membro ${createdUser.name || createdUser.email} criado e vinculado com sucesso!`,
        )
      } else {
        // Modo 'link': vincular usuário existente
        if (!selectedExistingUserId) {
          toast.error('Selecione um usuário existente para vincular.')
          setIsAddingMemberInEdit(false)
          return
        }

        // Checar se já é membro ativo desta empresa
        const alreadyLinked = membros.some(
          (m) => m.empresa_id === editingEmpresa.id && m.user_id === selectedExistingUserId,
        )
        if (alreadyLinked) {
          toast.error('Este usuário já é membro desta empresa.')
          setIsAddingMemberInEdit(false)
          return
        }

        // Validar limites da empresa
        const isCourier = existingUserRole === 'courier'
        const limitCheck = await deliveryService.checkUserLimit(editingEmpresa.id, isCourier)
        if (!limitCheck.allowed) {
          toast.error(limitCheck.message || 'Limite de usuários do plano atingido.')
          setIsAddingMemberInEdit(false)
          return
        }

        // Criar registro na coleção membros
        await pb.collection<MembroRecord>('membros').create({
          empresa_id: editingEmpresa.id,
          user_id: selectedExistingUserId,
          papel: existingUserRole,
          ativo: true,
        })

        // Sincronizar users.role caso o usuário ainda não tenha papel ou coincida
        try {
          const usr = allUsers.find((u) => u.id === selectedExistingUserId)
          if (usr && usr.role !== 'master' && usr.role !== existingUserRole) {
            await pb.collection('users').update(selectedExistingUserId, {
              role: existingUserRole,
            })
          }
        } catch {
          /* intentionally ignored */
        }

        toast.success('Usuário vinculado a esta empresa com sucesso!')
      }

      // Limpar formulário de adição
      setIsEditAddMemberOpen(false)
      setEditNewMemberForm({
        name: '',
        email: '',
        password: '',
        phone: '',
        role: 'seller',
        vehicle_type: 'moto',
        vehicle_plate: '',
      })
      setSelectedExistingUserId('')
      await loadData()
    } catch (err: any) {
      console.error('Erro ao adicionar membro na empresa:', err)
      toast.error(err?.message || 'Falha ao adicionar membro.')
    } finally {
      setIsAddingMemberInEdit(false)
    }
  }

  // Abrir modal de edição de dados/papel do membro
  const handleOpenEditMember = (m: MembroRecord) => {
    const usr = allUsers.find((u) => u.id === m.user_id)
    const papel = (m.papel || usr?.role || 'seller') as 'admin' | 'seller' | 'courier'

    setEditingMember({
      membroId: m.id,
      userId: m.user_id,
      name: usr?.name || '',
      email: usr?.email || '',
      phone: usr?.phone || '',
      role: papel === 'admin' || papel === 'courier' ? papel : 'seller',
      vehicle_type: usr?.vehicle_type || 'moto',
      vehicle_plate: usr?.vehicle_plate || '',
    })
  }

  // Salvar alterações de papel e dados cadastrais do membro (válido para Matriz e Filiais)
  const handleSaveMemberEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingMember || !editingEmpresa) return

    setIsSavingMemberEdit(true)
    try {
      // 1. Atualizar vínculo na tabela `membros` (papel)
      await pb.collection<MembroRecord>('membros').update(editingMember.membroId, {
        papel: editingMember.role,
        ativo: true,
      })

      // 2. Atualizar dados do usuário em `users` (nome, telefone, role e veículo se courier)
      const userPayload: Record<string, any> = {
        name: editingMember.name.trim(),
        phone: editingMember.phone.trim(),
        role: editingMember.role,
      }
      if (editingMember.role === 'courier') {
        userPayload.vehicle_type = editingMember.vehicle_type || 'moto'
        userPayload.vehicle_plate = (editingMember.vehicle_plate || '').toUpperCase().trim()
      }

      await pb.collection('users').update(editingMember.userId, userPayload)

      toast.success('Dados e papel do membro atualizados com sucesso!')
      setEditingMember(null)
      await loadData()
    } catch (err: any) {
      console.error('Erro ao salvar membro:', err)
      toast.error(err?.message || 'Falha ao atualizar dados do membro.')
    } finally {
      setIsSavingMemberEdit(false)
    }
  }

  // Validar e abrir diálogo de confirmação de exclusão do vínculo de membro
  const requestDeleteMemberLink = (params: {
    membroId: string
    userId: string
    userName: string
    userRole: string
    empresaId: string
    companyName: string
  }) => {
    // Trava 1: Não permitir que o usuário remova o próprio vínculo
    if (user?.id && params.userId === user.id) {
      toast.error(
        'Você não pode remover o seu próprio vínculo desta empresa para não perder o acesso.',
      )
      return
    }

    // Trava 2: Não permitir remover o vínculo do ÚLTIMO admin ativo da empresa
    const companyActiveAdmins = membros.filter((m) => {
      if (m.empresa_id !== params.empresaId || m.ativo === false) return false
      if (m.papel === 'admin') return true
      const usr = allUsers.find((u) => u.id === m.user_id)
      return usr?.role === 'admin' || usr?.role === 'master'
    })

    const isTargetAdmin =
      params.userRole.toLowerCase().includes('admin') ||
      membros.some(
        (m) =>
          m.id === params.membroId &&
          (m.papel === 'admin' || allUsers.find((u) => u.id === m.user_id)?.role === 'admin'),
      )

    if (isTargetAdmin && companyActiveAdmins.length <= 1) {
      toast.error(
        'Não é possível remover o último administrador ativo da empresa. Cadastre outro administrador antes de desvincular este.',
      )
      return
    }

    setMemberToDelete(params)
  }

  // Confirmar exclusão do vínculo (membro) com a empresa
  const handleConfirmDeleteMemberLink = async () => {
    if (!memberToDelete) return

    // Revalidar travas de segurança antes de prosseguir
    if (user?.id && memberToDelete.userId === user.id) {
      toast.error(
        'Você não pode remover o seu próprio vínculo desta empresa para não perder o acesso.',
      )
      setMemberToDelete(null)
      return
    }

    const companyActiveAdmins = membros.filter((m) => {
      if (m.empresa_id !== memberToDelete.empresaId || m.ativo === false) return false
      if (m.papel === 'admin') return true
      const usr = allUsers.find((u) => u.id === m.user_id)
      return usr?.role === 'admin' || usr?.role === 'master'
    })

    const isTargetAdmin =
      memberToDelete.userRole.toLowerCase().includes('admin') ||
      membros.some(
        (m) =>
          m.id === memberToDelete.membroId &&
          (m.papel === 'admin' || allUsers.find((u) => u.id === m.user_id)?.role === 'admin'),
      )

    if (isTargetAdmin && companyActiveAdmins.length <= 1) {
      toast.error(
        'Não é possível remover o último administrador ativo da empresa. Cadastre outro administrador antes de desvincular este.',
      )
      setMemberToDelete(null)
      return
    }

    setIsDeletingMemberLink(true)
    try {
      // Exclui EXCLUSIVAMENTE o vínculo (registro na coleção `membros`), NUNCA o registro de `users`
      await deliveryService.deleteMembro(memberToDelete.membroId)
      toast.success(
        `Vínculo de "${memberToDelete.userName}" com ${memberToDelete.companyName || 'a empresa'} foi removido com sucesso. O histórico de rotas, entregas e pedidos do usuário foi preservado intacto.`,
      )
      setMemberToDelete(null)
      await loadData()
    } catch (err: any) {
      console.error('Erro ao excluir vínculo de membro:', err)
      toast.error(err?.message || 'Falha ao desvincular membro da empresa.')
    } finally {
      setIsDeletingMemberLink(false)
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
          verified: true,
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

  const handleRemoveMember = (membroId: string) => {
    const memb = membros.find((m) => m.id === membroId)
    const emp =
      selectedEmpresaForMembers || (memb ? empresas.find((e) => e.id === memb.empresa_id) : null)
    const usr = memb ? allUsers.find((u) => u.id === memb.user_id) : null
    const roleLabel = memb?.papel || usr?.role || 'membro'
    const companyDisplayName = emp?.nome_fantasia || emp?.nome_razao_social || 'a empresa'

    requestDeleteMemberLink({
      membroId,
      userId: memb?.user_id || '',
      userName: usr?.name || usr?.email || 'Membro',
      userRole: roleLabel,
      empresaId: emp?.id || memb?.empresa_id || '',
      companyName: companyDisplayName,
    })
  }

  // Ação de Bloqueio / Desbloqueio
  const handleConfirmToggleStatus = async () => {
    if (!toggleStatusTarget) return
    if (matrizId && toggleStatusTarget.id === matrizId && toggleStatusTarget.ativa !== false) {
      toast.error('A Matriz Principal não pode ser bloqueada.')
      setToggleStatusTarget(null)
      return
    }

    setIsTogglingStatus(true)
    const isCurrentlyActive = toggleStatusTarget.ativa !== false
    const willBeActive = !isCurrentlyActive
    const companyDisplayName =
      toggleStatusTarget.nome_fantasia || toggleStatusTarget.nome_razao_social

    try {
      const result = await deliveryService.toggleEmpresaAtiva(toggleStatusTarget.id, willBeActive)
      if (willBeActive) {
        toast.success(`A empresa "${companyDisplayName}" foi desbloqueada com sucesso!`)
      } else {
        toast.warning(
          `A empresa "${companyDisplayName}" foi bloqueada. Membros e entregadores tiveram o acesso suspenso.`,
        )
      }
      setToggleStatusTarget(null)
      await loadData()
      await refreshCompanyData()
    } catch (err: any) {
      console.error('Erro ao alternar status da empresa:', err)
      toast.error(err?.message || 'Falha ao alterar status da empresa.')
    } finally {
      setIsTogglingStatus(false)
    }
  }

  // Ação de Exclusão de Empresa com confirmação rigorosa
  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    if (matrizId && deleteTarget.id === matrizId) {
      toast.error('A Matriz Principal não pode ser excluída do sistema.')
      setDeleteTarget(null)
      return
    }

    const companyExpectedName = (
      deleteTarget.nome_fantasia ||
      deleteTarget.nome_razao_social ||
      ''
    ).trim()
    if (deleteConfirmationText.trim().toLowerCase() !== companyExpectedName.toLowerCase()) {
      toast.error(`Para confirmar, digite exatamente o nome "${companyExpectedName}".`)
      return
    }

    setIsDeleting(true)
    try {
      const result = await deliveryService.deleteEmpresaSafe(deleteTarget.id)
      toast.success(result.message || `Empresa "${companyExpectedName}" excluída com sucesso!`)
      setDeleteTarget(null)
      setDeleteConfirmationText('')
      await loadData()
      await refreshCompanyData()
    } catch (err: any) {
      console.error('Erro ao excluir empresa:', err)
      toast.error(err?.message || 'Falha ao excluir a empresa.')
    } finally {
      setIsDeleting(false)
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
                const isMatriz = Boolean(matrizId && emp.id === matrizId)

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
                            <div className="flex items-center gap-1.5">
                              {emp.ativa !== false ? (
                                <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-bold gap-1 shadow-xs">
                                  <CheckCircle2 className="h-3 w-3" /> Ativa
                                </Badge>
                              ) : (
                                <Badge className="bg-rose-500 hover:bg-rose-600 text-white text-[10px] font-bold gap-1 shadow-xs">
                                  <Lock className="h-3 w-3" /> Bloqueada
                                </Badge>
                              )}
                              {isSelected && (
                                <Badge
                                  variant="outline"
                                  className="text-[9px] font-bold border-[#00A3FF] text-[#00A3FF] bg-blue-50/60 uppercase"
                                >
                                  Em Uso
                                </Badge>
                              )}
                            </div>
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
                            <div className="flex items-center gap-2" title="E-mail Comercial">
                              <Mail className="h-3.5 w-3.5 text-slate-400" />
                              <span className="text-[11px] truncate">{emp.email}</span>
                            </div>
                          )}
                          {emp.notifications_email && (
                            <div
                              className="flex items-center gap-2 text-[#0052CC]"
                              title="E-mail de Notificações Automáticas (alerta de combustível, plano, créditos)"
                            >
                              <Bell className="h-3.5 w-3.5 text-[#00A3FF]" />
                              <span className="text-[11px] truncate font-medium">
                                {emp.notifications_email}
                              </span>
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

                        {/* Menu de Ações Administrativas Master: Bloquear/Desbloquear e Excluir */}
                        {isMaster && !isMatriz && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-xs text-slate-500 hover:text-[#002855] hover:bg-slate-200 h-8 w-8 p-0"
                                title="Mais ações da empresa"
                              >
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="end"
                              className="w-48 bg-white border-slate-200"
                            >
                              <DropdownMenuLabel className="text-[10px] uppercase font-bold text-slate-400">
                                Ações Master
                              </DropdownMenuLabel>
                              <DropdownMenuItem
                                onClick={() => setToggleStatusTarget(emp)}
                                className={`text-xs gap-2 cursor-pointer font-medium ${
                                  emp.ativa !== false
                                    ? 'text-amber-600 focus:text-amber-700 focus:bg-amber-50'
                                    : 'text-emerald-600 focus:text-emerald-700 focus:bg-emerald-50'
                                }`}
                              >
                                {emp.ativa !== false ? (
                                  <>
                                    <Lock className="h-3.5 w-3.5" />
                                    <span>Bloquear Empresa</span>
                                  </>
                                ) : (
                                  <>
                                    <Unlock className="h-3.5 w-3.5" />
                                    <span>Desbloquear Empresa</span>
                                  </>
                                )}
                              </DropdownMenuItem>

                              <DropdownMenuSeparator />

                              <DropdownMenuItem
                                onClick={() => {
                                  setDeleteTarget(emp)
                                  setDeleteConfirmationText('')
                                }}
                                className="text-xs gap-2 cursor-pointer font-medium text-rose-600 focus:text-rose-700 focus:bg-rose-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                <span>Excluir Empresa...</span>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
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
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-slate-700">
                    CNPJ (autocompletar)
                  </Label>
                  {isLookingUpCnpj && (
                    <span className="text-[10px] text-[#00A3FF] font-medium flex items-center gap-1 animate-pulse">
                      <Loader2 className="h-3 w-3 animate-spin" /> Consultando CNPJ...
                    </span>
                  )}
                </div>
                <div className="relative">
                  <Input
                    placeholder="00.000.000/0000-00"
                    value={formData.cnpj}
                    onChange={handleCnpjChange}
                    maxLength={18}
                    className={`h-9 border-slate-200 text-xs font-mono pr-8 ${
                      cnpjError ? 'border-rose-500' : ''
                    }`}
                  />
                  <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                    {isLookingUpCnpj ? (
                      <Loader2 className="h-4 w-4 animate-spin text-[#00A3FF]" />
                    ) : formData.cnpj.replace(/\D/g, '').length === 14 && !cnpjError ? (
                      <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
                    ) : null}
                  </div>
                </div>

                {cnpjError && (
                  <p className="text-[11px] text-rose-500 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> {cnpjError}
                  </p>
                )}

                {cnpjFeedback && !cnpjError && (
                  <p
                    className={`text-[11px] flex items-center gap-1 ${
                      cnpjFeedback.type === 'success'
                        ? 'text-emerald-600'
                        : cnpjFeedback.type === 'info'
                          ? 'text-slate-500'
                          : 'text-rose-500'
                    }`}
                  >
                    {cnpjFeedback.type === 'success' ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : (
                      <AlertCircle className="h-3 w-3" />
                    )}
                    {cnpjFeedback.message}
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

              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5 text-[#00A3FF]" />
                  E-mail de Notificações (avisos automáticos)
                </Label>
                <Input
                  type="email"
                  placeholder="avisos@empresa.com.br"
                  value={formData.notifications_email}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, notifications_email: e.target.value }))
                  }
                  className="h-9 border-slate-200 text-xs"
                />
                <p className="text-[11px] text-slate-500">
                  E-mail que recebe os avisos automáticos do sistema: alerta de combustível, uso do
                  plano e consumo de créditos.
                </p>
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

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">CEP</Label>
                  <Input
                    placeholder="00000-000"
                    value={formData.cep}
                    maxLength={9}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, cep: formatCEP(e.target.value) }))
                    }
                    className="h-9 border-slate-200 text-xs font-mono"
                  />
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs font-semibold text-slate-700">Complemento</Label>
                  <Input
                    placeholder="Sala, Galpão, Bloco..."
                    value={formData.complemento}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, complemento: e.target.value }))
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

      {/* Modal: Editar Empresa, Dados Cadastrais, Limites & Membros (Gestão Completa) */}
      <Dialog
        open={!!editingEmpresa}
        onOpenChange={(open) => {
          if (!open) {
            setEditingEmpresa(null)
            setIsEditAddMemberOpen(false)
            setEditingMember(null)
            setMemberToDelete(null)
          }
        }}
      >
        <DialogContent className="max-w-3xl bg-white border-slate-200 text-[#002855] p-6 max-h-[92vh] overflow-y-auto shadow-2xl">
          {(() => {
            const isEditingMatriz = Boolean(matrizId && editingEmpresa?.id === matrizId)
            const currentEditingMembers = editingEmpresa
              ? membros.filter((m) => m.empresa_id === editingEmpresa.id)
              : []
            const unlinkedUsers = allUsers.filter(
              (u) => u.role !== 'master' && !currentEditingMembers.some((m) => m.user_id === u.id),
            )

            return (
              <>
                <DialogHeader className="pb-3 border-b border-slate-100">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-[#002855]">
                        <Building2 className="h-5 w-5 text-[#00A3FF]" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <DialogTitle className="font-heading text-lg font-bold text-[#002855]">
                            {editingEmpresa?.nome_fantasia ||
                              editingEmpresa?.nome_razao_social ||
                              'Gestão da Empresa'}
                          </DialogTitle>
                          {isEditingMatriz && (
                            <Badge className="bg-[#002855] text-white text-[9px] px-2 py-0.5">
                              Matriz Principal
                            </Badge>
                          )}
                        </div>
                        <DialogDescription className="text-xs text-slate-500 mt-0.5">
                          Gestão unificada: dados cadastrais completos, limites operacionais e
                          membros vinculados.
                        </DialogDescription>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className="text-[11px] font-bold border-blue-200 bg-blue-50 text-[#002855] capitalize"
                      >
                        Plano: {editFormData.plano}
                      </Badge>
                      {editFormData.ativa ? (
                        <Badge className="bg-emerald-500 text-white text-[10px] font-bold gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Ativa
                        </Badge>
                      ) : (
                        <Badge className="bg-rose-500 text-white text-[10px] font-bold gap-1">
                          <Lock className="h-3 w-3" /> Bloqueada
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Aviso de Proteção da Matriz */}
                  {isEditingMatriz && (
                    <div className="mt-3 bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-start gap-2.5 text-xs text-blue-900">
                      <ShieldAlert className="h-4 w-4 text-[#00A3FF] shrink-0 mt-0.5" />
                      <div>
                        <strong className="block font-semibold">
                          Matriz Principal do Sistema:
                        </strong>
                        <span>
                          O CNPJ e o plano enterprise ilimitado permanecem protegidos para
                          integridade da plataforma. Os membros vinculados à matriz podem ser
                          gerenciados na aba Membros com preservação do histórico operacional.
                        </span>
                      </div>
                    </div>
                  )}
                </DialogHeader>

                {/* Abas Internas: Dados Cadastrais / Membros */}
                <Tabs
                  value={editActiveTab}
                  onValueChange={(val: any) => setEditActiveTab(val)}
                  className="w-full pt-3"
                >
                  <TabsList className="grid w-full grid-cols-2 bg-slate-100 p-1 rounded-xl h-10">
                    <TabsTrigger
                      value="dados"
                      className="text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-[#002855] data-[state=active]:shadow-xs rounded-lg flex items-center gap-2"
                    >
                      <Building className="h-3.5 w-3.5" />
                      Dados Cadastrais &amp; Limites
                    </TabsTrigger>
                    <TabsTrigger
                      value="membros"
                      className="text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-[#002855] data-[state=active]:shadow-xs rounded-lg flex items-center gap-2"
                    >
                      <Users className="h-3.5 w-3.5" />
                      Membros da Loja ({currentEditingMembers.length})
                    </TabsTrigger>
                  </TabsList>

                  {/* ABA 1: DADOS CADASTRAIS COMPLETOS & LIMITES */}
                  <TabsContent value="dados" className="space-y-4 pt-3 focus-visible:outline-none">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label className="text-xs font-semibold text-slate-700">
                          Razão Social *
                        </Label>
                        <Input
                          required
                          placeholder="Ex: Drogaria Santa Fé Ltda"
                          value={editFormData.nome_razao_social}
                          onChange={(e) =>
                            setEditFormData((p) => ({ ...p, nome_razao_social: e.target.value }))
                          }
                          className="h-9 border-slate-200 text-xs"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-slate-700">
                          Nome Fantasia
                        </Label>
                        <Input
                          placeholder="Ex: Farmácia Santa Fé"
                          value={editFormData.nome_fantasia}
                          onChange={(e) =>
                            setEditFormData((p) => ({ ...p, nome_fantasia: e.target.value }))
                          }
                          className="h-9 border-slate-200 text-xs"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-slate-700">
                          CNPJ {isEditingMatriz && '(Protegido na Matriz)'}
                        </Label>
                        <Input
                          disabled={isEditingMatriz}
                          placeholder="00.000.000/0000-00"
                          value={editFormData.cnpj}
                          onChange={handleEditCnpjChange}
                          maxLength={18}
                          className={`h-9 border-slate-200 text-xs font-mono ${
                            isEditingMatriz ? 'bg-slate-100 cursor-not-allowed opacity-80' : ''
                          } ${editCnpjError ? 'border-rose-500' : ''}`}
                        />
                        {editCnpjError && !isEditingMatriz && (
                          <p className="text-[11px] text-rose-500 flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" /> {editCnpjError}
                          </p>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-slate-700">
                          Telefone / WhatsApp
                        </Label>
                        <Input
                          placeholder="(21) 90000-0000"
                          value={editFormData.telefone}
                          onChange={(e) =>
                            setEditFormData((p) => ({
                              ...p,
                              telefone: formatPhone(e.target.value),
                            }))
                          }
                          maxLength={15}
                          className="h-9 border-slate-200 text-xs"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-slate-700">
                          E-mail Comercial
                        </Label>
                        <Input
                          type="email"
                          placeholder="contato@empresa.com.br"
                          value={editFormData.email}
                          onChange={(e) =>
                            setEditFormData((p) => ({ ...p, email: e.target.value }))
                          }
                          className="h-9 border-slate-200 text-xs"
                        />
                      </div>

                      <div className="space-y-1.5 sm:col-span-2">
                        <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                          <Mail className="h-3.5 w-3.5 text-[#00A3FF]" />
                          E-mail de Notificações (avisos automáticos)
                        </Label>
                        <Input
                          type="email"
                          placeholder="avisos@empresa.com.br"
                          value={editFormData.notifications_email}
                          onChange={(e) =>
                            setEditFormData((p) => ({
                              ...p,
                              notifications_email: e.target.value,
                            }))
                          }
                          className="h-9 border-slate-200 text-xs"
                        />
                        <p className="text-[11px] text-slate-500">
                          E-mail que recebe os avisos automáticos do sistema: alerta de combustível,
                          uso do plano e consumo de créditos.
                        </p>
                      </div>
                    </div>

                    {/* ENDEREÇO COMPLETO */}
                    <div className="border-t border-slate-200 pt-3">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2.5 flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-[#00A3FF]" /> Endereço Base /
                        Operacional
                      </span>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label className="text-xs font-semibold text-slate-700">
                            Logradouro (Rua / Av)
                          </Label>
                          <Input
                            placeholder="Rua das Lojas"
                            value={editFormData.logradouro}
                            onChange={(e) =>
                              setEditFormData((p) => ({ ...p, logradouro: e.target.value }))
                            }
                            className="h-9 border-slate-200 text-xs"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold text-slate-700">Número</Label>
                          <Input
                            placeholder="100"
                            value={editFormData.numero}
                            onChange={(e) =>
                              setEditFormData((p) => ({ ...p, numero: e.target.value }))
                            }
                            className="h-9 border-slate-200 text-xs"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold text-slate-700">Bairro</Label>
                          <Input
                            placeholder="Centro"
                            value={editFormData.bairro}
                            onChange={(e) =>
                              setEditFormData((p) => ({ ...p, bairro: e.target.value }))
                            }
                            className="h-9 border-slate-200 text-xs"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold text-slate-700">Cidade</Label>
                          <Input
                            placeholder="Rio de Janeiro"
                            value={editFormData.cidade}
                            onChange={(e) =>
                              setEditFormData((p) => ({ ...p, cidade: e.target.value }))
                            }
                            className="h-9 border-slate-200 text-xs"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold text-slate-700">UF</Label>
                          <Input
                            placeholder="RJ"
                            value={editFormData.uf}
                            maxLength={2}
                            onChange={(e) =>
                              setEditFormData((p) => ({ ...p, uf: e.target.value.toUpperCase() }))
                            }
                            className="h-9 border-slate-200 text-xs"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold text-slate-700">CEP</Label>
                          <Input
                            placeholder="00000-000"
                            value={editFormData.cep}
                            maxLength={9}
                            onChange={(e) =>
                              setEditFormData((p) => ({ ...p, cep: formatCEP(e.target.value) }))
                            }
                            className="h-9 border-slate-200 text-xs font-mono"
                          />
                        </div>

                        <div className="space-y-1.5 sm:col-span-2">
                          <Label className="text-xs font-semibold text-slate-700">
                            Complemento
                          </Label>
                          <Input
                            placeholder="Sala, Galpão, Bloco..."
                            value={editFormData.complemento}
                            onChange={(e) =>
                              setEditFormData((p) => ({ ...p, complemento: e.target.value }))
                            }
                            className="h-9 border-slate-200 text-xs"
                          />
                        </div>
                      </div>
                    </div>

                    {/* PLANO E LIMITES */}
                    <div className="border-t border-slate-200 pt-3">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[#002855] flex items-center gap-1.5 mb-2.5">
                        <Zap className="h-3.5 w-3.5 text-amber-500" /> Plano Comercial &amp; Limites
                        Operacionais
                      </span>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold text-slate-700">Plano</Label>
                          <Select
                            disabled={isEditingMatriz}
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
                            <SelectTrigger
                              className={`h-9 border-slate-200 text-xs ${
                                isEditingMatriz ? 'bg-slate-100 cursor-not-allowed opacity-80' : ''
                              }`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="basico">Básico (Até 5 usuários)</SelectItem>
                              <SelectItem value="profissional">
                                Profissional (Até 15 usuários)
                              </SelectItem>
                              <SelectItem value="enterprise">Enterprise (Ilimitado)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold text-slate-700">
                            Máx. Usuários
                          </Label>
                          <Input
                            type="number"
                            min="1"
                            disabled={isEditingMatriz}
                            value={editFormData.max_users}
                            onChange={(e) =>
                              setEditFormData((p) => ({ ...p, max_users: Number(e.target.value) }))
                            }
                            className={`h-9 border-slate-200 text-xs ${
                              isEditingMatriz ? 'bg-slate-100 cursor-not-allowed opacity-80' : ''
                            }`}
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold text-slate-700">
                            Máx. Entregadores
                          </Label>
                          <Input
                            type="number"
                            min="1"
                            disabled={isEditingMatriz}
                            value={editFormData.max_couriers}
                            onChange={(e) =>
                              setEditFormData((p) => ({
                                ...p,
                                max_couriers: Number(e.target.value),
                              }))
                            }
                            className={`h-9 border-slate-200 text-xs ${
                              isEditingMatriz ? 'bg-slate-100 cursor-not-allowed opacity-80' : ''
                            }`}
                          />
                        </div>

                        <div className="space-y-1.5 sm:col-span-3">
                          <Label className="text-xs font-semibold text-slate-700">
                            Máx. Pedidos / Mês
                          </Label>
                          <Input
                            type="number"
                            min="1"
                            disabled={isEditingMatriz}
                            value={editFormData.max_orders_month}
                            onChange={(e) =>
                              setEditFormData((p) => ({
                                ...p,
                                max_orders_month: Number(e.target.value),
                              }))
                            }
                            className={`h-9 border-slate-200 text-xs ${
                              isEditingMatriz ? 'bg-slate-100 cursor-not-allowed opacity-80' : ''
                            }`}
                          />
                        </div>
                      </div>

                      {!isEditingMatriz && (
                        <div className="flex items-center gap-2 pt-3">
                          <input
                            type="checkbox"
                            id="edit-empresa-ativa"
                            checked={editFormData.ativa}
                            onChange={(e) =>
                              setEditFormData((p) => ({ ...p, ativa: e.target.checked }))
                            }
                            className="h-4 w-4 rounded border-slate-300 text-[#00A3FF]"
                          />
                          <Label
                            htmlFor="edit-empresa-ativa"
                            className="text-xs font-semibold text-slate-700 cursor-pointer"
                          >
                            Empresa Ativa (permite login e operação comercial de membros e
                            entregadores)
                          </Label>
                        </div>
                      )}
                    </div>

                    <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
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
                        disabled={isSubmitting || !!editCnpjError}
                        className="bg-[#002855] hover:bg-[#001D3D] text-white text-xs font-bold"
                      >
                        {isSubmitting ? 'Salvando...' : 'Salvar Dados Cadastrais'}
                      </Button>
                    </div>
                  </TabsContent>

                  {/* ABA 2: GESTÃO COMPLETA DE MEMBROS */}
                  <TabsContent
                    value="membros"
                    className="space-y-4 pt-3 focus-visible:outline-none"
                  >
                    {/* Header da aba membros com botão de adicionar */}
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
                      <div>
                        <span className="text-xs font-bold text-[#002855] block">
                          Membros Ativos ({currentEditingMembers.length} /{' '}
                          {editingEmpresa?.max_users || 9999} no plano)
                        </span>
                        <p className="text-[11px] text-slate-500">
                          Adicione, edite dados e papéis ou desvincule membros com preservação total
                          de usuários e dados operacionais.
                        </p>
                      </div>

                      <Button
                        size="sm"
                        onClick={() => {
                          setIsEditAddMemberOpen(!isEditAddMemberOpen)
                          setEditingMember(null)
                        }}
                        className="bg-[#00A3FF] hover:bg-[#008CE0] text-white text-xs font-bold gap-1.5 h-8 shrink-0"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {isEditAddMemberOpen ? 'Ver Lista' : 'Adicionar Membro'}
                      </Button>
                    </div>

                    {/* Formulário de Adição de Membro (Criar Novo OU Vincular Existente) */}
                    {isEditAddMemberOpen && (
                      <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 space-y-3.5">
                        <div className="flex items-center justify-between border-b border-blue-200 pb-2">
                          <span className="text-xs font-bold text-[#002855] flex items-center gap-1.5">
                            <UserPlus className="h-4 w-4 text-[#00A3FF]" />
                            {memberAddMode === 'create'
                              ? 'Cadastrar Novo Usuário e Vincular'
                              : 'Vincular Usuário Existente'}
                          </span>

                          <div className="flex items-center gap-1 bg-white p-0.5 rounded-lg border border-blue-200">
                            <button
                              type="button"
                              onClick={() => setMemberAddMode('create')}
                              className={`text-[10px] font-bold px-2.5 py-1 rounded-md transition-all ${
                                memberAddMode === 'create'
                                  ? 'bg-[#002855] text-white shadow-xs'
                                  : 'text-slate-600 hover:text-[#002855]'
                              }`}
                            >
                              Criar Novo
                            </button>
                            <button
                              type="button"
                              onClick={() => setMemberAddMode('link')}
                              className={`text-[10px] font-bold px-2.5 py-1 rounded-md transition-all ${
                                memberAddMode === 'link'
                                  ? 'bg-[#002855] text-white shadow-xs'
                                  : 'text-slate-600 hover:text-[#002855]'
                              }`}
                            >
                              Vincular Existente
                            </button>
                          </div>
                        </div>

                        {memberAddMode === 'create' ? (
                          <form onSubmit={handleAddMemberInEdit} className="space-y-3">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <Label className="text-xs font-semibold text-slate-700">
                                  Nome Completo *
                                </Label>
                                <Input
                                  required
                                  placeholder="Ex: Carlos Silva"
                                  value={editNewMemberForm.name}
                                  onChange={(e) =>
                                    setEditNewMemberForm((p) => ({ ...p, name: e.target.value }))
                                  }
                                  className="h-8 border-slate-200 text-xs bg-white"
                                />
                              </div>

                              <div className="space-y-1">
                                <Label className="text-xs font-semibold text-slate-700">
                                  Papel / Função *
                                </Label>
                                <Select
                                  value={editNewMemberForm.role}
                                  onValueChange={(val: any) =>
                                    setEditNewMemberForm((p) => ({ ...p, role: val }))
                                  }
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
                                  placeholder="carlos@loja.com"
                                  value={editNewMemberForm.email}
                                  onChange={(e) =>
                                    setEditNewMemberForm((p) => ({ ...p, email: e.target.value }))
                                  }
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
                                  value={editNewMemberForm.password}
                                  onChange={(e) =>
                                    setEditNewMemberForm((p) => ({
                                      ...p,
                                      password: e.target.value,
                                    }))
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
                                  value={editNewMemberForm.phone}
                                  onChange={(e) =>
                                    setEditNewMemberForm((p) => ({
                                      ...p,
                                      phone: formatPhone(e.target.value),
                                    }))
                                  }
                                  className="h-8 border-slate-200 text-xs bg-white"
                                />
                              </div>

                              {editNewMemberForm.role === 'courier' && (
                                <>
                                  <div className="space-y-1">
                                    <Label className="text-xs font-semibold text-slate-700">
                                      Tipo de Veículo
                                    </Label>
                                    <Select
                                      value={editNewMemberForm.vehicle_type}
                                      onValueChange={(val) =>
                                        setEditNewMemberForm((p) => ({ ...p, vehicle_type: val }))
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
                                      value={editNewMemberForm.vehicle_plate}
                                      onChange={(e) =>
                                        setEditNewMemberForm((p) => ({
                                          ...p,
                                          vehicle_plate: e.target.value.toUpperCase(),
                                        }))
                                      }
                                      className="h-8 border-slate-200 text-xs bg-white font-mono"
                                    />
                                  </div>
                                </>
                              )}
                            </div>

                            <div className="flex justify-end gap-2 pt-2 border-t border-blue-200">
                              <Button
                                type="button"
                                variant="ghost"
                                onClick={() => setIsEditAddMemberOpen(false)}
                                className="h-8 text-xs text-slate-600"
                              >
                                Cancelar
                              </Button>
                              <Button
                                type="submit"
                                disabled={isAddingMemberInEdit}
                                className="h-8 text-xs bg-[#002855] hover:bg-[#001D3D] text-white font-bold"
                              >
                                {isAddingMemberInEdit
                                  ? 'Criando...'
                                  : 'Cadastrar e Vincular Membro'}
                              </Button>
                            </div>
                          </form>
                        ) : (
                          <form onSubmit={handleAddMemberInEdit} className="space-y-3">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div className="space-y-1 sm:col-span-2">
                                <Label className="text-xs font-semibold text-slate-700">
                                  Selecione o Usuário Cadastrado *
                                </Label>
                                <Select
                                  value={selectedExistingUserId}
                                  onValueChange={(val) => setSelectedExistingUserId(val)}
                                >
                                  <SelectTrigger className="h-9 border-slate-200 text-xs bg-white">
                                    <SelectValue placeholder="Selecione um usuário existente..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {unlinkedUsers.map((u) => (
                                      <SelectItem key={u.id} value={u.id}>
                                        {u.name || 'Sem Nome'} — {u.email} ({u.role || 'sem cargo'})
                                      </SelectItem>
                                    ))}
                                    {unlinkedUsers.length === 0 && (
                                      <div className="p-2 text-center text-xs text-slate-400">
                                        Nenhum usuário livre encontrado.
                                      </div>
                                    )}
                                  </SelectContent>
                                </Select>
                              </div>

                              <div className="space-y-1 sm:col-span-2">
                                <Label className="text-xs font-semibold text-slate-700">
                                  Papel nesta Empresa *
                                </Label>
                                <Select
                                  value={existingUserRole}
                                  onValueChange={(val: any) => setExistingUserRole(val)}
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
                            </div>

                            <div className="flex justify-end gap-2 pt-2 border-t border-blue-200">
                              <Button
                                type="button"
                                variant="ghost"
                                onClick={() => setIsEditAddMemberOpen(false)}
                                className="h-8 text-xs text-slate-600"
                              >
                                Cancelar
                              </Button>
                              <Button
                                type="submit"
                                disabled={isAddingMemberInEdit || !selectedExistingUserId}
                                className="h-8 text-xs bg-[#002855] hover:bg-[#001D3D] text-white font-bold"
                              >
                                {isAddingMemberInEdit ? 'Vinculando...' : 'Vincular à Empresa'}
                              </Button>
                            </div>
                          </form>
                        )}
                      </div>
                    )}

                    {/* Formulário de Edição do Membro Selecionado */}
                    {editingMember && (
                      <form
                        onSubmit={handleSaveMemberEdit}
                        className="rounded-xl border border-amber-300 bg-amber-50/50 p-4 space-y-3"
                      >
                        <div className="flex items-center justify-between border-b border-amber-200 pb-2">
                          <span className="text-xs font-bold text-[#002855] flex items-center gap-1.5">
                            <Edit2 className="h-3.5 w-3.5 text-amber-600" />
                            Editar Membro:{' '}
                            <strong>{editingMember.name || editingMember.email}</strong>
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingMember(null)}
                            className="h-7 text-xs text-slate-500 hover:text-slate-800"
                          >
                            Fechar Edição
                          </Button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs font-semibold text-slate-700">Nome</Label>
                            <Input
                              required
                              value={editingMember.name}
                              onChange={(e) =>
                                setEditingMember((p) => (p ? { ...p, name: e.target.value } : null))
                              }
                              className="h-8 border-slate-200 text-xs bg-white"
                            />
                          </div>

                          <div className="space-y-1">
                            <Label className="text-xs font-semibold text-slate-700">
                              Papel / Função *
                            </Label>
                            <Select
                              value={editingMember.role}
                              onValueChange={(val: any) =>
                                setEditingMember((p) => (p ? { ...p, role: val } : null))
                              }
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
                              WhatsApp / Telefone
                            </Label>
                            <Input
                              value={editingMember.phone}
                              onChange={(e) =>
                                setEditingMember((p) =>
                                  p ? { ...p, phone: formatPhone(e.target.value) } : null,
                                )
                              }
                              className="h-8 border-slate-200 text-xs bg-white"
                            />
                          </div>

                          <div className="space-y-1">
                            <Label className="text-xs font-semibold text-slate-700">
                              E-mail (Login)
                            </Label>
                            <Input
                              disabled
                              value={editingMember.email}
                              className="h-8 border-slate-200 text-xs bg-slate-100 cursor-not-allowed text-slate-500"
                            />
                          </div>

                          {editingMember.role === 'courier' && (
                            <>
                              <div className="space-y-1">
                                <Label className="text-xs font-semibold text-slate-700">
                                  Tipo de Veículo
                                </Label>
                                <Select
                                  value={editingMember.vehicle_type || 'moto'}
                                  onValueChange={(val) =>
                                    setEditingMember((p) =>
                                      p ? { ...p, vehicle_type: val } : null,
                                    )
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
                                  Placa
                                </Label>
                                <Input
                                  placeholder="ABC1D23"
                                  value={editingMember.vehicle_plate || ''}
                                  onChange={(e) =>
                                    setEditingMember((p) =>
                                      p
                                        ? { ...p, vehicle_plate: e.target.value.toUpperCase() }
                                        : null,
                                    )
                                  }
                                  className="h-8 border-slate-200 text-xs bg-white font-mono"
                                />
                              </div>
                            </>
                          )}
                        </div>

                        <div className="flex justify-end gap-2 pt-2 border-t border-amber-200">
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setEditingMember(null)}
                            className="h-8 text-xs text-slate-600"
                          >
                            Cancelar
                          </Button>
                          <Button
                            type="submit"
                            disabled={isSavingMemberEdit}
                            className="h-8 text-xs bg-[#002855] hover:bg-[#001D3D] text-white font-bold"
                          >
                            {isSavingMemberEdit ? 'Salvando...' : 'Salvar Dados do Membro'}
                          </Button>
                        </div>
                      </form>
                    )}

                    {/* Lista de Membros da Empresa */}
                    <div className="space-y-2">
                      <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl bg-white overflow-hidden max-h-72 overflow-y-auto">
                        {currentEditingMembers.map((m) => {
                          const usr = allUsers.find((u) => u.id === m.user_id)
                          const roleLabel = m.papel || usr?.role || 'membro'

                          return (
                            <div
                              key={m.id}
                              className="p-3.5 flex items-center justify-between gap-3 text-xs hover:bg-slate-50/70 transition-colors"
                            >
                              <div className="flex items-center gap-3">
                                <div className="h-8 w-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-[#002855] font-bold text-xs uppercase">
                                  {usr?.name ? usr.name.slice(0, 2) : 'US'}
                                </div>
                                <div>
                                  <p className="font-bold text-[#002855] flex items-center gap-2">
                                    <span>{usr?.name || 'Usuário Rotaly'}</span>
                                    {usr?.role === 'master' && (
                                      <Badge className="bg-amber-500 text-white text-[9px] px-1 py-0 h-4">
                                        Master
                                      </Badge>
                                    )}
                                  </p>
                                  <p className="text-[11px] text-slate-500">{usr?.email}</p>
                                  <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                                    {usr?.phone && <span>{usr.phone}</span>}
                                    {usr?.vehicle_type && (
                                      <span>
                                        • Veículo: {usr.vehicle_type}{' '}
                                        {usr?.vehicle_plate ? `(${usr.vehicle_plate})` : ''}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-2">
                                <Badge
                                  variant="outline"
                                  className="text-[10px] border-slate-200 text-slate-700 capitalize bg-slate-50 font-medium"
                                >
                                  {roleLabel}
                                </Badge>

                                {isMaster && (
                                  <>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => {
                                        setIsEditAddMemberOpen(false)
                                        handleOpenEditMember(m)
                                      }}
                                      className="h-7 w-7 text-slate-500 hover:text-[#002855] hover:bg-slate-200 rounded-lg"
                                      title="Editar papel e dados do membro"
                                    >
                                      <Edit2 className="h-3.5 w-3.5" />
                                    </Button>

                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={() =>
                                        requestDeleteMemberLink({
                                          membroId: m.id,
                                          userId: m.user_id,
                                          userName: usr?.name || usr?.email || 'Membro',
                                          userRole: roleLabel,
                                          empresaId: editingEmpresa.id,
                                          companyName:
                                            editingEmpresa.nome_fantasia ||
                                            editingEmpresa.nome_razao_social ||
                                            'Empresa',
                                        })
                                      }
                                      className="h-7 w-7 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg"
                                      title="Excluir vínculo do membro com esta empresa"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>
                          )
                        })}

                        {currentEditingMembers.length === 0 && (
                          <div className="p-8 text-center text-xs text-slate-400">
                            Nenhum membro vinculado a esta empresa ainda. Clique em "Adicionar
                            Membro" acima para cadastrar.
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-200 flex justify-end">
                      <Button
                        type="button"
                        onClick={() => setEditingEmpresa(null)}
                        className="border-slate-200 bg-slate-100 hover:bg-slate-200 text-[#002855] text-xs font-semibold"
                      >
                        Fechar
                      </Button>
                    </div>
                  </TabsContent>
                </Tabs>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* Confirmação de Exclusão de Vínculo de Membro */}
      <Dialog open={!!memberToDelete} onOpenChange={(open) => !open && setMemberToDelete(null)}>
        <DialogContent className="max-w-md bg-white border-slate-200 text-[#002855] p-6 shadow-xl">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="h-10 w-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="font-heading text-lg font-bold text-rose-700">
                  Desvincular Membro da Loja?
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500">
                  {memberToDelete?.userName} ({memberToDelete?.userRole})
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="py-2 text-xs text-slate-600 space-y-2">
            <p className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-slate-700">
              Esta ação removerá o <strong>vínculo deste usuário com a empresa atual</strong>.
            </p>
            <p className="text-slate-500 text-[11px]">
              O cadastro do usuário em si e seu histórico de rotas, entregas e pedidos são{' '}
              <strong>preservados intactos</strong> no banco de dados.
            </p>
          </div>

          <DialogFooter className="pt-3 border-t border-slate-200 flex sm:justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isDeletingMemberLink}
              onClick={() => setMemberToDelete(null)}
              className="text-xs"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={isDeletingMemberLink}
              onClick={handleConfirmDeleteMemberLink}
              className="text-xs font-bold text-white bg-rose-600 hover:bg-rose-700"
            >
              {isDeletingMemberLink ? 'Desvinculando...' : 'Confirmar Desvinculação'}
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
                            <div className="flex items-center gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => {
                                  // Abre a edição do membro transferindo para o modal de edição ou abrindo edição direta
                                  const targetEmp = empresas.find(
                                    (e) => e.id === selectedEmpresaForMembers?.id,
                                  )
                                  if (targetEmp) {
                                    setSelectedEmpresaForMembers(null)
                                    setEditingEmpresa(targetEmp)
                                    setEditActiveTab('membros')
                                    handleOpenEditMember(m)
                                  }
                                }}
                                className="h-7 w-7 text-slate-500 hover:text-[#002855] hover:bg-slate-200 rounded-lg"
                                title="Editar membro"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => handleRemoveMember(m.id)}
                                className="h-7 w-7 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg"
                                title="Desvincular membro"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
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

      {/* Modal de Confirmação: Bloquear / Desbloquear Empresa */}
      <Dialog
        open={!!toggleStatusTarget}
        onOpenChange={(open) => !open && setToggleStatusTarget(null)}
      >
        <DialogContent className="max-w-md bg-white border-slate-200 text-[#002855] p-6 shadow-xl">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div
                className={`h-10 w-10 rounded-xl flex items-center justify-center ${
                  toggleStatusTarget?.ativa !== false
                    ? 'bg-amber-100 text-amber-600'
                    : 'bg-emerald-100 text-emerald-600'
                }`}
              >
                {toggleStatusTarget?.ativa !== false ? (
                  <Lock className="h-5 w-5" />
                ) : (
                  <Unlock className="h-5 w-5" />
                )}
              </div>
              <div>
                <DialogTitle className="font-heading text-lg font-bold text-[#002855]">
                  {toggleStatusTarget?.ativa !== false
                    ? 'Bloquear Empresa?'
                    : 'Desbloquear Empresa?'}
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500">
                  {toggleStatusTarget?.nome_fantasia || toggleStatusTarget?.nome_razao_social}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="py-3 text-xs text-slate-600 space-y-2.5">
            {toggleStatusTarget?.ativa !== false ? (
              <>
                <p className="font-medium text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <strong>Atenção:</strong> Esta ação bloqueia imediatamente o acesso da loja ao
                  sistema. Todos os membros, vendedores e entregadores associados ficarão impedidos
                  de entrar e criar pedidos.
                </p>
                <p className="text-slate-500">
                  Os dados e o histórico de pedidos permanecem seguros e você poderá desbloquear
                  esta empresa a qualquer momento.
                </p>
              </>
            ) : (
              <>
                <p className="font-medium text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                  <strong>Reativação:</strong> Ao desbloquear a empresa, os membros e
                  administradores voltam a ter permissão para acessar o painel, despachar rotas e
                  criar novos pedidos normalmente.
                </p>
                <p className="text-slate-500">
                  Deseja realmente reativar o acesso de{' '}
                  <strong>
                    {toggleStatusTarget?.nome_fantasia || toggleStatusTarget?.nome_razao_social}
                  </strong>
                  ?
                </p>
              </>
            )}
          </div>

          <DialogFooter className="pt-3 border-t border-slate-200 flex sm:justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isTogglingStatus}
              onClick={() => setToggleStatusTarget(null)}
              className="text-xs"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={isTogglingStatus}
              onClick={handleConfirmToggleStatus}
              className={`text-xs font-bold text-white ${
                toggleStatusTarget?.ativa !== false
                  ? 'bg-amber-600 hover:bg-amber-700'
                  : 'bg-emerald-600 hover:bg-emerald-700'
              }`}
            >
              {isTogglingStatus ? (
                'Processando...'
              ) : toggleStatusTarget?.ativa !== false ? (
                <>
                  <Lock className="h-3.5 w-3.5 mr-1.5" />
                  Confirmar Bloqueio
                </>
              ) : (
                <>
                  <Unlock className="h-3.5 w-3.5 mr-1.5" />
                  Confirmar Desbloqueio
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de Exclusão de Empresa (com confirmação explícita por digitação do nome) */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
            setDeleteConfirmationText('')
          }
        }}
      >
        <DialogContent className="max-w-md bg-white border-slate-200 text-[#002855] p-6 shadow-xl">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="h-10 w-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="font-heading text-lg font-bold text-rose-700">
                  Excluir Empresa Definitivamente
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500">
                  Ação crítica e irreversível para o inquilino SaaS.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="py-2 space-y-3 text-xs text-slate-600">
            <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-rose-900 space-y-1.5">
              <p className="font-bold flex items-center gap-1.5">
                <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
                Você está prestes a excluir a empresa:
              </p>
              <p className="font-semibold text-rose-950 text-sm">
                "{deleteTarget?.nome_fantasia || deleteTarget?.nome_razao_social}"
              </p>
              <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-rose-800">
                <li>Os vínculos de membros e colaboradores desta empresa serão removidos.</li>
                <li>Os endereços base desta loja serão desvinculados.</li>
                <li>
                  Caso deseje apenas suspender o acesso temporariamente sem perder históricos,
                  recomendamos a opção <strong>Bloquear Empresa</strong>.
                </li>
              </ul>
            </div>

            <div className="space-y-1.5 pt-1">
              <Label className="text-xs font-semibold text-slate-700">
                Digite exatamente{' '}
                <strong className="text-rose-700 select-all font-mono">
                  {deleteTarget?.nome_fantasia || deleteTarget?.nome_razao_social}
                </strong>{' '}
                para confirmar:
              </Label>
              <Input
                placeholder="Nome da empresa"
                value={deleteConfirmationText}
                onChange={(e) => setDeleteConfirmationText(e.target.value)}
                className="h-9 border-slate-300 text-xs font-medium focus:border-rose-500"
                autoFocus
              />
            </div>
          </div>

          <DialogFooter className="pt-3 border-t border-slate-200 flex sm:justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isDeleting}
              onClick={() => {
                setDeleteTarget(null)
                setDeleteConfirmationText('')
              }}
              className="text-xs"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={
                isDeleting ||
                deleteConfirmationText.trim().toLowerCase() !==
                  (deleteTarget?.nome_fantasia || deleteTarget?.nome_razao_social || '')
                    .trim()
                    .toLowerCase()
              }
              onClick={handleConfirmDelete}
              className="text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 gap-1.5"
            >
              {isDeleting ? (
                'Excluindo...'
              ) : (
                <>
                  <Trash2 className="h-3.5 w-3.5" />
                  Excluir Empresa
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default CompaniesPage

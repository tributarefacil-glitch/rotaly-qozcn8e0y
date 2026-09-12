import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import pb from '@/lib/pocketbase/client'
import type { EmpresaRecord, MembroRecord } from '@/types/delivery'
import { useAuth } from './AuthContext'

interface CompanyContextType {
  currentCompany: EmpresaRecord | null
  currentMember: MembroRecord | null
  allCompanies: EmpresaRecord[]
  isLoadingCompany: boolean
  setCurrentCompany: (company: EmpresaRecord) => void
  refreshCompanyData: () => Promise<void>
  hasMultiCompanyAccess: boolean
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined)

const STORAGE_KEY = 'rotaly_active_empresa_id'

export const CompanyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth()
  const [currentCompany, setCurrentCompanyState] = useState<EmpresaRecord | null>(null)
  const [currentMember, setCurrentMember] = useState<MembroRecord | null>(null)
  const [allCompanies, setAllCompanies] = useState<EmpresaRecord[]>([])
  const [isLoadingCompany, setIsLoadingCompany] = useState(true)

  const loadCompanyContext = useCallback(async () => {
    if (!isAuthenticated || !user) {
      setCurrentCompanyState(null)
      setCurrentMember(null)
      setAllCompanies([])
      setIsLoadingCompany(false)
      return
    }

    setIsLoadingCompany(true)
    try {
      // 1. Carregar lista de membros vinculados a este usuário
      const memberRecords = await pb
        .collection<MembroRecord>('membros')
        .getFullList({
          filter: `user_id = '${user.id}' && ativo = true`,
          expand: 'empresa_id',
          sort: '-created',
          requestKey: null,
        })
        .catch((e) => {
          console.warn('Erro ao consultar membros do usuário:', e)
          return [] as MembroRecord[]
        })

      // 2. Se for admin do sistema, buscar também todas as empresas cadastradas
      let companiesList: EmpresaRecord[] = []
      if (user.role === 'admin') {
        companiesList = await pb
          .collection<EmpresaRecord>('empresas')
          .getFullList({
            sort: 'nome_razao_social',
            requestKey: null,
          })
          .catch(() => [])
      } else {
        // Para seller ou courier, empresas são as que ele é membro ativo
        companiesList = memberRecords
          .map((m) => (m.expand?.empresa_id as EmpresaRecord) || null)
          .filter(Boolean) as EmpresaRecord[]
      }

      setAllCompanies(companiesList)

      // 3. Identificar se o usuário já tinha uma empresa selecionada em localStorage
      const savedCompanyId = localStorage.getItem(STORAGE_KEY)
      let resolvedCompany: EmpresaRecord | null = null
      let resolvedMember: MembroRecord | null = null

      // Validar contra a lista de empresas existentes e ativas
      if (savedCompanyId && savedCompanyId !== 'undefined' && savedCompanyId !== 'null') {
        resolvedCompany =
          companiesList.find((c) => c.id === savedCompanyId && c.ativa !== false) || null
      }

      // Se o ID salvo for inválido ou não existir na lista, limpar o storage imediatamente
      if (savedCompanyId && !resolvedCompany) {
        localStorage.removeItem(STORAGE_KEY)
      }

      // Se não encontrou pelo storage, priorizar a empresa vinculada via membros
      // Para admin, priorizar a Matriz se disponível, ou o primeiro membro ativo
      if (!resolvedCompany && memberRecords.length > 0) {
        // Tentar encontrar membro com a Matriz primeiro
        const matrizMember = memberRecords.find((m) => m.empresa_id === '7wo05iyvfcfh01h')
        resolvedMember = matrizMember || memberRecords[0]
        if (resolvedMember.expand?.empresa_id) {
          resolvedCompany = resolvedMember.expand.empresa_id
        } else {
          // Buscar empresa diretamente caso o expand não tenha vindo
          try {
            resolvedCompany = await pb
              .collection<EmpresaRecord>('empresas')
              .getOne(resolvedMember.empresa_id)
          } catch {
            /* intentionally ignored */
          }
        }
      }

      // Se ainda não encontrou e for admin, priorizar a Matriz em companiesList
      if (!resolvedCompany && companiesList.length > 0) {
        const matriz = companiesList.find((c) => c.id === '7wo05iyvfcfh01h')
        resolvedCompany = matriz || companiesList[0]
      }

      // 4. FALLBACK SEGURO: se o usuário não tiver NENHUM membro nem empresa cadastrada,
      // busca a "Empresa Principal" / primeira empresa cadastrada no banco para NUNCA travar a tela
      if (!resolvedCompany) {
        try {
          const fallbackList = await pb.collection<EmpresaRecord>('empresas').getList(1, 1, {
            sort: 'created',
            requestKey: null,
          })
          if (fallbackList.items.length > 0) {
            resolvedCompany = fallbackList.items[0]
            // Criar vínculo de membro em background para persistir retrocompatibilidade
            try {
              const newMember = await pb.collection<MembroRecord>('membros').create({
                empresa_id: resolvedCompany.id,
                user_id: user.id,
                papel:
                  user.role === 'admin'
                    ? 'admin'
                    : user.role === 'courier'
                      ? 'entregador'
                      : 'vendedor',
                ativo: true,
              })
              resolvedMember = newMember
            } catch {
              /* intentionally ignored */
            }
          }
        } catch (errFallback) {
          console.warn('Fallback empresas lookup falhou:', errFallback)
        }
      }

      // Resolver o membro correspondente à empresa ativa
      if (resolvedCompany && !resolvedMember) {
        resolvedMember = memberRecords.find((m) => m.empresa_id === resolvedCompany?.id) || null
      }

      if (resolvedCompany) {
        localStorage.setItem(STORAGE_KEY, resolvedCompany.id)
      }

      setCurrentCompanyState(resolvedCompany)
      setCurrentMember(resolvedMember)
    } catch (err) {
      console.error('Falha ao resolver contexto de empresa:', err)
    } finally {
      setIsLoadingCompany(false)
    }
  }, [user, isAuthenticated])

  useEffect(() => {
    if (!authLoading) {
      loadCompanyContext()
    }
  }, [authLoading, loadCompanyContext])

  const setCurrentCompany = (company: EmpresaRecord) => {
    setCurrentCompanyState(company)
    localStorage.setItem(STORAGE_KEY, company.id)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('rotaly_company_changed', {
          detail: { companyId: company.id, company },
        }),
      )
    }
  }

  const hasMultiCompanyAccess = user?.role === 'admin' || allCompanies.length > 1

  return (
    <CompanyContext.Provider
      value={{
        currentCompany,
        currentMember,
        allCompanies,
        isLoadingCompany: authLoading || isLoadingCompany,
        setCurrentCompany,
        refreshCompanyData: loadCompanyContext,
        hasMultiCompanyAccess,
      }}
    >
      {children}
    </CompanyContext.Provider>
  )
}

export const useCompany = () => {
  const context = useContext(CompanyContext)
  if (!context) {
    throw new Error('useCompany must be used within a CompanyProvider')
  }
  return context
}

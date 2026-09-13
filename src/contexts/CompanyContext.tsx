import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import pb from '@/lib/pocketbase/client'
import type { EmpresaRecord, MembroRecord } from '@/types/delivery'
import { useAuth } from './AuthContext'
import { getMyCompany, clearCompanyCache } from '@/lib/companyResolver'

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
      // 1. Fonte única de verdade síncrona/banco via getMyCompany
      const resolved = await getMyCompany()

      // 2. Carregar lista de membros vinculados a este usuário
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

      // 3. Se for admin do sistema, buscar todas as empresas para o seletor
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
        companiesList = memberRecords
          .map((m) => (m.expand?.empresa_id as EmpresaRecord) || null)
          .filter(Boolean) as EmpresaRecord[]
      }

      // Buscar o registro completo da empresa resolvida
      let resolvedCompany: EmpresaRecord | null =
        companiesList.find((c) => c.id === resolved.id) || null

      if (!resolvedCompany) {
        try {
          resolvedCompany = await pb.collection<EmpresaRecord>('empresas').getOne(resolved.id, {
            requestKey: null,
          })
        } catch {
          // Fallback mínimo para garantir objeto de empresa válido
          resolvedCompany = {
            id: resolved.id,
            nome_razao_social: resolved.name,
            nome_fantasia: resolved.name,
            cnpj: '',
            telefone: '',
            email: '',
            cep: '',
            logradouro: '',
            numero: '',
            bairro: '',
            cidade: 'Duque de Caxias',
            estado: 'RJ',
            ativa: true,
            created: '',
            updated: '',
            collectionId: 'empresas',
            collectionName: 'empresas',
          }
        }
      }

      if (!companiesList.some((c) => c.id === resolvedCompany?.id) && resolvedCompany) {
        companiesList.unshift(resolvedCompany)
      }
      setAllCompanies(companiesList)

      let resolvedMember = memberRecords.find((m) => m.empresa_id === resolvedCompany?.id) || null
      if (!resolvedMember && memberRecords.length > 0) {
        resolvedMember = memberRecords[0]
      }

      if (resolvedCompany) {
        localStorage.setItem(STORAGE_KEY, resolvedCompany.id)
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('rotaly_company_changed', {
              detail: { companyId: resolvedCompany.id, company: resolvedCompany },
            }),
          )
        }
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
    clearCompanyCache()
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

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import pb from '@/lib/pocketbase/client'
import type { EmpresaRecord, MembroRecord } from '@/types/delivery'
import { useAuth } from './AuthContext'
import { getMyCompany, clearCompanyCache, MATRIZ_EMPRESA_ID } from '@/lib/companyResolver'

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
      // 1. Fonte única de verdade: Matriz Rotaly Operações
      const resolved = await getMyCompany()

      let resolvedCompany: EmpresaRecord | null = null
      try {
        resolvedCompany = await pb.collection<EmpresaRecord>('empresas').getOne(resolved.id, {
          requestKey: null,
        })
      } catch {
        resolvedCompany = {
          id: MATRIZ_EMPRESA_ID,
          nome_razao_social: 'Rotaly Logística Matriz',
          nome_fantasia: 'Rotaly Operações',
          cnpj: '34.567.890/0001-22',
          telefone: '(21) 96428-2954',
          email: 'tributarefacil@gmail.com',
          cep: '25020-210',
          logradouro: 'Rua Manuel Vieira',
          numero: '196',
          bairro: 'Centro',
          cidade: 'Duque de Caxias',
          estado: 'RJ',
          ativa: true,
          created: '',
          updated: '',
          collectionId: 'empresas',
          collectionName: 'empresas',
        }
      }

      // 2. Carregar vínculo de membro
      const memberRecords = await pb
        .collection<MembroRecord>('membros')
        .getFullList({
          filter: `user_id = '${user.id}'`,
          sort: '-created',
          requestKey: null,
        })
        .catch(() => [] as MembroRecord[])

      const resolvedMember = memberRecords[0] || null

      setAllCompanies(resolvedCompany ? [resolvedCompany] : [])
      setCurrentCompanyState(resolvedCompany)
      setCurrentMember(resolvedMember)

      localStorage.setItem(STORAGE_KEY, MATRIZ_EMPRESA_ID)
      if (typeof window !== 'undefined' && resolvedCompany) {
        window.dispatchEvent(
          new CustomEvent('rotaly_company_changed', {
            detail: { companyId: MATRIZ_EMPRESA_ID, company: resolvedCompany },
          }),
        )
      }
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

  // No modo empresa única, desativamos o multiCompanyAccess para impedir trocas
  const hasMultiCompanyAccess = false

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

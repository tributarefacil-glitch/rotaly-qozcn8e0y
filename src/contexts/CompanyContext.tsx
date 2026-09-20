import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import pb from '@/lib/pocketbase/client'
import type { EmpresaRecord, MembroRecord } from '@/types/delivery'
import { useAuth } from './AuthContext'
import { getMyCompany, clearCompanyCache, resolveMatrizCompany } from '@/lib/companyResolver'

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
      clearCompanyCache()
      setCurrentCompanyState(null)
      setCurrentMember(null)
      setAllCompanies([])
      setIsLoadingCompany(false)
      if (typeof window !== 'undefined') {
        localStorage.removeItem(STORAGE_KEY)
        localStorage.removeItem('rotaly_active_company')
        localStorage.removeItem('rotaly_empresa_id')
      }
      return
    }

    setIsLoadingCompany(true)
    try {
      const isMaster = user.role === 'master'

      // Se for master, carregar todas as empresas cadastradas no sistema
      let loadedCompanies: EmpresaRecord[] = []
      if (isMaster) {
        try {
          loadedCompanies = await pb.collection<EmpresaRecord>('empresas').getFullList({
            sort: 'nome_razao_social',
            requestKey: null,
          })
          setAllCompanies(loadedCompanies)
        } catch (err) {
          console.warn('Erro ao carregar lista de empresas para Master:', err)
        }
      }

      // Resolver empresa ativa
      const resolved = await getMyCompany()

      let resolvedCompany: EmpresaRecord | null = null
      if (resolved.id) {
        try {
          resolvedCompany = await pb.collection<EmpresaRecord>('empresas').getOne(resolved.id, {
            requestKey: null,
          })
        } catch {
          resolvedCompany = null
        }
      }

      // Se a empresa selecionada não pôde ser recuperada ou está inativa, recai na matriz dinamicamente
      if (!resolvedCompany || resolvedCompany.ativa === false) {
        const matriz = await resolveMatrizCompany()
        if (matriz) {
          resolvedCompany = matriz
        } else if (loadedCompanies.length > 0) {
          resolvedCompany = loadedCompanies[0]
        }
      }

      // Carregar vínculo de membro
      const memberRecords = await pb
        .collection<MembroRecord>('membros')
        .getFullList({
          filter: `user_id = '${user.id}'`,
          sort: '-created',
          requestKey: null,
        })
        .catch(() => [] as MembroRecord[])

      const resolvedMember =
        memberRecords.find((m) => m.empresa_id === resolved.id) || memberRecords[0] || null

      if (!isMaster) {
        setAllCompanies(resolvedCompany ? [resolvedCompany] : [])
      }
      setCurrentCompanyState(resolvedCompany)
      setCurrentMember(resolvedMember)

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

  // Apenas o Administrador Master tem acesso para alternar entre empresas
  const hasMultiCompanyAccess = user?.role === 'master'

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

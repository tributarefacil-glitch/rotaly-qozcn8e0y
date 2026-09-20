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
      try {
        resolvedCompany = await pb.collection<EmpresaRecord>('empresas').getOne(resolved.id, {
          requestKey: null,
        })
      } catch {
        resolvedCompany = loadedCompanies.find((c) => c.id === resolved.id) || {
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
          plano: 'enterprise',
          created: '',
          updated: '',
          collectionId: 'empresas',
          collectionName: 'empresas',
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

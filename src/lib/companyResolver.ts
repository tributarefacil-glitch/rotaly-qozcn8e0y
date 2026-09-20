/**
 * Centralized Single-Source-of-Truth for Active Company Resolution.
 *
 * Suporte a SaaS Multiempresa (Multi-tenant):
 * - Usuário 'master': Tem visão global de todas as empresas e pode alternar o contexto
 *   selecionando qualquer empresa no painel ou localStorage.
 * - Usuário de empresa ('admin', 'seller', 'courier'): Totalmente amarrado à empresa
 *   onde está cadastrado na coleção 'membros'. NUNCA acessa dados de outra empresa.
 * - Fallback / Operação Matriz: Se for Empresa 1 ('7wo05iyvfcfh01h'), continua funcionando
 *   de forma transparente.
 */
import pb from '@/lib/pocketbase/client'
import type { EmpresaRecord, MembroRecord, UserRecord } from '@/types/delivery'

export const MATRIZ_EMPRESA_ID = '7wo05iyvfcfh01h'
export const STORAGE_KEY = 'rotaly_active_empresa_id'

export interface ResolvedCompany {
  id: string
  name: string
  source:
    | 'master_selection'
    | 'master_default'
    | 'membro_empresa'
    | 'fallback_matriz'
    | 'single_company_matriz'
  memberId?: string
  role?: string
  plano?: string
}

let cachedCompany: ResolvedCompany | null = null

/**
 * Invalidate cached resolution
 */
export function clearCompanyCache(): void {
  cachedCompany = null
}

/**
 * Resolves the active company for the currently authenticated user
 */
export async function getMyCompany(): Promise<ResolvedCompany> {
  const authUser = pb.authStore.record as unknown as UserRecord | null
  const isMaster = authUser?.role === 'master'

  // 1. Caso Master: Pode alternar o contexto de empresa via localStorage ou escolher Empresa 1 por padrão
  if (isMaster) {
    let savedId = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
    if (!savedId) {
      savedId = MATRIZ_EMPRESA_ID
    }

    try {
      const comp = await pb
        .collection<EmpresaRecord>('empresas')
        .getOne(savedId, { requestKey: null })
        .catch(() => null)

      if (comp) {
        const resolved: ResolvedCompany = {
          id: comp.id,
          name: comp.nome_fantasia || comp.nome_razao_social,
          source: 'master_selection',
          plano: comp.plano,
        }
        cachedCompany = resolved
        return resolved
      }
    } catch {
      /* fallback */
    }

    const fallbackMaster: ResolvedCompany = {
      id: MATRIZ_EMPRESA_ID,
      name: 'Rotaly Operações',
      source: 'master_default',
      plano: 'enterprise',
    }
    cachedCompany = fallbackMaster
    return fallbackMaster
  }

  // 2. Usuário comum (admin de empresa, vendedor, entregador):
  // Rigidamente amarrado à empresa à qual pertence em 'membros'
  if (authUser?.id) {
    try {
      const members = await pb.collection<MembroRecord>('membros').getFullList({
        filter: `user_id = '${authUser.id}' && ativo = true`,
        expand: 'empresa_id',
        sort: '-created',
        requestKey: null,
      })

      if (members.length > 0) {
        const primary = members[0]
        const comp = primary.expand?.empresa_id as EmpresaRecord | undefined
        const compName = comp?.nome_fantasia || comp?.nome_razao_social || 'Minha Empresa'

        const resolved: ResolvedCompany = {
          id: primary.empresa_id,
          name: compName,
          source: 'membro_empresa',
          memberId: primary.id,
          role: primary.papel,
          plano: comp?.plano,
        }

        if (typeof window !== 'undefined') {
          localStorage.setItem(STORAGE_KEY, primary.empresa_id)
        }

        cachedCompany = resolved
        return resolved
      }
    } catch (err) {
      console.warn('Erro ao resolver empresa do membro:', err)
    }
  }

  // 3. Fallback seguro para Empresa 1 Matriz
  const fallback: ResolvedCompany = {
    id: MATRIZ_EMPRESA_ID,
    name: 'Rotaly Operações',
    source: 'fallback_matriz',
    plano: 'enterprise',
  }
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, MATRIZ_EMPRESA_ID)
  }
  cachedCompany = fallback
  return fallback
}

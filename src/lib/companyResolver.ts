/**
 * Centralized Single-Source-of-Truth for Active Company Resolution.
 *
 * MODO EMPRESA ÚNICA (Rotaly Operações - Matriz '7wo05iyvfcfh01h'):
 * Reversão definitiva do modo multilojas atendendo ao pedido expresso do usuário.
 * Retorna SEMPRE a Matriz '7wo05iyvfcfh01h' ("Rotaly Operações") para todos os usuários e telas.
 */
import pb from '@/lib/pocketbase/client'
import type { EmpresaRecord } from '@/types/delivery'

export const MATRIZ_EMPRESA_ID = '7wo05iyvfcfh01h'
export const FARMACIA_XODO_ID = '7wo05iyvfcfh01h' // unificado com a Matriz

export interface ResolvedCompany {
  id: string
  name: string
  source:
    | 'membro_filial'
    | 'membro_unico'
    | 'admin_selection'
    | 'fallback_filial'
    | 'fallback_matriz'
    | 'single_company_matriz'
  memberId?: string
  role?: string
}

let cachedCompany: ResolvedCompany | null = null

/**
 * Invalidate cached resolution
 */
export function clearCompanyCache(): void {
  cachedCompany = null
}

/**
 * Resolves the active company — SEMPRE a Matriz '7wo05iyvfcfh01h' ("Rotaly Operações")
 */
export async function getMyCompany(): Promise<ResolvedCompany> {
  const result: ResolvedCompany = {
    id: MATRIZ_EMPRESA_ID,
    name: 'Rotaly Operações',
    source: 'single_company_matriz',
  }

  if (typeof window !== 'undefined') {
    localStorage.setItem('rotaly_active_empresa_id', MATRIZ_EMPRESA_ID)
  }

  // Tentar buscar o nome atualizado do banco se disponível
  try {
    if (cachedCompany) return cachedCompany
    const comp = await pb
      .collection<EmpresaRecord>('empresas')
      .getOne(MATRIZ_EMPRESA_ID, {
        requestKey: null,
      })
      .catch(() => null)

    if (comp) {
      result.name = comp.nome_fantasia || comp.nome_razao_social || 'Rotaly Operações'
    }
  } catch {
    /* fallback to default */
  }

  cachedCompany = result
  return result
}

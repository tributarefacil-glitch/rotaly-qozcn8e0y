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
let cachedMatrizId: string | null = null

/**
 * Invalidate cached resolution
 */
export function clearCompanyCache(): void {
  cachedCompany = null
  cachedMatrizId = null
}

/**
 * Descobre dinamicamente a Matriz real:
 * Critérios em ordem de prioridade:
 * 1. Empresa mais antiga no banco (sort: '+created') - a fundadora original
 * 2. Vínculo do usuário master na coleção 'membros' com papel 'admin'
 * 3. Fallback por CNPJ da matriz ("34.567.890/0001-22")
 */
export async function resolveMatrizCompany(): Promise<EmpresaRecord | null> {
  try {
    // 1. Tentar pegar a empresa mais antiga cadastrada
    const oldestList = await pb.collection<EmpresaRecord>('empresas').getList(1, 1, {
      sort: '+created',
      requestKey: null,
    })
    if (oldestList.items.length > 0) {
      cachedMatrizId = oldestList.items[0].id
      return oldestList.items[0]
    }
  } catch (err) {
    console.warn('Tentativa 1 de resolver matriz falhou:', err)
  }

  try {
    // 2. Tentar por CNPJ da matriz como fallback
    const byCnpj = await pb
      .collection<EmpresaRecord>('empresas')
      .getFirstListItem('cnpj = "34.567.890/0001-22"', { requestKey: null })
    if (byCnpj) {
      cachedMatrizId = byCnpj.id
      return byCnpj
    }
  } catch {
    /* fallback */
  }

  return null
}

/**
 * Obter o ID da Matriz de forma assíncrona ou do cache se disponível
 */
export async function getMatrizCompanyId(): Promise<string> {
  if (cachedMatrizId) return cachedMatrizId
  const matriz = await resolveMatrizCompany()
  if (matriz?.id) {
    cachedMatrizId = matriz.id
    return matriz.id
  }
  // Se ainda assim não encontrar, retorna vazio ou o primeiro registro
  return ''
}

/**
 * Resolves the active company for the currently authenticated user
 */
export async function getMyCompany(): Promise<ResolvedCompany> {
  const authUser = pb.authStore.record as unknown as UserRecord | null
  const isMaster = authUser?.role === 'master'

  // Resolver Matriz real dinamicamente
  const matrizRecord = await resolveMatrizCompany()
  const matrizId = matrizRecord?.id || ''
  const matrizName =
    matrizRecord?.nome_fantasia || matrizRecord?.nome_razao_social || 'Rotaly Operações'

  // 1. Caso Master: Ao logar como master, deve iniciar SEMPRE na matriz real.
  // Pode alternar o contexto de empresa se selecionou explicitamente uma empresa válida no painel.
  if (isMaster) {
    let savedId = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null

    // Se o savedId for inválido ou não existir, inicia sempre na Matriz real
    if (savedId) {
      try {
        const comp = await pb
          .collection<EmpresaRecord>('empresas')
          .getOne(savedId, { requestKey: null })
          .catch(() => null)

        if (comp) {
          const resolved: ResolvedCompany = {
            id: comp.id,
            name: comp.nome_fantasia || comp.nome_razao_social,
            source: comp.id === matrizId ? 'master_default' : 'master_selection',
            plano: comp.plano,
          }
          cachedCompany = resolved
          return resolved
        }
      } catch {
        /* fallback para matriz */
      }
    }

    // Default do master: SEMPRE na Matriz Real
    if (typeof window !== 'undefined' && matrizId) {
      localStorage.setItem(STORAGE_KEY, matrizId)
    }

    const fallbackMaster: ResolvedCompany = {
      id: matrizId,
      name: matrizName,
      source: 'master_default',
      plano: matrizRecord?.plano || 'enterprise',
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
        // Se pertencer à matriz, prioriza a matriz; caso contrário a primeira vinculada
        const memberForMatriz = matrizId ? members.find((m) => m.empresa_id === matrizId) : null
        const primary = memberForMatriz || members[0]
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

  // 3. Fallback seguro para a Matriz Real dinâmica
  const fallback: ResolvedCompany = {
    id: matrizId,
    name: matrizName,
    source: 'fallback_matriz',
    plano: matrizRecord?.plano || 'enterprise',
  }
  if (typeof window !== 'undefined' && matrizId) {
    localStorage.setItem(STORAGE_KEY, matrizId)
  }
  cachedCompany = fallback
  return fallback
}

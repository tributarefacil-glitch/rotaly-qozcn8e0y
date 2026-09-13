/**
 * Centralized Single-Source-of-Truth for Active Company Resolution.
 *
 * Rules:
 * 1. Resolves directly from `membros` table via user_id = '<auth.id>' && ativo = true.
 * 2. If user has multiple active memberships, prioritizes non-matriz company (id != '7wo05iyvfcfh01h').
 * 3. Never falls back to Matriz for sellers/couriers with filial memberships.
 * 4. Short in-memory cache (5 seconds) to avoid redundant network bursts across concurrent calls,
 *    with instant invalidation via clearCompanyCache().
 */
import pb from '@/lib/pocketbase/client'
import type { EmpresaRecord, MembroRecord } from '@/types/delivery'

export const MATRIZ_EMPRESA_ID = '7wo05iyvfcfh01h'
export const FARMACIA_XODO_ID = 'ssyicw8uzwqc01w'

export interface ResolvedCompany {
  id: string
  name: string
  source:
    | 'membro_filial'
    | 'membro_unico'
    | 'admin_selection'
    | 'fallback_filial'
    | 'fallback_matriz'
  memberId?: string
  role?: string
}

let cachedCompany: ResolvedCompany | null = null
let cachedUserId: string | null = null
let cacheExpiresAt = 0

/**
 * Invalidate cached resolution
 */
export function clearCompanyCache(): void {
  cachedCompany = null
  cachedUserId = null
  cacheExpiresAt = 0
}

/**
 * Resolves the authenticated user's company directly from the database.
 */
export async function getMyCompany(): Promise<ResolvedCompany> {
  const authRecord = pb.authStore.record as { id: string; role?: string; email?: string } | null
  const userId = authRecord?.id
  const userRole = authRecord?.role

  if (!userId) {
    return {
      id: FARMACIA_XODO_ID,
      name: 'Farmácia Xodó do Pilar',
      source: 'fallback_filial',
    }
  }

  // Cache hit
  const now = Date.now()
  if (cachedCompany && cachedUserId === userId && now < cacheExpiresAt) {
    return cachedCompany
  }

  try {
    // 1. Consulta direta na coleção membros
    const membros = await pb
      .collection<MembroRecord>('membros')
      .getFullList({
        filter: `user_id = '${userId}' && ativo = true`,
        expand: 'empresa_id',
        sort: '-created',
        requestKey: null,
      })
      .catch((err) => {
        console.warn('[companyResolver] Erro ao consultar membros:', err)
        return [] as MembroRecord[]
      })

    // 2. Se houver vínculos ativos:
    if (membros.length > 0) {
      // Priorizar empresa NÃO-matriz (ex: Farmácia Xodó do Pilar ssyicw8uzwqc01w)
      const nonMatrizMember = membros.find((m) => m.empresa_id !== MATRIZ_EMPRESA_ID)
      const selectedMember = nonMatrizMember || membros[0]
      const empresaExp = selectedMember.expand?.empresa_id as EmpresaRecord | undefined

      let companyName = empresaExp?.nome_fantasia || empresaExp?.nome_razao_social

      if (!companyName) {
        try {
          const comp = await pb
            .collection<EmpresaRecord>('empresas')
            .getOne(selectedMember.empresa_id, {
              requestKey: null,
            })
          companyName = comp.nome_fantasia || comp.nome_razao_social
        } catch {
          companyName =
            selectedMember.empresa_id === FARMACIA_XODO_ID
              ? 'Farmácia Xodó do Pilar'
              : 'Empresa Operacional'
        }
      }

      const result: ResolvedCompany = {
        id: selectedMember.empresa_id,
        name:
          companyName ||
          (selectedMember.empresa_id === FARMACIA_XODO_ID
            ? 'Farmácia Xodó do Pilar'
            : 'Empresa Operacional'),
        source: nonMatrizMember ? 'membro_filial' : 'membro_unico',
        memberId: selectedMember.id,
        role: selectedMember.papel,
      }

      // Re-idratar localStorage com o valor correto apurado no banco
      if (typeof window !== 'undefined') {
        localStorage.setItem('rotaly_active_empresa_id', result.id)
      }

      cachedCompany = result
      cachedUserId = userId
      cacheExpiresAt = Date.now() + 5000 // 5 segundos
      return result
    }

    // 3. Se for Admin do sistema sem vínculo específico de membro:
    if (userRole === 'admin') {
      const saved =
        typeof window !== 'undefined' ? localStorage.getItem('rotaly_active_empresa_id') : null
      if (saved && saved !== 'undefined' && saved !== 'null' && saved.trim() !== '') {
        try {
          const comp = await pb
            .collection<EmpresaRecord>('empresas')
            .getOne(saved.trim(), { requestKey: null })
          const res: ResolvedCompany = {
            id: comp.id,
            name: comp.nome_fantasia || comp.nome_razao_social,
            source: 'admin_selection',
          }
          cachedCompany = res
          cachedUserId = userId
          cacheExpiresAt = Date.now() + 5000
          return res
        } catch {
          /* fallback below */
        }
      }
    }

    // 4. Fallback sem vínculos: buscar primeira filial cadastrada diferente da Matriz
    const filiais = await pb
      .collection<EmpresaRecord>('empresas')
      .getFullList({
        filter: `id != '${MATRIZ_EMPRESA_ID}' && ativa != false`,
        sort: 'created',
        requestKey: null,
      })
      .catch(() => [] as EmpresaRecord[])

    const bestFilial = filiais.find((f) => f.id === FARMACIA_XODO_ID) || filiais[0]
    if (bestFilial) {
      const result: ResolvedCompany = {
        id: bestFilial.id,
        name: bestFilial.nome_fantasia || bestFilial.nome_razao_social,
        source: 'fallback_filial',
      }
      if (typeof window !== 'undefined') {
        localStorage.setItem('rotaly_active_empresa_id', result.id)
      }
      cachedCompany = result
      cachedUserId = userId
      cacheExpiresAt = Date.now() + 5000
      return result
    }

    // 5. Último fallback se o banco estiver vazio
    const res: ResolvedCompany = {
      id: FARMACIA_XODO_ID,
      name: 'Farmácia Xodó do Pilar',
      source: 'fallback_filial',
    }
    cachedCompany = res
    cachedUserId = userId
    cacheExpiresAt = Date.now() + 5000
    return res
  } catch (err) {
    console.error('[companyResolver] Falha inesperada ao resolver empresa:', err)
    return {
      id: FARMACIA_XODO_ID,
      name: 'Farmácia Xodó do Pilar',
      source: 'fallback_filial',
    }
  }
}

import { describe, expect, it } from 'vitest'
import {
  BLOCKED_ACCOUNT_MESSAGE,
  getCourierStatusBadge,
  isCourierActive,
  isCourierBlocked,
  isCourierEligibleForAssignment,
} from './courierStatus'

// Teste de regressão do bloqueio de entregador (bug: coluna STATUS ficava "Ativo" após Bloquear).
// Cobertura: bloquear muda badge para Bloqueado, desbloquear volta a Ativo, bloqueado não é
// elegível para nova atribuição de rota e o fluxo de login recusa usuário bloqueado (varredura
// do AuthContext por ?raw, pois os testes sob src/ não usam fs/path/__dirname).

describe('courierStatus - bloqueio de entregador', () => {
  it('bloquear (status inactive) resulta em badge Bloqueado', () => {
    const badge = getCourierStatusBadge('inactive')
    expect(badge.label).toBe('Bloqueado')
    expect(badge.className).toContain('rose')
  })

  it('desbloquear (status active) restaura badge Ativo', () => {
    const badge = getCourierStatusBadge('active')
    expect(badge.label).toBe('Ativo')
    expect(badge.className).toContain('emerald')
  })

  it('statuses operacionais de rota ativa continuam Ativo (idle/busy)', () => {
    expect(getCourierStatusBadge('idle').label).toBe('Ativo')
    expect(getCourierStatusBadge('busy').label).toBe('Ativo')
  })

  it('pendente continua Pendente (fluxo de credenciamento intacto)', () => {
    expect(getCourierStatusBadge('pending').label).toBe('Pendente')
  })

  it('usuário bloqueado não é elegível para nova atribuição de rota', () => {
    expect(isCourierEligibleForAssignment('inactive')).toBe(false)
    expect(isCourierEligibleForAssignment('active')).toBe(true)
    expect(isCourierEligibleForAssignment('idle')).toBe(true)
  })

  it('usuário bloqueado não conta como ativo; ativo/idle/busy contam', () => {
    expect(isCourierBlocked('inactive')).toBe(true)
    expect(isCourierActive('inactive')).toBe(false)
    expect(isCourierActive('active')).toBe(true)
    expect(isCourierActive('idle')).toBe(true)
    expect(isCourierActive('busy')).toBe(true)
  })

  it('status ausente/inválido não explode e cai em Inativo', () => {
    expect(getCourierStatusBadge(undefined).label).toBe('Inativo')
    expect(getCourierStatusBadge(null).label).toBe('Inativo')
    expect(getCourierStatusBadge('qualquer_coisa').label).toBe('Inativo')
  })

  it('mensagem de conta bloqueada existe para o fluxo de login', () => {
    expect(BLOCKED_ACCOUNT_MESSAGE).toContain('Conta bloqueada')
  })
})

describe('courierStatus - guarda de login de bloqueado (varredura AuthContext)', () => {
  const rawFiles = import.meta.glob<string>('/src/contexts/AuthContext.tsx', {
    query: '?raw',
    eager: true,
  }) as Record<string, string>
  const rawAuth = Object.values(rawFiles).join('\n')

  it('AuthContext recusa login de usuário bloqueado antes de propagar sessão', () => {
    expect(rawAuth).toContain('isUserBlocked(')
    expect(rawAuth).toContain('throw new Error(BLOCKED_ACCOUNT_MESSAGE')
  })

  it('AuthContext também encerra sessão já ativa de usuário bloqueado', () => {
    expect(rawAuth).toContain('authStore.clear()')
  })
})

describe('courierStatus - bloqueado nunca aparece em seletor manual de atribuição', () => {
  // Varredura ?raw (padrão dos testes sob src/, sem fs/path/__dirname) para garantir que
  // TODOS os seletores manuais de entregador filtram bloqueados — não só a sugestão automática.
  const rawSources = import.meta.glob<string>(
    '/src/components/{CreateOrderModal,RouteOptimizerModal}.tsx',
    {
      query: '?raw',
      eager: true,
    },
  ) as Record<string, string>

  it('CreateOrderModal filtra bloqueados no seletor "Atribuir Entregador"', () => {
    const raw = rawSources['/src/components/CreateOrderModal.tsx'] || ''
    expect(raw).toContain('isCourierBlocked')
    expect(raw).toContain('rawCouriers.filter((c) => !isCourierBlocked(c?.status))')
  })

  it('RouteOptimizerModal ignora bloqueados na atribuição manual e automática', () => {
    const raw = rawSources['/src/components/RouteOptimizerModal.tsx'] || ''
    // Filtro de elegibilidade da lista manual de atribuição
    expect(raw).toContain("status === 'inactive'")
    // Reatribuição/planos automáticos também excluem bloqueados
    expect(raw).toContain("c.status !== 'inactive'")
  })
})

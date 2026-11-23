// Estado canônico de bloqueio do entregador.
// Bloqueado = users.status === 'inactive' (enum já existente no PocketBase).
// Toda tela que exibe ou atribui entregador deve passar por aqui.

export type CourierStatusBadge = {
  label: string
  className: string
}

export function isCourierBlocked(status?: string | null): boolean {
  return status === 'inactive'
}

export function isCourierPending(status?: string | null): boolean {
  return status === 'pending'
}

export function isCourierActive(status?: string | null): boolean {
  return status === 'active' || status === 'idle' || status === 'busy'
}

// Elegível para receber NOVA atribuição de rota: nunca bloqueado.
export function isCourierEligibleForAssignment(status?: string | null): boolean {
  return !isCourierBlocked(status) && isCourierActive(status)
}

export function getCourierStatusBadge(status?: string | null): CourierStatusBadge {
  if (isCourierPending(status)) {
    return {
      label: 'Pendente',
      className:
        'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700',
    }
  }
  if (isCourierBlocked(status)) {
    return {
      label: 'Bloqueado',
      className:
        'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-300 dark:border-rose-700',
    }
  }
  if (isCourierActive(status)) {
    return {
      label: 'Ativo',
      className:
        'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700',
    }
  }
  return {
    label: 'Inativo',
    className:
      'bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700',
  }
}

// Mensagem padrão exibida quando um usuário bloqueado tenta entrar.
export const BLOCKED_ACCOUNT_MESSAGE =
  'Conta bloqueada. Procure o administrador da empresa para reativar seu acesso.'

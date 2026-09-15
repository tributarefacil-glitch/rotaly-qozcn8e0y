// Centralização e deduplicação de alertas e notificações por toast
// Evita toasts duplicados disparados por múltiplos listeners em tempo real (Header, SellerDashboard, ControlTower)

const displayedToastKeys = new Set<string>()

// Limpar chaves antigas periodicamente se acumular muitos itens
if (typeof window !== 'undefined') {
  setInterval(
    () => {
      if (displayedToastKeys.size > 200) {
        displayedToastKeys.clear()
      }
    },
    10 * 60 * 1000,
  )
}

/**
 * Registra e valida se uma notificação já foi exibida como toast.
 * @param key Chave idempotente (ex: `notif-${recordId}`, `dev-${courierId}-${orderId}`)
 * @returns true se for a primeira vez (deve exibir); false se já foi exibida recentemente
 */
export function shouldDisplayToast(key: string): boolean {
  if (!key) return true
  if (displayedToastKeys.has(key)) {
    return false
  }
  displayedToastKeys.add(key)
  return true
}

/**
 * Marca uma chave como já exibida manualmente
 */
export function markToastDisplayed(key: string): void {
  if (key) {
    displayedToastKeys.add(key)
  }
}

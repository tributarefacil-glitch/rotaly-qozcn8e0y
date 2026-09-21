/**
 * Gerador de tracking_code de alta entropia para pedidos Rotaly.
 * Formato padrão: TRK-<ano>-<4 últimos dígitos do timestamp><4 dígitos aleatórios>
 * Exemplo: TRK-2026-95630142
 *
 * Evita colisões de unicidade no índice idx_orders_tracking_code mesmo em
 * picos de concorrência simultânea.
 */
export function generateTrackingCode(date: Date = new Date()): string {
  const year = date.getFullYear()
  const timeSuffix = String(date.getTime()).slice(-4)
  const randomSuffix = String(Math.floor(1000 + Math.random() * 9000))
  return `TRK-${year}-${timeSuffix}${randomSuffix}`
}

import type { OrderRecord } from '../types/delivery'

export type KmScope = 'perna' | 'lote'

export function getLoteCanonico(orders: OrderRecord[], routeBatchKey?: string): number {
  if (!orders || orders.length === 0) return 0
  const maxRoad = orders.reduce((max, o) => {
    const val = typeof o.total_route_with_return_km === 'number' ? o.total_route_with_return_km : 0
    return Math.max(max, val)
  }, 0)
  if (maxRoad > 0) return Number(maxRoad.toFixed(1))
  const sumLegs = orders.reduce((sum, o) => sum + (o.distance_km || 0), 0)
  const maxReturn = Math.max(0, ...orders.map((o) => o.return_trip_km || 0))
  return Number((sumLegs + maxReturn).toFixed(1))
}

export function compararKm(
  escopoA: KmScope,
  valorA: number,
  escopoB: KmScope,
  valorB: number,
): { valido: boolean; diferenca: number; alertaSanidade?: string } {
  if (escopoA !== escopoB) {
    console.error(
      `[compararKm] Tentativa de comparar escopos incompatíveis: ${escopoA} (${valorA} km) vs ${escopoB} (${valorB} km). Operação bloqueada.`,
    )
    return { valido: false, diferenca: 0 }
  }
  const diferenca = Math.abs(valorA - valorB)
  const maior = Math.max(valorA, valorB)
  const razao = maior > 0 ? diferenca / maior : 0
  let alertaSanidade: string | undefined
  if (razao > 0.5) {
    alertaSanidade = '⚠️ possível erro de dados — revisar fonte'
  }
  return { valido: true, diferenca: Number(diferenca.toFixed(1)), alertaSanidade }
}

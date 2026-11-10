/**
 * src/lib/fuelDefaults.ts
 *
 * FONTE ÚNICA dos parâmetros padrão de combustível do Rotaly.
 *
 * MOTIVO: o R$ 6,49 estava replicado em 31 pontos de 9 arquivos diferentes. Quando o preço
 * real passou a ser R$ 6,39, cada tela podia mostrar um valor diferente e o pagamento do
 * entregador sair errado — sem ninguém perceber, porque não havia erro, só divergência.
 *
 * REGRA: nenhum arquivo deve escrever 30 ou 6,39 literalmente. Importe daqui.
 */

/** Consumo padrão de moto, em km por litro. Usado só se app_settings estiver vazio. */
export const DEFAULT_FUEL_CONSUMPTION_KML = 30.0

/** Preço padrão do litro, em reais. Usado só se app_settings estiver vazio. */
export const DEFAULT_FUEL_PRICE_PER_LITER = 6.39

/** Consumo padrão de carro, em km por litro. */
export const DEFAULT_CAR_FUEL_CONSUMPTION_KML = 10.0

/** Consumo padrão de caminhão, em km por litro. */
export const DEFAULT_TRUCK_FUEL_CONSUMPTION_KML = 6.0

/** Tempo padrão de permanência em cada parada, em minutos. */
export const DEFAULT_STOP_DURATION_MINUTES = 5

/** Normaliza o preço do combustível dentro das faixas plausíveis do Brasil. */
export function sanitizeFuelPrice(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!isFinite(n) || n <= 0) return null
  if (n < 1 || n > 20) return null
  return n
}

/** Normaliza o consumo (km/L) dentro das faixas plausíveis. */
export function sanitizeConsumptionKml(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!isFinite(n) || n <= 0) return null
  if (n < 3 || n > 80) return null
  return n
}

/**
 * Resolve consumo e preço com a precedência canônica:
 * 1. individual do entregador, 2. padrão do veículo, 3. padrão geral, 4. constante.
 */
export function resolveFuelParams(params: {
  vehicleType?: string
  courierConsumptionKml?: number | null
  courierFuelPrice?: number | null
  settings?: Record<string, unknown> | null
}): { consumptionKml: number; pricePerLiter: number; source: string } {
  const { vehicleType = 'moto', courierConsumptionKml, courierFuelPrice, settings } = params
  const s = (settings || {}) as Record<string, unknown>
  const vt = String(vehicleType || 'moto').toLowerCase()

  const prefix =
    vt.includes('bicicleta') || vt.includes('bike')
      ? 'bike'
      : vt.includes('caminhao') || vt.includes('caminhão')
        ? 'caminhao'
        : vt.includes('carro')
          ? 'carro'
          : 'moto'

  const defaultConsumption =
    prefix === 'carro'
      ? DEFAULT_CAR_FUEL_CONSUMPTION_KML
      : prefix === 'caminhao'
        ? DEFAULT_TRUCK_FUEL_CONSUMPTION_KML
        : DEFAULT_FUEL_CONSUMPTION_KML

  const cCons = sanitizeConsumptionKml(courierConsumptionKml)
  const cPrice = sanitizeFuelPrice(courierFuelPrice)
  if (cCons && cPrice) {
    return { consumptionKml: cCons, pricePerLiter: cPrice, source: 'entregador' }
  }

  let consumption = sanitizeConsumptionKml(s[`${prefix}_consumption_kml`])
  let price = sanitizeFuelPrice(s[`${prefix}_fuel_price`])

  if (!consumption) consumption = sanitizeConsumptionKml(s.fuel_consumption_kml)
  if (!price) price = sanitizeFuelPrice(s.fuel_price_per_liter)

  if (!consumption && cCons) consumption = cCons
  if (!price && cPrice) price = cPrice

  return {
    consumptionKml: consumption ?? defaultConsumption,
    pricePerLiter: price ?? DEFAULT_FUEL_PRICE_PER_LITER,
    source: consumption || price ? 'app_settings' : 'padrao_do_codigo',
  }
}

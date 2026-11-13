/**
 * src/lib/fuelDefaults.test.ts
 *
 * Trava a PRECEDÊNCIA dos parâmetros de combustível e o nome REAL dos campos de
 * app_settings. Origem: em 10/11/2026 o pagamento lia `consumption_kml` / `fuel_price`,
 * que NÃO existem na coleção — o valor gravado pelo Admin era ignorado e o sistema
 * caía no default do código (R$ 6,49 em vez do preço real de R$ 6,39).
 *
 * Sem teste, esse tipo de bug não aparece: não há erro, só um número silenciosamente errado.
 */

import { describe, it, expect } from 'vitest'
import {
  resolveFuelParams,
  sanitizeFuelPrice,
  sanitizeConsumptionKml,
  DEFAULT_FUEL_CONSUMPTION_KML,
  DEFAULT_FUEL_PRICE_PER_LITER,
} from './fuelDefaults'

describe('resolveFuelParams — precedência e campos reais de app_settings', () => {
  it('lê moto_consumption_kml e moto_fuel_price (o bug de 10/11)', () => {
    const r = resolveFuelParams({
      vehicleType: 'moto',
      settings: { moto_consumption_kml: 35, moto_fuel_price: 5.8 },
    })

    expect(r.consumptionKml).toBe(35)
    expect(r.pricePerLiter).toBe(5.8)
    expect(r.source).toBe('app_settings')
  })

  it('NÃO lê os campos errados consumption_kml / fuel_price', () => {
    // Se alguém reintroduzir os nomes errados, o valor vaza para o pagamento e este pega.
    const r = resolveFuelParams({
      vehicleType: 'moto',
      settings: { consumption_kml: 99, fuel_price: 99 },
    })

    expect(r.consumptionKml).toBe(DEFAULT_FUEL_CONSUMPTION_KML)
    expect(r.pricePerLiter).toBe(DEFAULT_FUEL_PRICE_PER_LITER)
  })

  it('o padrão é 30 km/L e R$ 6,39 — nunca o preço antigo de R$ 6,49', () => {
    expect(DEFAULT_FUEL_CONSUMPTION_KML).toBe(30)
    expect(DEFAULT_FUEL_PRICE_PER_LITER).toBe(6.39)
  })

  it('parâmetro do entregador tem precedência sobre app_settings', () => {
    const r = resolveFuelParams({
      vehicleType: 'moto',
      courierConsumptionKml: 28,
      courierFuelPrice: 6.1,
      settings: { moto_consumption_kml: 35, moto_fuel_price: 5.8 },
    })

    expect(r.consumptionKml).toBe(28)
    expect(r.pricePerLiter).toBe(6.1)
    expect(r.source).toBe('entregador')
  })

  it('sem app_settings nem entregador, cai no padrão do código', () => {
    const r = resolveFuelParams({ vehicleType: 'moto', settings: null })

    expect(r.consumptionKml).toBe(DEFAULT_FUEL_CONSUMPTION_KML)
    expect(r.pricePerLiter).toBe(DEFAULT_FUEL_PRICE_PER_LITER)
    expect(r.source).toBe('padrao_do_codigo')
  })

  it('usa o padrão certo por veículo: carro 10 km/L, caminhão 6 km/L', () => {
    expect(resolveFuelParams({ vehicleType: 'carro', settings: null }).consumptionKml).toBe(10)
    expect(resolveFuelParams({ vehicleType: 'caminhao', settings: null }).consumptionKml).toBe(6)
  })

  it('rejeita valor absurdo e devolve o padrão seguro', () => {
    // Divisão por 0 gera Infinity e pagamento infinito; preço 0 paga R$ 0,00.
    expect(sanitizeConsumptionKml(0)).toBeNull()
    expect(sanitizeConsumptionKml(-5)).toBeNull()
    expect(sanitizeConsumptionKml(Number.NaN)).toBeNull()
    expect(sanitizeConsumptionKml(500)).toBeNull() // fora da faixa 3..80
    expect(sanitizeConsumptionKml('abc')).toBeNull()

    expect(sanitizeFuelPrice(0)).toBeNull()
    expect(sanitizeFuelPrice(-1)).toBeNull()
    expect(sanitizeFuelPrice(50)).toBeNull() // fora da faixa 1..20

    const r = resolveFuelParams({
      vehicleType: 'moto',
      settings: { moto_consumption_kml: 0, moto_fuel_price: 0 },
    })
    expect(r.consumptionKml).toBe(DEFAULT_FUEL_CONSUMPTION_KML)
    expect(r.pricePerLiter).toBe(DEFAULT_FUEL_PRICE_PER_LITER)
  })

  it('aceita consumo gravado como texto numérico (formulário do Admin)', () => {
    // Campo de input chega como string; Number() converte e o valor vale.
    const r = resolveFuelParams({
      vehicleType: 'moto',
      settings: { moto_consumption_kml: '32', moto_fuel_price: '6.19' },
    })

    expect(r.consumptionKml).toBe(32)
    expect(r.pricePerLiter).toBe(6.19)
  })
})

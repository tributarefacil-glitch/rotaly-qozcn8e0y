/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration 0224 — Semeia os parâmetros de combustível em app_settings.
 *
 * PROBLEMA QUE ESTA MIGRATION RESOLVE:
 * A coleção app_settings estava VAZIA em produção (0 registros). Sem registro, todo o
 * cálculo de combustível caía no valor padrão escrito no código-fonte, e não havia como
 * o admin configurar pela tela — o que ele salvava não tinha onde ser gravado.
 *
 * Consequência prática: o pagamento do entregador usava R$ 6,49/L enquanto o preço real
 * praticado é R$ 6,39/L. Diferença silenciosa, sem erro no sistema.
 *
 * Valores gravados (confirmados pelo Diogo em 10/11/2026):
 *   - Moto: 30 km/L e R$ 6,39/L
 *   - Carro: 10 km/L e R$ 6,39/L
 *   - Caminhão: 6 km/L e R$ 6,39/L
 *
 * A migração é idempotente: se já existir registro com key='global', não duplica.
 */
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('app_settings')

    // Já existe? Não mexe.
    let existing = null
    try {
      existing = app.findFirstRecordByFilter('app_settings', "key = 'global'")
    } catch (_) {
      existing = null
    }

    if (existing) {
      // Completa apenas os campos de combustível que estiverem vazios.
      let changed = false
      const setIfEmpty = (field, value) => {
        const current = existing.get(field)
        if (current === null || current === undefined || Number(current) <= 0) {
          existing.set(field, value)
          changed = true
        }
      }
      setIfEmpty('fuel_price_per_liter', 6.39)
      setIfEmpty('fuel_consumption_kml', 30.0)
      setIfEmpty('moto_fuel_price', 6.39)
      setIfEmpty('moto_consumption_kml', 30.0)
      setIfEmpty('carro_fuel_price', 6.39)
      setIfEmpty('carro_consumption_kml', 10.0)
      setIfEmpty('caminhao_fuel_price', 6.39)
      setIfEmpty('caminhao_consumption_kml', 6.0)
      if (changed) {
        app.save(existing)
        console.log('0224: app_settings existente completado com parametros de combustivel.')
      } else {
        console.log('0224: app_settings ja configurado, nada a fazer.')
      }
      return
    }

    const record = new Record(collection)
    record.set('key', 'global')
    record.set('fuel_price_per_liter', 6.39)
    record.set('fuel_consumption_kml', 30.0)
    record.set('moto_fuel_price', 6.39)
    record.set('moto_consumption_kml', 30.0)
    record.set('carro_fuel_price', 6.39)
    record.set('carro_consumption_kml', 10.0)
    record.set('caminhao_fuel_price', 6.39)
    record.set('caminhao_consumption_kml', 6.0)
    app.save(record)
    console.log('0224: app_settings criado — moto 30 km/L a R$ 6,39/L.')
  },
  (app) => {
    // Rollback: remove apenas o registro semeado por esta migration.
    try {
      const rec = app.findFirstRecordByFilter('app_settings', "key = 'global'")
      if (rec) app.delete(rec)
    } catch (_) {
      // nada a reverter
    }
  },
)

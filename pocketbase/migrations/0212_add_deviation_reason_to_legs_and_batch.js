/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration 0212:
 * Adiciona o campo deviation_reason nas coleções:
 * 1. route_leg_analysis (text, opcional)
 * 2. route_batch_telemetry (text/json ou deviation_reasons nos lotes)
 */
migrate(
  (app) => {
    // 1. route_leg_analysis.deviation_reason
    try {
      const legCol = app.findCollectionByNameOrId('route_leg_analysis')
      let hasField = false
      try {
        if (legCol.fields.getByName('deviation_reason')) {
          hasField = true
        }
      } catch (_) {}

      if (!hasField) {
        legCol.fields.add(
          new TextField({
            name: 'deviation_reason',
            required: false,
          }),
        )
        app.save(legCol)
        console.log('[0212] Adicionado campo deviation_reason em route_leg_analysis.')
      }
    } catch (errLeg) {
      console.log('[0212] Erro ao adicionar deviation_reason em route_leg_analysis:', errLeg)
    }

    // 2. route_batch_telemetry.deviation_reasons (json para mapear { [orderId]: reason })
    try {
      const batchCol = app.findCollectionByNameOrId('route_batch_telemetry')
      let hasField = false
      try {
        if (batchCol.fields.getByName('deviation_reasons')) {
          hasField = true
        }
      } catch (_) {}

      if (!hasField) {
        batchCol.fields.add(
          new JSONField({
            name: 'deviation_reasons',
            required: false,
          }),
        )
        app.save(batchCol)
        console.log('[0212] Adicionado campo deviation_reasons em route_batch_telemetry.')
      }
    } catch (errBatch) {
      console.log('[0212] Erro ao adicionar deviation_reasons em route_batch_telemetry:', errBatch)
    }
  },
  (app) => {
    try {
      const legCol = app.findCollectionByNameOrId('route_leg_analysis')
      legCol.fields.removeByName('deviation_reason')
      app.save(legCol)
    } catch (_) {}

    try {
      const batchCol = app.findCollectionByNameOrId('route_batch_telemetry')
      batchCol.fields.removeByName('deviation_reasons')
      app.save(batchCol)
    } catch (_) {}
  },
)

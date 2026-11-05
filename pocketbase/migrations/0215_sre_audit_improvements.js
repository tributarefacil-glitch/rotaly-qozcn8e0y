/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration 0215: Auditoria SRE
 * 1. Adiciona campo macro_reason em off_route_events (evita 400 em filtros de motivo/desvio)
 * 2. Adiciona campos de controle de lote em route_batch_telemetry:
 *    - total_deliveries (number)
 *    - processing_started_at (date)
 *    - processing_retries (number)
 *    - telemetry_capped (bool)
 *    - capped_reason (text)
 * 3. Atualiza a view route_batches para expor total_deliveries
 */
migrate(
  (app) => {
    // 1. Campo macro_reason em off_route_events
    try {
      const offCol = app.findCollectionByNameOrId('off_route_events')
      if (offCol && !offCol.fields.getByName('macro_reason')) {
        offCol.fields.add(
          new TextField({
            name: 'macro_reason',
            required: false,
          }),
        )
        app.save(offCol)
        console.log('[0215] Campo macro_reason adicionado em off_route_events.')
      }

      // Backfill de macro_reason com base em deviation_reason ou event_type
      try {
        app
          .db()
          .newQuery(`
          UPDATE off_route_events
          SET macro_reason = CASE
            WHEN deviation_reason IS NOT NULL AND deviation_reason != '' THEN deviation_reason
            WHEN event_type = 'rua_bloqueada' THEN 'RUA BLOQUEADA'
            WHEN event_type = 'area_de_risco' THEN 'AREA DE RISCO'
            WHEN event_type = 'alagamento' THEN 'ALAGAMENTO'
            WHEN event_type = 'retorno_mais_rapido' THEN 'RETORNO MAIS RAPIDO'
            WHEN event_type = 'route_deviation' THEN 'DESVIO DE ROTA'
            WHEN event_type = 'unexpected_stop' THEN 'PARADA INESPERADA'
            ELSE event_type
          END
          WHERE macro_reason IS NULL OR macro_reason = ''
        `)
          .execute()
      } catch (backfillErr) {
        console.log('[0215] Aviso no backfill de macro_reason:', backfillErr)
      }
    } catch (e1) {
      console.log('[0215] Erro ao alterar off_route_events:', e1)
    }

    // 2. Campos em route_batch_telemetry
    try {
      const rbtCol = app.findCollectionByNameOrId('route_batch_telemetry')
      if (rbtCol) {
        let changed = false
        if (!rbtCol.fields.getByName('total_deliveries')) {
          rbtCol.fields.add(
            new NumberField({
              name: 'total_deliveries',
              required: false,
            }),
          )
          changed = true
        }
        if (!rbtCol.fields.getByName('processing_started_at')) {
          rbtCol.fields.add(
            new DateField({
              name: 'processing_started_at',
              required: false,
            }),
          )
          changed = true
        }
        if (!rbtCol.fields.getByName('processing_retries')) {
          rbtCol.fields.add(
            new NumberField({
              name: 'processing_retries',
              required: false,
            }),
          )
          changed = true
        }
        if (!rbtCol.fields.getByName('telemetry_capped')) {
          rbtCol.fields.add(
            new BoolField({
              name: 'telemetry_capped',
              required: false,
            }),
          )
          changed = true
        }
        if (!rbtCol.fields.getByName('capped_reason')) {
          rbtCol.fields.add(
            new TextField({
              name: 'capped_reason',
              required: false,
            }),
          )
          changed = true
        }

        if (changed) {
          app.save(rbtCol)
          console.log('[0215] Campos de controle adicionados em route_batch_telemetry.')
        }

        // Backfill de total_deliveries a partir do json metadata (orders_count) ou legs_data
        try {
          app
            .db()
            .newQuery(`
            UPDATE route_batch_telemetry
            SET total_deliveries = CAST(json_extract(metadata, '$.orders_count') AS INTEGER)
            WHERE (total_deliveries IS NULL OR total_deliveries = 0)
              AND json_extract(metadata, '$.orders_count') IS NOT NULL
          `)
            .execute()
        } catch (bfTotErr) {
          console.log('[0215] Aviso no backfill total_deliveries:', bfTotErr)
        }
      }
    } catch (e2) {
      console.log('[0215] Erro ao alterar route_batch_telemetry:', e2)
    }

    // 3. Atualizar view route_batches para expor total_deliveries
    try {
      let viewCol = null
      try {
        viewCol = app.findCollectionByNameOrId('route_batches')
      } catch (_) {}

      if (viewCol) {
        viewCol.viewQuery =
          "SELECT id, courier_id, route_batch_key, empresa_id, km_viario_total, km_gps_total, km_oficial, pings_count, gaps_count, gaps_total_seconds, status, COALESCE(total_deliveries, CAST(json_extract(metadata, '$.orders_count') AS INTEGER), 0) AS total_deliveries, created, updated FROM route_batch_telemetry"

        if (!viewCol.fields.getByName('total_deliveries')) {
          viewCol.fields.add(
            new NumberField({
              name: 'total_deliveries',
              required: false,
            }),
          )
        }
        app.save(viewCol)
        console.log('[0215] View route_batches atualizada com total_deliveries.')
      }
    } catch (e3) {
      console.log('[0215] Erro ao atualizar view route_batches:', e3)
    }
  },
  (app) => {
    try {
      const offCol = app.findCollectionByNameOrId('off_route_events')
      if (offCol && offCol.fields.getByName('macro_reason')) {
        offCol.fields.removeByName('macro_reason')
        app.save(offCol)
      }
    } catch (_) {}

    try {
      const rbtCol = app.findCollectionByNameOrId('route_batch_telemetry')
      if (rbtCol) {
        if (rbtCol.fields.getByName('total_deliveries'))
          rbtCol.fields.removeByName('total_deliveries')
        if (rbtCol.fields.getByName('processing_started_at'))
          rbtCol.fields.removeByName('processing_started_at')
        if (rbtCol.fields.getByName('processing_retries'))
          rbtCol.fields.removeByName('processing_retries')
        if (rbtCol.fields.getByName('telemetry_capped'))
          rbtCol.fields.removeByName('telemetry_capped')
        if (rbtCol.fields.getByName('capped_reason')) rbtCol.fields.removeByName('capped_reason')
        app.save(rbtCol)
      }
    } catch (_) {}
  },
)

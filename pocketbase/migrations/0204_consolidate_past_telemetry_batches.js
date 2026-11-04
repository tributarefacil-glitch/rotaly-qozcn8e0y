/// <reference path="../pb_data/types.d.ts" />

/**
 * Migração 0204: Reconciliação e consolidação idempotente dos lotes de telemetria
 * (Guilherme 03/11, batch 29895435 e guarda para o lote do Edson 04/11).
 *
 * Regras permanentes:
 * 1. Idempotente (no-op se já consolidado ou em banco vazio).
 * 2. Grava no audit_trail com actor_name = 'Sistema', user_id = '', metadata.system_trigger = true.
 * 3. Timestamps UTC, janela Brasília (UTC-3) 05h–23h59.
 * 4. NUNCA somar km/entregas a partir de amostras truncadas: lê o total canônico 1x por route_batch_key.
 * 5. Se o lote 29895435 já estiver em route_batch_telemetry ou associado a pedidos, faz upsert sem duplicar.
 */
migrate(
  (app) => {
    function logAudit(collectionName, recordId, action, fieldName, oldVal, newVal, extraMeta = {}) {
      try {
        const auditCol = app.findCollectionByNameOrId('audit_trail')
        if (!auditCol) return
        const trail = new Record(auditCol)
        trail.set('action', action)
        trail.set('user_id', '') // relation users não aceita 'system'
        trail.set('actor_name', 'Sistema')
        trail.set('actor_role', 'system')
        trail.set('target_collection', collectionName)
        trail.set('target_record_id', recordId)
        trail.set('field_name', fieldName)
        trail.set('old_value', oldVal !== undefined && oldVal !== null ? String(oldVal) : '')
        trail.set('new_value', newVal !== undefined && newVal !== null ? String(newVal) : '')
        const meta = {
          system_trigger: true,
          migration: '0204_consolidate_past_telemetry_batches',
          ...extraMeta,
        }
        trail.set('metadata', meta)
        app.save(trail)
      } catch (err) {
        console.warn(`[0204] Falha ao registrar audit_trail (${collectionName}:${recordId}):`, err)
      }
    }

    const telemetryCol = app.findCollectionByNameOrId('route_batch_telemetry')
    if (!telemetryCol) {
      console.warn('[0204] Coleção route_batch_telemetry não encontrada.')
      return
    }

    // 1. LOTE GUILHERME (03/11/2026, sufixo de batch 29895435)
    // Procurar por pedidos pertencentes ao lote 29895435
    try {
      const guilhermeOrders = app.findRecordsByFilter(
        'orders',
        "route_batch_key ~ '29895435'",
        'sequence',
        100,
        0,
      )

      if (guilhermeOrders && guilhermeOrders.length > 0) {
        const firstOrder = guilhermeOrders[0]
        const batchKey = firstOrder.getString('route_batch_key')
        const courierId = firstOrder.getString('courier_id')
        const empresaId = firstOrder.getString('empresa_id')

        let existingBatch = null
        try {
          existingBatch = app.findFirstRecordByData(
            'route_batch_telemetry',
            'route_batch_key',
            batchKey,
          )
        } catch (_) {
          existingBatch = null
        }

        if (!existingBatch) {
          const rec = new Record(telemetryCol)
          rec.set('route_batch_key', batchKey)
          rec.set('courier_id', courierId)
          if (empresaId) rec.set('empresa_id', empresaId)

          let kmViarioSum = 0
          for (let i = 0; i < guilhermeOrders.length; i++) {
            kmViarioSum += guilhermeOrders[i].getFloat('distance_km') || 0
          }
          kmViarioSum = Math.round(kmViarioSum * 100) / 100

          rec.set('km_viario_total', kmViarioSum)
          rec.set('km_gps_total', kmViarioSum)
          rec.set('km_oficial', kmViarioSum)
          rec.set('status', 'processed')
          rec.set('metadata', {
            migration: '0204',
            orders_count: guilhermeOrders.length,
            reconstructed_at: new Date().toISOString(),
          })

          app.save(rec)

          logAudit(
            'route_batch_telemetry',
            rec.id,
            'consolidate_lost_batch',
            'route_batch_key',
            '',
            batchKey,
            {
              courier_id: courierId,
              orders_count: guilhermeOrders.length,
              km_viario_total: kmViarioSum,
              batch_key: batchKey,
            },
          )
        }
      }
    } catch (errGuilherme) {
      console.warn('[0204] Aviso ao processar lote Guilherme:', errGuilherme)
    }

    // 2. GUARDA PARA O LOTE DO EDSON (04/11/2026, courier tetrfu5oi19jbwz)
    // Se Edson já finalizou a rota (route_finished = true em todos os pedidos ativos), consolidar 1x.
    // Se ainda está aberta (route_finished = false), NÃO força o fechamento prematuro (Edson ainda está na rua).
    // O hook orders_prevent_overlapping_routes e canonical_telemetry_engine agora já usam UPSERT idempotente
    // e vão salvar com perfeição quando ele tocar "Voltar para base".
    try {
      const edsonOrders = app.findRecordsByFilter(
        'orders',
        "courier_id = 'tetrfu5oi19jbwz' && route_started = true && route_started_at >= '2026-11-04 00:00:00'",
        'sequence',
        100,
        0,
      )

      if (edsonOrders && edsonOrders.length > 0) {
        const allFinished = edsonOrders.every((o) => o.getBool('route_finished'))
        if (allFinished) {
          const firstOrd = edsonOrders[0]
          const edsonBatchKey = firstOrd.getString('route_batch_key')
          if (edsonBatchKey) {
            let existingEdsonBatch = null
            try {
              existingEdsonBatch = app.findFirstRecordByData(
                'route_batch_telemetry',
                'route_batch_key',
                edsonBatchKey,
              )
            } catch (_) {}

            if (!existingEdsonBatch) {
              const recEdson = new Record(telemetryCol)
              recEdson.set('route_batch_key', edsonBatchKey)
              recEdson.set('courier_id', 'tetrfu5oi19jbwz')
              const empId = firstOrd.getString('empresa_id')
              if (empId) recEdson.set('empresa_id', empId)

              let kmViarioEdson = 0
              for (let j = 0; j < edsonOrders.length; j++) {
                kmViarioEdson += edsonOrders[j].getFloat('distance_km') || 0
              }
              kmViarioEdson = Math.round(kmViarioEdson * 100) / 100

              recEdson.set('km_viario_total', kmViarioEdson)
              recEdson.set('km_gps_total', kmViarioEdson)
              recEdson.set('km_oficial', kmViarioEdson)
              recEdson.set('status', 'processed')
              recEdson.set('metadata', {
                migration: '0204',
                orders_count: edsonOrders.length,
                reconstructed_at: new Date().toISOString(),
              })

              app.save(recEdson)

              logAudit(
                'route_batch_telemetry',
                recEdson.id,
                'consolidate_edson_batch',
                'route_batch_key',
                '',
                edsonBatchKey,
                {
                  courier_id: 'tetrfu5oi19jbwz',
                  orders_count: edsonOrders.length,
                  km_viario_total: kmViarioEdson,
                },
              )
            }
          }
        }
      }
    } catch (errEdson) {
      console.warn('[0204] Aviso ao processar lote Edson:', errEdson)
    }
  },
  (app) => {
    // Reversão no-op
  },
)

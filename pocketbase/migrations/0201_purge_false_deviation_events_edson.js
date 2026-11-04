/// <reference path="../pb_data/types.d.ts" />

/**
 * pocketbase/migrations/0201_purge_false_deviation_events_edson.js
 *
 * Migration 0201:
 * Expurgar / classificar como falsos positivos os eventos de off_route_events
 * de hoje (2026-11-04) do entregador Edson Pereira da Silva Junior (id tetrfu5oi19jbwz)
 * gerados por falso desvio em linha reta / ping sem confirmação mínima.
 *
 * Preservação total:
 * O desvio legítimo de rota anterior (~12h33 / ID y4609qelzpnn2n2 / pedido sfzqio1zqkes5ge)
 * é estritamente preservado.
 *
 * Convenção de auditoria:
 * Registro em audit_trail com user_id vazio + actor_name='Sistema' + metadata.system_trigger=true.
 */

migrate(
  (app) => {
    const courierId = 'tetrfu5oi19jbwz' // Edson Pereira da Silva Junior
    const legitimateEventId = 'y4609qelzpnn2n2' // Desvio real de ~12:33 preservado

    const auditCol = app.findCollectionByNameOrId('audit_trail')
    const offRouteCol = app.findCollectionByNameOrId('off_route_events')

    if (!offRouteCol) {
      console.warn('[0201] Coleção off_route_events não encontrada.')
      return
    }

    try {
      // Buscar eventos de hoje do Edson exceto o legítimo das 12:33
      const events = app.findRecordsByFilter(
        'off_route_events',
        `courier_id = '${courierId}' && created >= '2026-11-04 13:00:00.000Z' && id != '${legitimateEventId}'`,
        'created',
        100,
        0,
      )

      console.log(
        `[0201] Eventos de desvio do Edson de hoje para expurgo/classificação: ${events.length}`,
      )

      const purgedDetails = []

      for (let i = 0; i < events.length; i++) {
        const ev = events[i]
        const evId = ev.id
        const orderId = ev.getString('order_id')
        const eventType = ev.getString('event_type')
        const dist = ev.getInt('distance_deviation_meters')
        const created = ev.getString('created')

        purgedDetails.push({
          id: evId,
          order_id: orderId,
          event_type: eventType,
          distance_deviation_meters: dist,
          created,
        })

        // Deletar o evento falso positivo
        app.delete(ev)
      }

      // Se houver audit_trail, registrar o expurgo idempotente
      if (auditCol && purgedDetails.length > 0) {
        const auditRec = new Record(auditCol)
        auditRec.set('user_id', '')
        auditRec.set('courier_id', courierId)
        auditRec.set('collection', 'off_route_events')
        auditRec.set('record_id', courierId)
        auditRec.set('action', 'purge_false_positive_deviations')
        auditRec.set('field', 'off_route_events')
        auditRec.set('old_value', `${purgedDetails.length} false_deviations`)
        auditRec.set('new_value', 'purged')
        auditRec.set('metadata', {
          target_user_name: 'EDSON PEREIRA DA SILVA JUNIOR',
          courier_id: courierId,
          purged_events: purgedDetails,
          preserved_event_id: legitimateEventId,
          reason:
            'Expurgo de falsos positivos de desvio de rota gerados por ping único ou artefato de telemetria sem confirmação viária de 3 pings',
          system_trigger: true,
          actor_name: 'Sistema',
          actor_email: 'sistema@rotaly.com',
          actor_role: 'system',
        })
        app.save(auditRec)
        console.log(
          `[0201] Auditoria gravada com sucesso para ${purgedDetails.length} eventos expurgados.`,
        )
      }
    } catch (err) {
      console.warn('[0201] Erro na migração de desvios do Edson:', err)
    }
  },
  () => {
    // Reversão não necessária para expurgo idempotente de falso positivo
  },
)

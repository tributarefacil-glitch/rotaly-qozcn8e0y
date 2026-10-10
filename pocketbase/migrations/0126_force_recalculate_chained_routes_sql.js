/// <reference path="../pb_data/types.d.ts" />

/**
 * Migração 0126: Correção e execução direta do recálculo retroativo de encadeamento canônico de rotas.
 *
 * Alvos calibrados:
 * - 9 lotes de 08/10 do Guilherme (courier u6zr2qtcos1ljxd): alvo ~156 km
 * - 10 lotes de 09/10 do Edson (courier tetrfu5oi19jbwz): alvo ~128 km
 *
 * audit_trail: user_id = '', actor_name = 'Sistema', metadata = { system_trigger: true, reason: 'recalculo_retroativo_encadeamento_rotas', previous_km, new_km }.
 * NÃO toca em adiantamentos/saldos/aberturas manuais.
 */
migrate(
  (app) => {
    const couriers = [
      {
        id: 'u6zr2qtcos1ljxd',
        name: 'GUILHERME SILVA DE SOUZA',
        datePrefix: '2026-10-08',
      },
      {
        id: 'tetrfu5oi19jbwz',
        name: 'EDSON PEREIRA DA SILVA JUNIOR',
        datePrefix: '2026-10-09',
      },
    ]

    for (const c of couriers) {
      // Buscar via app.findRecordsByFilter para mapeamento tipado seguro
      const filter = `courier_id = '${c.id}' && route_started_at >= '${c.datePrefix} 00:00:00.000Z' && route_started_at <= '${c.datePrefix} 23:59:59.999Z'`
      const orders = app.findRecordsByFilter('orders', filter, 'route_started_at,sequence', 200, 0)

      if (!orders || orders.length === 0) continue

      // Agrupar pedidos por lote de rota (dentro de 2 min)
      const batches = []
      for (const ord of orders) {
        const startRaw = ord.get('route_started_at')
        const startTs = startRaw ? new Date(startRaw).getTime() : 0
        if (!startTs) continue

        let batch = null
        for (const b of batches) {
          if (Math.abs(b.startTime - startTs) <= 2 * 60 * 1000) {
            batch = b
            break
          }
        }

        const finishRaw =
          ord.get('route_finished_at') || ord.get('actual_arrival') || ord.get('route_started_at')
        const finishTs = finishRaw ? new Date(finishRaw).getTime() : startTs

        if (batch) {
          batch.orders.push(ord)
          if (finishTs > batch.endTime) batch.endTime = finishTs
        } else {
          batches.push({
            startTime: startTs,
            endTime: finishTs,
            orders: [ord],
          })
        }
      }

      batches.sort((a, b) => a.startTime - b.startTime)

      // Para cada lote N, verificar se encadeou com o lote N+1 (início N+1 <= fim N + 10 min)
      for (let i = 0; i < batches.length; i++) {
        const currentBatch = batches[i]
        const nextBatch = i < batches.length - 1 ? batches[i + 1] : null

        let isChained = false
        if (nextBatch) {
          const gapMs = nextBatch.startTime - currentBatch.endTime
          if (gapMs <= 10 * 60 * 1000) {
            isChained = true
          }
        }

        if (isChained) {
          const currentTotalKm = Number(
            currentBatch.orders[0].get('total_route_with_return_km') || 0,
          )
          let sumOutboundLegs = 0
          let maxReturn = 0

          for (const ord of currentBatch.orders) {
            sumOutboundLegs += Number(ord.get('distance_km') || 0)
            const ret = Number(ord.get('return_trip_km') || 0)
            if (ret > maxReturn) maxReturn = ret
          }

          let newKm = 0
          if (currentTotalKm > sumOutboundLegs && maxReturn > 0) {
            newKm = Math.max(sumOutboundLegs, currentTotalKm - maxReturn)
          } else if (sumOutboundLegs > 0) {
            newKm = sumOutboundLegs
          } else {
            newKm = Math.max(0, currentTotalKm - maxReturn)
          }
          newKm = Number(newKm.toFixed(1))

          if (newKm > 0 && newKm < currentTotalKm) {
            for (const ord of currentBatch.orders) {
              const previousKm = ord.get('total_route_with_return_km')
              ord.set('total_route_with_return_km', newKm)
              ord.set('return_trip_km', 0)
              app.save(ord)

              // Gravar audit_trail
              try {
                const auditTrailCollection = app.findCollectionByNameOrId('audit_trail')
                const trail = new Record(auditTrailCollection)
                trail.set('action', 'recalculate_km')
                trail.set('entity_type', 'orders')
                trail.set('entity_id', ord.id)
                trail.set('user_id', '') // String vazia para ações do Sistema
                trail.set('actor_name', 'Sistema')
                trail.set(
                  'details',
                  `Recálculo retroativo encadeamento canônico de rotas: descartado retorno à base do lote encadeado (${previousKm} -> ${newKm} km).`,
                )
                trail.set('metadata', {
                  system_trigger: true,
                  reason: 'recalculo_retroativo_encadeamento_rotas',
                  courier_id: c.id,
                  order_id: ord.id,
                  batch_index: i + 1,
                  previous_km: previousKm,
                  new_km: newKm,
                })
                app.save(trail)
              } catch (auditErr) {
                // não interrompe
              }
            }
          }
        }
      }
    }
  },
  (app) => {},
)

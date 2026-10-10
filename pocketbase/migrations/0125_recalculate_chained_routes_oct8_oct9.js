/// <reference path="../pb_data/types.d.ts" />

/**
 * Migração 0125: Recálculo retroativo de encadeamento canônico de rotas.
 *
 * REGRA DO USUÁRIO / ENGENHARIA:
 * Quando o lote N é iniciado em menos de 10 minutos após o término do lote N-1
 * (ou sem retorno efetivo à base), descarta o retorno à base do lote N-1,
 * cobrando apenas o trajeto viário até a última parada daquele lote.
 *
 * Alvos calibrados:
 * - 9 lotes de 08/10 do Guilherme (courier u6zr2qtcos1ljxd): alvo ~156 km (hoje ~174 km)
 * - 10 lotes de 09/10 do Edson (courier tetrfu5oi19jbwz): alvo ~128 km (hoje 183,4 km)
 *
 * Preserva estritamente:
 * - audit_trail com user_id='', actor_name='Sistema', metadata={ system_trigger: true, reason: 'recalculo_retroativo_encadeamento_rotas', previous_km, new_km }
 * - NÃO toca em adiantamentos / saldos de abertura / fuel_advances manuais.
 */
migrate(
  (app) => {
    console.log('[0125] Iniciando recálculo retroativo de encadeamento de rotas...')

    function haversineMeters(lat1, lon1, lat2, lon2) {
      if (!lat1 || !lon1 || !lat2 || !lon2) return 0
      const R = 6371000
      const dLat = ((lat2 - lat1) * Math.PI) / 180
      const dLon = ((lon2 - lon1) * Math.PI) / 180
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
          Math.cos((lat2 * Math.PI) / 180) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2)
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
      return R * c
    }

    const couriersToProcess = [
      {
        id: 'u6zr2qtcos1ljxd',
        name: 'GUILHERME SILVA DE SOUZA',
        dateStart: '2026-10-08 00:00:00.000Z',
        dateEnd: '2026-10-08 23:59:59.999Z',
        expectedTargetKm: 156,
      },
      {
        id: 'tetrfu5oi19jbwz',
        name: 'EDSON PEREIRA DA SILVA JUNIOR',
        dateStart: '2026-10-09 00:00:00.000Z',
        dateEnd: '2026-10-09 23:59:59.999Z',
        expectedTargetKm: 128,
      },
    ]

    for (const courier of couriersToProcess) {
      console.log(`[0125] Analisando lotes do entregador ${courier.name} (${courier.id})...`)

      const filter = `courier_id = '${courier.id}' && route_started = true && route_started_at >= '${courier.dateStart}' && route_started_at <= '${courier.dateEnd}'`
      const orders = app.findRecordsByFilter('orders', filter, 'route_started_at,sequence', 200, 0)

      if (!orders || orders.length === 0) {
        console.log(`[0125] Nenhum pedido encontrado para ${courier.name}.`)
        continue
      }

      // Agrupar pedidos por lote de rota (chave de lote baseada no route_started_at com tolerância de 2 min)
      const batches = []
      for (const order of orders) {
        const startRaw = order.get('route_started_at')
        const startTs = startRaw ? new Date(startRaw).getTime() : 0
        if (!startTs) continue

        let foundBatch = null
        for (const b of batches) {
          if (Math.abs(b.startTime - startTs) <= 2 * 60 * 1000) {
            foundBatch = b
            break
          }
        }

        if (foundBatch) {
          foundBatch.orders.push(order)
          const finishRaw = order.get('route_finished_at') || order.get('actual_arrival')
          const finishTs = finishRaw ? new Date(finishRaw).getTime() : startTs
          if (finishTs > foundBatch.endTime) foundBatch.endTime = finishTs
        } else {
          const finishRaw = order.get('route_finished_at') || order.get('actual_arrival')
          const finishTs = finishRaw ? new Date(finishRaw).getTime() : startTs
          batches.push({
            startTime: startTs,
            endTime: finishTs,
            orders: [order],
          })
        }
      }

      // Ordenar lotes cronologicamente
      batches.sort((a, b) => a.startTime - b.startTime)
      console.log(`[0125] Total de lotes encontrados para ${courier.name}: ${batches.length}`)

      // Para cada lote N, verificar se o lote N+1 iniciou < 10 minutos após o fim do lote N
      for (let i = 0; i < batches.length; i++) {
        const currentBatch = batches[i]
        const nextBatch = i < batches.length - 1 ? batches[i + 1] : null

        let isChained = false
        if (nextBatch) {
          const gapMs = nextBatch.startTime - currentBatch.endTime
          // Se o próximo lote começou menos de 10 minutos (600.000 ms) após o fim deste lote
          // ou se começou durante/antes do encerramento oficial (gap <= 10 min)
          if (gapMs <= 10 * 60 * 1000) {
            isChained = true
          }
        }

        // Se encadeou com o próximo lote, descarta o retorno à base do lote atual
        if (isChained) {
          // Identificar o valor anterior do lote
          const currentTotalKm = Number(
            currentBatch.orders[0].get('total_route_with_return_km') || 0,
          )

          // Calcular a soma das pernas de ida deste lote (sem o retorno à base)
          let sumOutboundLegsKm = 0
          let maxReturnKm = 0

          for (const ord of currentBatch.orders) {
            const dist = Number(ord.get('distance_km') || 0)
            const ret = Number(ord.get('return_trip_km') || 0)
            sumOutboundLegsKm += dist
            if (ret > maxReturnKm) maxReturnKm = ret
          }

          // Se o lote estava cobrando o retorno à base:
          // newKm = total_route_with_return_km - maxReturnKm (ou sumOutboundLegsKm direto)
          let newKm = 0
          if (currentTotalKm > sumOutboundLegsKm && maxReturnKm > 0) {
            newKm = Math.max(sumOutboundLegsKm, currentTotalKm - maxReturnKm)
          } else if (sumOutboundLegsKm > 0) {
            newKm = sumOutboundLegsKm
          } else {
            newKm = Math.max(0, currentTotalKm - maxReturnKm)
          }

          newKm = Number(newKm.toFixed(1))

          // Se houve redução efetiva
          if (newKm > 0 && newKm < currentTotalKm) {
            console.log(
              `[0125] Lote #${i + 1} de ${courier.name} encadeado com lote #${i + 2}. Ajustando KM: ${currentTotalKm} -> ${newKm} km (descartado retorno de ~${(currentTotalKm - newKm).toFixed(1)} km)`,
            )

            for (const ord of currentBatch.orders) {
              const previousKm = ord.get('total_route_with_return_km')
              ord.set('total_route_with_return_km', newKm)
              // Zerar o return_trip_km da ordem final para refletir o não-retorno à base
              ord.set('return_trip_km', 0)
              app.save(ord)

              // Registrar auditoria no audit_trail
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
                  `Recálculo retroativo de encadeamento canônico de rotas: descartado retorno à base do lote encadeado (${previousKm} km -> ${newKm} km).`,
                )
                trail.set('metadata', {
                  system_trigger: true,
                  reason: 'recalculo_retroativo_encadeamento_rotas',
                  courier_id: courier.id,
                  order_id: ord.id,
                  batch_index: i + 1,
                  previous_km: previousKm,
                  new_km: newKm,
                })
                app.save(trail)
              } catch (auditErr) {
                console.warn(`[0125] Aviso ao gravar audit_trail para pedido ${ord.id}:`, auditErr)
              }
            }
          }
        }
      }

      // Calcular o total final recalculado de KM do entregador para o dia
      let finalDayRoadKm = 0
      const finalBatches = app.findRecordsByFilter('orders', filter, 'route_started_at', 200, 0)
      const seenBatchKeys = new Set()

      for (const ord of finalBatches) {
        const startRaw = ord.get('route_started_at')
        const startTs = startRaw ? new Date(startRaw).getTime() : 0
        // Arredondar para bloco de 2 minutos para agrupar o lote
        const bKey = Math.floor(startTs / (2 * 60 * 1000))
        if (!seenBatchKeys.has(bKey)) {
          seenBatchKeys.add(bKey)
          const km = Number(ord.get('total_route_with_return_km') || 0)
          finalDayRoadKm += km
        }
      }

      console.log(
        `[0125] >> Total recalculado de ${courier.name} no dia: ${finalDayRoadKm.toFixed(1)} km (alvo: ~${courier.expectedTargetKm} km)`,
      )
    }

    console.log('[0125] Migração concluída com sucesso.')
  },
  (app) => {
    // Reversão neutra
    console.log('[0125] Reversão de recálculo retroativo executada.')
  },
)

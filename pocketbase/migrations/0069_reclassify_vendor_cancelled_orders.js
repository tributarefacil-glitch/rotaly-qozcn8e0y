/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // TRABALHO 1: Reclassificar cancelados pelo vendedor no histórico e zerar telemetria/combustível
    // Regra v0.0.217: cancelamento pelo vendedor não conta para o entregador (km, combustível, entrega)
    // nem como venda do vendedor — motivo 'cancelado_vendedor' em completion_reason.

    // 1. Pedidos mapeados com evidência clara de cancelamento pelo vendedor:
    // TRK-2026-379, TRK-2026-839, TRK-2026-854, TRK-2026-384, TRK-2026-183, TRK-2026-397, TRK-2026-516
    const vendorCancelledCodes = [
      'TRK-2026-379',
      'TRK-2026-839',
      'TRK-2026-854',
      'TRK-2026-384',
      'TRK-2026-183',
      'TRK-2026-397',
      'TRK-2026-516',
    ]

    let reclassifiedCount = 0

    for (const code of vendorCancelledCodes) {
      try {
        const order = app.findFirstRecordByData('orders', 'tracking_code', code)
        if (order && order.get('status') === 'cancelled') {
          order.set('completion_reason', 'cancelado_vendedor')
          order.set('distance_km', 0)
          order.set('fuel_cost', 0)
          order.set('return_trip_km', 0)
          order.set('total_route_with_return_km', 0)
          order.set('total_route_fuel_cost', 0)
          app.save(order)
          reclassifiedCount++
          console.log(`0069: Reclassificado e zerado com sucesso: ${code}`)
        } else if (order) {
          console.log(
            `0069: Pulado ${code} porque status não é 'cancelled' (${order.get('status')})`,
          )
        }
      } catch (err) {
        console.log(`0069: Fallback SQL para ${code}:`, err)
        try {
          app
            .db()
            .newQuery(
              `UPDATE orders SET
                completion_reason = 'cancelado_vendedor',
                distance_km = 0,
                fuel_cost = 0,
                return_trip_km = 0,
                total_route_with_return_km = 0,
                total_route_fuel_cost = 0
              WHERE tracking_code = {:code} AND status = 'cancelled'`,
            )
            .bind({ code })
            .execute()
          reclassifiedCount++
        } catch (sqlErr) {
          console.log(`0069: Erro SQL para ${code}:`, sqlErr)
        }
      }
    }

    console.log(
      `0069: Total de pedidos reclassificados como cancelado_vendedor: ${reclassifiedCount}`,
    )

    // 2. Casos ambíguos — NÃO TOCAR (preservar como estão para decisão gerencial)
    // Listar no log com status e detalhes atuais
    const ambiguousCodes = [
      'TRK-2026-254',
      'TRK-2026-700',
      'TRK-2026-257',
      'TRK-2026-900',
      'TRK-2026-105',
    ]

    console.log('0069: === CASOS AMBÍGUOS MANTIDOS SEM ALTERAÇÃO PARA DECISÃO GERENCIAL ===')
    for (const ambCode of ambiguousCodes) {
      try {
        const ambOrder = app.findFirstRecordByData('orders', 'tracking_code', ambCode)
        if (ambOrder) {
          console.log(
            `0069: Ambíguo [INTACTO]: ${ambCode} | Status: ${ambOrder.get('status')} | Motivo: ${ambOrder.get('completion_reason')} | km: ${ambOrder.get('distance_km')} | fuel: ${ambOrder.get('fuel_cost')} | notas: ${ambOrder.get('notes')}`,
          )
        }
      } catch (_) {
        console.log(`0069: Ambíguo ${ambCode} não encontrado no banco`)
      }
    }
  },
  (app) => {
    // Reversão segura
  },
)

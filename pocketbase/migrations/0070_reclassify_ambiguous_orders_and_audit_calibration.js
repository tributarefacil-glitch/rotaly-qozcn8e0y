/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // AÇÃO 1 — Reclassificação retroativa dos 5 casos ambíguos como cancelados pelo vendedor
    // Pedidos aprovados pela gerência:
    // - TRK-2026-254 (completion_reason anterior: 'delivered' incoerente)
    // - TRK-2026-700 (completion_reason anterior: 'delivered' incoerente)
    // - TRK-2026-257 (completion_reason anterior: vazio)
    // - TRK-2026-900 (completion_reason anterior: vazio)
    // - TRK-2026-105 (completion_reason anterior: vazio)
    //
    // Regras:
    // - completion_reason = 'cancelado_vendedor'
    // - distance_km = 0, fuel_cost = 0, return_trip_km = 0, total_route_with_return_km = 0, total_route_fuel_cost = 0
    // - PRESERVAR: status ('cancelled'), total_price/itens, tracking_code, datas, receiver_name, notas, etc.
    // - Guardas de idempotência e mesmíssimo padrão da migração 0069.
    // - NÃO tocar em nenhum outro pedido.

    const targetAmbiguousCodes = [
      'TRK-2026-254',
      'TRK-2026-700',
      'TRK-2026-257',
      'TRK-2026-900',
      'TRK-2026-105',
    ]

    let reclassifiedCount = 0

    for (const code of targetAmbiguousCodes) {
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
          console.log(
            `0070: Pedido ${code} reclassificado com sucesso como 'cancelado_vendedor' e zerado`,
          )
        } else if (order) {
          console.log(
            `0070: Pedido ${code} pulado pois status != 'cancelled' (${order.get('status')})`,
          )
        }
      } catch (err) {
        console.log(`0070: Fallback SQL para ${code}:`, err)
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
          console.log(`0070: Erro SQL para ${code}:`, sqlErr)
        }
      }
    }

    console.log(
      `0070: Total de pedidos ambíguos reclassificados como 'cancelado_vendedor': ${reclassifiedCount} de ${targetAmbiguousCodes.length}`,
    )

    // AÇÃO 2 — Verificação dos 2 clientes pendentes de calibração exata pelo Google
    // - Edilsa Queres — Rua Cassua, 01, Chácara Rio-Petrópolis, Duque de Caxias/RJ (id: dmgeebmwdc0fi6y)
    // - Thamires — Av. Calombe, 18, Chácaras Rio-Petrópolis, Duque de Caxias/RJ (id: 2gjolwgymi9a2w9)
    //
    // Doutrina estrita da gerência:
    // Se o serviço do Google não retornar nada com precisão APPROXIMATE ou melhor em variações de endereço,
    // NÃO inventar ou estimar coordenada à mão. Manter como está e registrar para calibragem com pino arrastável manual.
    // Registramos no log de migração o estado atual conferido no banco de dados.

    const clientAuditList = [
      { id: 'dmgeebmwdc0fi6y', name: 'Edilsa Queres' },
      { id: '2gjolwgymi9a2w9', name: 'THAMIRES' },
    ]

    for (const item of clientAuditList) {
      try {
        const cust = app.findFirstRecordByData('customers', 'id', item.id)
        if (cust) {
          console.log(
            `0070: Cliente ${item.name} (${item.id}) no banco: lat=${cust.get('lat')}, lng=${cust.get('lng')}, notes='${cust.get('notes')}'`,
          )
        }
      } catch (custErr) {
        console.log(`0070: Cliente ${item.name} (${item.id}) não localizado:`, custErr)
      }
    }
  },
  (app) => {
    // Reversão segura
  },
)

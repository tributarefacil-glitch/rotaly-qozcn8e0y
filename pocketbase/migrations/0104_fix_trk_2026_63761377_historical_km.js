/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // -------------------------------------------------------------------------
    // CORREÇÃO HISTÓRICA DO PEDIDO TRK-2026-63761377 (p8fn6czik3dbet7)
    // -------------------------------------------------------------------------
    // Cliente: Daiana Lins da Silva (kqt7s3okhjflrjt)
    // Entregador: Vinicios Lunz (o9nccdbkmc9onh0)
    // Lote: 16:55 (liberação 17:14 / 19:33) de 03/10/2026
    //
    // Contexto e Auditoria:
    // O lote totaliza 7,80 km planejados com 4 paradas:
    // - Parada 1: 2,25 km (nfco2s4ae73snzs - Lidiane)
    // - Parada 2: 1,67 km (r179xwu0fwi2lzu - Daiana Rodrigues)
    // - Parada 3: 1,61 km
    // Total das 3 paradas = 5,53 km.
    // O pedido TRK-2026-63761377 é a Parada 4 do lote, gravado erroneamente com
    // distance_km = 0 e return_trip_km = 0 porque entrou no lote às 17h46 e
    // o endereço só finalizou às 17h47 sem recálculo subsequente.
    // Perna da Parada 4 + retorno à base fechando os 7,80 km oficiais:
    // 7,80 - 5,53 = 2,27 km (sendo distance_km = 1,47 km e return_trip_km = 0,80 km).
    //
    // Consumo para moto (35 km/l a R$ 6.49):
    // 2,27 / 35.0 * 6.49 = R$ 0.42 de combustível.
    // total_route_with_return_km do lote oficial = 7,80 km.
    // total_route_fuel_cost do lote oficial = 7,80 / 35.0 * 6.49 = R$ 1.45.
    //
    // Regra: NÃO alterar registros que já possuam aprovação manual em route_km_approvals.
    try {
      const records = app.findRecordsByFilter(
        'orders',
        "tracking_code = 'TRK-2026-63761377' || id = 'p8fn6czik3dbet7'",
        '',
        1,
        0,
      )

      if (records && records.length > 0) {
        const order = records[0]
        const orderId = order.id

        // Verificar se há aprovação existente em route_km_approvals
        let hasApproval = false
        try {
          const approvals = app.findRecordsByFilter(
            'route_km_approvals',
            `order_id = '${orderId}'`,
            '',
            1,
            0,
          )
          if (approvals && approvals.length > 0) {
            hasApproval = true
          }
        } catch (_) {}

        if (hasApproval) {
          console.log(
            `[0104] Pedido ${orderId} (${order.getString('tracking_code')}) já possui aprovação em route_km_approvals; mantendo inalterado.`,
          )
        } else {
          console.log(
            `[0104] Corrigindo pedido TRK-2026-63761377 (${orderId}): distance_km = 0 -> 1.47, return_trip_km = 0 -> 0.80, total_route_with_return_km -> 7.80`,
          )
          order.set('distance_km', 1.47)
          order.set('return_trip_km', 0.8)
          order.set('total_route_with_return_km', 7.8)

          // Rateio de combustível coerente com a perna (2,27 km a 35 km/l e R$ 6.49/l)
          const fuelCost = Number(((2.27 / 35.0) * 6.49).toFixed(2)) // R$ 0.42
          const totalFuelCost = Number(((7.8 / 35.0) * 6.49).toFixed(2)) // R$ 1.45
          order.set('fuel_cost', fuelCost)
          order.set('total_route_fuel_cost', totalFuelCost)

          // Atualizar coordenadas do endereço se estavam apontando para a base
          // Cliente Daiana Lins: lat -22.6841, lng -43.2915
          if (
            order.getFloat('end_address_lat') === 0 ||
            order.getFloat('end_address_lat') === -22.6990563
          ) {
            try {
              const custs = app.findRecordsByFilter('customers', "id = 'kqt7s3okhjflrjt'", '', 1, 0)
              if (custs && custs.length > 0) {
                const cust = custs[0]
                if (cust.getFloat('lat') !== 0) {
                  order.set('end_address_lat', cust.getFloat('lat'))
                  order.set('end_address_lng', cust.getFloat('lng'))
                  order.set('end_address_text', cust.getString('address'))
                  order.set('end_address_name', cust.getString('name'))
                }
              }
            } catch (_) {}
          }

          app.save(order)
          console.log(
            `[0104] Pedido TRK-2026-63761377 corrigido com sucesso! Total km: 2.27 (1.47 + 0.80), combustível: R$ ${fuelCost}`,
          )
        }
      } else {
        console.log('[0104] Pedido TRK-2026-63761377 não localizado no banco.')
      }
    } catch (err) {
      console.log('[0104] Erro na migração de correção histórica:', err)
    }
  },
  (app) => {
    // Reversão opcional (não reverte para 0 para não reintroduzir defeito)
    console.log('[0104] Reversão executada.')
  },
)

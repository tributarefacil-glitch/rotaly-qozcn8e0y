/// <reference path="../pb_data/types.d.ts" />

/**
 * pocketbase/migrations/0119_recalculate_corrected_pins_and_sweep.js
 *
 * Passo 1 — Migração retroativa:
 * 1. Regravar distance_km, end_address_lat, end_address_lng do pedido mvq9v1entkq4kr0
 *    (TRK-2026-50835025, AMANDA, cliente 9ep5tse5i1xwte0: hoje 15,57 km / -22.7868557,-43.3130887
 *    -> pin vigente -22.7020481, -43.2965082, viário ~0,9 km)
 * 2. Regravar distance_km, end_address_lat, end_address_lng do pedido xr0rhjkbcd5p0h0
 *    (TRK-2026-84304848, Angelica Santos, cliente ikb33ojgavtvf12: hoje 14,5 km
 *    -> pin vigente -22.7024873, -43.2934906, viário ~1,0 km)
 * 3. Recalcular distance_km viário a partir da base.
 * 4. Trilha audit_trail: user_id vazio, actor_name 'Sistema', metadata.system_trigger=true,
 *    metadata.reason='pin do cliente corrigido após criação do pedido', old/new values.
 * 5. Varrer pedidos delivered dos últimos 7 dias (fuso America/Sao_Paulo, 05h–23h59)
 *    com snapshot >500m do pin vigente e corrigir igual.
 */

migrate(
  (app) => {
    console.log('[0119] Iniciando correção retroativa de pedidos com pin divergente...')

    function haversineMeters(lat1, lon1, lat2, lon2) {
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

    function calculateRoadKm(baseLat, baseLng, destLat, destLng) {
      const directM = haversineMeters(baseLat, baseLng, destLat, destLng)
      const directKm = directM / 1000
      // Fator viário urbano padrão 1.25x (mínimo 0.8 km)
      const roadKm = Math.max(0.8, Number((directKm * 1.25).toFixed(2)))
      return roadKm
    }

    let auditCol = null
    try {
      auditCol = app.findCollectionByNameOrId('audit_trail')
    } catch (_) {}

    function recordAudit(order, oldValues, newValues, customerId) {
      if (!auditCol) return
      try {
        const rec = new Record(auditCol)
        rec.set('collection', 'orders')
        rec.set('record_id', order.id)
        rec.set('action', 'fix_customer_pin_retroactive')
        rec.set('field', 'distance_and_destination_coords')
        rec.set(
          'old_value',
          JSON.stringify({
            distance_km: oldValues.distance_km,
            end_address_lat: oldValues.end_address_lat,
            end_address_lng: oldValues.end_address_lng,
          }),
        )
        rec.set(
          'new_value',
          JSON.stringify({
            distance_km: newValues.distance_km,
            end_address_lat: newValues.end_address_lat,
            end_address_lng: newValues.end_address_lng,
          }),
        )
        rec.set('timestamp', new Date().toISOString())
        if (order.getString('courier_id')) {
          rec.set('courier_id', order.getString('courier_id'))
        }
        rec.set('metadata', {
          actor_name: 'Sistema',
          actor_email: 'sistema@rotaly.com',
          actor_role: 'system',
          system_trigger: true,
          reason: 'pin do cliente corrigido após criação do pedido',
          order_id: order.id,
          tracking_code: order.getString('tracking_code'),
          customer_id: customerId,
          old_distance_km: oldValues.distance_km,
          new_distance_km: newValues.distance_km,
          old_coords: { lat: oldValues.end_address_lat, lng: oldValues.end_address_lng },
          new_coords: { lat: newValues.end_address_lat, lng: newValues.end_address_lng },
        })
        app.save(rec)
      } catch (err) {
        console.warn('[0119] Falha ao gravar audit_trail para pedido', order.id, err)
      }
    }

    function fixOrderWithCustomer(order, customer) {
      const custLat = customer.getFloat('lat') || 0
      const custLng = customer.getFloat('lng') || 0
      if (custLat === 0 && custLng === 0) return false

      const oldLat = order.getFloat('end_address_lat') || 0
      const oldLng = order.getFloat('end_address_lng') || 0
      const oldDist = order.getFloat('distance_km') || 0

      const distDiff = haversineMeters(oldLat, oldLng, custLat, custLng)
      if (distDiff <= 500 && oldDist > 0) {
        // Divergência desprezível ou já alinhado
        return false
      }

      const baseLat = order.getFloat('start_base_lat') || -22.6990563
      const baseLng = order.getFloat('start_base_lng') || -43.296723

      // Recalcular distance_km viário a partir da base
      const newDistKm = calculateRoadKm(baseLat, baseLng, custLat, custLng)

      console.log(
        `[0119] Corrigindo pedido ${order.getString('tracking_code')} (${order.id}): ` +
          `coords (${oldLat}, ${oldLng}) -> (${custLat}, ${custLng}), ` +
          `distance_km ${oldDist} -> ${newDistKm} km (delta pin: ${Math.round(distDiff)}m)`,
      )

      order.set('end_address_lat', custLat)
      order.set('end_address_lng', custLng)
      order.set('distance_km', newDistKm)

      app.save(order)

      recordAudit(
        order,
        { distance_km: oldDist, end_address_lat: oldLat, end_address_lng: oldLng },
        { distance_km: newDistKm, end_address_lat: custLat, end_address_lng: custLng },
        customer.id,
      )

      return true
    }

    // 1. Pedidos específicos declarados no Passo 1:
    // Pedido 1: mvq9v1entkq4kr0 (TRK-2026-50835025, AMANDA, cliente 9ep5tse5i1xwte0)
    try {
      const order1 = app.findRecordById('orders', 'mvq9v1entkq4kr0')
      const cust1 = app.findRecordById('customers', '9ep5tse5i1xwte0')
      if (order1 && cust1) {
        fixOrderWithCustomer(order1, cust1)
      }
    } catch (e1) {
      console.warn('[0119] Erro ao corrigir pedido mvq9v1entkq4kr0:', e1)
    }

    // Pedido 2: xr0rhjkbcd5p0h0 (TRK-2026-84304848, Angelica Santos, cliente ikb33ojgavtvf12)
    try {
      const order2 = app.findRecordById('orders', 'xr0rhjkbcd5p0h0')
      const cust2 = app.findRecordById('customers', 'ikb33ojgavtvf12')
      if (order2 && cust2) {
        fixOrderWithCustomer(order2, cust2)
      }
    } catch (e2) {
      console.warn('[0119] Erro ao corrigir pedido xr0rhjkbcd5p0h0:', e2)
    }

    // 2. Varrer pedidos delivered dos últimos 7 dias (fuso America/Sao_Paulo, 05h–23h59)
    // com snapshot >500m do pin vigente e corrigir igual.
    try {
      // 7 dias a partir de 29/09/2026 08:00 UTC (05h BRT)
      const deliveredOrders = app.findRecordsByFilter(
        'orders',
        "status = 'delivered' && created >= '2026-09-29 08:00:00'",
        'created',
        500,
        0,
      )

      console.log(
        `[0119] Varrendo ${deliveredOrders.length} pedidos delivered dos últimos 7 dias...`,
      )

      let sweptCount = 0
      for (let i = 0; i < deliveredOrders.length; i++) {
        const ord = deliveredOrders[i]
        // Se já foi processado acima, pular
        if (ord.id === 'mvq9v1entkq4kr0' || ord.id === 'xr0rhjkbcd5p0h0') continue

        const custId = ord.getString('customer_id')
        if (!custId) continue

        let cust = null
        try {
          cust = app.findRecordById('customers', custId)
        } catch (_) {
          cust = null
        }
        if (!cust) continue

        const custLat = cust.getFloat('lat') || 0
        const custLng = cust.getFloat('lng') || 0
        if (custLat === 0 && custLng === 0) continue

        const endLat = ord.getFloat('end_address_lat') || 0
        const endLng = ord.getFloat('end_address_lng') || 0

        const distM = haversineMeters(endLat, endLng, custLat, custLng)
        if (distM > 500) {
          const ok = fixOrderWithCustomer(ord, cust)
          if (ok) sweptCount++
        }
      }

      console.log(`[0119] Concluída varredura: ${sweptCount} pedidos adicionais corrigidos.`)
    } catch (sweepErr) {
      console.warn('[0119] Erro durante varredura de pedidos delivered:', sweepErr)
    }
  },
  (app) => {
    console.log('[0119] Reversão da migration 0119.')
  },
)

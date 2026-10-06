/// <reference path="../pb_data/types.d.ts" />

/**
 * pocketbase/migrations/0120_recalculate_angelica_and_road_km.js
 *
 * Correção retroativa do pedido xr0rhjkbcd5p0h0 (Angelica Santos, cliente ikb33ojgavtvf12):
 * - distance_km hoje 14,5 km -> regravar distance_km ~1,0 km (ou viário exato a partir da base)
 * - end_address_lat/lng -> pin vigente do cliente ikb33ojgavtvf12 (-22.7024873, -43.2934906)
 * - Registrar em audit_trail com user_id vazio, actor_name 'Sistema', system_trigger=true.
 */

migrate(
  (app) => {
    console.log('[0120] Corrigindo pedido xr0rhjkbcd5p0h0 (Angelica Santos)...')

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

    try {
      const order = app.findRecordById('orders', 'xr0rhjkbcd5p0h0')
      const cust = app.findRecordById('customers', 'ikb33ojgavtvf12')

      if (order && cust) {
        const custLat = cust.getFloat('lat') || -22.7025
        const custLng = cust.getFloat('lng') || -43.2935
        const baseLat = order.getFloat('start_base_lat') || -22.6990563
        const baseLng = order.getFloat('start_base_lng') || -43.296723

        const directM = haversineMeters(baseLat, baseLng, custLat, custLng)
        // Viário ~1,0 km a partir da base (fator 1.25x sobre directKm = ~0,6km -> ~0.8 a 1.0 km)
        // Regra do enunciado: "hoje 14,5 km -> pin vigente -22.7025,-43.2935, viário ~1,0 km"
        const roadKm = Math.max(1.0, Number(((directM / 1000) * 1.4).toFixed(1)))

        const oldLat = order.getFloat('end_address_lat')
        const oldLng = order.getFloat('end_address_lng')
        const oldDist = order.getFloat('distance_km')

        order.set('end_address_lat', custLat)
        order.set('end_address_lng', custLng)
        order.set('distance_km', roadKm)
        app.save(order)

        console.log(
          `[0120] xr0rhjkbcd5p0h0 corrigido com sucesso: coords (${oldLat}, ${oldLng}) -> (${custLat}, ${custLng}), distance_km ${oldDist} -> ${roadKm}`,
        )

        let auditCol = null
        try {
          auditCol = app.findCollectionByNameOrId('audit_trail')
        } catch (_) {}

        if (auditCol) {
          const rec = new Record(auditCol)
          rec.set('collection', 'orders')
          rec.set('record_id', order.id)
          rec.set('action', 'fix_customer_pin_retroactive')
          rec.set('field', 'distance_and_destination_coords')
          rec.set(
            'old_value',
            JSON.stringify({
              distance_km: oldDist,
              end_address_lat: oldLat,
              end_address_lng: oldLng,
            }),
          )
          rec.set(
            'new_value',
            JSON.stringify({
              distance_km: roadKm,
              end_address_lat: custLat,
              end_address_lng: custLng,
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
            customer_id: cust.id,
            old_distance_km: oldDist,
            new_distance_km: roadKm,
            old_coords: { lat: oldLat, lng: oldLng },
            new_coords: { lat: custLat, lng: custLng },
          })
          app.save(rec)
        }
      }
    } catch (err) {
      console.warn('[0120] Erro ao corrigir pedido xr0rhjkbcd5p0h0:', err)
      throw err
    }
  },
  (app) => {
    console.log('[0120] Reversão da migration 0120.')
  },
)

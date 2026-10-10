/**
 * Migração 0128: Correção cadastral da cliente Elaine (cteyngfui5yt4ab)
 * e substituição do trecho inflado na rota TRK-2026-46213458 (Guilherme 10/10).
 *
 * Dados reais aprovados pelo usuário:
 * - Endereço: Rua Nossa Senhora Aparecida, Pilar, Duque de Caxias - RJ, CEP: 25235-000
 * - Número em branco
 * - Pin: lat: -22.7029705, lng: -43.3030357
 *
 * O pin anterior no topo da serra (-22.6130814, -43.2865399, ~10 km distante da base)
 * inflou o lote de 10/10 das 12:02 (lote de 5 entregas) em ~21,1 km (42,9 km -> 21,8 km).
 *
 * Contrapartida / Auditoria de KM:
 * - Ajustar distância do pedido TRK-2026-46213458 (m6sq2t1530x3aup) para o trecho viário real (~1.1 km)
 * - Retorno à base do pedido ajustado para ~0.8 km
 * - Recalcular total_route_with_return_km do lote das 12:02 de Guilherme para 21.8 km
 * - Registrar trilha de auditoria em audit_trail com autor = Sistema (user_id = '')
 *
 * SALDOS INTACTOS: Guilherme R$ 220,99 · Vinicios R$ 67,62.
 */

migrate(
  (app) => {
    console.log(
      '[0128] Iniciando migração 0128: Correção da Elaine e recálculo da rota TRK-2026-46213458...',
    )

    // 1. Atualizar registro do cliente Elaine (cteyngfui5yt4ab)
    let elaineCustomer = null
    try {
      elaineCustomer = app.findRecordById('customers', 'cteyngfui5yt4ab')
    } catch (err) {
      console.warn('[0128] Cliente cteyngfui5yt4ab não encontrado por ID:', err)
    }

    if (elaineCustomer) {
      const oldLat = elaineCustomer.getFloat('lat')
      const oldLng = elaineCustomer.getFloat('lng')
      const oldAddress = elaineCustomer.getString('address')

      elaineCustomer.set('street', 'Rua Nossa Senhora Aparecida')
      elaineCustomer.set('neighborhood', 'Pilar')
      elaineCustomer.set('city', 'Duque de Caxias')
      elaineCustomer.set('state', 'RJ')
      elaineCustomer.set('postal_code', '25235-000')
      elaineCustomer.set('complement', '')
      elaineCustomer.set(
        'address',
        'Rua Nossa Senhora Aparecida, Pilar, Duque de Caxias - RJ, CEP: 25235-000',
      )
      elaineCustomer.set('lat', -22.7029705)
      elaineCustomer.set('lng', -43.3030357)
      elaineCustomer.set(
        'notes',
        '[CORREÇÃO DEFINITIVA v0.0.366]: Pin real confirmado no Pilar (-22.7029705, -43.3030357). Número em branco. CEP 25235-000.',
      )

      app.save(elaineCustomer)
      console.log('[0128] Cliente Elaine atualizado com sucesso no Pilar.')

      // Auditoria da cliente
      try {
        const auditCol = app.findCollectionByNameOrId('audit_trail')
        if (auditCol) {
          const trail = new Record(auditCol)
          trail.set('collection', 'customers')
          trail.set('record_id', elaineCustomer.id)
          trail.set('action', 'customer_pin_correction')
          trail.set('field', 'lat_lng_address')
          trail.set('old_value', String(oldLat) + ', ' + String(oldLng) + ' (' + oldAddress + ')')
          trail.set('new_value', '-22.7029705, -43.3030357 (Rua Nossa Senhora Aparecida, Pilar)')
          trail.set('user_id', '')
          trail.set('timestamp', new Date().toISOString())
          trail.set('metadata', {
            system_trigger: true,
            actor_name: 'Sistema',
            reason:
              'correção definitiva de pin e endereço da Elaine para Pilar conforme comando do usuário',
          })
          app.save(trail)
        }
      } catch (eAudit) {
        console.warn('[0128] Erro ao gravar audit_trail para cliente Elaine:', eAudit)
      }
    }

    // 2. Corrigir pedido TRK-2026-46213458 (m6sq2t1530x3aup) e recalcular o lote das 12:02
    let elaineOrder = null
    try {
      elaineOrder = app.findRecordById('orders', 'm6sq2t1530x3aup')
    } catch (_) {}

    if (!elaineOrder) {
      try {
        const found = app.findRecordsByFilter(
          'orders',
          "tracking_code = 'TRK-2026-46213458'",
          '',
          1,
          0,
        )
        if (found && found.length > 0) elaineOrder = found[0]
      } catch (_) {}
    }

    if (elaineOrder) {
      const oldDist = elaineOrder.getFloat('distance_km')
      const oldReturn = elaineOrder.getFloat('return_trip_km')
      const oldTotalBatch = elaineOrder.getFloat('total_route_with_return_km')

      // Distância corrigida de Elaine (Pilar, a ~0.9km da entrega anterior e ~0.8km da base Mais Saudavel)
      const correctedDistanceKm = 1.15
      const correctedReturnTripKm = 0.82
      const correctedBatchTotalKm = 21.8

      elaineOrder.set('end_address_lat', -22.7029705)
      elaineOrder.set('end_address_lng', -43.3030357)
      elaineOrder.set('end_address_name', 'Elaine')
      elaineOrder.set(
        'end_address_text',
        'Rua Nossa Senhora Aparecida, Pilar, Duque de Caxias - RJ, CEP: 25235-000',
      )
      elaineOrder.set('distance_km', correctedDistanceKm)
      elaineOrder.set('return_trip_km', correctedReturnTripKm)
      elaineOrder.set('total_route_with_return_km', correctedBatchTotalKm)
      elaineOrder.set(
        'notes',
        'Recebido por: Elaine (Doc: N/A) | [Ajuste v0.0.366: pin corrigido no Pilar, trecho inflado de ~10.8km recalculado para 1.15km, lote 21.8km]',
      )
      app.save(elaineOrder)
      console.log('[0128] Pedido TRK-2026-46213458 corrigido com sucesso.')

      // Atualizar as demais ordens do mesmo lote de 10/10 (~12:02Z de Guilherme)
      try {
        const batchOrders = app.findRecordsByFilter(
          'orders',
          "courier_id = 'u6zr2qtcos1ljxd' && route_started_at ~ '2026-10-10 12:02'",
          'sequence',
          50,
          0,
        )
        for (let i = 0; i < batchOrders.length; i++) {
          const ord = batchOrders[i]
          if (ord.id !== elaineOrder.id) {
            ord.set('total_route_with_return_km', correctedBatchTotalKm)
            app.save(ord)
          }
        }
        console.log(
          '[0128] Ordens do lote 12:02Z atualizadas para total_route_with_return_km = 21.8 km.',
        )
      } catch (eBatch) {
        console.warn('[0128] Erro ao atualizar lote 12:02Z:', eBatch)
      }

      // Auditoria da ordem
      try {
        const auditCol = app.findCollectionByNameOrId('audit_trail')
        if (auditCol) {
          const trail = new Record(auditCol)
          trail.set('collection', 'orders')
          trail.set('record_id', elaineOrder.id)
          trail.set('action', 'route_km_correction')
          trail.set('field', 'total_route_with_return_km')
          trail.set('old_value', String(oldTotalBatch) + ' km (dist: ' + String(oldDist) + ' km)')
          trail.set(
            'new_value',
            String(correctedBatchTotalKm) + ' km (dist: ' + String(correctedDistanceKm) + ' km)',
          )
          trail.set('courier_id', 'u6zr2qtcos1ljxd')
          trail.set('user_id', '')
          trail.set('timestamp', new Date().toISOString())
          trail.set('metadata', {
            system_trigger: true,
            actor_name: 'Sistema',
            reason:
              'substituição de trecho inflado na Auditoria de KM do caso Elaine TRK-2026-46213458',
            tracking_code: 'TRK-2026-46213458',
            old_distance_km: oldDist,
            new_distance_km: correctedDistanceKm,
            old_batch_km: oldTotalBatch,
            new_batch_km: correctedBatchTotalKm,
          })
          app.save(trail)
        }
      } catch (eAuditOrder) {
        console.warn('[0128] Erro ao gravar audit_trail para pedido Elaine:', eAuditOrder)
      }
    }

    console.log('[0128] Migração 0128 finalizada com sucesso.')
  },
  (app) => {
    console.log('[0128] Reversão executada.')
  },
)

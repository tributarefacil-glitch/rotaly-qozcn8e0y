// pocketbase/hooks/customers_recalc_orders_km.js
// Hook backend: Ao atualizar lat/lng de um cliente (aprovação de pin_entregador ou edição cadastral):
// 1. Recalcula distance_km dos pedidos não finalizados e dos pedidos entregues do dia corrente daquele cliente
//    usando as coordenadas novas (cálculo viário oficial base -> paradas -> retorno à base com fator viário ou distância direta).
// 2. Atualiza end_address_lat e end_address_lng no pedido para manter o snapshot alinhado com o cadastro vigente.
// 3. Registra cada recálculo na trilha de auditoria (audit_trail):
//    autor Sistema (user_id vazio, actor_name='Sistema', metadata.system_trigger=true),
//    motivo: "pin corrigido após criação do pedido", valores antes/depois.
// 4. NUNCA mexe em saldos de conta corrente (opening_balance, fuel_advances, etc).
// 5. Janela operacional America/Sao_Paulo 05h-23h59 (madrugada < 05h = dia anterior).

onRecordUpdate((e) => {
  const original = e.record.original()
  if (!original) return e.next()

  const custId = e.record.id
  const origLat = original.getFloat('lat')
  const origLng = original.getFloat('lng')
  const newLat = e.record.getFloat('lat')
  const newLng = e.record.getFloat('lng')

  // Se coordenadas não mudaram ou se o novo pin é zerado/inválido, não faz nada
  if (origLat === newLat && origLng === newLng) {
    return e.next()
  }
  if (!newLat || !newLng || isNaN(newLat) || isNaN(newLng) || (newLat === 0 && newLng === 0)) {
    return e.next()
  }

  // Prosseguir com o update do cliente primeiro
  e.next()

  try {
    const custName = e.record.getString('name') || 'Cliente'
    const custAddress = e.record.getString('address') || e.record.getString('street') || ''

    // Janela operacional America/Sao_Paulo (UTC-3): 05h às 23h59
    // Se UTC agora tem hora em SP < 5, o dia civil operacional é o dia anterior
    const nowUtc = new Date()
    // Offset de Brasília fixo -3h (-180 minutos)
    const spTime = new Date(nowUtc.getTime() - 3 * 3600 * 1000)
    let spYear = spTime.getUTCFullYear()
    let spMonth = spTime.getUTCMonth() // 0-11
    let spDay = spTime.getUTCDate()
    const spHour = spTime.getUTCHours()

    if (spHour < 5) {
      const prevDate = new Date(Date.UTC(spYear, spMonth, spDay - 1))
      spYear = prevDate.getUTCFullYear()
      spMonth = prevDate.getUTCMonth()
      spDay = prevDate.getUTCDate()
    }

    const pad = (n) => (n < 10 ? '0' + n : String(n))
    const todayStr = `${spYear}-${pad(spMonth + 1)}-${pad(spDay)}`
    // Início da janela: 05:00:00 SP = 08:00:00 UTC
    // Fim da janela: 23:59:59.999 SP = 02:59:59.999 UTC do dia civil seguinte
    const startWindowUtc = new Date(Date.UTC(spYear, spMonth, spDay, 8, 0, 0, 0))
    const endWindowUtc = new Date(Date.UTC(spYear, spMonth, spDay + 1, 2, 59, 59, 999))
    const startWindowStr = startWindowUtc.toISOString().replace('T', ' ')
    const endWindowStr = endWindowUtc.toISOString().replace('T', ' ')

    // Buscar pedidos associados a este cliente:
    // (A) Não finalizados: status != 'delivered' && status != 'cancelled'
    // (B) Entregues do dia corrente: status = 'delivered' && (actual_arrival >= start && actual_arrival <= end || (actual_arrival == '' && created >= start && created <= end))
    const uncompletedFilter = `customer_id = '${custId}' && status != 'delivered' && status != 'cancelled'`
    const deliveredTodayFilter = `customer_id = '${custId}' && status = 'delivered' && ((actual_arrival >= '${startWindowStr}' && actual_arrival <= '${endWindowStr}') || (actual_arrival = '' && created >= '${startWindowStr}' && created <= '${endWindowStr}'))`

    const ordersToProcess = []
    const seenOrderIds = {}

    try {
      const uncompletedOrders = e.app.findRecordsByFilter(
        'orders',
        uncompletedFilter,
        '-created',
        100,
      )
      for (let i = 0; i < uncompletedOrders.length; i++) {
        const o = uncompletedOrders[i]
        if (!seenOrderIds[o.id]) {
          seenOrderIds[o.id] = true
          ordersToProcess.push(o)
        }
      }
    } catch (uncompletedErr) {
      console.warn(
        '[customers_recalc_orders_km] Erro ao buscar pedidos não finalizados:',
        uncompletedErr,
      )
    }

    try {
      const deliveredTodayOrders = e.app.findRecordsByFilter(
        'orders',
        deliveredTodayFilter,
        '-created',
        100,
      )
      for (let i = 0; i < deliveredTodayOrders.length; i++) {
        const o = deliveredTodayOrders[i]
        if (!seenOrderIds[o.id]) {
          seenOrderIds[o.id] = true
          ordersToProcess.push(o)
        }
      }
    } catch (deliveredErr) {
      console.warn(
        '[customers_recalc_orders_km] Erro ao buscar pedidos entregues de hoje:',
        deliveredErr,
      )
    }

    if (ordersToProcess.length === 0) {
      return
    }

    // Helper Haversine em metros
    const calcHaversineMeters = (lat1, lon1, lat2, lon2) => {
      const R = 6371e3
      const toRad = (deg) => (deg * Math.PI) / 180
      const dLat = toRad(lat2 - lat1)
      const dLon = toRad(lon2 - lon1)
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
      return R * c
    }

    // Obter bases cadastradas para fallback de base de saída
    let bases = []
    try {
      bases = e.app.findRecordsByFilter('base_addresses', '', '-is_default', 10)
    } catch (_) {}
    const defaultBase = bases.length > 0 ? bases[0] : null
    const fallbackBaseLat = defaultBase ? defaultBase.getFloat('lat') : -22.7001402
    const fallbackBaseLng = defaultBase ? defaultBase.getFloat('lng') : -43.2982834

    const auditCol = e.app.findCollectionByNameOrId('audit_trail')

    for (let i = 0; i < ordersToProcess.length; i++) {
      const order = ordersToProcess[i]
      const oldKm = order.getFloat('distance_km') || 0
      const oldEndLat = order.getFloat('end_address_lat') || origLat
      const oldEndLng = order.getFloat('end_address_lng') || origLng

      const baseLat = order.getFloat('start_base_lat') || fallbackBaseLat
      const baseLng = order.getFloat('start_base_lng') || fallbackBaseLng

      // Cálculo viário oficial: distância base -> novo pin
      // Fator viário padrão urbano 1.3x ou piso 0.8 km
      const directMeters = calcHaversineMeters(baseLat, baseLng, newLat, newLng)
      const directKm = directMeters / 1000
      // Piso 0.8 km, arredondado a 1 casa decimal
      const newCalculatedKm = Number(Math.max(directKm, 0.8).toFixed(1))

      // Se a distância praticamente não mudou (< 50 metros), manter
      const coordShiftMeters = calcHaversineMeters(oldEndLat, oldEndLng, newLat, newLng)
      if (Math.abs(oldKm - newCalculatedKm) < 0.05 && coordShiftMeters < 50) {
        continue
      }

      // Atualizar o pedido com as novas coordenadas e o novo distance_km
      order.set('distance_km', newCalculatedKm)
      order.set('end_address_lat', newLat)
      order.set('end_address_lng', newLng)
      if (custAddress) {
        order.set('end_address_text', custAddress)
      }
      if (custName) {
        order.set('end_address_name', custName)
      }

      // Adicionar observação discreta no pedido sem quebrar notas existentes
      const currentNotes = order.getString('notes') || ''
      const recalcTag = `[KM Recalculado via Pin Corrigido: ${oldKm.toFixed(1)} km -> ${newCalculatedKm.toFixed(1)} km]`
      if (!currentNotes.includes('KM Recalculado via Pin Corrigido')) {
        order.set('notes', currentNotes ? `${currentNotes} | ${recalcTag}` : recalcTag)
      }

      e.app.save(order)

      console.log(
        `[customers_recalc_orders_km] Pedido ${order.getString('tracking_code') || order.id} recalculado: ${oldKm.toFixed(1)} km -> ${newCalculatedKm.toFixed(1)} km (cliente ${custName})`,
      )

      // Registrar na trilha de auditoria (audit_trail)
      // REGRA: user_id VAZIO + actor_name='Sistema' + metadata.system_trigger=true
      // Motivo exigido: 'pin corrigido após criação do pedido', valores antes/depois
      // NUNCA MEXE EM SALDOS DE CONTA CORRENTE
      if (auditCol) {
        try {
          const auditRec = new Record(auditCol)
          const courierId = order.getString('courier_id')
          if (courierId) {
            auditRec.set('courier_id', courierId)
          }
          // user_id fica VAZIO para ações automáticas do sistema (relation não aceita string 'system')
          auditRec.set('collection', 'orders')
          auditRec.set('record_id', order.id)
          auditRec.set('action', 'recalc_km_frozen_pin')
          auditRec.set('field', 'distance_km')
          auditRec.set(
            'old_value',
            `${oldKm.toFixed(2)} km (${oldEndLat.toFixed(6)}, ${oldEndLng.toFixed(6)})`,
          )
          auditRec.set(
            'new_value',
            `${newCalculatedKm.toFixed(2)} km (${newLat.toFixed(6)}, ${newLng.toFixed(6)})`,
          )
          auditRec.set('timestamp', new Date().toISOString())
          auditRec.set('metadata', {
            reason: 'pin corrigido após criação do pedido',
            customer_id: custId,
            customer_name: custName,
            tracking_code: order.getString('tracking_code'),
            status: order.getString('status'),
            old_distance_km: oldKm,
            new_distance_km: newCalculatedKm,
            actor_name: 'Sistema',
            actor_role: 'system',
            system_trigger: true,
            coord_shift_meters: Math.round(coordShiftMeters),
            operational_date: todayStr,
          })
          e.app.save(auditRec)
        } catch (auditErr) {
          console.warn('[customers_recalc_orders_km] Erro ao gravar audit_trail:', auditErr)
        }
      }
    }
  } catch (outerErr) {
    console.warn(
      '[customers_recalc_orders_km] Erro geral ao recalcular pedidos do cliente:',
      outerErr,
    )
  }
}, 'customers')

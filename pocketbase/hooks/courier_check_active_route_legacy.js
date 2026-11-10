// pocketbase/hooks/courier_check_active_route_legacy.js
// Alias do endpoint de rota ativa, mantido para não quebrar o app do entregador que
// ainda consulta /backend/v1/courier/check-active-route (fallback do deliveryService).
// Mesmo contrato e mesma resposta de courier_check_active_route.js.
//
// Um routerAdd por arquivo, handler inline e autocontido (regra do Skip Cloud).

routerAdd('GET', '/backend/v1/courier/check-active-route', (c) => {
  let courierId = ''

  try {
    courierId = (c.request.url.query().get('courier_id') || '').trim()
  } catch (_) {}

  if (!courierId) {
    try {
      const info = c.requestInfo()
      if (info && info.query && info.query.courier_id) {
        courierId = String(info.query.courier_id).trim()
      }
    } catch (_) {}
  }

  if (!courierId) {
    return c.json(200, {
      active: false,
      has_active_route: false,
      route_id: null,
      active_orders_count: 0,
      pending_deliveries_count: 0,
      active_batch_key: null,
      route_started_at: null,
      first_order_id: null,
      message: 'courier_id não informado',
    })
  }

  const safeId = String(courierId).replace(/[^a-zA-Z0-9]/g, '')
  if (!safeId) {
    return c.json(200, {
      active: false,
      has_active_route: false,
      route_id: null,
      active_orders_count: 0,
      pending_deliveries_count: 0,
      active_batch_key: null,
      route_started_at: null,
      first_order_id: null,
      message: 'courier_id inválido',
    })
  }

  try {
    const activeOrders = $app.findRecordsByFilter(
      'orders',
      `courier_id = '${safeId}' && route_started = true && route_finished = false && status != 'cancelled'`,
      '-route_started_at',
      50,
      0,
    )

    if (!activeOrders || activeOrders.length === 0) {
      return c.json(200, {
        active: false,
        has_active_route: false,
        route_id: null,
        active_orders_count: 0,
        pending_deliveries_count: 0,
        active_batch_key: null,
        route_started_at: null,
        first_order_id: null,
      })
    }

    const firstActive = activeOrders[0]
    const batchKey = firstActive.getString('route_batch_key') || ''
    const startedAt =
      firstActive.getString('route_started_at') || firstActive.getString('created') || null

    let pendingDeliveries = 0
    for (let i = 0; i < activeOrders.length; i++) {
      const st = activeOrders[i].getString('status')
      if (st !== 'delivered' && st !== 'client_absent') pendingDeliveries++
    }

    return c.json(200, {
      active: true,
      has_active_route: true,
      route_id: firstActive.id,
      active_orders_count: activeOrders.length,
      pending_deliveries_count: pendingDeliveries,
      active_batch_key: batchKey,
      route_started_at: startedAt,
      first_order_id: firstActive.id,
    })
  } catch (err) {
    console.error('[courier/check-active-route] Erro ao consultar rota ativa:', err)
    return c.json(200, {
      active: false,
      has_active_route: false,
      error: 'Erro ao verificar rota ativa do entregador.',
    })
  }
})

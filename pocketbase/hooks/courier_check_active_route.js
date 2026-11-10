// pocketbase/hooks/courier_check_active_route.js
// Endpoint atômico de verificação de rota ativa do entregador.
//
// Corrigido em 2026-11-10: o handler vivia em orders_prevent_overlapping_routes.js como
// `const handleCheckActiveRoute = ...` no topo do arquivo e era passado por referência para
// o routerAdd. O PocketBase executa callbacks em um pool de VM separado do registro, então
// identificadores top-level não existem em runtime: a rota era registrada e quebrava com
// ReferenceError ao ser chamada, devolvendo 404 "File not found" ao app.
// Regra do Skip Cloud: todo routerAdd recebe o handler inline, autocontido.
//
// Contrato: responde SEMPRE 200 (has_active_route=false quando não há courier_id ou rota).

routerAdd('GET', '/backend/v1/check-active-route', (c) => {
  let courierId = ''

  // Query param: forma canônica no PocketBase v0.36
  try {
    courierId = (c.request.url.query().get('courier_id') || '').trim()
  } catch (_) {}

  // Fallback: courier_id vindo do requestInfo, quando disponível
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

  // Sanitiza para interpolar na expressão de filtro sem quebrar a query
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
    console.error('[check-active-route] Erro ao consultar rota ativa:', err)
    return c.json(200, {
      active: false,
      has_active_route: false,
      error: 'Erro ao verificar rota ativa do entregador.',
    })
  }
})

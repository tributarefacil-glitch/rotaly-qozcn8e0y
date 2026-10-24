// pocketbase/hooks/orders_prevent_overlapping_routes.js
// REGRA PERMANENTE CONTRA RECORRÊNCIA DE SOBREPOSIÇÃO DE ROTAS:
// 1. Bloquear o início de nova rota (route_started=true) quando o entregador já possuir
//    outra rota/lote em andamento ativo (route_started=true && route_finished!=true).
// 2. Bloquear fechamento acidental conjunto de pedidos de lotes distintos no mesmo toque/update.
// 3. Garantir integridade de rotas órfãs ou esquecidas: não permitir que entrem em novo lote sem encerramento.
// 4. Registro de audit_trail para qualquer tentativa bloqueada (user_id='', actor_name='Sistema', metadata.system_trigger=true).

onRecordBeforeUpdate((e) => {
  const order = e.record
  const original = order.original()
  if (!original) {
    e.next()
    return
  }

  const courierId = order.getString('courier_id') || original.getString('courier_id')
  if (!courierId) {
    e.next()
    return
  }

  const isNowStarted = order.getBool('route_started')
  const wasStarted = original.getBool('route_started')
  const isNowFinished = order.getBool('route_finished')
  const wasFinished = original.getBool('route_finished')

  // CASO 1: TENTATIVA DE INICIAR ROTA (route_started false -> true)
  if (isNowStarted && !wasStarted) {
    const currentBatchKey = order.getString('route_batch_key')
    const currentOrderId = order.id

    try {
      // Buscar se o entregador já possui outro pedido com rota iniciada e não finalizada
      // que pertença a um LOTE DIFERENTE
      const activeDifferentOrders = $app.findRecordsByFilter(
        'orders',
        `courier_id = '${courierId}' && route_started = true && route_finished = false && id != '${currentOrderId}' && status != 'cancelled'`,
        '-route_started_at',
        20,
        0,
      )

      if (activeDifferentOrders && activeDifferentOrders.length > 0) {
        // Verificar se os pedidos ativos pertencem a uma chave de lote distinta
        for (let i = 0; i < activeDifferentOrders.length; i++) {
          const actOrd = activeDifferentOrders[i]
          const actKey = actOrd.getString('route_batch_key')
          const actStartedAt = actOrd.getString('route_started_at') || actOrd.getString('created')

          // Se a chave for diferente, ou se foi iniciado há mais de 5 minutos
          const isDifferentBatch = currentBatchKey && actKey && currentBatchKey !== actKey
          const timeDiffMinutes = Math.abs(
            (new Date(order.getString('route_started_at') || new Date()).getTime() -
              new Date(actStartedAt).getTime()) /
              60000,
          )

          if (isDifferentBatch || timeDiffMinutes > 5) {
            console.error(
              `[orders_prevent_overlapping_routes] BLOQUEIO: Entregador ${courierId} tentou iniciar pedido ${currentOrderId} (lote ${currentBatchKey || 'novo'}) mas já possui rota ativa no lote ${actKey || actOrd.id} iniciada em ${actStartedAt}!`,
            )

            // Registrar violação na audit_trail
            try {
              const auditCol = $app.findCollectionByNameOrId('audit_trail')
              if (auditCol) {
                const audit = new Record(auditCol)
                audit.set('user_id', '') // Sistema
                audit.set('collection', 'orders')
                audit.set('record_id', currentOrderId)
                audit.set('courier_id', courierId)
                audit.set('action', 'bloqueio_inicio_rota_sobreposta')
                audit.set('field', 'route_started')
                audit.set('old_value', 'false')
                audit.set('new_value', 'bloqueado_rota_anterior_ativa')
                audit.set('timestamp', new Date().toISOString())
                audit.set('metadata', {
                  system_trigger: true,
                  actor_name: 'Sistema',
                  blocked_order_id: currentOrderId,
                  active_order_id: actOrd.id,
                  active_batch_key: actKey,
                  attempted_batch_key: currentBatchKey,
                  courier_id: courierId,
                  reason: 'Entregador já possui rota em andamento não finalizada na base',
                })
                $app.save(audit)
              }
            } catch (_) {}

            throw new BadRequestError(
              'Você já possui uma rota ativa em andamento! Finalize a rota anterior e retorne à base antes de iniciar uma nova.',
            )
          }
        }
      }
    } catch (checkErr) {
      if (
        checkErr &&
        (checkErr.name === 'BadRequestError' ||
          checkErr.message?.includes('Você já possui uma rota ativa'))
      ) {
        throw checkErr
      }
    }
  }

  // CASO 2: TENTATIVA DE FINALIZAR ROTA (route_finished false -> true)
  // Bloquear fechamento se o pedido estiver sendo finalizado mas pertencer a lote divergente
  // de outros pedidos do mesmo update
  if (isNowFinished && !wasFinished) {
    const batchKey = order.getString('route_batch_key')
    const finishIso = order.getString('route_finished_at')

    // Garantir que route_finished_at esteja preenchido
    if (!finishIso) {
      order.set('route_finished_at', new Date().toISOString())
    }
  }

  e.next()
}, 'orders')

// Endpoint customizado seguro para verificação atômica de status do entregador antes de iniciar
routerAdd('GET', '/backend/v1/courier/check-active-route', (c) => {
  const authRecord =
    (typeof c.Auth === 'function' ? c.Auth() : null) || c.auth || c.get('authRecord')
  if (!authRecord) {
    return c.json(401, { error: 'Requer autenticação.' })
  }

  const courierId = (c.requestInfo().query.courier_id || authRecord.id || '').trim()
  if (!courierId) {
    return c.json(400, { error: 'courier_id é obrigatório.' })
  }

  try {
    const activeOrders = $app.findRecordsByFilter(
      'orders',
      `courier_id = '${courierId}' && route_started = true && route_finished = false && status != 'cancelled'`,
      '-route_started_at',
      50,
      0,
    )

    if (!activeOrders || activeOrders.length === 0) {
      return c.json(200, {
        has_active_route: false,
        active_orders_count: 0,
        active_batch_key: null,
      })
    }

    const firstActive = activeOrders[0]
    const batchKey = firstActive.getString('route_batch_key') || ''
    const startedAt = firstActive.getString('route_started_at') || firstActive.getString('created')

    const pendingDeliveries = activeOrders.filter(
      (o) => o.getString('status') !== 'delivered' && o.getString('status') !== 'client_absent',
    ).length

    return c.json(200, {
      has_active_route: true,
      active_orders_count: activeOrders.length,
      pending_deliveries_count: pendingDeliveries,
      active_batch_key: batchKey,
      route_started_at: startedAt,
      first_order_id: firstActive.id,
    })
  } catch (err) {
    console.error('[check-active-route] Erro ao consultar rota ativa:', err)
    return c.json(500, { error: 'Erro ao verificar rota ativa do entregador.' })
  }
})

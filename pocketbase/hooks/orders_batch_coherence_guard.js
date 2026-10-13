// Hook PocketBase de Coerência e Blindagem de Chaves de Lote (route_batch_key):
// (1) onRecordCreate e onRecordUpdate em orders:
//     - Se route_started_at informado/alterado e a chave divergir do minuto canônico em mais de 2 min
//       (|bKeyMin - startedAtMin| > 2), recalcular e regravar route_batch_key automaticamente.
//     - Inserir audit_trail (user_id='', actor_name='Sistema', metadata.system_trigger=true, reason='route_batch_key_coherence_guard').
//     - Disparar reprocessamento do lote afetado via motor ($http ou endpoint interno).
//     - Pedido atribuído a entregador com rota ativa (route_started true, route_finished false)
//       herda a chave do lote ativo, nunca gera chave própria.
// (2) Atenção: Usuário autenticado vem de c.Auth() quando em rotas HTTP.

onRecordCreate((e) => {
  try {
    const order = e.record
    const courierId = order.getString('courier_id')
    const routeStartedAt = order.getString('route_started_at')
    let currentKey = order.getString('route_batch_key')

    // Se há entregador associado, verificar se ele possui uma rota ativa em andamento
    if (courierId) {
      try {
        const activeRouteOrders = e.app.findRecordsByFilter(
          'orders',
          `courier_id = '${courierId}' && route_started = true && route_finished = false && id != '${order.id}'`,
          '-route_started_at',
          1,
          0,
        )

        if (activeRouteOrders && activeRouteOrders.length > 0) {
          const activeKey = activeRouteOrders[0].getString('route_batch_key')
          if (activeKey && activeKey !== currentKey) {
            order.set('route_batch_key', activeKey)
            currentKey = activeKey
            console.log(
              `[orders_batch_coherence_guard] Pedido ${order.id} herdou route_batch_key '${activeKey}' da rota ativa do entregador ${courierId}.`,
            )
          }
        }
      } catch (eActive) {
        console.log('[orders_batch_coherence_guard] Erro ao checar rota ativa:', eActive)
      }
    }

    // Se route_started_at está informado, validar minutagem canônica
    if (routeStartedAt) {
      const sMs = new Date(routeStartedAt).getTime()
      if (!isNaN(sMs) && sMs > 0) {
        const startedAtMin = Math.floor(sMs / 60000)
        const dayKey = routeStartedAt.slice(0, 10).replace(/-/g, '')
        const canonicalKey = `rb_${courierId || 'unassigned'}_${dayKey}_${startedAtMin}`

        let isDivergent = false
        if (!currentKey) {
          isDivergent = true
        } else {
          const parts = currentKey.split('_')
          const keyMin = parseInt(parts[parts.length - 1], 10)
          if (isNaN(keyMin) || Math.abs(keyMin - startedAtMin) > 2) {
            isDivergent = true
          }
        }

        if (isDivergent) {
          order.set('route_batch_key', canonicalKey)
          console.log(
            `[orders_batch_coherence_guard] route_batch_key corrigido na criação para ${canonicalKey} (pedido ${order.id})`,
          )
        }
      }
    }
  } catch (err) {
    console.log('[orders_batch_coherence_guard] Erro no onRecordCreate:', err)
  }

  e.next()
}, 'orders')

onRecordUpdate((e) => {
  let needsReprocess = false
  let canonicalKeyToReprocess = ''

  try {
    const order = e.record
    const original = order.original()
    const courierId = order.getString('courier_id')
    const routeStartedAt = order.getString('route_started_at')
    const origRouteStartedAt = original ? original.getString('route_started_at') : ''
    const currentKey = order.getString('route_batch_key')
    const origKey = original ? original.getString('route_batch_key') : ''

    // 1. Pedido atribuído a entregador com rota ativa herda a chave do lote ativo
    const origCourierId = original ? original.getString('courier_id') : ''
    const courierChanged = courierId && courierId !== origCourierId
    const isNowStarted = order.getBool('route_started')
    const isNowFinished = order.getBool('route_finished')

    if (courierId && (courierChanged || (!isNowStarted && !currentKey))) {
      try {
        const activeRouteOrders = e.app.findRecordsByFilter(
          'orders',
          `courier_id = '${courierId}' && route_started = true && route_finished = false && id != '${order.id}'`,
          '-route_started_at',
          1,
          0,
        )

        if (activeRouteOrders && activeRouteOrders.length > 0) {
          const activeKey = activeRouteOrders[0].getString('route_batch_key')
          if (activeKey && activeKey !== currentKey) {
            order.set('route_batch_key', activeKey)
            console.log(
              `[orders_batch_coherence_guard] Pedido ${order.id} herdou route_batch_key '${activeKey}' da rota ativa existente do entregador ${courierId}.`,
            )
          }
        }
      } catch (eActive) {
        console.log('[orders_batch_coherence_guard] Erro ao checar rota ativa:', eActive)
      }
    }

    // 2. Se route_started_at informado ou alterado, validar divergência de minuto
    const effectiveKey = order.getString('route_batch_key')
    if (routeStartedAt) {
      const sMs = new Date(routeStartedAt).getTime()
      if (!isNaN(sMs) && sMs > 0) {
        const startedAtMin = Math.floor(sMs / 60000)
        const dayKey = routeStartedAt.slice(0, 10).replace(/-/g, '')
        const expectedCanonicalKey = `rb_${courierId || 'unassigned'}_${dayKey}_${startedAtMin}`

        let isDivergent = false
        if (!effectiveKey) {
          isDivergent = true
        } else {
          const parts = effectiveKey.split('_')
          const keyMin = parseInt(parts[parts.length - 1], 10)
          if (isNaN(keyMin) || Math.abs(keyMin - startedAtMin) > 2) {
            isDivergent = true
          }
        }

        if (isDivergent) {
          order.set('route_batch_key', expectedCanonicalKey)
          needsReprocess = true
          canonicalKeyToReprocess = expectedCanonicalKey

          console.log(
            `[orders_batch_coherence_guard] route_batch_key corrigido de '${effectiveKey}' para '${expectedCanonicalKey}' no pedido ${order.id}`,
          )

          // Registrar entrada na audit_trail
          try {
            const auditCol = e.app.findCollectionByNameOrId('audit_trail')
            if (auditCol) {
              const auditRec = new Record(auditCol)
              auditRec.set('user_id', '') // relation não aceita 'system'
              auditRec.set('collection', 'orders')
              auditRec.set('record_id', order.id)
              if (courierId) auditRec.set('courier_id', courierId)
              auditRec.set('action', 'route_batch_key_coherence_guard')
              auditRec.set('field', 'route_batch_key')
              auditRec.set('old_value', effectiveKey || 'vazio')
              auditRec.set('new_value', expectedCanonicalKey)
              auditRec.set('timestamp', new Date().toISOString())
              auditRec.set('metadata', {
                system_trigger: true,
                actor_name: 'Sistema',
                reason: 'route_batch_key_coherence_guard',
                started_at: routeStartedAt,
                started_at_min: startedAtMin,
                tracking_code: order.getString('tracking_code'),
              })
              e.app.save(auditRec)
            }
          } catch (eAudit) {
            console.log('[orders_batch_coherence_guard] Erro audit_trail:', eAudit)
          }
        }
      }
    }
  } catch (err) {
    console.log('[orders_batch_coherence_guard] Erro no onRecordUpdate:', err)
  }

  e.next()
}, 'orders')

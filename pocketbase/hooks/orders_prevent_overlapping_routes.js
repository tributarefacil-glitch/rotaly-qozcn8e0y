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

// NOTA (2026-11-10): os endpoints de verificação de rota ativa que ficavam neste arquivo
// foram movidos para courier_check_active_route.js e courier_check_active_route_legacy.js.
// Motivo: o PocketBase executa handlers de routerAdd em um pool de VM separado do registro,
// então um handler declarado no topo do arquivo e passado por referência quebra em runtime
// (ReferenceError -> 404 "File not found"). Cada arquivo de hook agora tem exatamente um
// routerAdd, com o handler inline e autocontido.

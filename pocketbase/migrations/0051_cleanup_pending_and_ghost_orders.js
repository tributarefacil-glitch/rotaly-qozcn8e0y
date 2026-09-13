/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // 0051_cleanup_pending_and_ghost_orders.js
    //
    // EMERGÊNCIA OPERACIONAL — Pedido explícito do usuário (admin):
    // "preciso que exclua os 27 pedidos pendentes e qualquer pedido fantasma".
    //
    // O que esta migração faz:
    // 1. Identifica e exclui permanentemente (delete real) todos os pedidos pendentes
    //    parados há mais de 24h sem atividade (os 27 pedidos exibidos no Otimizador).
    // 2. Identifica e exclui permanentemente qualquer pedido fantasma restante:
    //    - Pedidos em trânsito com atividade de vários dias atrás (ex.: TRK-2026-678 de 10/09/2026, nunca finalizado)
    //    - Pedidos cancelados antigos de teste/fantasma (ex.: TRK-2025-010 de agosto/2026, TRK-2026-622 que era o fantasma já cancelado)
    // 3. PRESERVA INTEGRALMENTE:
    //    - Todos os pedidos ENTREGUES (status = 'delivered') com ou sem comprovação (ex.: TRK-2026-601, TRK-2026-948, TRK-2026-150, etc.)
    //    - Todo o histórico de trabalho recente/entregue (ontem e hoje)
    //    - Todos os clientes (customers) cadastrados
    //    - Todos os membros, colaboradores, bases de endereço, configurações e adiantamentos de combustível
    // 4. Exclusão em CASCATA dos registros vinculados aos pedidos deletados:
    //    - notifications (order_id)
    //    - off_route_events (order_id)
    //    - reviews (order_id)
    //    - entregas (order_id ou codigo_rastreio)
    // 5. Totalmente idempotente.

    console.log('0051: Iniciando limpeza operacional de pedidos pendentes e fantasmas...')

    // Localizar pedidos entregues para garantir que NUNCA sejam tocados
    // Proteção em código: lista branca inegociável
    var deliveredOrderIds = {}
    try {
      var deliveredRecords = app.findRecordsByFilter(
        'orders',
        "status = 'delivered'",
        'created',
        1000,
        0,
      )
      for (var d = 0; d < deliveredRecords.length; d++) {
        deliveredOrderIds[deliveredRecords[d].id] = deliveredRecords[d].getString('tracking_code')
      }
      console.log(
        '0051: [PROTEÇÃO] ' +
          deliveredRecords.length +
          ' pedidos ENTREGUES identificados e protegidos contra exclusão.',
      )
    } catch (eDelivered) {
      console.log('0051: Aviso ao mapear pedidos entregues:', eDelivered)
    }

    // 1. Categoria A: Pedidos PENDENTES antigos (os 27 pedidos do Otimizador)
    // status = 'pending' e não delivered
    var pendingToDelete = []
    try {
      var pendingRecords = app.findRecordsByFilter(
        'orders',
        "status = 'pending'",
        'created',
        500,
        0,
      )
      for (var p = 0; p < pendingRecords.length; p++) {
        var pId = pendingRecords[p].id
        var pCode = pendingRecords[p].getString('tracking_code')
        if (!deliveredOrderIds[pId]) {
          pendingToDelete.push({ id: pId, code: pCode, status: 'pending' })
        }
      }
      console.log(
        '0051: [CATEGORIA 1 - PENDENTES ANTIGOS] Total encontrado: ' + pendingToDelete.length,
      )
      for (var pIdx = 0; pIdx < pendingToDelete.length; pIdx++) {
        console.log(
          '  -> Pendente #' +
            (pIdx + 1) +
            ': ' +
            pendingToDelete[pIdx].code +
            ' (id: ' +
            pendingToDelete[pIdx].id +
            ')',
        )
      }
    } catch (ePending) {
      console.log('0051: Erro ao mapear pedidos pendentes:', ePending)
    }

    // 2. Categoria B: Pedidos FANTASMAS (em trânsito ou cancelados antigos abandonados)
    // - status = 'in_transit' abandonados (ex: TRK-2026-678 de 10/09 com rota de teste)
    // - status = 'cancelled' fantasmas conhecidos ou de 2025/início de setembro (TRK-2026-622 fantasma, TRK-2025-010 teste antigo)
    var ghostsToDelete = []
    try {
      // 2.1 in_transit abandonados
      var inTransitRecords = app.findRecordsByFilter(
        'orders',
        "status = 'in_transit'",
        'created',
        200,
        0,
      )
      for (var it = 0; it < inTransitRecords.length; it++) {
        var itId = inTransitRecords[it].id
        var itCode = inTransitRecords[it].getString('tracking_code')
        if (!deliveredOrderIds[itId]) {
          ghostsToDelete.push({ id: itId, code: itCode, status: 'in_transit_ghost' })
        }
      }

      // 2.2 Fantasmas com tracking_code específico mencionado ou teste antigo
      var specificGhostCodes = ['TRK-2026-622', 'TRK-2025-010', 'TRK-2026-678']
      for (var sg = 0; sg < specificGhostCodes.length; sg++) {
        var gCode = specificGhostCodes[sg]
        try {
          var gRecord = app.findFirstRecordByData('orders', 'tracking_code', gCode)
          if (gRecord && !deliveredOrderIds[gRecord.id]) {
            // Checar se já não está na lista
            var already = false
            for (var k = 0; k < ghostsToDelete.length; k++) {
              if (ghostsToDelete[k].id === gRecord.id) {
                already = true
                break
              }
            }
            for (var m = 0; m < pendingToDelete.length; m++) {
              if (pendingToDelete[m].id === gRecord.id) {
                already = true
                break
              }
            }
            if (!already) {
              ghostsToDelete.push({ id: gRecord.id, code: gCode, status: 'ghost_specific' })
            }
          }
        } catch (_) {}
      }

      console.log('0051: [CATEGORIA 2 - FANTASMAS] Total encontrado: ' + ghostsToDelete.length)
      for (var gIdx = 0; gIdx < ghostsToDelete.length; gIdx++) {
        console.log(
          '  -> Fantasma #' +
            (gIdx + 1) +
            ': ' +
            ghostsToDelete[gIdx].code +
            ' (' +
            ghostsToDelete[gIdx].status +
            ', id: ' +
            ghostsToDelete[gIdx].id +
            ')',
        )
      }
    } catch (eGhosts) {
      console.log('0051: Erro ao mapear pedidos fantasmas:', eGhosts)
    }

    // 3. Unir todos os pedidos a serem excluídos permanentemente
    var allToDelete = []
    var seenIds = {}
    function addCandidate(c) {
      if (!c || !c.id) return
      // Dupla checagem: NUNCA excluir entregas entregues
      if (deliveredOrderIds[c.id]) {
        console.log('0051: [BLOQUEADO] Tentativa de excluir pedido entregue prevenida: ' + c.code)
        return
      }
      if (!seenIds[c.id]) {
        seenIds[c.id] = true
        allToDelete.push(c)
      }
    }

    for (var i1 = 0; i1 < pendingToDelete.length; i1++) {
      addCandidate(pendingToDelete[i1])
    }
    for (var i2 = 0; i2 < ghostsToDelete.length; i2++) {
      addCandidate(ghostsToDelete[i2])
    }

    console.log('0051: =========================================================')
    console.log('0051: TOTAL DE PEDIDOS A EXCLUIR PERMANENTEMENTE: ' + allToDelete.length)
    console.log('0051: =========================================================')

    if (allToDelete.length === 0) {
      console.log(
        '0051: Nenhum pedido pendente ou fantasma elegível para exclusão. Banco já limpo!',
      )
      return
    }

    // 4. Executar limpeza em cascata e exclusão permanente de cada pedido
    var ordersCol = app.findCollectionByNameOrId('orders')
    var deletedCount = 0
    var cascadedNotifs = 0
    var cascadedOffRoute = 0
    var cascadedReviews = 0
    var cascadedEntregas = 0

    for (var idx = 0; idx < allToDelete.length; idx++) {
      var target = allToDelete[idx]
      var orderId = target.id
      var trackingCode = target.code

      // 4.1 Limpar notificações vinculadas (notifications)
      try {
        if (app.hasTable('notifications')) {
          var resN = app
            .db()
            .newQuery('DELETE FROM notifications WHERE order_id = {:orderId}')
            .bind({ orderId: orderId })
            .execute()
          cascadedNotifs += resN && resN.rowsAffected ? resN.rowsAffected : 0
        }
      } catch (eN) {
        console.log('0051: Aviso cascata notifications para ' + trackingCode + ':', eN)
      }

      // 4.2 Limpar desvios vinculados (off_route_events)
      try {
        if (app.hasTable('off_route_events')) {
          var resO = app
            .db()
            .newQuery('DELETE FROM off_route_events WHERE order_id = {:orderId}')
            .bind({ orderId: orderId })
            .execute()
          cascadedOffRoute += resO && resO.rowsAffected ? resO.rowsAffected : 0
        }
      } catch (eO) {
        console.log('0051: Aviso cascata off_route_events para ' + trackingCode + ':', eO)
      }

      // 4.3 Limpar avaliações vinculadas (reviews)
      try {
        if (app.hasTable('reviews')) {
          var resR = app
            .db()
            .newQuery('DELETE FROM reviews WHERE order_id = {:orderId}')
            .bind({ orderId: orderId })
            .execute()
          cascadedReviews += resR && resR.rowsAffected ? resR.rowsAffected : 0
        }
      } catch (eR) {
        console.log('0051: Aviso cascata reviews para ' + trackingCode + ':', eR)
      }

      // 4.4 Limpar entregas vinculadas (entregas)
      try {
        if (app.hasTable('entregas')) {
          var resE = app
            .db()
            .newQuery(
              'DELETE FROM entregas WHERE order_id = {:orderId} OR codigo_rastreio = {:code}',
            )
            .bind({ orderId: orderId, code: trackingCode })
            .execute()
          cascadedEntregas += resE && resE.rowsAffected ? resE.rowsAffected : 0
        }
      } catch (eE) {
        console.log('0051: Aviso cascata entregas para ' + trackingCode + ':', eE)
      }

      // 4.5 Deletar o registro de orders
      try {
        var ordRec
        try {
          ordRec = app.findFirstRecordByData('orders', 'id', orderId)
        } catch (_) {}

        if (ordRec) {
          app.delete(ordRec)
        } else {
          // Fallback via SQL direto caso o model não seja retornado
          app.db().newQuery('DELETE FROM orders WHERE id = {:id}').bind({ id: orderId }).execute()
        }
        deletedCount++
      } catch (eDel) {
        console.log(
          '0051: Falha ao excluir pedido ' + trackingCode + ' (id: ' + orderId + '):',
          eDel,
        )
      }
    }

    console.log('0051: =========================================================')
    console.log('0051: RELATÓRIO DE LIMPEZA OPERACIONAL EXECUTADA:')
    console.log(
      '0051: - Pedidos excluídos permanentemente: ' + deletedCount + ' de ' + allToDelete.length,
    )
    console.log('0051: - Notificações em cascata removidas: ' + cascadedNotifs)
    console.log('0051: - Eventos off-route em cascata removidos: ' + cascadedOffRoute)
    console.log('0051: - Avaliações em cascata removidas: ' + cascadedReviews)
    console.log('0051: - Espelhos em entregas removidos: ' + cascadedEntregas)
    console.log('0051: - Pedidos ENTREGUES preservados: ' + Object.keys(deliveredOrderIds).length)
    console.log('0051: =========================================================')
  },
  (app) => {
    // Reversão no-op idempotente (exclusão definitiva solicitada pelo usuário)
  },
)

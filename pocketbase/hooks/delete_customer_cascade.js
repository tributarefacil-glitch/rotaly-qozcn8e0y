// Hook para exclusão em cascata de cliente pelo vendedor / admin
// Exclui pedidos vinculados (e registros atrelados a esses pedidos como notificações/reviews/desvios)
// e em seguida exclui o cliente.
// Regra: Não permite excluir se houver entregas já iniciadas ou em trânsito (apenas pendentes/concluídas/canceladas).

routerAdd(
  'POST',
  '/backend/v1/customers/{id}/delete-cascade',
  (e) => {
    try {
      const authUser = e.auth
      if (!authUser) {
        return e.json(401, { message: 'Autenticação necessária.' })
      }

      const callerRole = authUser.getString('role')
      if (callerRole !== 'admin' && callerRole !== 'seller') {
        return e.json(403, {
          message: 'Apenas vendedores e administradores podem excluir clientes.',
        })
      }

      const customerId = e.request.pathValue('id')
      if (!customerId) {
        return e.json(400, { message: 'ID de cliente não informado.' })
      }

      let customer
      try {
        customer = $app.findRecordById('customers', customerId)
      } catch (findErr) {
        return e.json(404, { message: 'Cliente não encontrado.' })
      }

      // Buscar pedidos vinculados a este cliente
      let linkedOrders = []
      try {
        linkedOrders = $app.findRecordsByFilter(
          'orders',
          "customer_id = '" + customerId + "'",
          '-created',
          1000,
          0,
        )
      } catch (err) {
        console.log('Erro ao buscar pedidos do cliente:', err)
      }

      // Verificar se há pedidos ativos em trânsito ou com rota iniciada
      const activeInTransit = linkedOrders.filter((ord) => {
        const status = ord.getString('status')
        const routeStarted = ord.getBool('route_started')
        const routeReleased = ord.getBool('route_released')
        return (
          status === 'in_transit' ||
          (routeStarted && !ord.getBool('route_finished')) ||
          (routeReleased && status === 'assigned')
        )
      })

      if (activeInTransit.length > 0) {
        return e.json(400, {
          message:
            'Não é possível excluir o cliente pois ele possui entregas em trânsito ou em rota já liberada.',
        })
      }

      let deletedOrdersCount = 0

      // Exclusão em cascata dentro de transação atômica
      $app.runInTransaction((txApp) => {
        for (let i = 0; i < linkedOrders.length; i++) {
          const ord = linkedOrders[i]
          const orderId = ord.id

          // 1. Excluir notificações vinculadas ao pedido
          try {
            const notifs = txApp.findRecordsByFilter(
              'notifications',
              "order_id = '" + orderId + "'",
              '-created',
              500,
              0,
            )
            for (let n = 0; n < notifs.length; n++) {
              txApp.delete(notifs[n])
            }
          } catch (_) {}

          // 2. Excluir avaliações (reviews) vinculadas ao pedido
          try {
            const revs = txApp.findRecordsByFilter(
              'reviews',
              "order_id = '" + orderId + "'",
              '-created',
              500,
              0,
            )
            for (let r = 0; r < revs.length; r++) {
              txApp.delete(revs[r])
            }
          } catch (_) {}

          // 3. Excluir eventos de desvio (off_route_events) vinculados ao pedido
          try {
            const offEvents = txApp.findRecordsByFilter(
              'off_route_events',
              "order_id = '" + orderId + "'",
              '-created',
              500,
              0,
            )
            for (let o = 0; o < offEvents.length; o++) {
              txApp.delete(offEvents[o])
            }
          } catch (_) {}

          // 4. Excluir o pedido em si
          txApp.delete(ord)
          deletedOrdersCount++
        }

        // 5. Excluir o cadastro do cliente
        txApp.delete(customer)
      })

      return e.json(200, {
        success: true,
        message: 'Cliente e ' + deletedOrdersCount + ' pedido(s) excluído(s) com sucesso.',
        deletedOrdersCount: deletedOrdersCount,
      })
    } catch (err) {
      console.log('Erro ao excluir cliente em cascata:', err)
      return e.json(500, {
        message: 'Erro interno ao excluir cliente: ' + (err.message || String(err)),
      })
    }
  },
  $apis.requireAuth(),
)

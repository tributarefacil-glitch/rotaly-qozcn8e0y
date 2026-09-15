/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // Limpar o evento falso de desvio gerado às 18:47:08 para o pedido TRK-2026-959 (id 'xsdwf1liq7acel1')
    // que ocorreu após a entrega do pedido ter sido concluída (18:47:07).
    try {
      app
        .db()
        .newQuery(
          "DELETE FROM off_route_events WHERE order_id = 'xsdwf1liq7acel1' AND event_type = 'route_deviation'",
        )
        .execute()
    } catch (err) {
      console.log('Error deleting false off_route_event for xsdwf1liq7acel1:', err)
    }

    // Limpar também as notificações correspondentes geradas indevidamente para entregador e vendedor
    try {
      app
        .db()
        .newQuery(
          "DELETE FROM notifications WHERE order_id = 'xsdwf1liq7acel1' AND type = 'off_route'",
        )
        .execute()
    } catch (errNotif) {
      console.log('Error deleting false notifications for xsdwf1liq7acel1:', errNotif)
    }
  },
  (app) => {
    // Revert irrelevante para remoção de evento espúrio
  },
)

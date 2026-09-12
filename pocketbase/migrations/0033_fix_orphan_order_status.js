migrate(
  (app) => {
    try {
      const record = app.findFirstRecordByData('orders', 'id', 'u9igr82zvokrtu9')
      if (record) {
        record.set('status', 'pending')
        record.set('route_started', false)
        record.set('route_released', false)
        record.set('route_finished', false)
        app.save(record)
      }
    } catch (_) {
      // Se o pedido não existir ou já tiver sido alterado, ignora
    }
  },
  (app) => {
    try {
      const record = app.findFirstRecordByData('orders', 'id', 'u9igr82zvokrtu9')
      if (record) {
        record.set('status', 'in_transit')
        app.save(record)
      }
    } catch (_) {}
  },
)

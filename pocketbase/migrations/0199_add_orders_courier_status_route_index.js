/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('orders')

    // Verifica se o índice composto já existe para evitar duplicação
    const exists = collection.indexes.some((idx) => idx.includes('idx_orders_courier_status_route'))

    if (!exists) {
      collection.indexes.push(
        'CREATE INDEX idx_orders_courier_status_route ON orders (courier_id, status, route_started)',
      )
      app.save(collection)
    }
  },
  (app) => {
    try {
      const collection = app.findCollectionByNameOrId('orders')
      collection.indexes = collection.indexes.filter(
        (idx) => !idx.includes('idx_orders_courier_status_route'),
      )
      app.save(collection)
    } catch (e) {
      // ignore
    }
  },
)

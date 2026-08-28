migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')
    const ordersCol = app.findCollectionByNameOrId('orders')
    const customersCol = app.findCollectionByNameOrId('customers')

    // 1. fuel_advances (Adiantamentos/Pagamentos de combustível ao entregador)
    const fuelAdvances = new Collection({
      name: 'fuel_advances',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != ''",
      fields: [
        {
          name: 'courier_id',
          type: 'relation',
          required: true,
          collectionId: usersCol.id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        { name: 'amount', type: 'number', required: true, min: 0.01 },
        { name: 'date', type: 'date', required: true },
        { name: 'notes', type: 'text' },
        {
          name: 'payment_method',
          type: 'select',
          values: ['pix', 'dinheiro', 'transferencia', 'outro'],
          maxSelect: 1,
        },
        {
          name: 'created_by',
          type: 'relation',
          collectionId: usersCol.id,
          cascadeDelete: false,
          maxSelect: 1,
        },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE INDEX idx_fuel_advances_courier ON fuel_advances (courier_id, date DESC)'],
    })
    app.save(fuelAdvances)

    // 2. reviews (Avaliação de entregador e vendedor pelo cliente no rastreio público)
    const reviews = new Collection({
      name: 'reviews',
      type: 'base',
      listRule: '', // public list/view for tracking page
      viewRule: '',
      createRule: '', // public can create from public tracking page
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != ''",
      fields: [
        {
          name: 'order_id',
          type: 'relation',
          required: true,
          collectionId: ordersCol.id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        {
          name: 'courier_id',
          type: 'relation',
          collectionId: usersCol.id,
          cascadeDelete: false,
          maxSelect: 1,
        },
        {
          name: 'seller_id',
          type: 'relation',
          collectionId: usersCol.id,
          cascadeDelete: false,
          maxSelect: 1,
        },
        { name: 'courier_rating', type: 'number', required: true, min: 1, max: 5 },
        { name: 'seller_rating', type: 'number', required: true, min: 1, max: 5 },
        { name: 'comment', type: 'text' },
        { name: 'customer_name', type: 'text' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_reviews_order ON reviews (order_id)',
        'CREATE INDEX idx_reviews_courier ON reviews (courier_id)',
        'CREATE INDEX idx_reviews_seller ON reviews (seller_id)',
      ],
    })
    app.save(reviews)

    // 3. off_route_events (Eventos de desvio > 500m e paradas fora da rota)
    const offRouteEvents = new Collection({
      name: 'off_route_events',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != ''",
      fields: [
        {
          name: 'courier_id',
          type: 'relation',
          required: true,
          collectionId: usersCol.id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        {
          name: 'order_id',
          type: 'relation',
          collectionId: ordersCol.id,
          cascadeDelete: false,
          maxSelect: 1,
        },
        {
          name: 'event_type',
          type: 'select',
          required: true,
          values: ['route_deviation', 'unexpected_stop'],
          maxSelect: 1,
        },
        { name: 'distance_deviation_meters', type: 'number' },
        { name: 'stop_duration_seconds', type: 'number' },
        { name: 'lat', type: 'number', required: true },
        { name: 'lng', type: 'number', required: true },
        { name: 'address', type: 'text' },
        { name: 'notes', type: 'text' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_off_route_courier_created ON off_route_events (courier_id, created DESC)',
        'CREATE INDEX idx_off_route_type ON off_route_events (event_type)',
      ],
    })
    app.save(offRouteEvents)
  },
  (app) => {
    try {
      const offRouteEvents = app.findCollectionByNameOrId('off_route_events')
      app.delete(offRouteEvents)
    } catch (_) {}

    try {
      const reviews = app.findCollectionByNameOrId('reviews')
      app.delete(reviews)
    } catch (_) {}

    try {
      const fuelAdvances = app.findCollectionByNameOrId('fuel_advances')
      app.delete(fuelAdvances)
    } catch (_) {}
  },
)

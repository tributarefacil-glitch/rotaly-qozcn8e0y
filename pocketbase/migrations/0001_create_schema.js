migrate(
  (app) => {
    // 1. Update users auth collection with role, status
    const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')

    if (!usersCol.fields.getByName('role')) {
      usersCol.fields.add(
        new SelectField({
          name: 'role',
          values: ['admin', 'seller', 'courier'],
          maxSelect: 1,
          required: false,
        }),
      )
    }

    if (!usersCol.fields.getByName('status')) {
      usersCol.fields.add(
        new SelectField({
          name: 'status',
          values: ['active', 'idle', 'busy'],
          maxSelect: 1,
          required: false,
        }),
      )
    }

    // users access rules
    usersCol.listRule = "@request.auth.id != ''"
    usersCol.viewRule = "@request.auth.id != '' || @request.auth.id = ''"
    usersCol.updateRule = "@request.auth.id != ''"
    usersCol.deleteRule = "@request.auth.role = 'admin'"
    app.save(usersCol)

    // 2. Create customers collection
    const customersCol = new Collection({
      name: 'customers',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.role = 'admin'",
      fields: [
        { name: 'name', type: 'text', required: true },
        { name: 'phone', type: 'text', required: true },
        { name: 'address', type: 'text', required: true },
        { name: 'lat', type: 'number', required: false },
        { name: 'lng', type: 'number', required: false },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_customers_name ON customers (name)',
        'CREATE INDEX idx_customers_phone ON customers (phone)',
      ],
    })
    app.save(customersCol)

    // 3. Create orders collection
    const ordersCol = new Collection({
      name: 'orders',
      type: 'base',
      // Public tracking access rule allows public reads by tracking_code
      listRule:
        "@request.auth.id != '' || (@request.query.tracking_code != '' && tracking_code = @request.query.tracking_code)",
      viewRule: "@request.auth.id != '' || tracking_code != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.role = 'admin'",
      fields: [
        {
          name: 'seller_id',
          type: 'relation',
          collectionId: '_pb_users_auth_',
          maxSelect: 1,
          required: false,
        },
        {
          name: 'customer_id',
          type: 'relation',
          collectionId: customersCol.id,
          maxSelect: 1,
          required: true,
        },
        {
          name: 'courier_id',
          type: 'relation',
          collectionId: '_pb_users_auth_',
          maxSelect: 1,
          required: false,
        },
        {
          name: 'status',
          type: 'select',
          values: ['pending', 'in_transit', 'delivered', 'cancelled'],
          maxSelect: 1,
          required: true,
        },
        { name: 'tracking_code', type: 'text', required: true },
        { name: 'items', type: 'json', required: false },
        { name: 'total_price', type: 'number', required: false },
        {
          name: 'priority',
          type: 'select',
          values: ['normal', 'urgent', 'high'],
          maxSelect: 1,
          required: false,
        },
        { name: 'estimated_arrival', type: 'date', required: false },
        { name: 'actual_arrival', type: 'date', required: false },
        {
          name: 'signature',
          type: 'file',
          maxSelect: 1,
          maxSize: 5242880,
          mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        {
          name: 'proof_photo',
          type: 'file',
          maxSelect: 1,
          maxSize: 5242880,
          mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
        },
        { name: 'notes', type: 'text', required: false },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_orders_tracking_code ON orders (tracking_code)',
        'CREATE INDEX idx_orders_status ON orders (status)',
        'CREATE INDEX idx_orders_courier ON orders (courier_id)',
        'CREATE INDEX idx_orders_customer ON orders (customer_id)',
      ],
    })
    app.save(ordersCol)

    // 4. Create locations collection
    const locationsCol = new Collection({
      name: 'locations',
      type: 'base',
      listRule: '',
      viewRule: '',
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.role = 'admin'",
      fields: [
        {
          name: 'user_id',
          type: 'relation',
          collectionId: '_pb_users_auth_',
          maxSelect: 1,
          required: true,
        },
        { name: 'lat', type: 'number', required: true },
        { name: 'lng', type: 'number', required: true },
        { name: 'speed', type: 'number', required: false },
        { name: 'heading', type: 'number', required: false },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE INDEX idx_locations_user_created ON locations (user_id, created DESC)'],
    })
    app.save(locationsCol)

    // 5. Create notifications collection
    const notificationsCol = new Collection({
      name: 'notifications',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != ''",
      fields: [
        {
          name: 'user_id',
          type: 'relation',
          collectionId: '_pb_users_auth_',
          maxSelect: 1,
          required: false,
        },
        { name: 'title', type: 'text', required: true },
        { name: 'message', type: 'text', required: true },
        {
          name: 'type',
          type: 'select',
          values: ['delay', 'system', 'order', 'off_route', 'warning'],
          maxSelect: 1,
          required: true,
        },
        { name: 'read', type: 'bool', required: false },
        {
          name: 'order_id',
          type: 'relation',
          collectionId: ordersCol.id,
          maxSelect: 1,
          required: false,
        },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE INDEX idx_notifications_user_read ON notifications (user_id, read)'],
    })
    app.save(notificationsCol)
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('notifications'))
    } catch (_) {}
    try {
      app.delete(app.findCollectionByNameOrId('locations'))
    } catch (_) {}
    try {
      app.delete(app.findCollectionByNameOrId('orders'))
    } catch (_) {}
    try {
      app.delete(app.findCollectionByNameOrId('customers'))
    } catch (_) {}
  },
)

migrate(
  (app) => {
    // 1. Create app_settings collection if not exists
    let appSettingsCol
    try {
      appSettingsCol = app.findCollectionByNameOrId('app_settings')
    } catch (_) {
      appSettingsCol = new Collection({
        name: 'app_settings',
        type: 'base',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.role = 'admin'",
        updateRule: "@request.auth.role = 'admin'",
        deleteRule: "@request.auth.role = 'admin'",
        fields: [
          { name: 'key', type: 'text', required: true },
          { name: 'fuel_price_per_liter', type: 'number', required: false },
          { name: 'fuel_consumption_kml', type: 'number', required: false },
          { name: 'extra', type: 'json', required: false },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: ['CREATE UNIQUE INDEX idx_app_settings_key ON app_settings (key)'],
      })
      app.save(appSettingsCol)
    }

    // Seed default settings: fuel_price = 5.59, fuel_consumption = 35.0 (35 km/L)
    try {
      app.findFirstRecordByData('app_settings', 'key', 'global_settings')
    } catch (_) {
      const defaultSettings = new Record(appSettingsCol)
      defaultSettings.set('key', 'global_settings')
      defaultSettings.set('fuel_price_per_liter', 5.59)
      defaultSettings.set('fuel_consumption_kml', 35.0)
      app.save(defaultSettings)
    }

    // 2. Extend orders collection with new fields
    const ordersCol = app.findCollectionByNameOrId('orders')

    // Update status select field to include all new business statuses
    const statusField = ordersCol.fields.getByName('status')
    if (statusField) {
      statusField.values = [
        'pending',
        'in_transit',
        'delivered',
        'address_error',
        'client_absent',
        'cancelled',
      ]
      statusField.maxSelect = 1
    }

    // Add completion_reason field (finalizada, erro de endereco, cliente ausente, etc.)
    if (!ordersCol.fields.getByName('completion_reason')) {
      ordersCol.fields.add(
        new SelectField({
          name: 'completion_reason',
          values: ['delivered', 'address_error', 'client_absent', 'other'],
          maxSelect: 1,
          required: false,
        }),
      )
    }

    // Add sequence number in route (1, 2, 3...)
    if (!ordersCol.fields.getByName('sequence')) {
      ordersCol.fields.add(
        new NumberField({
          name: 'sequence',
          onlyInt: true,
          required: false,
        }),
      )
    }

    // Add distance_km field
    if (!ordersCol.fields.getByName('distance_km')) {
      ordersCol.fields.add(
        new NumberField({
          name: 'distance_km',
          required: false,
        }),
      )
    }

    // Add estimated_duration_minutes field
    if (!ordersCol.fields.getByName('estimated_duration_minutes')) {
      ordersCol.fields.add(
        new NumberField({
          name: 'estimated_duration_minutes',
          required: false,
        }),
      )
    }

    // Add fuel_cost field
    if (!ordersCol.fields.getByName('fuel_cost')) {
      ordersCol.fields.add(
        new NumberField({
          name: 'fuel_cost',
          required: false,
        }),
      )
    }

    app.save(ordersCol)
  },
  (app) => {
    try {
      const appSettingsCol = app.findCollectionByNameOrId('app_settings')
      app.delete(appSettingsCol)
    } catch (_) {}
  },
)

migrate(
  (app) => {
    // 1. Create base_addresses collection (Base da empresa / loja e endereços de finalização da rota)
    let baseAddressesCol
    try {
      baseAddressesCol = app.findCollectionByNameOrId('base_addresses')
    } catch (_) {
      baseAddressesCol = new Collection({
        name: 'base_addresses',
        type: 'base',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.id != ''",
        fields: [
          { name: 'name', type: 'text', required: true },
          {
            name: 'type',
            type: 'select',
            values: ['base', 'end_point', 'store', 'warehouse'],
            maxSelect: 1,
            required: false,
          },
          { name: 'address', type: 'text', required: true },
          { name: 'street', type: 'text', required: false },
          { name: 'neighborhood', type: 'text', required: false },
          { name: 'city', type: 'text', required: false },
          { name: 'state', type: 'text', required: false },
          { name: 'postal_code', type: 'text', required: false },
          { name: 'lat', type: 'number', required: false },
          { name: 'lng', type: 'number', required: false },
          { name: 'is_default', type: 'bool', required: false },
          { name: 'is_end_default', type: 'bool', required: false },
          {
            name: 'created_by',
            type: 'relation',
            collectionId: '_pb_users_auth_',
            maxSelect: 1,
            required: false,
          },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: ['CREATE INDEX idx_base_addresses_type ON base_addresses (type)'],
      })
      app.save(baseAddressesCol)
    }

    // Seed default base record if empty
    try {
      const existing = app.findRecordsByFilter('base_addresses', '', '-created', 1, 0)
      if (!existing || existing.length === 0) {
        const seedBase = new Record(baseAddressesCol)
        seedBase.set('name', 'Base Central LOGHYPE (Loja Principal)')
        seedBase.set('type', 'base')
        seedBase.set('address', 'Av. Paulista, 1000 - Bela Vista, São Paulo - SP')
        seedBase.set('street', 'Av. Paulista, 1000')
        seedBase.set('neighborhood', 'Bela Vista')
        seedBase.set('city', 'São Paulo')
        seedBase.set('state', 'SP')
        seedBase.set('postal_code', '01310-100')
        seedBase.set('lat', -23.565734)
        seedBase.set('lng', -46.651257)
        seedBase.set('is_default', true)
        seedBase.set('is_end_default', true)
        app.save(seedBase)

        // Seed an alternate final address
        const seedFinal = new Record(baseAddressesCol)
        seedFinal.set('name', 'Galpão / Ponto de Apoio Zona Sul')
        seedFinal.set('type', 'end_point')
        seedFinal.set('address', 'Av. Santo Amaro, 3450 - Brooklin, São Paulo - SP')
        seedFinal.set('street', 'Av. Santo Amaro, 3450')
        seedFinal.set('neighborhood', 'Brooklin')
        seedFinal.set('city', 'São Paulo')
        seedFinal.set('state', 'SP')
        seedFinal.set('postal_code', '04556-300')
        seedFinal.set('lat', -23.61845)
        seedFinal.set('lng', -46.68532)
        seedFinal.set('is_default', false)
        seedFinal.set('is_end_default', false)
        app.save(seedFinal)
      }
    } catch (_) {}

    // 2. Extend orders collection with route lifecycle and return-trip fields
    const ordersCol = app.findCollectionByNameOrId('orders')

    if (!ordersCol.fields.getByName('route_started')) {
      ordersCol.fields.add(
        new BoolField({
          name: 'route_started',
          required: false,
        }),
      )
    }

    if (!ordersCol.fields.getByName('route_started_at')) {
      ordersCol.fields.add(
        new DateField({
          name: 'route_started_at',
          required: false,
        }),
      )
    }

    if (!ordersCol.fields.getByName('start_base_name')) {
      ordersCol.fields.add(
        new TextField({
          name: 'start_base_name',
          required: false,
        }),
      )
    }

    if (!ordersCol.fields.getByName('start_base_address')) {
      ordersCol.fields.add(
        new TextField({
          name: 'start_base_address',
          required: false,
        }),
      )
    }

    if (!ordersCol.fields.getByName('start_base_lat')) {
      ordersCol.fields.add(
        new NumberField({
          name: 'start_base_lat',
          required: false,
        }),
      )
    }

    if (!ordersCol.fields.getByName('start_base_lng')) {
      ordersCol.fields.add(
        new NumberField({
          name: 'start_base_lng',
          required: false,
        }),
      )
    }

    if (!ordersCol.fields.getByName('end_address_name')) {
      ordersCol.fields.add(
        new TextField({
          name: 'end_address_name',
          required: false,
        }),
      )
    }

    if (!ordersCol.fields.getByName('end_address_text')) {
      ordersCol.fields.add(
        new TextField({
          name: 'end_address_text',
          required: false,
        }),
      )
    }

    if (!ordersCol.fields.getByName('end_address_lat')) {
      ordersCol.fields.add(
        new NumberField({
          name: 'end_address_lat',
          required: false,
        }),
      )
    }

    if (!ordersCol.fields.getByName('end_address_lng')) {
      ordersCol.fields.add(
        new NumberField({
          name: 'end_address_lng',
          required: false,
        }),
      )
    }

    if (!ordersCol.fields.getByName('return_trip_km')) {
      ordersCol.fields.add(
        new NumberField({
          name: 'return_trip_km',
          required: false,
        }),
      )
    }

    if (!ordersCol.fields.getByName('total_route_with_return_km')) {
      ordersCol.fields.add(
        new NumberField({
          name: 'total_route_with_return_km',
          required: false,
        }),
      )
    }

    if (!ordersCol.fields.getByName('total_route_fuel_cost')) {
      ordersCol.fields.add(
        new NumberField({
          name: 'total_route_fuel_cost',
          required: false,
        }),
      )
    }

    app.save(ordersCol)
  },
  (app) => {
    try {
      const baseAddressesCol = app.findCollectionByNameOrId('base_addresses')
      app.delete(baseAddressesCol)
    } catch (_) {}
  },
)

migrate(
  (app) => {
    const ordersCol = app.findCollectionByNameOrId('orders')

    if (!ordersCol.fields.getByName('route_released')) {
      ordersCol.fields.add(
        new BoolField({
          name: 'route_released',
          required: false,
        }),
      )
    }

    if (!ordersCol.fields.getByName('route_released_at')) {
      ordersCol.fields.add(
        new DateField({
          name: 'route_released_at',
          required: false,
        }),
      )
    }

    app.save(ordersCol)
  },
  (app) => {
    try {
      const ordersCol = app.findCollectionByNameOrId('orders')
      if (ordersCol.fields.getByName('route_released')) {
        ordersCol.fields.removeByName('route_released')
      }
      if (ordersCol.fields.getByName('route_released_at')) {
        ordersCol.fields.removeByName('route_released_at')
      }
      app.save(ordersCol)
    } catch (_) {}
  },
)

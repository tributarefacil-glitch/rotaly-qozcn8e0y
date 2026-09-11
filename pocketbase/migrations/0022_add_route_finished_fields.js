migrate(
  (app) => {
    const ordersCol = app.findCollectionByNameOrId('orders')

    // 1. route_finished (indica se a rota inteira foi concluída pelo entregador ao retornar à base)
    if (!ordersCol.fields.getByName('route_finished')) {
      ordersCol.fields.add(
        new BoolField({
          name: 'route_finished',
          required: false,
        }),
      )
    }

    // 2. route_finished_at (timestamp do momento da chegada à base e finalização da rota inteira)
    if (!ordersCol.fields.getByName('route_finished_at')) {
      ordersCol.fields.add(
        new DateField({
          name: 'route_finished_at',
          required: false,
        }),
      )
    }

    app.save(ordersCol)
  },
  (app) => {
    const ordersCol = app.findCollectionByNameOrId('orders')
    if (ordersCol.fields.getByName('route_finished')) {
      ordersCol.fields.removeByName('route_finished')
    }
    if (ordersCol.fields.getByName('route_finished_at')) {
      ordersCol.fields.removeByName('route_finished_at')
    }
    app.save(ordersCol)
  },
)

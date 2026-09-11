migrate(
  (app) => {
    // Permitir delete em customers para admins e sellers autenticados
    const customersCol = app.findCollectionByNameOrId('customers')
    customersCol.deleteRule = "@request.auth.role = 'admin' || @request.auth.role = 'seller'"
    app.save(customersCol)

    // Permitir delete em orders para admins e sellers autenticados
    const ordersCol = app.findCollectionByNameOrId('orders')
    ordersCol.deleteRule = "@request.auth.role = 'admin' || @request.auth.role = 'seller'"
    app.save(ordersCol)
  },
  (app) => {
    try {
      const customersCol = app.findCollectionByNameOrId('customers')
      customersCol.deleteRule = "@request.auth.role = 'admin'"
      app.save(customersCol)
    } catch (_) {}

    try {
      const ordersCol = app.findCollectionByNameOrId('orders')
      ordersCol.deleteRule = "@request.auth.role = 'admin'"
      app.save(ordersCol)
    } catch (_) {}
  },
)

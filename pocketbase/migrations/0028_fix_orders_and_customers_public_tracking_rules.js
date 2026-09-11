migrate(
  (app) => {
    // 1. Atualizar orders listRule e viewRule para permitir leitura pública irrestrita ou por tracking_code
    const ordersCol = app.findCollectionByNameOrId('orders')
    ordersCol.listRule = ''
    ordersCol.viewRule = ''
    app.save(ordersCol)

    // 2. Atualizar customers viewRule e listRule para que dados públicos de entrega (nome e endereço do destinatário)
    // possam ser expandidos na tela pública de rastreamento
    const customersCol = app.findCollectionByNameOrId('customers')
    customersCol.viewRule = ''
    // listRule pode permitir usuários logados ou leitura pública se necessário para expand
    customersCol.listRule = ''
    app.save(customersCol)

    // 3. Atualizar users viewRule para que nome e tipo de veículo do entregador possam ser lidos no rastreio público
    const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')
    usersCol.viewRule = ''
    app.save(usersCol)
  },
  (app) => {
    try {
      const ordersCol = app.findCollectionByNameOrId('orders')
      ordersCol.listRule =
        "@request.auth.id != '' || (@request.query.tracking_code != '' && tracking_code = @request.query.tracking_code)"
      ordersCol.viewRule = "@request.auth.id != '' || tracking_code != ''"
      app.save(ordersCol)
    } catch (_) {}

    try {
      const customersCol = app.findCollectionByNameOrId('customers')
      customersCol.listRule = "@request.auth.id != ''"
      customersCol.viewRule = "@request.auth.id != ''"
      app.save(customersCol)
    } catch (_) {}

    try {
      const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')
      usersCol.viewRule = "@request.auth.id != '' || @request.auth.id = ''"
      app.save(usersCol)
    } catch (_) {}
  },
)

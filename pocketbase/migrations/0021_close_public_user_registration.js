migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')
    // Fecha o auto-cadastro público.
    // Apenas usuários já autenticados no sistema podem criar novos usuários:
    // - admin pode criar qualquer usuário (admin, seller, courier)
    // - seller pode criar apenas entregadores (courier)
    usersCol.createRule =
      "@request.auth.role = 'admin' || (@request.auth.role = 'seller' && role = 'courier')"
    app.save(usersCol)
  },
  (app) => {
    const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')
    // Reverter para a regra anterior caso necessário
    usersCol.createRule = ''
    app.save(usersCol)
  },
)

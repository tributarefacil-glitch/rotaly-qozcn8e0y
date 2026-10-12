migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')
    // Permitir que sellers também possam listar e visualizar entregadores e usuários necessários
    usersCol.listRule =
      "@request.auth.role = 'admin' || @request.auth.role = 'master' || @request.auth.role = 'seller' || @request.auth.id = id"
    usersCol.viewRule =
      "@request.auth.role = 'admin' || @request.auth.role = 'master' || @request.auth.role = 'seller' || @request.auth.id = id"
    app.save(usersCol)
    console.log('[0142] Regras de listRule e viewRule de users atualizadas para permitir seller.')
  },
  (app) => {
    const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')
    usersCol.listRule =
      "@request.auth.role = 'admin' || @request.auth.role = 'master' || @request.auth.id = id"
    usersCol.viewRule =
      "@request.auth.role = 'admin' || @request.auth.role = 'master' || @request.auth.id = id"
    app.save(usersCol)
    console.log('[0142] Regras de users revertidas.')
  },
)

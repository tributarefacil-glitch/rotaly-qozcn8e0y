migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')
    usersCol.updateRule =
      "@request.auth.id = id || @request.auth.role = 'admin' || @request.auth.role = 'master'"
    usersCol.viewRule =
      "@request.auth.role = 'admin' || @request.auth.role = 'master' || @request.auth.id = id"
    usersCol.listRule =
      "@request.auth.role = 'admin' || @request.auth.role = 'master' || @request.auth.id = id"
    app.save(usersCol)
    console.log('[0140] Regras de API da coleção users atualizadas com role master.')
  },
  (app) => {
    const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')
    usersCol.updateRule = "@request.auth.id = id || @request.auth.role = 'admin'"
    usersCol.viewRule = ''
    usersCol.listRule = "@request.auth.id != ''"
    app.save(usersCol)
    console.log('[0140] Regras de API da coleção users revertidas.')
  },
)

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')
    // Allow admins to create any user or allow public signup (e.g. if desired),
    // Setting createRule to allow admin creation or registration:
    usersCol.createRule = "@request.auth.role = 'admin' || @request.auth.id = ''"
    app.save(usersCol)
  },
  (app) => {
    const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')
    usersCol.createRule = ''
    app.save(usersCol)
  },
)

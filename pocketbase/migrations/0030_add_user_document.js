migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')

    if (!usersCol.fields.getByName('document')) {
      usersCol.fields.add(
        new TextField({
          name: 'document',
          required: false,
        }),
      )
    }

    // Adiciona índice não-único em document
    usersCol.addIndex('idx_users_document', false, 'document', '')

    app.save(usersCol)
  },
  (app) => {
    try {
      const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')
      if (usersCol.fields.getByName('document')) {
        usersCol.fields.removeByName('document')
      }
      try {
        usersCol.removeIndex('idx_users_document')
      } catch (_) {}
      app.save(usersCol)
    } catch (_) {}
  },
)

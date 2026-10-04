/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // Criar coleção audit_trail:
    // user_id rel, collection text, record_id text, action text, field text, old_value text, new_value text, timestamp date
    // listRule/viewRule admin/master, createRule autenticado, updateRule/deleteRule null
    const usersCol = app.findCollectionByNameOrId('users')

    const auditCol = new Collection({
      name: 'audit_trail',
      type: 'base',
      listRule:
        "@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin')",
      viewRule:
        "@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin')",
      createRule: "@request.auth.id != ''",
      updateRule: null,
      deleteRule: null,
      fields: [
        {
          name: 'user_id',
          type: 'relation',
          required: false,
          collectionId: usersCol ? usersCol.id : '_pb_users_auth_',
          cascadeDelete: false,
          maxSelect: 1,
        },
        {
          name: 'collection',
          type: 'text',
          required: true,
        },
        {
          name: 'record_id',
          type: 'text',
          required: true,
        },
        {
          name: 'action',
          type: 'text',
          required: true,
        },
        {
          name: 'field',
          type: 'text',
          required: false,
        },
        {
          name: 'old_value',
          type: 'text',
          required: false,
        },
        {
          name: 'new_value',
          type: 'text',
          required: false,
        },
        {
          name: 'timestamp',
          type: 'date',
          required: false,
        },
        {
          name: 'courier_id',
          type: 'relation',
          required: false,
          collectionId: usersCol ? usersCol.id : '_pb_users_auth_',
          cascadeDelete: false,
          maxSelect: 1,
        },
        {
          name: 'metadata',
          type: 'json',
          required: false,
        },
        {
          name: 'created',
          type: 'autodate',
          onCreate: true,
          onUpdate: false,
        },
        {
          name: 'updated',
          type: 'autodate',
          onCreate: true,
          onUpdate: true,
        },
      ],
      indexes: [
        'CREATE INDEX idx_audit_trail_coll_record ON audit_trail (collection, record_id)',
        'CREATE INDEX idx_audit_trail_courier ON audit_trail (courier_id)',
        'CREATE INDEX idx_audit_trail_created ON audit_trail (created DESC)',
      ],
    })

    app.save(auditCol)
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('audit_trail')
      app.delete(col)
    } catch {}
  },
)

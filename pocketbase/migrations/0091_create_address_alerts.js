migrate(
  (app) => {
    const usersCollection = app.findCollectionByNameOrId('_pb_users_auth_')
    const customersCollection = app.findCollectionByNameOrId('customers')
    const empresasCollection = app.findCollectionByNameOrId('empresas')

    const collection = new Collection({
      name: 'address_alerts',
      type: 'base',
      // Multiempresa:
      // master: vê tudo (@request.auth.role = 'master')
      // admin/seller/courier: vê da sua empresa vinculada em membros ou company
      listRule:
        "@request.auth.id != '' && (@request.auth.role = 'master' || company = '' || company = null || @collection.membros.empresa_id ?= company && @collection.membros.user_id ?= @request.auth.id)",
      viewRule:
        "@request.auth.id != '' && (@request.auth.role = 'master' || company = '' || company = null || @collection.membros.empresa_id ?= company && @collection.membros.user_id ?= @request.auth.id)",
      createRule: "@request.auth.id != ''",
      updateRule:
        "@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin' || @request.auth.role = 'seller')",
      deleteRule:
        "@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin')",
      fields: [
        {
          name: 'company',
          type: 'relation',
          collectionId: empresasCollection.id,
          cascadeDelete: false,
          maxSelect: 1,
        },
        {
          name: 'customer',
          type: 'relation',
          collectionId: customersCollection.id,
          cascadeDelete: true,
          maxSelect: 1,
          required: true,
        },
        {
          name: 'current_address',
          type: 'json',
        },
        {
          name: 'suggested_address',
          type: 'json',
        },
        {
          name: 'origin',
          type: 'select',
          values: ['varredura_cep', 'pin_entregador'],
          maxSelect: 1,
          required: true,
        },
        {
          name: 'status',
          type: 'select',
          values: ['pendente', 'aprovado', 'reprovado'],
          maxSelect: 1,
          required: true,
        },
        {
          name: 'distance_meters',
          type: 'number',
        },
        {
          name: 'marked_by',
          type: 'relation',
          collectionId: usersCollection.id,
          cascadeDelete: false,
          maxSelect: 1,
        },
        {
          name: 'marked_at',
          type: 'date',
        },
        {
          name: 'reviewed_by',
          type: 'relation',
          collectionId: usersCollection.id,
          cascadeDelete: false,
          maxSelect: 1,
        },
        {
          name: 'reviewed_at',
          type: 'date',
        },
        {
          name: 'notes',
          type: 'text',
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
        'CREATE INDEX idx_address_alerts_company ON address_alerts (company)',
        'CREATE INDEX idx_address_alerts_customer ON address_alerts (customer)',
        'CREATE INDEX idx_address_alerts_status ON address_alerts (status)',
        'CREATE INDEX idx_address_alerts_origin ON address_alerts (origin)',
      ],
    })

    app.save(collection)
  },
  (app) => {
    try {
      const collection = app.findCollectionByNameOrId('address_alerts')
      app.delete(collection)
    } catch (_) {}
  },
)

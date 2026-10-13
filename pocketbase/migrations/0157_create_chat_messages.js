/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users')
    let ordersCol = null
    try {
      ordersCol = app.findCollectionByNameOrId('orders')
    } catch {}

    const chatCol = new Collection({
      name: 'chat_messages',
      type: 'base',
      listRule:
        "@request.auth.id != '' && (sender_id = @request.auth.id || recipient_id = @request.auth.id)",
      viewRule:
        "@request.auth.id != '' && (sender_id = @request.auth.id || recipient_id = @request.auth.id)",
      createRule: "@request.auth.id != '' && sender_id = @request.auth.id",
      updateRule:
        "@request.auth.id != '' && (sender_id = @request.auth.id || recipient_id = @request.auth.id)",
      deleteRule: "@request.auth.id != '' && sender_id = @request.auth.id",
      fields: [
        {
          name: 'sender_id',
          type: 'relation',
          required: true,
          collectionId: usersCol ? usersCol.id : '_pb_users_auth_',
          cascadeDelete: false,
          maxSelect: 1,
        },
        {
          name: 'recipient_id',
          type: 'relation',
          required: true,
          collectionId: usersCol ? usersCol.id : '_pb_users_auth_',
          cascadeDelete: false,
          maxSelect: 1,
        },
        {
          name: 'route_batch_key',
          type: 'text',
          required: false,
        },
        {
          name: 'order_id',
          type: 'relation',
          required: false,
          collectionId: ordersCol ? ordersCol.id : 'orders',
          cascadeDelete: false,
          maxSelect: 1,
        },
        {
          name: 'order_code',
          type: 'text',
          required: false,
        },
        {
          name: 'text',
          type: 'text',
          required: true,
        },
        {
          name: 'kind',
          type: 'select',
          required: false,
          values: ['text', 'quick_reply'],
          maxSelect: 1,
        },
        {
          name: 'read_at',
          type: 'date',
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
        'CREATE INDEX idx_chat_messages_sender_created ON chat_messages (sender_id, created DESC)',
        'CREATE INDEX idx_chat_messages_recipient_created ON chat_messages (recipient_id, created DESC)',
        'CREATE INDEX idx_chat_messages_pair ON chat_messages (sender_id, recipient_id, created DESC)',
        'CREATE INDEX idx_chat_messages_unread ON chat_messages (recipient_id, read_at)',
      ],
    })

    app.save(chatCol)
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('chat_messages')
      if (col) {
        app.delete(col)
      }
    } catch {}
  },
)

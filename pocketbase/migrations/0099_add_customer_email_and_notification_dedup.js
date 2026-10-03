/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // 1. Adicionar campo 'email' na coleção 'customers' se não existir
    try {
      const customersCol = app.findCollectionByNameOrId('customers')
      if (!customersCol.fields.getByName('email')) {
        customersCol.fields.add(
          new EmailField({
            name: 'email',
            required: false,
          }),
        )
        app.save(customersCol)
        console.log('0099: Campo email adicionado na coleção customers com sucesso.')
      }
    } catch (errCust) {
      console.log('0099: Erro ao adicionar email em customers:', errCust)
      throw errCust
    }

    // 2. Criar coleção 'notification_dedup' para deduplicação persistente de alertas/e-mails
    let dedupCol
    try {
      dedupCol = app.findCollectionByNameOrId('notification_dedup')
    } catch (_) {
      // Coleção ainda não existe, cria agora
    }

    if (!dedupCol) {
      dedupCol = new Collection({
        name: 'notification_dedup',
        type: 'base',
        // Coleção de uso interno do backend / admin
        listRule:
          "@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin')",
        viewRule:
          "@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin')",
        createRule: null, // Apenas via hooks / superuser / migrations
        updateRule: null,
        deleteRule: null,
        fields: [
          {
            name: 'dedup_key',
            type: 'text',
            required: true,
          },
          {
            name: 'tipo_notificacao',
            type: 'text',
            required: false,
          },
          {
            name: 'order_id',
            type: 'text',
            required: false,
          },
          {
            name: 'recipient',
            type: 'text',
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
          'CREATE UNIQUE INDEX idx_notification_dedup_key ON notification_dedup (dedup_key)',
          'CREATE INDEX idx_notification_dedup_created ON notification_dedup (created)',
        ],
      })

      app.save(dedupCol)
      console.log('0099: Coleção notification_dedup criada com sucesso.')
    }
  },
  (app) => {
    try {
      const dedupCol = app.findCollectionByNameOrId('notification_dedup')
      if (dedupCol) {
        app.delete(dedupCol)
      }
    } catch (_) {}

    try {
      const customersCol = app.findCollectionByNameOrId('customers')
      const field = customersCol.fields.getByName('email')
      if (field) {
        customersCol.fields.removeByName('email')
        app.save(customersCol)
      }
    } catch (_) {}
  },
)

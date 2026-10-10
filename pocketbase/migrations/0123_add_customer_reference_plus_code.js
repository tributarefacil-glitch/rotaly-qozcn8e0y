// pocketbase/migrations/0123_add_customer_reference_plus_code.js
// Migração 0123: Endereçamento Moderno (Comunidades sem CEP, lote/quadra sem número)
// - Adiciona campos `reference_point` (text), `plus_code` (text), `pending_client_pin` (json) em `customers`
// - Cria endpoint de hook ou atualiza rules para permitir que o cliente envie sua localização via link público /pin/:id

migrate(
  (app) => {
    const customersCol = app.findCollectionByNameOrId('customers')

    if (!customersCol.fields.getByName('reference_point')) {
      customersCol.fields.add(
        new TextField({
          name: 'reference_point',
          required: false,
        }),
      )
    }

    if (!customersCol.fields.getByName('plus_code')) {
      customersCol.fields.add(
        new TextField({
          name: 'plus_code',
          required: false,
        }),
      )
    }

    if (!customersCol.fields.getByName('pending_client_pin')) {
      customersCol.fields.add(
        new JSONField({
          name: 'pending_client_pin',
          required: false,
          maxSize: 100000,
        }),
      )
    }

    app.save(customersCol)
  },
  (app) => {
    try {
      const customersCol = app.findCollectionByNameOrId('customers')
      customersCol.fields.removeByName('reference_point')
      customersCol.fields.removeByName('plus_code')
      customersCol.fields.removeByName('pending_client_pin')
      app.save(customersCol)
    } catch (_) {}
  },
)

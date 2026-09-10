migrate(
  (app) => {
    const customersCol = app.findCollectionByNameOrId('customers')

    if (!customersCol.fields.getByName('document')) {
      customersCol.fields.add(
        new TextField({
          name: 'document',
          required: false,
        }),
      )
    }

    if (!customersCol.fields.getByName('notes')) {
      customersCol.fields.add(
        new TextField({
          name: 'notes',
          required: false,
        }),
      )
    }

    customersCol.addIndex('idx_customers_document', false, 'document', '')
    app.save(customersCol)
  },
  (app) => {
    try {
      const customersCol = app.findCollectionByNameOrId('customers')
      if (customersCol.fields.getByName('document')) {
        customersCol.fields.removeByName('document')
      }
      if (customersCol.fields.getByName('notes')) {
        customersCol.fields.removeByName('notes')
      }
      try {
        customersCol.removeIndex('idx_customers_document')
      } catch (_) {}
      app.save(customersCol)
    } catch (_) {}
  },
)

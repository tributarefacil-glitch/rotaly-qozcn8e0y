migrate(
  (app) => {
    const customersCol = app.findCollectionByNameOrId('customers')

    if (!customersCol.fields.getByName('phone2')) {
      customersCol.fields.add(
        new TextField({
          name: 'phone2',
          required: false,
        }),
      )
    }

    if (!customersCol.fields.getByName('phone3')) {
      customersCol.fields.add(
        new TextField({
          name: 'phone3',
          required: false,
        }),
      )
    }

    customersCol.addIndex('idx_customers_phone2', false, 'phone2', '')
    customersCol.addIndex('idx_customers_phone3', false, 'phone3', '')

    app.save(customersCol)
  },
  (app) => {
    try {
      const customersCol = app.findCollectionByNameOrId('customers')
      if (customersCol.fields.getByName('phone2')) {
        customersCol.fields.removeByName('phone2')
      }
      if (customersCol.fields.getByName('phone3')) {
        customersCol.fields.removeByName('phone3')
      }
      customersCol.removeIndex('idx_customers_phone2')
      customersCol.removeIndex('idx_customers_phone3')
      app.save(customersCol)
    } catch (_) {}
  },
)

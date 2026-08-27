migrate(
  (app) => {
    const customersCol = app.findCollectionByNameOrId('customers')

    if (!customersCol.fields.getByName('street')) {
      customersCol.fields.add(
        new TextField({
          name: 'street',
          required: false,
        }),
      )
    }

    if (!customersCol.fields.getByName('neighborhood')) {
      customersCol.fields.add(
        new TextField({
          name: 'neighborhood',
          required: false,
        }),
      )
    }

    if (!customersCol.fields.getByName('city')) {
      customersCol.fields.add(
        new TextField({
          name: 'city',
          required: false,
        }),
      )
    }

    if (!customersCol.fields.getByName('state')) {
      customersCol.fields.add(
        new TextField({
          name: 'state',
          required: false,
        }),
      )
    }

    if (!customersCol.fields.getByName('postal_code')) {
      customersCol.fields.add(
        new TextField({
          name: 'postal_code',
          required: false,
        }),
      )
    }

    if (!customersCol.fields.getByName('complement')) {
      customersCol.fields.add(
        new TextField({
          name: 'complement',
          required: false,
        }),
      )
    }

    app.save(customersCol)
  },
  (app) => {
    try {
      const customersCol = app.findCollectionByNameOrId('customers')
      const fieldsToRemove = [
        'street',
        'neighborhood',
        'city',
        'state',
        'postal_code',
        'complement',
      ]
      for (const f of fieldsToRemove) {
        const field = customersCol.fields.getByName(f)
        if (field) {
          customersCol.fields.removeByName(f)
        }
      }
      app.save(customersCol)
    } catch (_) {}
  },
)

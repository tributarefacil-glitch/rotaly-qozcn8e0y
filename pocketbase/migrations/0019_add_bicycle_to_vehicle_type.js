migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')
    const field = usersCol.fields.getByName('vehicle_type')
    if (field) {
      // Ensure 'bicycle' and 'bicicleta' are allowed values
      const currentValues = Array.isArray(field.values) ? field.values : []
      const newValues = Array.from(
        new Set([...currentValues, 'moto', 'carro', 'van', 'caminhao', 'bicycle', 'bicicleta']),
      )
      field.values = newValues
      app.save(usersCol)
    }
  },
  (app) => {
    try {
      const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')
      const field = usersCol.fields.getByName('vehicle_type')
      if (field) {
        field.values = ['moto', 'carro', 'van', 'caminhao']
        app.save(usersCol)
      }
    } catch (_) {}
  },
)

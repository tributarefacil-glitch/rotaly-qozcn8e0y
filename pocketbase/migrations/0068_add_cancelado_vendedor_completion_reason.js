/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('orders')
    const field = collection.fields.getByName('completion_reason')
    if (field && Array.isArray(field.values) && !field.values.includes('cancelado_vendedor')) {
      field.values.push('cancelado_vendedor')
      app.save(collection)
      console.log('0068: Adicionado valor cancelado_vendedor ao completion_reason de orders.')
    }
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('orders')
    const field = collection.fields.getByName('completion_reason')
    if (field && Array.isArray(field.values) && field.values.includes('cancelado_vendedor')) {
      field.values = field.values.filter((v) => v !== 'cancelado_vendedor')
      app.save(collection)
    }
  },
)

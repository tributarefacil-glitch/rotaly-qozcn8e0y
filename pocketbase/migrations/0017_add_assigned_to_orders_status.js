/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('orders')
    const statusField = collection.fields.getByName('status')
    if (statusField && !statusField.values.includes('assigned')) {
      statusField.values.push('assigned')
      app.save(collection)
    }
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('orders')
    const statusField = collection.fields.getByName('status')
    if (statusField && statusField.values.includes('assigned')) {
      statusField.values = statusField.values.filter((v) => v !== 'assigned')
      app.save(collection)
    }
  },
)

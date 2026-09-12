/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('locations')

    // gps_reason: motivo detalhado da falha ('permission_denied' | 'weak_signal' | 'unavailable' | 'unsupported' | '')
    if (!collection.fields.getByName('gps_reason')) {
      collection.fields.add(
        new Field({
          name: 'gps_reason',
          type: 'text',
          required: false,
          presentable: false,
        }),
      )
    }

    return app.save(collection)
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('locations')
    if (collection.fields.getByName('gps_reason')) {
      collection.fields.removeByName('gps_reason')
    }
    return app.save(collection)
  },
)

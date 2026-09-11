/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('locations')

    // gps_status: 'active' | 'disabled' | 'offline'
    if (!collection.fields.getByName('gps_status')) {
      collection.fields.addAt(
        9,
        new Field({
          name: 'gps_status',
          type: 'text',
          required: false,
          presentable: false,
        }),
      )
    }

    // offline_buffered: boolean indicando se o ponto veio do buffer de contingência offline
    if (!collection.fields.getByName('offline_buffered')) {
      collection.fields.addAt(
        10,
        new Field({
          name: 'offline_buffered',
          type: 'bool',
          required: false,
          presentable: false,
        }),
      )
    }

    // accuracy: precisão do GPS em metros
    if (!collection.fields.getByName('accuracy')) {
      collection.fields.addAt(
        11,
        new Field({
          name: 'accuracy',
          type: 'number',
          required: false,
          presentable: false,
        }),
      )
    }

    return app.save(collection)
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('locations')
    collection.fields.removeByName('gps_status')
    collection.fields.removeByName('offline_buffered')
    collection.fields.removeByName('accuracy')
    return app.save(collection)
  },
)

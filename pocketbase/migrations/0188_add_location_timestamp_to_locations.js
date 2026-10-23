/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const locationsCol = app.findCollectionByNameOrId('locations')
    if (!locationsCol.fields.getByName('location_timestamp')) {
      locationsCol.fields.add(
        new DateField({
          name: 'location_timestamp',
          required: false,
        }),
      )
      app.save(locationsCol)
    }
  },
  (app) => {
    const locationsCol = app.findCollectionByNameOrId('locations')
    if (locationsCol.fields.getByName('location_timestamp')) {
      locationsCol.fields.removeByName('location_timestamp')
      app.save(locationsCol)
    }
  },
)

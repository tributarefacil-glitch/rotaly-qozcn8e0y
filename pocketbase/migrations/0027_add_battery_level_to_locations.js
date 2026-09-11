migrate(
  (app) => {
    const locationsCol = app.findCollectionByNameOrId('locations')

    if (!locationsCol.fields.getByName('battery_level')) {
      locationsCol.fields.add(
        new NumberField({
          name: 'battery_level',
          required: false,
          min: 0,
          max: 100,
        }),
      )
    }

    app.save(locationsCol)
  },
  (app) => {
    const locationsCol = app.findCollectionByNameOrId('locations')
    if (locationsCol.fields.getByName('battery_level')) {
      locationsCol.fields.removeByName('battery_level')
    }
    app.save(locationsCol)
  },
)

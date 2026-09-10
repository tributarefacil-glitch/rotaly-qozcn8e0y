migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('app_settings')

    // Add fields for Moto
    if (!col.fields.getByName('moto_fuel_price')) {
      col.fields.add(
        new NumberField({
          name: 'moto_fuel_price',
          required: false,
        }),
      )
    }
    if (!col.fields.getByName('moto_consumption_kml')) {
      col.fields.add(
        new NumberField({
          name: 'moto_consumption_kml',
          required: false,
        }),
      )
    }

    // Add fields for Carro
    if (!col.fields.getByName('carro_fuel_price')) {
      col.fields.add(
        new NumberField({
          name: 'carro_fuel_price',
          required: false,
        }),
      )
    }
    if (!col.fields.getByName('carro_consumption_kml')) {
      col.fields.add(
        new NumberField({
          name: 'carro_consumption_kml',
          required: false,
        }),
      )
    }

    // Add fields for Caminhão
    if (!col.fields.getByName('caminhao_fuel_price')) {
      col.fields.add(
        new NumberField({
          name: 'caminhao_fuel_price',
          required: false,
        }),
      )
    }
    if (!col.fields.getByName('caminhao_consumption_kml')) {
      col.fields.add(
        new NumberField({
          name: 'caminhao_consumption_kml',
          required: false,
        }),
      )
    }

    app.save(col)

    // Update global_settings record with initial values if existing
    try {
      const record = app.findFirstRecordByData('app_settings', 'key', 'global_settings')
      const currentPrice = record.get('fuel_price_per_liter') || 5.59

      if (!record.get('moto_fuel_price')) {
        record.set('moto_fuel_price', currentPrice)
      }
      if (!record.get('moto_consumption_kml')) {
        record.set('moto_consumption_kml', record.get('fuel_consumption_kml') || 35.0)
      }

      if (!record.get('carro_fuel_price')) {
        record.set('carro_fuel_price', currentPrice)
      }
      if (!record.get('carro_consumption_kml')) {
        record.set('carro_consumption_kml', 12.0)
      }

      if (!record.get('caminhao_fuel_price')) {
        record.set('caminhao_fuel_price', currentPrice)
      }
      if (!record.get('caminhao_consumption_kml')) {
        record.set('caminhao_consumption_kml', 7.0)
      }

      app.save(record)
    } catch (_) {}
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('app_settings')
      const fieldsToRemove = [
        'moto_fuel_price',
        'moto_consumption_kml',
        'carro_fuel_price',
        'carro_consumption_kml',
        'caminhao_fuel_price',
        'caminhao_consumption_kml',
      ]
      for (const f of fieldsToRemove) {
        const field = col.fields.getByName(f)
        if (field) {
          col.fields.removeByName(f)
        }
      }
      app.save(col)
    } catch (_) {}
  },
)

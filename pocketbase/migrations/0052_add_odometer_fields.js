migrate(
  (app) => {
    // 1. Atualizar coleção rotas com campos de odômetro
    try {
      const rotasCol = app.findCollectionByNameOrId('rotas')
      if (!rotasCol.fields.getByName('odometro_inicial')) {
        rotasCol.fields.add(new NumberField({ name: 'odometro_inicial' }))
      }
      if (!rotasCol.fields.getByName('odometro_final')) {
        rotasCol.fields.add(new NumberField({ name: 'odometro_final' }))
      }
      if (!rotasCol.fields.getByName('km_odometro')) {
        rotasCol.fields.add(new NumberField({ name: 'km_odometro' }))
      }
      if (!rotasCol.fields.getByName('foto_odometro_inicial')) {
        rotasCol.fields.add(
          new FileField({
            name: 'foto_odometro_inicial',
            maxSelect: 1,
            maxSize: 10485760,
            mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
          }),
        )
      }
      if (!rotasCol.fields.getByName('foto_odometro_final')) {
        rotasCol.fields.add(
          new FileField({
            name: 'foto_odometro_final',
            maxSelect: 1,
            maxSize: 10485760,
            mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
          }),
        )
      }
      if (!rotasCol.fields.getByName('data')) {
        rotasCol.fields.add(new DateField({ name: 'data' }))
      }
      app.save(rotasCol)
      console.log('0052: Campos de odômetro adicionados à coleção rotas.')
    } catch (err) {
      console.warn('0052: Aviso ao atualizar coleção rotas:', err)
    }

    // 2. Atualizar coleção orders também com campos de odômetro para persistência direta por ciclo/lote de rota
    try {
      const ordersCol = app.findCollectionByNameOrId('orders')
      if (!ordersCol.fields.getByName('odometro_inicial')) {
        ordersCol.fields.add(new NumberField({ name: 'odometro_inicial' }))
      }
      if (!ordersCol.fields.getByName('odometro_final')) {
        ordersCol.fields.add(new NumberField({ name: 'odometro_final' }))
      }
      if (!ordersCol.fields.getByName('km_odometro')) {
        ordersCol.fields.add(new NumberField({ name: 'km_odometro' }))
      }
      if (!ordersCol.fields.getByName('foto_odometro_inicial')) {
        ordersCol.fields.add(
          new FileField({
            name: 'foto_odometro_inicial',
            maxSelect: 1,
            maxSize: 10485760,
            mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
          }),
        )
      }
      if (!ordersCol.fields.getByName('foto_odometro_final')) {
        ordersCol.fields.add(
          new FileField({
            name: 'foto_odometro_final',
            maxSelect: 1,
            maxSize: 10485760,
            mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
          }),
        )
      }
      app.save(ordersCol)
      console.log('0052: Campos de odômetro adicionados à coleção orders.')
    } catch (err) {
      console.warn('0052: Aviso ao atualizar coleção orders:', err)
    }
  },
  (app) => {
    // Revert idempotent
    try {
      const rotasCol = app.findCollectionByNameOrId('rotas')
      if (rotasCol.fields.getByName('odometro_inicial'))
        rotasCol.fields.removeByName('odometro_inicial')
      if (rotasCol.fields.getByName('odometro_final'))
        rotasCol.fields.removeByName('odometro_final')
      if (rotasCol.fields.getByName('km_odometro')) rotasCol.fields.removeByName('km_odometro')
      if (rotasCol.fields.getByName('foto_odometro_inicial'))
        rotasCol.fields.removeByName('foto_odometro_inicial')
      if (rotasCol.fields.getByName('foto_odometro_final'))
        rotasCol.fields.removeByName('foto_odometro_final')
      if (rotasCol.fields.getByName('data')) rotasCol.fields.removeByName('data')
      app.save(rotasCol)
    } catch (_) {}

    try {
      const ordersCol = app.findCollectionByNameOrId('orders')
      if (ordersCol.fields.getByName('odometro_inicial'))
        ordersCol.fields.removeByName('odometro_inicial')
      if (ordersCol.fields.getByName('odometro_final'))
        ordersCol.fields.removeByName('odometro_final')
      if (ordersCol.fields.getByName('km_odometro')) ordersCol.fields.removeByName('km_odometro')
      if (ordersCol.fields.getByName('foto_odometro_inicial'))
        ordersCol.fields.removeByName('foto_odometro_inicial')
      if (ordersCol.fields.getByName('foto_odometro_final'))
        ordersCol.fields.removeByName('foto_odometro_final')
      app.save(ordersCol)
    } catch (_) {}
  },
)

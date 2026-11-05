/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration 0213:
 * 1. Adiciona campo deviation_reason em orders (text, opcional)
 * 2. Adiciona campo courier_reported_shortcut em route_leg_analysis (bool, opcional)
 */
migrate(
  (app) => {
    // 1. orders.deviation_reason
    try {
      const ordersCol = app.findCollectionByNameOrId('orders')
      let hasField = false
      try {
        if (ordersCol.fields.getByName('deviation_reason')) {
          hasField = true
        }
      } catch (_) {}

      if (!hasField) {
        ordersCol.fields.add(
          new TextField({
            name: 'deviation_reason',
            required: false,
          }),
        )
        app.save(ordersCol)
        console.log('[0213] Adicionado campo deviation_reason em orders.')
      }
    } catch (errOrders) {
      console.log('[0213] Erro ao adicionar deviation_reason em orders:', errOrders)
    }

    // 2. route_leg_analysis.courier_reported_shortcut
    try {
      const legCol = app.findCollectionByNameOrId('route_leg_analysis')
      let hasField = false
      try {
        if (legCol.fields.getByName('courier_reported_shortcut')) {
          hasField = true
        }
      } catch (_) {}

      if (!hasField) {
        legCol.fields.add(
          new BoolField({
            name: 'courier_reported_shortcut',
            required: false,
          }),
        )
        app.save(legCol)
        console.log('[0213] Adicionado campo courier_reported_shortcut em route_leg_analysis.')
      }
    } catch (errLeg) {
      console.log(
        '[0213] Erro ao adicionar courier_reported_shortcut em route_leg_analysis:',
        errLeg,
      )
    }
  },
  (app) => {
    try {
      const ordersCol = app.findCollectionByNameOrId('orders')
      ordersCol.fields.removeByName('deviation_reason')
      app.save(ordersCol)
    } catch (_) {}

    try {
      const legCol = app.findCollectionByNameOrId('route_leg_analysis')
      legCol.fields.removeByName('courier_reported_shortcut')
      app.save(legCol)
    } catch (_) {}
  },
)

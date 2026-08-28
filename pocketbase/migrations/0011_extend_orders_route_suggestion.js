migrate(
  (app) => {
    const ordersCol = app.findCollectionByNameOrId('orders')

    // 1. Add assignment_type (manual vs automatic)
    if (!ordersCol.fields.getByName('assignment_type')) {
      ordersCol.fields.add(
        new SelectField({
          name: 'assignment_type',
          values: ['manual', 'automatic'],
          maxSelect: 1,
          required: false,
        }),
      )
    }

    // 2. Add route_suggestion_status (accepted vs rejected vs none)
    if (!ordersCol.fields.getByName('route_suggestion_status')) {
      ordersCol.fields.add(
        new SelectField({
          name: 'route_suggestion_status',
          values: ['accepted', 'rejected', 'edited', 'none'],
          maxSelect: 1,
          required: false,
        }),
      )
    }

    // 3. Add route_suggestion_details (json details like km_saved, suggested_courier, order_in_route, etc.)
    if (!ordersCol.fields.getByName('route_suggestion_details')) {
      ordersCol.fields.add(
        new JSONField({
          name: 'route_suggestion_details',
          required: false,
        }),
      )
    }

    // 4. Add receiver_name text field if not exists
    if (!ordersCol.fields.getByName('receiver_name')) {
      ordersCol.fields.add(
        new TextField({
          name: 'receiver_name',
          required: false,
        }),
      )
    }

    app.save(ordersCol)
  },
  (app) => {
    // Revert if needed
  },
)

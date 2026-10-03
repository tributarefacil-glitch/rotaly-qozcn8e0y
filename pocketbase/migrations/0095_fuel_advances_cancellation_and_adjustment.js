migrate(
  (app) => {
    const fuelAdvancesCol = app.findCollectionByNameOrId('fuel_advances')
    const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')

    // 1. Campo status: 'active' | 'cancelled' (default 'active')
    if (!fuelAdvancesCol.fields.getByName('status')) {
      fuelAdvancesCol.fields.add(
        new SelectField({
          name: 'status',
          required: false,
          values: ['active', 'cancelled'],
          maxSelect: 1,
        }),
      )
    }

    // 2. Campo entry_type: 'advance' | 'balance_adjustment' (default 'advance')
    if (!fuelAdvancesCol.fields.getByName('entry_type')) {
      fuelAdvancesCol.fields.add(
        new SelectField({
          name: 'entry_type',
          required: false,
          values: ['advance', 'balance_adjustment'],
          maxSelect: 1,
        }),
      )
    }

    // 3. Campo cancelled_at: date
    if (!fuelAdvancesCol.fields.getByName('cancelled_at')) {
      fuelAdvancesCol.fields.add(
        new DateField({
          name: 'cancelled_at',
          required: false,
        }),
      )
    }

    // 4. Campo cancelled_by: relation -> users
    if (!fuelAdvancesCol.fields.getByName('cancelled_by')) {
      fuelAdvancesCol.fields.add(
        new RelationField({
          name: 'cancelled_by',
          collectionId: usersCol.id,
          cascadeDelete: false,
          maxSelect: 1,
          required: false,
        }),
      )
    }

    // 5. Campo cancellation_reason: text
    if (!fuelAdvancesCol.fields.getByName('cancellation_reason')) {
      fuelAdvancesCol.fields.add(
        new TextField({
          name: 'cancellation_reason',
          required: false,
        }),
      )
    }

    // 6. Campo previous_balance: number (saldo anterior no momento do ajuste/cancelamento para auditoria)
    if (!fuelAdvancesCol.fields.getByName('previous_balance')) {
      fuelAdvancesCol.fields.add(
        new NumberField({
          name: 'previous_balance',
          required: false,
        }),
      )
    }

    // 7. Campo new_balance: number (novo saldo resultante do ajuste para auditoria)
    if (!fuelAdvancesCol.fields.getByName('new_balance')) {
      fuelAdvancesCol.fields.add(
        new NumberField({
          name: 'new_balance',
          required: false,
        }),
      )
    }

    app.save(fuelAdvancesCol)

    // Preenche registros existentes com status = 'active' e entry_type = 'advance'
    app
      .db()
      .newQuery("UPDATE fuel_advances SET status = 'active' WHERE status IS NULL OR status = ''")
      .execute()
    app
      .db()
      .newQuery(
        "UPDATE fuel_advances SET entry_type = 'advance' WHERE entry_type IS NULL OR entry_type = ''",
      )
      .execute()
  },
  (app) => {
    const fuelAdvancesCol = app.findCollectionByNameOrId('fuel_advances')
    const fieldNames = [
      'status',
      'entry_type',
      'cancelled_at',
      'cancelled_by',
      'cancellation_reason',
      'previous_balance',
      'new_balance',
    ]
    for (const name of fieldNames) {
      const f = fuelAdvancesCol.fields.getByName(name)
      if (f) {
        fuelAdvancesCol.fields.removeByName(name)
      }
    }
    app.save(fuelAdvancesCol)
  },
)

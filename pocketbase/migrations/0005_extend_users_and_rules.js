migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')

    // 1. Phone
    if (!usersCol.fields.getByName('phone')) {
      usersCol.fields.add(
        new TextField({
          name: 'phone',
          required: false,
        }),
      )
    }

    // 2. Vehicle type (moto/carro/van/caminhao)
    if (!usersCol.fields.getByName('vehicle_type')) {
      usersCol.fields.add(
        new SelectField({
          name: 'vehicle_type',
          values: ['moto', 'carro', 'van', 'caminhao'],
          maxSelect: 1,
          required: false,
        }),
      )
    }

    // 3. Vehicle model
    if (!usersCol.fields.getByName('vehicle_model')) {
      usersCol.fields.add(
        new TextField({
          name: 'vehicle_model',
          required: false,
        }),
      )
    }

    // 4. Vehicle year
    if (!usersCol.fields.getByName('vehicle_year')) {
      usersCol.fields.add(
        new NumberField({
          name: 'vehicle_year',
          required: false,
          onlyInt: true,
        }),
      )
    }

    // 5. Vehicle plate
    if (!usersCol.fields.getByName('vehicle_plate')) {
      usersCol.fields.add(
        new TextField({
          name: 'vehicle_plate',
          required: false,
        }),
      )
    }

    // 6. Documents (files or json URLs — we add documents file field and selfie file field)
    if (!usersCol.fields.getByName('documents')) {
      usersCol.fields.add(
        new FileField({
          name: 'documents',
          maxSelect: 5,
          maxSize: 10485760, // 10MB
          mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
          required: false,
        }),
      )
    }

    // 7. Selfie file
    if (!usersCol.fields.getByName('selfie')) {
      usersCol.fields.add(
        new FileField({
          name: 'selfie',
          maxSelect: 1,
          maxSize: 5242880, // 5MB
          mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
          required: false,
        }),
      )
    }

    // 8. Update status select to support: active, inactive, pending, idle, busy
    const statusField = usersCol.fields.getByName('status')
    if (statusField) {
      statusField.values = ['active', 'inactive', 'pending', 'idle', 'busy']
      statusField.maxSelect = 1
    } else {
      usersCol.fields.add(
        new SelectField({
          name: 'status',
          values: ['active', 'inactive', 'pending', 'idle', 'busy'],
          maxSelect: 1,
          required: false,
        }),
      )
    }

    // 9. RLS rules:
    // - create: public ("") so anyone can register unauthenticated
    // - list: auth users or admin
    // - view: public / auth
    // - update: admin or self (@request.auth.id = id || @request.auth.role = 'admin')
    // - delete: admin (@request.auth.role = 'admin')
    usersCol.createRule = ''
    usersCol.listRule = "@request.auth.id != ''"
    usersCol.viewRule = "@request.auth.id != '' || @request.auth.id = ''"
    usersCol.updateRule = "@request.auth.id = id || @request.auth.role = 'admin'"
    usersCol.deleteRule = "@request.auth.role = 'admin'"

    app.save(usersCol)
  },
  (app) => {
    const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')
    usersCol.createRule = "@request.auth.role = 'admin' || @request.auth.id = ''"
    app.save(usersCol)
  },
)

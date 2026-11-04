migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')
    const empresasCol = app.findCollectionByNameOrId('empresas')

    const collection = new Collection({
      name: 'route_leg_analysis',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != ''",
      fields: [
        { name: 'route_batch_key', type: 'text', required: true },
        {
          name: 'courier_id',
          type: 'relation',
          required: true,
          collectionId: usersCol.id,
          cascadeDelete: false,
          maxSelect: 1,
        },
        {
          name: 'empresa_id',
          type: 'relation',
          collectionId: empresasCol.id,
          cascadeDelete: false,
          maxSelect: 1,
        },
        { name: 'leg_index', type: 'number', required: true },
        {
          name: 'leg_type',
          type: 'select',
          values: ['base_to_stop', 'stop_to_stop', 'return_to_base'],
          required: true,
        },
        { name: 'from_name', type: 'text' },
        { name: 'to_name', type: 'text' },
        { name: 'order_id', type: 'text' },
        { name: 'tracking_code', type: 'text' },
        { name: 'km_planned', type: 'number', required: true },
        { name: 'km_realized', type: 'number' },
        { name: 'km_diff', type: 'number' },
        { name: 'diff_pct', type: 'number' },
        { name: 'pings_count', type: 'number' },
        { name: 'is_better_route', type: 'bool' },
        { name: 'is_excess_deviation', type: 'bool' },
        { name: 'is_insufficient_data', type: 'bool' },
        {
          name: 'analysis_status',
          type: 'select',
          values: ['candidate_better', 'excess_deviation', 'equivalent', 'insufficient_data'],
        },
        { name: 'started_at', type: 'date' },
        { name: 'finished_at', type: 'date' },
        { name: 'metadata', type: 'json' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_route_leg_unique ON route_leg_analysis (route_batch_key, leg_index)',
        'CREATE INDEX idx_route_leg_courier ON route_leg_analysis (courier_id, created DESC)',
        'CREATE INDEX idx_route_leg_status ON route_leg_analysis (analysis_status)',
        'CREATE INDEX idx_route_leg_better ON route_leg_analysis (is_better_route)',
      ],
    })

    app.save(collection)
  },
  (app) => {
    try {
      const collection = app.findCollectionByNameOrId('route_leg_analysis')
      if (collection) {
        app.delete(collection)
      }
    } catch (_) {
      // noop
    }
  },
)

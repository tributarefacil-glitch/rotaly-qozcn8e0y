// pocketbase/migrations/0194_route_batches_alias_view.js
// ITEM 3: Compatibilidade definitiva para consultas a "route_batches".
// Cria uma view collection chamada "route_batches" espelhando "route_batch_telemetry".
// Assim qualquer chamada REST do app ou APK a /api/collections/route_batches/...
// (inclusive filtrando por courier_id) responde perfeitamente sem erro 404!

migrate(
  (app) => {
    let existing = null
    try {
      existing = app.findCollectionByNameOrId('route_batches')
    } catch (_) {}

    if (!existing) {
      const viewCol = new Collection({
        name: 'route_batches',
        type: 'view',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        viewQuery:
          'SELECT id, courier_id, route_batch_key, empresa_id, km_viario_total, km_gps_total, km_oficial, pings_count, gaps_count, gaps_total_seconds, status, created, updated FROM route_batch_telemetry',
        fields: [
          { name: 'courier_id', type: 'relation', collectionId: '_pb_users_auth_', maxSelect: 1 },
          { name: 'route_batch_key', type: 'text' },
          {
            name: 'empresa_id',
            type: 'relation',
            collectionId: app.findCollectionByNameOrId('empresas').id,
            maxSelect: 1,
          },
          { name: 'km_viario_total', type: 'number' },
          { name: 'km_gps_total', type: 'number' },
          { name: 'km_oficial', type: 'number' },
          { name: 'pings_count', type: 'number' },
          { name: 'gaps_count', type: 'number' },
          { name: 'gaps_total_seconds', type: 'number' },
          { name: 'status', type: 'text' },
        ],
      })
      app.save(viewCol)
    }
  },
  (app) => {
    try {
      const viewCol = app.findCollectionByNameOrId('route_batches')
      if (viewCol) {
        app.delete(viewCol)
      }
    } catch (_) {}
  },
)

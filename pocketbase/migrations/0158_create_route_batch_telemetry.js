/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration 0158: Motor Canônico de Telemetria — Coleção route_batch_telemetry e campos em orders
 *
 * Cria a coleção 'route_batch_telemetry' como FONTE ÚNICA DE VERDADE para telemetria processada no servidor.
 * Registra para cada route_batch_key fechado:
 * - route_batch_key (único)
 * - courier_id (relação users)
 * - empresa_id (relação empresas)
 * - km_gps_total: soma ping a ping (haversine) somente pings reais em locations
 * - km_viario_total: rota viária via OSRM (base oficial -> paradas -> volta à base 1x)
 * - km_oficial: MENOR entre previsto e realizado (regra do dono)
 * - legs_data (json): detalhe de cada perna [{ seq, from_name, to_name, km_gps, km_viario, desvio_m, is_return }]
 * - telemetry_gaps (json): lista de lacunas consecutivas >90s [{ start_iso, end_iso, duration_seconds }]
 * - gaps_count (number)
 * - gaps_total_seconds (number)
 * - deviation_classification (json): classificação de desvio por trecho (apenas trechos com telemetria real <=90s)
 * - return_to_base_data (json): dados da volta à base oficial (-22.6977499, -43.2936013), contada 1x no fim do lote
 * - pings_count (number)
 * - route_started_at (date)
 * - route_finished_at (date)
 * - status (select: processed | yellow_flag | blocked_admin_decision)
 * - calculated_at (date)
 *
 * Também adiciona campos de apoio em orders para rastreabilidade direta do lote:
 * - route_batch_key (se não existir na coleção orders como campo nativo registrado)
 * - batch_telemetry_id (relação route_batch_telemetry)
 */

migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('users')
    let empresasCol = null
    try {
      empresasCol = app.findCollectionByNameOrId('empresas')
    } catch {}

    // 1. Criar coleção route_batch_telemetry
    const telemetryCol = new Collection({
      name: 'route_batch_telemetry',
      type: 'base',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != ''",
      fields: [
        {
          name: 'route_batch_key',
          type: 'text',
          required: true,
        },
        {
          name: 'courier_id',
          type: 'relation',
          required: true,
          collectionId: usersCol ? usersCol.id : '_pb_users_auth_',
          cascadeDelete: false,
          maxSelect: 1,
        },
        {
          name: 'empresa_id',
          type: 'relation',
          required: false,
          collectionId: empresasCol ? empresasCol.id : 'empresas',
          cascadeDelete: false,
          maxSelect: 1,
        },
        {
          name: 'km_gps_total',
          type: 'number',
          required: false,
        },
        {
          name: 'km_viario_total',
          type: 'number',
          required: false,
        },
        {
          name: 'km_oficial',
          type: 'number',
          required: false,
        },
        {
          name: 'legs_data',
          type: 'json',
          required: false,
        },
        {
          name: 'telemetry_gaps',
          type: 'json',
          required: false,
        },
        {
          name: 'gaps_count',
          type: 'number',
          required: false,
        },
        {
          name: 'gaps_total_seconds',
          type: 'number',
          required: false,
        },
        {
          name: 'deviation_classification',
          type: 'json',
          required: false,
        },
        {
          name: 'return_to_base_data',
          type: 'json',
          required: false,
        },
        {
          name: 'pings_count',
          type: 'number',
          required: false,
        },
        {
          name: 'first_ping_at',
          type: 'date',
          required: false,
        },
        {
          name: 'last_ping_at',
          type: 'date',
          required: false,
        },
        {
          name: 'route_started_at',
          type: 'date',
          required: false,
        },
        {
          name: 'route_finished_at',
          type: 'date',
          required: false,
        },
        {
          name: 'status',
          type: 'select',
          required: false,
          values: ['processed', 'yellow_flag', 'blocked_admin_decision'],
          maxSelect: 1,
        },
        {
          name: 'metadata',
          type: 'json',
          required: false,
        },
        {
          name: 'created',
          type: 'autodate',
          onCreate: true,
          onUpdate: false,
        },
        {
          name: 'updated',
          type: 'autodate',
          onCreate: true,
          onUpdate: true,
        },
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_batch_telemetry_key ON route_batch_telemetry (route_batch_key)',
        'CREATE INDEX idx_batch_telemetry_courier ON route_batch_telemetry (courier_id, created DESC)',
        'CREATE INDEX idx_batch_telemetry_created ON route_batch_telemetry (created DESC)',
      ],
    })

    app.save(telemetryCol)

    // 2. Garantir campo route_batch_key na coleção orders (caso não exista formalmente)
    try {
      const ordersCol = app.findCollectionByNameOrId('orders')
      if (ordersCol) {
        if (!ordersCol.fields.getByName('route_batch_key')) {
          ordersCol.fields.add(
            new TextField({
              name: 'route_batch_key',
              required: false,
            }),
          )
        }
        if (!ordersCol.fields.getByName('batch_telemetry_id')) {
          ordersCol.fields.add(
            new RelationField({
              name: 'batch_telemetry_id',
              required: false,
              collectionId: telemetryCol.id,
              maxSelect: 1,
              cascadeDelete: false,
            }),
          )
        }
        app.save(ordersCol)
      }
    } catch (eOrders) {
      console.log('[migration 0158] Aviso ao adicionar campos em orders:', eOrders)
    }
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('route_batch_telemetry')
      if (col) {
        app.delete(col)
      }
    } catch {}
  },
)

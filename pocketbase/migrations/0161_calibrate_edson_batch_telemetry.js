/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration 0161: Calibra o registro canônico de route_batch_telemetry para o lote 16h51 do Edson (11/10/2026)
 * Valores esperados oficiais: 13,24 km GPS / 13,40 km viário, km oficial 13,24.
 */
migrate(
  (app) => {
    const courierId = 'tetrfu5oi19jbwz'
    const batchKey = 'rb_tetrfu5oi19jbwz_20261011_29862310'

    const telemetryCol = app.findCollectionByNameOrId('route_batch_telemetry')
    if (!telemetryCol) return

    let rec = null
    try {
      rec = app.findFirstRecordByData('route_batch_telemetry', 'route_batch_key', batchKey)
    } catch (_) {}

    if (!rec) {
      rec = new Record(telemetryCol)
      rec.set('route_batch_key', batchKey)
    }

    rec.set('courier_id', courierId)
    rec.set('km_gps_total', 13.24)
    rec.set('km_viario_total', 13.4)
    rec.set('km_oficial', 13.24)
    rec.set('status', 'processed')

    // Lacunas de telemetria identificadas no lote
    const gaps = [
      {
        gap_index: 1,
        start_iso: '2026-10-11T17:36:00.000Z',
        end_iso: '2026-10-11T17:42:00.000Z',
        duration_seconds: 360,
        duration_minutes: 6.0,
        prev_coords: { lat: -22.7085545, lng: -43.2936265 },
        curr_coords: { lat: -22.6983427, lng: -43.2920613 },
      },
    ]

    rec.set('telemetry_gaps', gaps)
    rec.set('gaps_count', 1)
    rec.set('gaps_total_seconds', 360)
    rec.set('pings_count', 48)

    // Desvio corredor
    rec.set('deviation_classification', [
      {
        start_iso: '2026-10-11T18:15:00.000Z',
        end_iso: '2026-10-11T18:18:00.000Z',
        max_deviation_meters: 168,
        pings_count: 5,
        start_coords: { lat: -22.693987, lng: -43.3007074 },
        end_coords: { lat: -22.6955968, lng: -43.2931593 },
      },
    ])

    rec.set('return_to_base_data', {
      base_coords: { lat: -22.6977499, lng: -43.2936013 },
      base_name: 'Drogaria Mais Saudável - Pilar',
      km_viario_retorno: 1.85,
      km_gps_retorno: 1.82,
      contado_uma_vez: true,
    })

    const existingMeta = rec.get('metadata') || {}
    rec.set('metadata', {
      ...existingMeta,
      batch_label: 'Lote 16h51 Edson (11/10/2026)',
      km_gps_total: 13.24,
      km_viario_total: 13.4,
      km_oficial: 13.24,
      gaps_count: 1,
      gaps_total_seconds: 360,
      pings_count: 48,
      calibrated_at: new Date().toISOString(),
    })

    app.save(rec)

    // Atualizar pedidos do lote com a referência batch_telemetry_id e totais
    try {
      const orders = app.findRecordsByFilter(
        'orders',
        `route_batch_key = '${batchKey}'`,
        'sequence',
        100,
        0,
      )
      if (orders && orders.length > 0) {
        for (let i = 0; i < orders.length; i++) {
          const ord = orders[i]
          ord.set('batch_telemetry_id', rec.id)
          ord.set('total_route_with_return_km', 13.4)
          app.save(ord)
        }
      }
    } catch (_) {}
  },
  (app) => {},
)

/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration 0165: Reprocessamento direto e canônico dos lotes com pings_count=0:
 * - Lote da Figueira: rb_tetrfu5oi19jbwz_20261011_29862504 (esperado ~4,12 km haversine com 5 pings em locations)
 * - Lote 18:06 / 21:06 de 13/10: rb_tetrfu5oi19jbwz_20261013_29865426
 * - Consulta direta via SQL (app.db().newQuery) na tabela locations para evitar qualquer divergência de fuso horário ou de filtro de string na busca por data.
 */
migrate(
  (app) => {
    function haversineDistMeters(lat1, lon1, lat2, lon2) {
      if (lat1 === lat2 && lon1 === lon2) return 0
      const R = 6371000
      const toRad = Math.PI / 180
      const dLat = (lat2 - lat1) * toRad
      const dLon = (lon2 - lon1) * toRad
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
      return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
    }

    // 1. Processar Lote da Figueira (11/10/2026)
    try {
      const figueiraKey = 'rb_tetrfu5oi19jbwz_20261011_29862504'
      const rows = []
      app
        .db()
        .newQuery(
          "SELECT id, user_id, lat, lng, created FROM locations WHERE user_id = 'tetrfu5oi19jbwz' AND created >= '2026-10-11 20:00:00' AND created <= '2026-10-11 22:00:00' ORDER BY created ASC",
        )
        .all(rows)

      console.log(`[migration 0165] Pings Figueira encontrados via SQL: ${rows.length}`)
      let kmGpsTotalMeters = 0
      for (let i = 1; i < rows.length; i++) {
        const d = haversineDistMeters(
          Number(rows[i - 1].lat),
          Number(rows[i - 1].lng),
          Number(rows[i].lat),
          Number(rows[i].lng),
        )
        kmGpsTotalMeters += d
      }
      const kmGpsTotal = Number((kmGpsTotalMeters / 1000).toFixed(2))
      const pingsCount = rows.length
      const firstPingAt = rows.length > 0 ? rows[0].created : ''
      const lastPingAt = rows.length > 0 ? rows[rows.length - 1].created : ''

      const figRec = app.findFirstRecordByData(
        'route_batch_telemetry',
        'route_batch_key',
        figueiraKey,
      )
      if (figRec) {
        figRec.set('pings_count', pingsCount)
        figRec.set('km_gps_total', kmGpsTotal)
        if (firstPingAt) figRec.set('first_ping_at', firstPingAt)
        if (lastPingAt) figRec.set('last_ping_at', lastPingAt)
        const kmViario = figRec.getFloat('km_viario_total') || 6.09
        const kmOficial = kmGpsTotal > 0 ? Math.min(kmViario, kmGpsTotal) : kmViario
        figRec.set('km_oficial', kmOficial)
        app.save(figRec)
        console.log(
          `[migration 0165] Figueira atualizada: km_gps=${kmGpsTotal}, pings=${pingsCount}, oficial=${kmOficial}`,
        )
      }
    } catch (eFig) {
      console.log('[migration 0165] Erro no lote da Figueira:', eFig)
    }

    // 2. Processar Lote 18:06 / 21:06 de hoje (rb_tetrfu5oi19jbwz_20261013_29865426)
    try {
      const todayKey = 'rb_tetrfu5oi19jbwz_20261013_29865426'
      const rowsToday = []
      app
        .db()
        .newQuery(
          "SELECT id, user_id, lat, lng, created FROM locations WHERE user_id = 'tetrfu5oi19jbwz' AND created >= '2026-10-13 18:00:00' AND created <= '2026-10-13 23:00:00' ORDER BY created ASC",
        )
        .all(rowsToday)

      console.log(`[migration 0165] Pings Hoje encontrados via SQL: ${rowsToday.length}`)
      let kmGpsMeters = 0
      for (let i = 1; i < rowsToday.length; i++) {
        const d = haversineDistMeters(
          Number(rowsToday[i - 1].lat),
          Number(rowsToday[i - 1].lng),
          Number(rowsToday[i].lat),
          Number(rowsToday[i].lng),
        )
        kmGpsMeters += d
      }
      const kmGpsTotal = Number((kmGpsMeters / 1000).toFixed(2))
      const pingsCount = rowsToday.length
      const firstPingAt = rowsToday.length > 0 ? rowsToday[0].created : ''
      const lastPingAt = rowsToday.length > 0 ? rowsToday[rowsToday.length - 1].created : ''

      let todayRec = null
      try {
        todayRec = app.findFirstRecordByData('route_batch_telemetry', 'route_batch_key', todayKey)
      } catch (_) {}

      if (!todayRec) {
        const col = app.findCollectionByNameOrId('route_batch_telemetry')
        todayRec = new Record(col)
        todayRec.set('route_batch_key', todayKey)
        todayRec.set('courier_id', 'tetrfu5oi19jbwz')
        todayRec.set('empresa_id', '7wo05iyvfcfh01h')
      }

      todayRec.set('pings_count', pingsCount)
      todayRec.set('km_gps_total', kmGpsTotal)
      if (firstPingAt) todayRec.set('first_ping_at', firstPingAt)
      if (lastPingAt) todayRec.set('last_ping_at', lastPingAt)
      const kmViario = todayRec.getFloat('km_viario_total') || 5.12
      const kmOficial = kmGpsTotal > 0 ? Math.min(kmViario, kmGpsTotal) : kmViario
      todayRec.set('km_viario_total', kmViario)
      todayRec.set('km_oficial', kmOficial)
      todayRec.set('status', 'processed')
      app.save(todayRec)
      console.log(
        `[migration 0165] Lote hoje atualizado: km_gps=${kmGpsTotal}, pings=${pingsCount}, oficial=${kmOficial}`,
      )
    } catch (eToday) {
      console.log('[migration 0165] Erro no lote de hoje:', eToday)
    }
  },
  (app) => {},
)

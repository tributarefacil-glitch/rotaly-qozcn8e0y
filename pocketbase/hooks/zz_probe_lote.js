// pocketbase/hooks/zz_probe_lote.js
// DIAGNÓSTICO TEMPORÁRIO — remover depois. Somente LEITURA.
// Extrai coordenadas reais da base e das paradas do lote do Edson para um
// teste comparativo de otimização (rota atual x rota otimizada).
routerAdd('GET', '/backend/v1/zz-lote-geo', (c) => {
  const batch = 'rb_tetrfu5oi19jbwz_20261110_29905526'
  try {
    const ords = $app.findRecordsByFilter(
      'orders',
      `route_batch_key = '${batch}'`,
      'sequence',
      50,
      0,
    )
    const out = []
    for (let i = 0; i < ords.length; i++) {
      const o = ords[i]
      out.push({
        code: o.getString('tracking_code'),
        seq: o.get('sequence'),
        status: o.getString('status'),
        end_lat: o.getFloat('end_address_lat'),
        end_lng: o.getFloat('end_address_lng'),
        start_lat: o.getFloat('start_base_lat'),
        start_lng: o.getFloat('start_base_lng'),
        end_text: o.getString('end_address_text'),
        route_km: o.get('total_route_with_return_km'),
        distance_km: o.get('distance_km'),
      })
    }
    return c.json(200, { total: ords.length, pedidos: out })
  } catch (err) {
    return c.json(500, { error: String((err && err.message) || err) })
  }
})

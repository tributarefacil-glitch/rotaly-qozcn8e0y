// pocketbase/hooks/zz_diag_lote.js
// DIAGNÓSTICO TEMPORÁRIO — remover depois. Apenas leitura, não altera nada.
// Lista os pedidos do lote informado com empresa_id, sequence, status e route_released,
// para identificar por que o app do entregador exibe menos paradas que o total do lote.
routerAdd('GET', '/backend/v1/zz-diag-lote', (c) => {
  let batchKey = ''
  try {
    batchKey = (c.request.url.query().get('batch_key') || '').trim()
  } catch (_) {}
  if (!batchKey) {
    return c.json(400, { error: 'informe batch_key' })
  }
  const safe = batchKey.replace(/[^a-zA-Z0-9_]/g, '')
  try {
    const ords = $app.findRecordsByFilter(
      'orders',
      `route_batch_key = '${safe}'`,
      'sequence',
      200,
      0,
    )
    const out = []
    for (let i = 0; i < ords.length; i++) {
      const o = ords[i]
      out.push({
        tracking_code: o.getString('tracking_code'),
        sequence: o.get('sequence'),
        status: o.getString('status'),
        route_released: o.getBool('route_released'),
        route_started: o.getBool('route_started'),
        route_finished: o.getBool('route_finished'),
        empresa_id: o.getString('empresa_id'),
        courier_id: o.getString('courier_id'),
        customer: o.getString('customer_id'),
      })
    }
    const empresas = {}
    for (let j = 0; j < out.length; j++) {
      const e = out[j].empresa_id || '(vazio)'
      empresas[e] = (empresas[e] || 0) + 1
    }
    return c.json(200, {
      batch_key: safe,
      total: out.length,
      empresas_contagem: empresas,
      pedidos: out,
    })
  } catch (err) {
    return c.json(500, { error: String((err && err.message) || err) })
  }
})

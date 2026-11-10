// pocketbase/hooks/zz_diag_lote.js
// DIAGNÓSTICO TEMPORÁRIO — remover depois. Apenas leitura, não altera nada.
// Roda o MESMO filtro que o app do entregador usa e compara com o total do lote,
// para descobrir por que a tela exibe menos paradas que o servidor tem.
routerAdd('GET', '/backend/v1/zz-diag-lote', (c) => {
  let courierId = ''
  try {
    courierId = (c.request.url.query().get('courier_id') || '').trim()
  } catch (_) {}
  if (!courierId) return c.json(400, { error: 'informe courier_id' })
  const safe = courierId.replace(/[^a-zA-Z0-9]/g, '')

  try {
    // Filtro exato do CourierApp
    const filtroApp = `courier_id = '${safe}' && (route_released = true || status = 'assigned' || status = 'in_transit' || status = 'delivered' || status = 'address_error' || status = 'client_absent')`

    const doFiltro = $app.findRecordsByFilter('orders', filtroApp, 'sequence,-created', 500, 0)

    const detalhe = []
    for (let i = 0; i < doFiltro.length; i++) {
      const o = doFiltro[i]
      detalhe.push({
        tracking_code: o.getString('tracking_code'),
        sequence: o.get('sequence'),
        status: o.getString('status'),
        route_released: o.getBool('route_released'),
        route_started: o.getBool('route_started'),
        route_finished: o.getBool('route_finished'),
        batch: o.getString('route_batch_key'),
        route_started_at: o.getString('route_started_at'),
        created: o.getString('created'),
      })
    }

    // Contagem por status e por lote
    const porStatus = {}
    const porLote = {}
    for (let j = 0; j < detalhe.length; j++) {
      const d = detalhe[j]
      porStatus[d.status] = (porStatus[d.status] || 0) + 1
      const b = d.batch || '(sem lote)'
      porLote[b] = (porLote[b] || 0) + 1
    }

    // Pedidos que o app considera executáveis (in_transit ou assigned)
    const executaveis = detalhe.filter((d) => d.status === 'in_transit' || d.status === 'assigned')

    return c.json(200, {
      courier_id: safe,
      total_filtro_app: detalhe.length,
      total_executaveis: executaveis.length,
      por_status: porStatus,
      por_lote: porLote,
      pedidos: detalhe,
    })
  } catch (err) {
    return c.json(500, { error: String((err && err.message) || err) })
  }
})

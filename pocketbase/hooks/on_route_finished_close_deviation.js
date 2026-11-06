// pocketbase/hooks/on_route_finished_close_deviation.js
//
// QUANDO UMA ROTA É FINALIZADA (route_finished = true), CONSOLIDA E FECHA
// QUALQUER EPISÓDIO ABERTO DE DESVIO OU PARADA NÃO PLANEJADA PARA O LOTE
//
onRecordAfterUpdateSuccess((e) => {
  try {
    const targetOrder = e.record
    const originalOrder = targetOrder.original()
    const incomingRouteFinished = targetOrder.getBool('route_finished')
    const wasRouteFinished = originalOrder ? originalOrder.getBool('route_finished') : false

    // Disparar somente na transição de falso para verdadeiro
    if (!incomingRouteFinished || wasRouteFinished) {
      return
    }

    const courierId = targetOrder.getString('courier_id')
    const batchKey = targetOrder.getString('route_batch_key')

    if (!courierId) {
      return
    }

    let filterStr = `courier_id = '${courierId}'`
    if (batchKey) {
      filterStr += ` && notes ~ '${batchKey}'`
    }

    const openDevEvs = e.app.findRecordsByFilter('off_route_events', filterStr, '-created', 20, 0)

    const nowIso = new Date().toISOString()
    for (let i = 0; i < openDevEvs.length; i++) {
      const ev = openDevEvs[i]
      const notes = ev.getString('notes') || ''
      if (!notes.includes('[fechado')) {
        try {
          const epStart = new Date(ev.getString('created')).getTime()
          const totalDur = Math.max(1, Math.round((Date.now() - epStart) / 1000))
          ev.set('stop_duration_seconds', totalDur)
          ev.set('notes', `${notes} [fechado - lote concluído em ${nowIso.slice(11, 19)} UTC]`)
          e.app.save(ev)
        } catch (errSave) {
          console.log('[on_route_finished_close_deviation] Erro ao fechar evento:', errSave)
        }
      }
    }
  } catch (err) {
    console.log('[on_route_finished_close_deviation] Erro no hook:', err)
  }
}, 'orders')

/**
 * pocketbase/hooks/mixed_batch_auto_close.js
 *
 * FUTURO: fechamento automatico de "lote misto" orfao.
 * Gatilhos:
 *   - onRecordAfterUpdateSuccess em orders: se o pedido acabou de ficar delivered e
 *     todos os irmaos do lote ja estao concluidos, fecha o lote inteiro na hora.
 *   - onRecordCreateRequest em locations: a cada ping, rede de seguranca que checa
 *     (barato, por courier) se existe lote misto prescrito (pedido in_transit sem
 *     atualizacao ha mais de 3h com irmaos todos concluidos) e fecha.
 *
 * IMPORTANTE (escopo JSVM do PocketBase): callbacks rodam em um pool de VM separado,
 * entao declaracoes top-level (const/funcoes helpers) NAO sao visiveis dentro deles.
 * TODA a logica e constantes vivem INLINE no corpo de cada callback (helpers
 * duplicados de proposito, sem qualquer referencia a declaracoes top-level).
 *
 * Regras: nao altera km/fuel; auditoria com user_id vazio + actor_name='Sistema' +
 * metadata.system_trigger=true; idempotente (so age em pedidos ainda in_transit).
 */

// A) Pedido recem-concluido: se o lote ficou 100% concluido exceto um preso, fecha agora
//    (independe das 3h: o caso e inequivoco, a ultima entrega gravada foi a do irmao).
onRecordAfterUpdateSuccess((e) => {
  // --- helpers inline (escopo JSVM: nada de top-level aqui) ---
  const FINAL_STATUSES = [
    'delivered',
    'delivered_with_exception',
    'unsuccessful',
    'address_error',
    'client_absent',
    'cancelled',
  ]
  const isFinalStatus = (st) => FINAL_STATUSES.indexOf(st) !== -1
  const STALE_MS = 3 * 60 * 60 * 1000 // 3 horas sem atualizacao

  const closeMixedBatch = (app, stuck, siblings) => {
    const nowIso = new Date().toISOString()
    const bKey = stuck.getString('route_batch_key')

    try {
      stuck.set('status', 'delivered')
      stuck.set('completion_reason', 'system_auto_close')
      stuck.set('route_finished', true)
      stuck.set('route_finished_at', nowIso)
      app.save(stuck)
    } catch (eSave) {
      console.warn('[mixed_batch_auto_close] Erro ao fechar pedido ' + stuck.id + ':', eSave)
      return false
    }

    for (let s = 0; s < siblings.length; s++) {
      const sib = siblings[s]
      if (sib.getBool('route_finished')) continue
      try {
        sib.set('route_finished', true)
        if (!sib.getString('route_finished_at')) sib.set('route_finished_at', nowIso)
        app.save(sib)
      } catch (eSib) {
        console.warn(
          '[mixed_batch_auto_close] Erro ao propagar route_finished p/ ' + sib.id + ':',
          eSib,
        )
      }
    }

    // Auditoria (acao automatica do Sistema)
    try {
      const auditCol = app.findCollectionByNameOrId('audit_trail')
      if (auditCol) {
        const auditRec = new Record(auditCol)
        auditRec.set('user_id', '')
        auditRec.set('collection', 'orders')
        auditRec.set('record_id', stuck.id)
        const courierId = stuck.getString('courier_id')
        if (courierId) auditRec.set('courier_id', courierId)
        const empresaId = stuck.getString('empresa_id')
        if (empresaId) auditRec.set('empresa_id', empresaId)
        auditRec.set('action', 'auto_close_lote_misto')
        auditRec.set('field', 'status')
        auditRec.set('old_value', 'in_transit')
        auditRec.set('new_value', 'delivered')
        auditRec.set('timestamp', nowIso)
        auditRec.set('metadata', {
          system_trigger: true,
          actor_name: 'Sistema',
          actor_role: 'system',
          tracking_code: stuck.getString('tracking_code'),
          route_batch_key: bKey,
          siblings_count: siblings.length,
          reason:
            'Lote misto: todas as demais entregas do lote concluidas e pedido preso em in_transit ha mais de 3 horas.',
          note: 'Fechamento automatico com completion_reason=system_auto_close. Km/fuel inalterados.',
        })
        app.save(auditRec)
      }
    } catch (eAudit) {
      console.warn('[mixed_batch_auto_close] Erro ao gravar audit_trail:', eAudit)
    }

    // Fechamento de episodios de desvio abertos do lote (equivalente a
    // on_route_finished_close_deviation, que nao e acionado por saves internos)
    try {
      const courierIdDev = stuck.getString('courier_id')
      if (courierIdDev) {
        let filterStr = "courier_id = '" + courierIdDev + "'"
        if (bKey) filterStr += " && notes ~ '" + bKey + "'"
        const openDevEvs = app.findRecordsByFilter('off_route_events', filterStr, '-created', 20, 0)
        for (let d = 0; d < openDevEvs.length; d++) {
          const ev = openDevEvs[d]
          const notes = ev.getString('notes') || ''
          if (notes.indexOf('[fechado') === -1) {
            try {
              const epStart = new Date(ev.getString('created')).getTime()
              const totalDur = Math.max(1, Math.round((Date.now() - epStart) / 1000))
              ev.set('stop_duration_seconds', totalDur)
              ev.set(
                'notes',
                notes + ' [fechado - lote concluido em ' + nowIso.slice(11, 19) + ' UTC]',
              )
              app.save(ev)
            } catch (errSave) {
              console.warn('[mixed_batch_auto_close] Erro ao fechar evento de desvio:', errSave)
            }
          }
        }
      }
    } catch (errDev) {
      console.warn('[mixed_batch_auto_close] Erro ao fechar desvios do lote:', errDev)
    }

    // Fim de lote: telemetria canonica (mesma chamada do fechamento normal)
    try {
      $http.send({
        url: 'http://127.0.0.1:8090/backend/v1/telemetria-lote/processar',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ route_batch_key: bKey }),
        timeout: 15,
      })
    } catch (_) {}

    return true
  }

  const checkMixedBatchForOrder = (app, stuck) => {
    const bKey = stuck.getString('route_batch_key')
    if (!bKey) return false
    if (stuck.getString('status') !== 'in_transit') return false
    if (!stuck.getBool('route_started')) return false

    let siblings = []
    try {
      siblings = app.findRecordsByFilter(
        'orders',
        "route_batch_key = '" + bKey + "' && id != '" + stuck.id + "'",
        'updated',
        500,
        0,
      )
    } catch (eSib) {
      console.warn('[mixed_batch_auto_close] Erro ao buscar irmaos:', eSib)
      return false
    }
    if (!siblings || siblings.length === 0) return false
    if (!siblings.every((s) => isFinalStatus(s.getString('status')))) return false

    const updatedMs = new Date(stuck.getString('updated') || stuck.getString('created')).getTime()
    if (!(updatedMs > 0 && Date.now() - updatedMs > STALE_MS)) return false

    return closeMixedBatch(app, stuck, siblings)
  }

  // --- corpo do gatilho ---
  try {
    const ord = e.record
    const st = ord.getString('status')
    if (!isFinalStatus(st)) {
      e.next()
      return
    }
    const bKey = ord.getString('route_batch_key')
    if (!bKey) {
      e.next()
      return
    }

    const siblings = $app.findRecordsByFilter(
      'orders',
      "route_batch_key = '" +
        bKey +
        "' && id != '" +
        ord.id +
        "' && (status = 'in_transit' || (route_finished = false || route_finished = null))",
      'updated',
      100,
      0,
    )

    if (!siblings || siblings.length === 0) {
      e.next()
      return
    }

    for (let i = 0; i < siblings.length; i++) {
      const sib = siblings[i]
      const sibStatus = sib.getString('status')
      if (sibStatus !== 'in_transit') continue // pendentes aguardam entrega normal
      checkMixedBatchForOrder($app, sib)
    }
  } catch (errHook) {
    console.warn('[mixed_batch_auto_close] Erro no afterUpdate de orders:', errHook)
  } finally {
    e.next()
  }
}, 'orders')

// B) Rede de seguranca a cada ping de localizacao: fecha lote misto stale
onRecordCreateRequest((e) => {
  // --- helpers inline (escopo JSVM: nada de top-level aqui) ---
  const FINAL_STATUSES = [
    'delivered',
    'delivered_with_exception',
    'unsuccessful',
    'address_error',
    'client_absent',
    'cancelled',
  ]
  const isFinalStatus = (st) => FINAL_STATUSES.indexOf(st) !== -1
  const STALE_MS = 3 * 60 * 60 * 1000 // 3 horas sem atualizacao

  const formatPbDate = (d) =>
    d
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d+Z?$/, '')

  const closeMixedBatch = (app, stuck, siblings) => {
    const nowIso = new Date().toISOString()
    const bKey = stuck.getString('route_batch_key')

    try {
      stuck.set('status', 'delivered')
      stuck.set('completion_reason', 'system_auto_close')
      stuck.set('route_finished', true)
      stuck.set('route_finished_at', nowIso)
      app.save(stuck)
    } catch (eSave) {
      console.warn('[mixed_batch_auto_close] Erro ao fechar pedido ' + stuck.id + ':', eSave)
      return false
    }

    for (let s = 0; s < siblings.length; s++) {
      const sib = siblings[s]
      if (sib.getBool('route_finished')) continue
      try {
        sib.set('route_finished', true)
        if (!sib.getString('route_finished_at')) sib.set('route_finished_at', nowIso)
        app.save(sib)
      } catch (eSib) {
        console.warn(
          '[mixed_batch_auto_close] Erro ao propagar route_finished p/ ' + sib.id + ':',
          eSib,
        )
      }
    }

    // Auditoria (acao automatica do Sistema)
    try {
      const auditCol = app.findCollectionByNameOrId('audit_trail')
      if (auditCol) {
        const auditRec = new Record(auditCol)
        auditRec.set('user_id', '')
        auditRec.set('collection', 'orders')
        auditRec.set('record_id', stuck.id)
        const courierId = stuck.getString('courier_id')
        if (courierId) auditRec.set('courier_id', courierId)
        const empresaId = stuck.getString('empresa_id')
        if (empresaId) auditRec.set('empresa_id', empresaId)
        auditRec.set('action', 'auto_close_lote_misto')
        auditRec.set('field', 'status')
        auditRec.set('old_value', 'in_transit')
        auditRec.set('new_value', 'delivered')
        auditRec.set('timestamp', nowIso)
        auditRec.set('metadata', {
          system_trigger: true,
          actor_name: 'Sistema',
          actor_role: 'system',
          tracking_code: stuck.getString('tracking_code'),
          route_batch_key: bKey,
          siblings_count: siblings.length,
          reason:
            'Lote misto: todas as demais entregas do lote concluidas e pedido preso em in_transit ha mais de 3 horas.',
          note: 'Fechamento automatico com completion_reason=system_auto_close. Km/fuel inalterados.',
        })
        app.save(auditRec)
      }
    } catch (eAudit) {
      console.warn('[mixed_batch_auto_close] Erro ao gravar audit_trail:', eAudit)
    }

    // Fechamento de episodios de desvio abertos do lote
    try {
      const courierIdDev = stuck.getString('courier_id')
      if (courierIdDev) {
        let filterStr = "courier_id = '" + courierIdDev + "'"
        if (bKey) filterStr += " && notes ~ '" + bKey + "'"
        const openDevEvs = app.findRecordsByFilter('off_route_events', filterStr, '-created', 20, 0)
        for (let d = 0; d < openDevEvs.length; d++) {
          const ev = openDevEvs[d]
          const notes = ev.getString('notes') || ''
          if (notes.indexOf('[fechado') === -1) {
            try {
              const epStart = new Date(ev.getString('created')).getTime()
              const totalDur = Math.max(1, Math.round((Date.now() - epStart) / 1000))
              ev.set('stop_duration_seconds', totalDur)
              ev.set(
                'notes',
                notes + ' [fechado - lote concluido em ' + nowIso.slice(11, 19) + ' UTC]',
              )
              app.save(ev)
            } catch (errSave) {
              console.warn('[mixed_batch_auto_close] Erro ao fechar evento de desvio:', errSave)
            }
          }
        }
      }
    } catch (errDev) {
      console.warn('[mixed_batch_auto_close] Erro ao fechar desvios do lote:', errDev)
    }

    // Fim de lote: telemetria canonica (mesma chamada do fechamento normal)
    try {
      $http.send({
        url: 'http://127.0.0.1:8090/backend/v1/telemetria-lote/processar',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ route_batch_key: bKey }),
        timeout: 15,
      })
    } catch (_) {}

    return true
  }

  const checkMixedBatchForOrder = (app, stuck) => {
    const bKey = stuck.getString('route_batch_key')
    if (!bKey) return false
    if (stuck.getString('status') !== 'in_transit') return false
    if (!stuck.getBool('route_started')) return false

    let siblings = []
    try {
      siblings = app.findRecordsByFilter(
        'orders',
        "route_batch_key = '" + bKey + "' && id != '" + stuck.id + "'",
        'updated',
        500,
        0,
      )
    } catch (eSib) {
      console.warn('[mixed_batch_auto_close] Erro ao buscar irmaos:', eSib)
      return false
    }
    if (!siblings || siblings.length === 0) return false
    if (!siblings.every((s) => isFinalStatus(s.getString('status')))) return false

    const updatedMs = new Date(stuck.getString('updated') || stuck.getString('created')).getTime()
    if (!(updatedMs > 0 && Date.now() - updatedMs > STALE_MS)) return false

    return closeMixedBatch(app, stuck, siblings)
  }

  // --- corpo do gatilho ---
  try {
    const loc = e.record
    if (!loc) {
      e.next()
      return
    }

    // Descarte prévio de pings de baixa precisão (accuracy >= 100m) ou coordenadas inválidas/fora de faixa
    const accuracy = loc.getFloat('accuracy')
    if (accuracy >= 100) {
      e.next()
      return
    }

    const lat = loc.getFloat('lat')
    const lng = loc.getFloat('lng')
    if (
      !isFinite(lat) ||
      !isFinite(lng) ||
      (lat === 0 && lng === 0) ||
      (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      e.next()
      return
    }

    const courierId = loc.getString('user_id')
    if (!courierId) {
      e.next()
      return
    }
    const staleCutoff = formatPbDate(new Date(Date.now() - STALE_MS))
    const stuckOrders = $app.findRecordsByFilter(
      'orders',
      "courier_id = '" +
        courierId +
        "' && status = 'in_transit' && route_started = true && updated < '" +
        staleCutoff +
        "'",
      'updated',
      20,
      0,
    )
    for (let i = 0; i < stuckOrders.length; i++) {
      checkMixedBatchForOrder($app, stuckOrders[i])
    }
  } catch (errHook) {
    console.warn('[mixed_batch_auto_close] Erro no create de locations:', errHook)
  } finally {
    e.next()
  }
}, 'locations')

console.log('[mixed_batch_auto_close] Hooks de fechamento de lote misto registrados.')

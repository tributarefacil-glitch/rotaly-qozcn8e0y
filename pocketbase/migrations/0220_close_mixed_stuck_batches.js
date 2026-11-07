/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration 0220 - Lote misto (todas as entregas concluidas exceto uma presa em in_transit).
 *
 * PASSADO: para cada pedido com status='in_transit' cujos irmaos do mesmo route_batch_key
 * estao todos em status final (delivered/delivered_with_exception/unsuccessful/address_error/
 * client_absent/cancelled) e sem atualizacao ha mais de 3 horas:
 *   - status = 'delivered', completion_reason = 'system_auto_close'
 *   - route_finished = true no pedido e propagado para o lote
 *   - auditoria: user_id vazio + actor_name='Sistema' + metadata.system_trigger=true
 *   - nao altera km/fuel; chama processamento de telemetria do lote (fim de lote normal)
 * Idempotente: so toca em pedidos ainda in_transit (reexecucao e no-op).
 * Banco vazio: nenhum candidato, no-op.
 */

migrate((app) => {
  const now = new Date()
  const nowIso = now.toISOString()
  const threeHoursAgoMs = now.getTime() - 3 * 60 * 60 * 1000
  const threeHoursAgo = new Date(threeHoursAgoMs)

  const FINAL_STATUSES = [
    'delivered',
    'delivered_with_exception',
    'unsuccessful',
    'address_error',
    'client_absent',
    'cancelled',
  ]

  const formatPbDate = (d) =>
    d
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d+Z?$/, '')

  const isFinalStatus = (st) => FINAL_STATUSES.indexOf(st) !== -1

  const auditCol = (() => {
    try {
      return app.findCollectionByNameOrId('audit_trail')
    } catch (_) {
      return null
    }
  })()

  // 1) Pedidos presos: in_transit, rota iniciada e sem atualizacao ha mais de 3h
  let stuckOrders = []
  try {
    stuckOrders = app.findRecordsByFilter(
      'orders',
      `status = 'in_transit' && route_started = true && updated < '${formatPbDate(threeHoursAgo)}'`,
      'updated',
      500,
      0,
    )
  } catch (eFind) {
    console.warn('[0220] Erro ao buscar pedidos presos:', eFind)
    return
  }

  if (!stuckOrders || stuckOrders.length === 0) {
    console.log('[0220] Nenhum pedido in_transit sem atualizacao ha mais de 3h. No-op.')
    return
  }

  let closedCount = 0
  const processedBatches = {}

  for (let i = 0; i < stuckOrders.length; i++) {
    const stuck = stuckOrders[i]
    const bKey = stuck.getString('route_batch_key')
    if (!bKey) continue
    if (processedBatches[bKey]) continue
    processedBatches[bKey] = true

    // 2) Irmaos do mesmo lote
    let siblings = []
    try {
      siblings = app.findRecordsByFilter(
        'orders',
        `route_batch_key = '${bKey}' && id != '${stuck.id}'`,
        'updated',
        500,
        0,
      )
    } catch (eSib) {
      console.warn(`[0220] Erro ao buscar irmaos do lote ${bKey}:`, eSib)
      continue
    }

    // Lote misto exige pelo menos um irmao concluido; se nao ha irmaos, nao e classe "lote misto"
    if (!siblings || siblings.length === 0) continue

    const allSiblingsFinal = siblings.every((s) => isFinalStatus(s.getString('status')))
    if (!allSiblingsFinal) continue

    // 3) Fechar o pedido preso
    try {
      stuck.set('status', 'delivered')
      stuck.set('completion_reason', 'system_auto_close')
      stuck.set('route_finished', true)
      stuck.set('route_finished_at', nowIso)
      app.save(stuck)
      closedCount++
      console.log(
        `[0220] Pedido ${stuck.getString('tracking_code')} (${stuck.id}) do lote ${bKey} fechado automaticamente.`,
      )
    } catch (eSave) {
      console.warn(`[0220] Erro ao fechar pedido ${stuck.id}:`, eSave)
      continue
    }

    // 4) Propagar route_finished para irmaos ainda abertos no lote
    for (let s = 0; s < siblings.length; s++) {
      const sib = siblings[s]
      if (sib.getBool('route_finished')) continue
      try {
        sib.set('route_finished', true)
        if (!sib.getString('route_finished_at')) sib.set('route_finished_at', nowIso)
        app.save(sib)
      } catch (eSibSave) {
        console.warn(`[0220] Erro ao propagar route_finished para ${sib.id}:`, eSibSave)
      }
    }

    // 5) Auditoria: user_id vazio + actor_name='Sistema' + metadata.system_trigger=true
    if (auditCol) {
      try {
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
          courier_id: stuck.getString('courier_id'),
          siblings_count: siblings.length,
          reason:
            'Lote misto: todas as demais entregas do lote concluidas e pedido preso em in_transit ha mais de 3 horas sem atualizacao.',
          note: 'Fechamento automatico com completion_reason=system_auto_close. Km/fuel inalterados.',
        })
        app.save(auditRec)
      } catch (eAudit) {
        console.warn('[0220] Erro ao gravar audit_trail:', eAudit)
      }
    }

    // 6) Fim de lote: telemetria canonica do lote (mesma chamada do fechamento normal)
    try {
      $http.send({
        url: 'http://127.0.0.1:8090/backend/v1/telemetria-lote/processar',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ route_batch_key: bKey }),
        timeout: 15,
      })
    } catch (_) {}
  }

  console.log(`[0220] Concluido: ${closedCount} pedido(s) preso(s) em lote misto fechado(s).`)
})

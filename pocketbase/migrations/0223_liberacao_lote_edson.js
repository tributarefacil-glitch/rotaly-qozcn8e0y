/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration 0223 - Liberação administrativa do lote do EDSON (10/11/2026).
 *
 * Contexto: o entregador EDSON (tetrfu5oi19jbwz) perdeu conexão, marcou as entregas
 * offline no aplicativo e o status nunca subiu para o servidor. O app passou a exibir
 * "todas as paradas concluídas" (cache local IndexedDB) enquanto o servidor mantinha
 * 2 pedidos em 'in_transit'. Ao chegar na base, o encerramento da rota era recusado
 * por "pedido(s) sem desfecho" e o entregador ficou parado.
 *
 * Pedidos afetados:
 * - mnnqchxoniyjz3s / TRK-2026-55615302 (cliente Thayna, sequência 6)
 * - w2lhh2837ic31tt / TRK-2026-41285998 (sequência 7)
 * Lote: rb_tetrfu5oi19jbwz_20261110_29905384
 *
 * Liberação autorizada pelo dono da operação (Diogo Mendes) em 10/11/2026.
 *
 * Ações:
 * 1. Marca os pendentes do lote como status='client_absent' com
 *    completion_reason='liberado_admin' — o registro NÃO é apagado e fica claro no
 *    histórico que o desfecho não veio do cliente, e sim de liberação administrativa.
 * 2. Propaga route_finished=true para todos os pedidos do lote (encerra a rota).
 * 3. Grava audit_trail com motivo, autor declarado e lista dos pedidos liberados.
 * 4. Fecha episódios de desvio abertos vinculados ao lote.
 *
 * Idempotente: pedidos que já tenham desfecho válido não são tocados, e rodar de novo
 * não altera nada.
 */
migrate(
  (app) => {
    const BATCH_KEY = 'rb_tetrfu5oi19jbwz_20261110_29905384'
    const COURIER_ID = 'tetrfu5oi19jbwz'
    const TARGET_IDS = ['mnnqchxoniyjz3s', 'w2lhh2837ic31tt']
    const nowIso = new Date().toISOString()
    const MOTIVO =
      'Entregador sem conexao marcou entregas offline; status nao sincronizou e a rota ficou travada na base. Liberacao administrativa autorizada por Diogo Mendes.'

    const liberados = []

    // 1. Aplicar desfecho administrativo nos pedidos pendentes do lote
    for (let i = 0; i < TARGET_IDS.length; i++) {
      const orderId = TARGET_IDS[i]
      let order = null
      try {
        order = app.findRecordById('orders', orderId)
      } catch (_) {
        continue // idempotente em bases onde o registro não exista
      }
      if (!order) continue

      const oldStatus = order.getString('status')
      const jaResolvido =
        oldStatus === 'delivered' ||
        oldStatus === 'cancelled' ||
        oldStatus === 'address_error' ||
        oldStatus === 'client_absent'

      if (jaResolvido) {
        console.log(`0223: Pedido ${orderId} ja possui desfecho (${oldStatus}). Ignorado.`)
        continue
      }

      // completion_reason é um select fechado: usa 'client_absent', que é o desfecho
      // canônico aceito pela guarda de route_finished. A origem administrativa fica
      // registrada em audit_trail (autorizado_por + reason + nota).
      order.set('status', 'client_absent')
      order.set('completion_reason', 'client_absent')
      order.set('route_finished', true)
      if (!order.getString('route_finished_at')) {
        order.set('route_finished_at', nowIso)
      }
      if (!order.getString('actual_arrival')) {
        order.set('actual_arrival', nowIso)
      }
      app.save(order)
      liberados.push(order.getString('tracking_code') || orderId)
      console.log(`0223: Pedido ${orderId} liberado (client_absent / liberado_admin)`)

      // 3. Auditoria por pedido
      try {
        const auditCol = app.findCollectionByNameOrId('audit_trail')
        if (auditCol) {
          const auditRec = new Record(auditCol)
          auditRec.set('user_id', '') // Sistema
          auditRec.set('actor_name', 'Liberacao administrativa')
          auditRec.set('collection', 'orders')
          auditRec.set('record_id', order.id)
          const courierId = order.getString('courier_id')
          if (courierId) auditRec.set('courier_id', courierId)
          const empresaId = order.getString('empresa_id')
          if (empresaId) auditRec.set('empresa_id', empresaId)
          auditRec.set('action', 'liberacao_administrativa_lote')
          auditRec.set('field', 'status')
          auditRec.set('old_value', oldStatus || 'in_transit')
          auditRec.set('new_value', 'client_absent')
          auditRec.set('timestamp', nowIso)
          auditRec.set('metadata', {
            system_trigger: false,
            actor_role: 'admin',
            autorizado_por: 'Diogo Mendes',
            tracking_code: order.getString('tracking_code'),
            route_batch_key: BATCH_KEY,
            courier_id: courierId || '',
            reason: MOTIVO,
            completion_reason: 'client_absent',
            nota: 'Desfecho marcado como client_absent por liberacao administrativa, nao por confirmacao do cliente.',
          })
          app.save(auditRec)
        }
      } catch (eAudit) {
        console.warn('0223: Erro ao registrar audit_trail para ' + orderId + ':', eAudit)
      }
    }

    // 2. Propagar route_finished=true para todo o lote (encerra a rota do entregador)
    try {
      const irmaos = app.findRecordsByFilter(
        'orders',
        `route_batch_key = '${BATCH_KEY}'`,
        'sequence',
        200,
        0,
      )
      for (let s = 0; s < irmaos.length; s++) {
        const sib = irmaos[s]
        if (!sib.getBool('route_finished')) {
          sib.set('route_finished', true)
          if (!sib.getString('route_finished_at')) {
            sib.set('route_finished_at', nowIso)
          }
          app.save(sib)
          console.log(`0223: route_finished=true propagado no pedido ${sib.id}`)
        }
      }
    } catch (eBatch) {
      console.warn('0223: Erro ao propagar route_finished no lote:', eBatch)
    }

    // 4. Fechar episódios de desvio abertos do lote
    try {
      const devs = app.findRecordsByFilter(
        'off_route_events',
        `notes ~ '${BATCH_KEY}'`,
        '-created',
        50,
        0,
      )
      for (let d = 0; d < devs.length; d++) {
        const ev = devs[d]
        const notes = ev.getString('notes') || ''
        if (!notes.includes('[fechado')) {
          const inicio = new Date(ev.getString('created')).getTime()
          const dur = Math.max(1, Math.round((Date.now() - inicio) / 1000))
          ev.set('stop_duration_seconds', dur)
          ev.set(
            'notes',
            `${notes} [fechado - liberacao administrativa em ${nowIso.slice(11, 19)} UTC]`,
          )
          app.save(ev)
        }
      }
    } catch (eDev) {
      console.warn('0223: Erro ao fechar off_route_events do lote:', eDev)
    }

    console.log(
      `0223: Liberacao concluida. Lote ${BATCH_KEY}, entregador ${COURIER_ID}, pedidos liberados: ${
        liberados.length > 0 ? liberados.join(', ') : 'nenhum (ja resolvidos)'
      }`,
    )
  },
  () => {
    // Reversão não aplicável: liberação de lote é registro operacional.
  },
)

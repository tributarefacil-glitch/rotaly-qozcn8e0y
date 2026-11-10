// pocketbase/hooks/route_release_admin.js
// Liberação administrativa de lote travado.
//
// Uso: destravar entregador cujo lote ficou com pedidos "sem desfecho" por perda de
// sincronização (app offline marcou a entrega, mas o servidor nunca recebeu o status).
// Sem isso o entregador fica parado na base e não consegue encerrar a rota.
//
// Segurança:
// - Exige autenticação válida ($apis.requireAuth()).
// - Só aceita usuário com role 'admin' ou 'master'.
// - Exige justificativa com pelo menos 5 caracteres (mesmo padrão da liberação de geofence).
// - Grava sempre em audit_trail com autor, motivo, lote e pedidos afetados.
//
// Efeito: marca os pedidos do lote informado como 'client_absent' com
// completion_reason='liberado_admin' e route_finished=true, encerrando a rota.
// NÃO apaga nada: o pedido continua no histórico com o desfecho registrado.

routerAdd(
  'POST',
  '/backend/v1/route-release-admin',
  (c) => {
    let authRecord = null
    try {
      authRecord = c.get('authRecord') || (typeof c.Auth === 'function' ? c.Auth() : null)
    } catch (_) {}

    if (!authRecord || !authRecord.id) {
      return c.json(401, { error: 'Autenticação obrigatória.' })
    }

    let payload = {}
    try {
      const info = c.requestInfo()
      payload = (info && info.body) || {}
    } catch (_) {}

    const batchKey = String(payload.batch_key || '').trim()
    const reason = String(payload.reason || '').trim()

    if (!batchKey) {
      return c.json(400, { error: 'Informe o batch_key do lote a liberar.' })
    }
    if (reason.length < 5) {
      return c.json(400, {
        error: 'Justificativa obrigatória com pelo menos 5 caracteres.',
      })
    }

    try {
      const requester = $app.findRecordById('users', authRecord.id)
      const role = requester.getString('role')
      if (role !== 'admin' && role !== 'master') {
        return c.json(403, { error: 'Apenas admin ou master pode liberar lote.' })
      }

      const batchOrders = $app.findRecordsByFilter(
        'orders',
        `route_batch_key = '${batchKey.replace(/[^a-zA-Z0-9_]/g, '')}'`,
        'sequence,created',
        200,
        0,
      )

      if (!batchOrders || batchOrders.length === 0) {
        return c.json(404, { error: 'Nenhum pedido encontrado para este lote.' })
      }

      const agora = new Date().toISOString()
      const liberados = []
      const falhas = []

      for (let i = 0; i < batchOrders.length; i++) {
        const ord = batchOrders[i]
        const st = ord.getString('status')
        const jaResolvido =
          st === 'delivered' ||
          st === 'cancelled' ||
          st === 'address_error' ||
          st === 'client_absent'

        if (jaResolvido) continue

        try {
          ord.set('status', 'client_absent')
          ord.set('completion_reason', 'liberado_admin')
          ord.set('route_finished', true)
          ord.set('route_finished_at', agora)
          if (!ord.getString('actual_arrival')) ord.set('actual_arrival', agora)
          $app.save(ord)
          liberados.push(ord.getString('tracking_code') || ord.id)
        } catch (errOrd) {
          falhas.push({
            id: ord.id,
            erro: String((errOrd && errOrd.message) || errOrd),
          })
        }
      }

      // Trilha de auditoria obrigatória
      try {
        const auditCol = $app.findCollectionByNameOrId('audit_trail')
        if (auditCol) {
          const audit = new Record(auditCol)
          audit.set('user_id', authRecord.id)
          audit.set('actor_name', requester.getString('name') || 'Administrador')
          audit.set('collection', 'orders')
          audit.set('action', 'liberacao_administrativa_lote')
          audit.set('field', 'route_finished')
          audit.set('old_value', 'false')
          audit.set('new_value', 'true')
          audit.set('timestamp', agora)
          audit.set('metadata', {
            route_batch_key: batchKey,
            reason: reason,
            liberados: liberados,
            falhas: falhas,
            system_trigger: false,
          })
          $app.save(audit)
        }
      } catch (errAudit) {
        console.error('[route-release-admin] Falha ao gravar audit_trail:', errAudit)
      }

      return c.json(200, {
        ok: true,
        batch_key: batchKey,
        liberados: liberados.length,
        tracking_codes: liberados,
        falhas: falhas,
        message:
          liberados.length > 0
            ? `${liberados.length} pedido(s) liberado(s). Entregador pode encerrar a rota.`
            : 'Nenhum pedido pendente neste lote.',
      })
    } catch (err) {
      console.error('[route-release-admin] Erro:', err)
      return c.json(500, {
        error: 'Falha ao liberar o lote.',
        detail: String((err && err.message) || err),
      })
    }
  },
  $apis.requireAuth(),
)

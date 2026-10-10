// Hook PocketBase de Blindagem Estrutural da Regra de Negócio de Pedidos:
// "Ordem que o cliente nunca vai para o entregador de forma automática. Somente o vendedor ou administrador pode escolher os entregadores."
//
// 1. onRecordCreate / onRecordCreateRequest:
//    Força em qualquer criação de pedido:
//    - status = 'pending'
//    - route_released = false
//    - route_started = false
//    - route_released_at = null / ''
//    - route_started_at = null / ''
//    - sequence = null
//    Se courier_id vier preenchido (escolha humana consciente pelo vendedor/admin),
//    garante assignment_type = 'manual' se vier vazio.
//    Loga caixa-preta (console.log) caso algum payload tente nascer fora do padrão.
//
// 2. onRecordUpdateRequest:
//    Bloqueia entregadores ('courier') de auto-atribuir, redirecionar ou alterar o courier_id
//    quando o pedido está em rota ativa iniciada (route_started=true && route_finished!=true).
//    Apenas vendedor ou admin (ou rotinas internas sem auth de courier) podem alterar a atribuição.

onRecordCreate((e) => {
  try {
    const order = e.record
    const incomingStatus = order.getString('status')
    const incomingRouteReleased = order.getBool('route_released')
    const incomingRouteStarted = order.getBool('route_started')
    const incomingSequence = order.get('sequence')
    const incomingRouteReleasedAt = order.getString('route_released_at')
    const incomingRouteStartedAt = order.getString('route_started_at')
    const courierId = order.getString('courier_id')
    const assignmentType = order.getString('assignment_type')
    const trackingCode = order.getString('tracking_code') || order.id || 'NOVO_PEDIDO'

    // Caixa-preta / auditoria de integridade operacional:
    // Denuncia qualquer tentativa externa ou anômala de criar pedido já liberado, iniciado, roteirizado ou fora de status pendente.
    const isAbnormal =
      (incomingStatus !== '' && incomingStatus !== 'pending') ||
      incomingRouteReleased === true ||
      incomingRouteStarted === true ||
      (incomingSequence !== null && incomingSequence !== undefined && incomingSequence !== 0) ||
      (incomingRouteReleasedAt !== '' && incomingRouteReleasedAt !== null) ||
      (incomingRouteStartedAt !== '' && incomingRouteStartedAt !== null)

    if (isAbnormal) {
      console.log(
        `[AUDITORIA_ROTEAMENTO_BLINDADO] [CAIXA-PRETA] Tentativa de criacao de pedido com estado ativo/iniciado interceptada! ` +
          `tracking_code=${trackingCode}, ` +
          `status_original='${incomingStatus}', ` +
          `route_released=${incomingRouteReleased}, ` +
          `route_started=${incomingRouteStarted}, ` +
          `sequence=${incomingSequence}, ` +
          `courier_id='${courierId}'. ` +
          `O servidor FORCOU o pedido para nascer rigorosamente 'pending' e fora de qualquer rota!`,
      )

      try {
        const auditCol = e.app.findCollectionByNameOrId('audit_trail')
        if (auditCol) {
          const auditRec = new Record(auditCol)
          let resolvedUserId = ''
          if (e.auth && e.auth.id) {
            try {
              const authUser = e.app.findRecordById('users', e.auth.id)
              if (authUser) resolvedUserId = authUser.id
            } catch (_) {}
          }
          if (resolvedUserId) {
            auditRec.set('user_id', resolvedUserId)
          }
          if (courierId) auditRec.set('courier_id', courierId)
          auditRec.set('collection', 'orders')
          auditRec.set('record_id', order.id || 'NEW_RECORD')
          auditRec.set('action', 'guard_force_pending')
          auditRec.set('field', 'status')
          auditRec.set('old_value', incomingStatus || 'abnormal_active')
          auditRec.set('new_value', 'pending')
          auditRec.set('timestamp', new Date().toISOString())
          auditRec.set('metadata', {
            reason: 'Blindagem estrutural: pedido forçado para pending na criação',
            tracking_code: trackingCode,
            actor_name: 'Sistema',
            actor_role: 'system',
            system_trigger: true,
          })
          e.app.save(auditRec)
        }
      } catch (auditErr) {
        console.log('[AUDITORIA_ROTEAMENTO_BLINDADO] Erro ao gravar audit_trail:', auditErr)
      }
    }

    // Forçar regras blindadas no banco de dados (lado servidor)
    order.set('status', 'pending')
    order.set('route_released', false)
    order.set('route_started', false)
    order.set('route_released_at', null)
    order.set('route_started_at', null)
    order.set('sequence', null)

    // Se houver courier_id (escolha manual do vendedor/admin no seletor ou botão ACEITAR),
    // garantir assignment_type = 'manual' quando vier sem esse campo.
    if (courierId && !assignmentType) {
      order.set('assignment_type', 'manual')
    }
  } catch (err) {
    console.log('[AUDITORIA_ROTEAMENTO_BLINDADO] Erro no hook onRecordCreate de orders:', err)
  }

  e.next()
}, 'orders')

// Interceptador de requisições de atualização (onRecordUpdateRequest):
// Impede entregador com papel 'courier' de redirecionar ou trocar o courier_id
// de um pedido em rota ativa já iniciada (route_started=true && route_finished!=true).
onRecordUpdateRequest((e) => {
  try {
    const authRecord = e.auth
    const role = authRecord ? authRecord.getString('role') : ''

    // Se quem está requisitando a atualização for um entregador (role === 'courier')
    if (role === 'courier') {
      const order = e.record
      const originalOrder = order.original()

      const origCourierId = originalOrder.getString('courier_id')
      const newCourierId = order.getString('courier_id')
      const isRouteStarted = originalOrder.getBool('route_started')
      const isRouteFinished = originalOrder.getBool('route_finished')

      // Se o pedido está em rota ativa iniciada e não finalizada
      // e houve tentativa de alterar ou remover o courier_id pelo entregador:
      if (isRouteStarted && !isRouteFinished && origCourierId !== newCourierId) {
        console.log(
          `[AUDITORIA_ROTEAMENTO_BLINDADO] [BLOQUEIO_SEGURANCA] Entregador id=${authRecord.id} tentou alterar courier_id ` +
            `de '${origCourierId}' para '${newCourierId}' no pedido id=${order.id} (tracking=${order.getString('tracking_code')}) ` +
            `com rota ativa em andamento. Operacao barrada pelo servidor!`,
        )
        throw new BadRequestError(
          'Entregadores não têm permissão para transferir ou auto-atribuir pedidos em rota ativa. ' +
            'Somente vendedores ou administradores podem alterar os entregadores.',
        )
      }
    }

    // PONTO 4 — Anti-fraude geofence (Regra Nova Permanente):
    // A confirmação delivered nunca bloqueia. Se >500m, aceita com status delivered marcando
    // entrega_geofence_flag='pendente_aprovacao_gt_500m', gravando audit_trail e criando address_alerts.
    const targetOrder = e.record
    const newStatus = targetOrder.getString('status')
    const geofenceFlag = targetOrder.getString('entrega_geofence_flag')
    const distanceM =
      targetOrder.getFloat('entrega_fora_pin_m') ||
      targetOrder.getFloat('entrega_distance_to_pin_m') ||
      0
    const trackingCode = targetOrder.getString('tracking_code') || ''
    const empresaId = targetOrder.getString('empresa_id') || ''
    const courierIdVal = targetOrder.getString('courier_id') || ''
    const customerIdVal = targetOrder.getString('customer_id') || ''

    if (newStatus === 'delivered' && geofenceFlag === 'pendente_aprovacao_gt_500m') {
      try {
        const auditCol = $app.findCollectionByNameOrId('audit_trail')
        if (auditCol) {
          const auditRec = new Record(auditCol)
          // Regra do projeto: ações automáticas usam user_id vazio + actor_name='Sistema' + metadata.system_trigger=true
          auditRec.set('user_id', '')
          auditRec.set('actor_name', 'Sistema')
          auditRec.set('action', 'geofence_pending_approval')
          auditRec.set('collection', 'orders')
          auditRec.set('record_id', targetOrder.id)
          auditRec.set('field', 'entrega_geofence_flag')
          auditRec.set('old_value', 'em_transito')
          auditRec.set('new_value', 'pendente_aprovacao_gt_500m')
          if (courierIdVal) auditRec.set('courier_id', courierIdVal)
          if (empresaId) auditRec.set('empresa_id', empresaId)
          auditRec.set(
            'metadata',
            JSON.stringify({
              order_id: targetOrder.id,
              tracking_code: trackingCode,
              distance_m: distanceM,
              courier_id: courierIdVal,
              customer_id: customerIdVal,
              system_trigger: true,
              actor_role: 'system',
              reason: `Entrega confirmada a ${distanceM}m do pin cadastrado (>500m). Encaminhado para aprovação da central.`,
            }),
          )
          $app.save(auditRec)
          console.log(
            '[orders_guard] audit_trail registrado com sucesso para geofence_pending_approval:',
            targetOrder.id,
          )
        }

        // Criar alerta em address_alerts se ainda não existir pendente para este cliente
        const alertsCol = $app.findCollectionByNameOrId('address_alerts')
        if (alertsCol && customerIdVal) {
          let hasPendingAlert = false
          try {
            const existingAlert = $app.findFirstRecordByFilter(
              'address_alerts',
              `customer = '${customerIdVal}' && status = 'pendente'`,
            )
            if (existingAlert) {
              hasPendingAlert = true
            }
          } catch (_) {
            hasPendingAlert = false
          }

          if (!hasPendingAlert) {
            const alertRec = new Record(alertsCol)
            alertRec.set('customer', customerIdVal)
            if (empresaId) alertRec.set('company', empresaId)
            alertRec.set('origin', 'pin_entregador')
            alertRec.set('status', 'pendente')
            alertRec.set('distance_meters', distanceM)
            if (courierIdVal) alertRec.set('marked_by', courierIdVal)
            alertRec.set('marked_at', new Date().toISOString())
            alertRec.set(
              'suggested_address',
              JSON.stringify({
                address: targetOrder.getString('end_address_text') || '',
                lat: targetOrder.getFloat('end_address_lat') || 0,
                lng: targetOrder.getFloat('end_address_lng') || 0,
              }),
            )
            alertRec.set(
              'notes',
              `Entrega realizada a ${(distanceM / 1000).toFixed(1)} km do pin cadastrado no pedido ${trackingCode}. Aguarda conferência da central.`,
            )
            $app.save(alertRec)
            console.log(
              '[orders_guard] address_alerts criado com sucesso para cliente:',
              customerIdVal,
            )
          }
        }
      } catch (errHookPending) {
        console.log('[orders_guard] Aviso ao processar geofence_pending_approval:', errHookPending)
      }
    } else if (newStatus === 'delivered' && geofenceFlag === 'liberado_admin') {
      const unlockReason = (targetOrder.getString('entrega_admin_unlock_reason') || '').trim()
      if (!unlockReason || unlockReason.length < 5) {
        throw new BadRequestError(
          'Liberação administrativa fora do geofence (>500m) exige justificativa detalhada com pelo menos 5 caracteres.',
        )
      }

      // Garantir gravação no audit_trail com quem liberou, quando, motivo e distância medida
      try {
        const adminId = authRecord ? authRecord.id : ''
        const adminName = authRecord
          ? authRecord.getString('name') || 'Administrador'
          : 'Administrador'

        const auditCol = $app.findCollectionByNameOrId('audit_trail')
        if (auditCol) {
          const auditRec = new Record(auditCol)
          if (adminId) {
            auditRec.set('user_id', adminId)
          }
          auditRec.set('actor_name', adminName)
          auditRec.set('action', 'geofence_admin_unlock')
          auditRec.set('collection', 'orders')
          auditRec.set('record_id', targetOrder.id)
          auditRec.set('field', 'entrega_geofence_flag')
          auditRec.set('old_value', 'bloqueado_gt_500m')
          auditRec.set('new_value', 'liberado_admin')
          if (courierIdVal) auditRec.set('courier_id', courierIdVal)
          if (empresaId) auditRec.set('empresa_id', empresaId)
          auditRec.set(
            'metadata',
            JSON.stringify({
              order_id: targetOrder.id,
              tracking_code: trackingCode,
              admin_user_id: adminId,
              admin_user_name: adminName,
              distance_m: distanceM,
              reason: unlockReason,
            }),
          )
          $app.save(auditRec)
          console.log(
            '[orders_guard] audit_trail registrado com sucesso para liberação admin >500m:',
            targetOrder.id,
          )
        }
      } catch (auditErr) {
        console.log('[orders_guard] Aviso ao salvar audit_trail para liberação admin:', auditErr)
      }
    }
  } catch (err) {
    // Se for o BadRequestError explicitamente lançado, propaga para barrar a requisição
    if (
      err &&
      (err.name === 'BadRequestError' ||
        (err.message && err.message.includes('Liberação administrativa')))
    ) {
      throw err
    }
    console.log(
      '[AUDITORIA_ROTEAMENTO_BLINDADO] Erro no hook onRecordUpdateRequest de orders:',
      err,
    )
  }

  e.next()
}, 'orders')

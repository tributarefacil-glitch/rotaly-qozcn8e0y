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
        // Checagem atômica prévia (mesmo cliente, janela 6h, <30m ou pendente) antes de $app.save
        const alertsCol = $app.findCollectionByNameOrId('address_alerts')
        if (alertsCol && customerIdVal) {
          let isDuplicate = false
          try {
            const sixHoursAgoIso = new Date(Date.now() - 6 * 3600 * 1000).toISOString()
            const existingAlerts = $app.findRecordsByFilter(
              'address_alerts',
              `customer = '${customerIdVal}' && created >= '${sixHoursAgoIso}'`,
              '-created',
              10,
              0,
            )
            const targetLat = targetOrder.getFloat('end_address_lat') || 0
            const targetLng = targetOrder.getFloat('end_address_lng') || 0

            for (let a = 0; a < existingAlerts.length; a++) {
              const ex = existingAlerts[a]
              if (ex.getString('status') === 'pendente') {
                isDuplicate = true
                break
              }
              let exLat = 0
              let exLng = 0
              try {
                const exS = JSON.parse(ex.getString('suggested_address') || '{}')
                exLat = Number(exS.lat || 0)
                exLng = Number(exS.lng || 0)
              } catch (_) {}

              if (targetLat !== 0 && targetLng !== 0 && exLat !== 0 && exLng !== 0) {
                const dLat = ((exLat - targetLat) * Math.PI) / 180
                const dLon = ((exLng - targetLng) * Math.PI) / 180
                const aHarv =
                  Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos((targetLat * Math.PI) / 180) *
                    Math.cos((exLat * Math.PI) / 180) *
                    Math.sin(dLon / 2) *
                    Math.sin(dLon / 2)
                const distM = 6371000 * 2 * Math.atan2(Math.sqrt(aHarv), Math.sqrt(1 - aHarv))
                if (distM <= 30) {
                  isDuplicate = true
                  break
                }
              }
            }
          } catch (_) {
            isDuplicate = false
          }

          if (!isDuplicate) {
            try {
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
            } catch (errSaveAlert) {
              console.log(
                '[orders_guard] Criação de address_alerts interceptada pelo dedup guard:',
                errSaveAlert?.message || errSaveAlert,
              )
            }
          } else {
            console.log(
              '[orders_guard] address_alerts suprimido por deduplicação (alerta existente para cliente):',
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

    // BLOCO NOVO (decisão do dono 12/10):
    // Ao confirmar entrega (status 'delivered'), o pin do entregador no local preenche coordenadas
    // APENAS se o cliente ainda não possuir nenhuma coordenada e não for entrega pendente de aprovação (>500m).
    // PROIBIDO sobrescrever coordenadas de cliente antes da aprovação do alerta pela central!
    if (
      newStatus === 'delivered' &&
      customerIdVal &&
      geofenceFlag !== 'pendente_aprovacao_gt_500m'
    ) {
      try {
        const custRecord = $app.findRecordById('customers', customerIdVal)
        const custNotes = custRecord ? custRecord.getString('notes') || '' : ''

        // Respeitar nota intocável
        if (!custNotes.includes('[CORREÇÃO DEFINITIVA')) {
          const dLat =
            targetOrder.getFloat('delivery_lat') || targetOrder.getFloat('end_address_lat') || 0
          const dLng =
            targetOrder.getFloat('delivery_lng') || targetOrder.getFloat('end_address_lng') || 0

          if (dLat !== 0 && dLng !== 0 && !isNaN(dLat) && !isNaN(dLng)) {
            // Atualizar lat/lng do cliente APENAS se estiver sem coordenadas
            const currentCustLat = custRecord.getFloat('lat') || 0
            const currentCustLng = custRecord.getFloat('lng') || 0

            if (currentCustLat === 0 && currentCustLng === 0) {
              custRecord.set('lat', dLat)
              custRecord.set('lng', dLng)
              $app.save(custRecord)
              console.log(
                '[orders_guard] Coordenadas iniciais do cliente preenchidas via pin entregador:',
                customerIdVal,
              )
            }
          }
        }
      } catch (errCustPin) {
        console.log(
          '[orders_guard] Aviso ao sincronizar coordenadas do customer no hook:',
          errCustPin,
        )
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

  // GUARDA SERVIDORA: Bloqueio estrutural de route_finished com pedidos pendentes no lote
  // Impede que qualquer cliente (app, API, script) grave route_finished=true enquanto houver
  // pedidos do lote sem desfecho válido (entregue, não atendido com motivo ou cancelado).
  // Se a última posição do entregador estiver a <150m da base oficial, destaca no log e na mensagem
  // ("tentativa de confirmação da base"). Registra sempre na audit_trail com padrão do sistema.
  try {
    const targetOrder = e.record
    const originalOrder = targetOrder.original()
    const incomingRouteFinished = targetOrder.getBool('route_finished')
    const wasRouteFinished = originalOrder ? originalOrder.getBool('route_finished') : false

    // Disparar somente quando houver transição para route_finished = true
    if (incomingRouteFinished && !wasRouteFinished) {
      const courierId = targetOrder.getString('courier_id')
      const batchKey = targetOrder.getString('route_batch_key')
      const currentOrderId = targetOrder.id

      // Base oficial Mais Saudavel (Pilar)
      const BASE_OFICIAL_LAT = -22.6977499
      const BASE_OFICIAL_LNG = -43.2936013
      const BASE_GEOFENCE_RADIUS_M = 150

      // Haversine inline para cálculo em metros
      const calcHaversineMeters = function (lat1, lon1, lat2, lon2) {
        const R = 6371e3
        const toRad = function (deg) {
          return (deg * Math.PI) / 180
        }
        const dLat = toRad(lat2 - lat1)
        const dLon = toRad(lon2 - lon1)
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        return Math.round(R * c)
      }

      // 1. Localizar outros pedidos do mesmo lote/rota
      // Desfechos válidos que encerram a entrega:
      // status in ('delivered', 'address_error', 'client_absent', 'cancelled')
      // Qualquer outro status (pending, assigned, in_transit) ou ausência de desfecho caracteriza pedido pendente.
      // IMPORTANTE: apenas pedidos que foram de fato INICIADOS nesta rota (route_started = true)
      // fazem parte da rota em execução. Pedidos atribuídos ou liberados para rotas futuras
      // (route_started = false) ficam na fila de espera e NUNCA bloqueiam o fechamento da rota atual!
      let batchOrders = []
      try {
        if (batchKey) {
          batchOrders = e.app.findRecordsByFilter(
            'orders',
            `route_batch_key = '${batchKey}' && route_started = true && id != '${currentOrderId}'`,
            'sequence,created',
            100,
            0,
          )
        } else if (courierId) {
          // Fallback por courierId com rota iniciada e não finalizada
          batchOrders = e.app.findRecordsByFilter(
            'orders',
            `courier_id = '${courierId}' && route_started = true && route_finished = false && id != '${currentOrderId}'`,
            'sequence,created',
            100,
            0,
          )
        }
      } catch (eBatchFind) {
        console.warn(
          '[orders_guard] Erro ao buscar pedidos do lote para validação de route_finished:',
          eBatchFind,
        )
      }

      // Função auxiliar para checar se o pedido possui desfecho válido
      const isOrderResolved = function (ord) {
        const st = ord.getString('status')
        const compReason = ord.getString('completion_reason')

        // Status com desfecho conclusivo
        if (
          st === 'delivered' ||
          st === 'cancelled' ||
          st === 'address_error' ||
          st === 'client_absent'
        ) {
          return true
        }
        // Casos onde completionReason já categoriza encerramento válido
        if (
          compReason === 'delivered' ||
          compReason === 'address_error' ||
          compReason === 'client_absent' ||
          compReason === 'cancelado_vendedor'
        ) {
          return true
        }
        return false
      }

      // GUARDA ANTI-CEP ORDERS_GUARD: Antes de qualquer processamento de encerramento,
      // validar se existe address_alerts pendente ou recente para este pedido/cliente e não duplicar.
      const currentOrderResolved = isOrderResolved(targetOrder)
      // Identificar pedidos pendentes no lote
      const pendingOrdersInBatch = []
      if (!currentOrderResolved) {
        pendingOrdersInBatch.push({
          id: targetOrder.id,
          tracking_code: targetOrder.getString('tracking_code') || targetOrder.id,
          status: targetOrder.getString('status') || 'vazio',
          sequence: targetOrder.get('sequence') || 0,
        })
      }

      for (let i = 0; i < batchOrders.length; i++) {
        const bo = batchOrders[i]
        if (!isOrderResolved(bo)) {
          pendingOrdersInBatch.push({
            id: bo.id,
            tracking_code: bo.getString('tracking_code') || bo.id,
            status: bo.getString('status') || 'vazio',
            sequence: bo.get('sequence') || 0,
          })
        }
      }

      // 2. SE HOUVER PEDIDO PENDENTE: BLOQUEAR A GRAVAÇÃO
      if (pendingOrdersInBatch.length > 0) {
        // Verificar última posição conhecida do entregador para destacar caso geofence da base (<150m)
        let lastCourierLat = null
        let lastCourierLng = null
        let distToBaseMeters = null
        let isAtBaseGeofence = false

        const effectiveUserId = courierId || (e.auth ? e.auth.id : '')
        if (effectiveUserId) {
          try {
            const locRecords = e.app.findRecordsByFilter(
              'locations',
              `user_id = '${effectiveUserId}'`,
              '-created',
              1,
              0,
            )
            if (locRecords && locRecords.length > 0) {
              lastCourierLat = locRecords[0].getFloat('lat')
              lastCourierLng = locRecords[0].getFloat('lng')
              if (
                lastCourierLat !== 0 &&
                lastCourierLng !== 0 &&
                !isNaN(lastCourierLat) &&
                !isNaN(lastCourierLng)
              ) {
                distToBaseMeters = calcHaversineMeters(
                  lastCourierLat,
                  lastCourierLng,
                  BASE_OFICIAL_LAT,
                  BASE_OFICIAL_LNG,
                )
                if (distToBaseMeters <= BASE_GEOFENCE_RADIUS_M) {
                  isAtBaseGeofence = true
                }
              }
            }
          } catch (eLocFind) {
            console.warn(
              '[orders_guard] Erro ao buscar última localização do entregador:',
              eLocFind,
            )
          }
        }

        const pendingCodes = pendingOrdersInBatch.map((p) => p.tracking_code).join(', ')
        const pendingCount = pendingOrdersInBatch.length

        // Montar mensagem de log com destaque para o caso da base
        let logMessage = `[orders_guard] [BLOQUEIO_ROUTE_FINISHED] Tentativa de finalizar rota com ${pendingCount} pedido(s) pendente(s): [${pendingCodes}]. Lote=${batchKey || 'sem_lote'}, Entregador=${courierId || 'indefinido'}.`
        if (isAtBaseGeofence && distToBaseMeters !== null) {
          logMessage += ` ALERTA_BASE: Entregador parado na base (${distToBaseMeters}m do pin oficial <= 150m) tentando finalizar rota com pedido pendente!`
        } else if (distToBaseMeters !== null) {
          logMessage += ` Distância até a base: ${distToBaseMeters}m.`
        }
        console.warn(logMessage)

        // Registrar tentativa bloqueada em audit_trail (obrigatório do projeto)
        // user_id vazio (relation não aceita 'system'), actor_name='Sistema', metadata.system_trigger=true
        try {
          const auditCol = e.app.findCollectionByNameOrId('audit_trail')
          if (auditCol) {
            const auditRec = new Record(auditCol)
            auditRec.set('user_id', '') // relation não aceita 'system'
            auditRec.set('actor_name', 'Sistema')
            auditRec.set('action', 'bloqueio_route_finished_pedidos_pendentes')
            auditRec.set('collection', 'orders')
            auditRec.set('record_id', targetOrder.id)
            auditRec.set('field', 'route_finished')
            auditRec.set('old_value', 'false')
            auditRec.set('new_value', 'bloqueado_com_pedidos_pendentes')
            if (courierId) auditRec.set('courier_id', courierId)
            const empresaId = targetOrder.getString('empresa_id')
            if (empresaId) auditRec.set('empresa_id', empresaId)
            auditRec.set('timestamp', new Date().toISOString())

            const auditMetadata = {
              system_trigger: true,
              actor_role: 'system',
              route_batch_key: batchKey || '',
              target_order_id: targetOrder.id,
              target_tracking_code: targetOrder.getString('tracking_code'),
              pending_orders_count: pendingCount,
              pending_orders: pendingOrdersInBatch,
              courier_id: courierId || '',
              dist_to_base_meters: distToBaseMeters,
              is_at_base_geofence: isAtBaseGeofence,
              last_courier_lat: lastCourierLat,
              last_courier_lng: lastCourierLng,
              base_lat: BASE_OFICIAL_LAT,
              base_lng: BASE_OFICIAL_LNG,
              block_reason: isAtBaseGeofence
                ? `Tentativa de finalizar rota direto da base (${distToBaseMeters}m <= 150m) com ${pendingCount} pedido(s) pendente(s)`
                : `Tentativa de finalizar rota com ${pendingCount} pedido(s) pendente(s)`,
            }
            auditRec.set('metadata', auditMetadata)
            e.app.save(auditRec)
            console.log(
              '[orders_guard] audit_trail registrado com sucesso para bloqueio de route_finished:',
              targetOrder.id,
            )
          }
        } catch (auditErr) {
          console.warn(
            '[orders_guard] Erro ao registrar audit_trail do bloqueio de route_finished:',
            auditErr,
          )
        }

        // Lançar BadRequestError com mensagem clara para o chamador (com destaque se estiver na base)
        let clientErrorMessage = `Não é possível finalizar a rota: existem ${pendingCount} pedido(s) sem desfecho (${pendingCodes}). Todos os pedidos do lote precisam ser entregues ou marcados como não atendidos antes de encerrar a rota.`
        if (isAtBaseGeofence && distToBaseMeters !== null) {
          clientErrorMessage = `Não é possível finalizar a rota da base (${distToBaseMeters}m): existem ${pendingCount} pedido(s) sem desfecho (${pendingCodes}). Conclua o desfecho de todos os pedidos antes de finalizar o lote.`
        }
        throw new BadRequestError(clientErrorMessage)
      }
    }
  } catch (errRouteFinishedGuard) {
    if (
      errRouteFinishedGuard &&
      (errRouteFinishedGuard.name === 'BadRequestError' ||
        (errRouteFinishedGuard.message &&
          errRouteFinishedGuard.message.includes('Não é possível finalizar a rota')))
    ) {
      throw errRouteFinishedGuard
    }
    console.warn(
      '[orders_guard] Erro inesperado na guarda de route_finished:',
      errRouteFinishedGuard,
    )
  }

  e.next()
}, 'orders')

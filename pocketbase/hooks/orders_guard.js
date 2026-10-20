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
    const originalOrder = targetOrder.original()
    const newStatus = targetOrder.getString('status')
    const prevStatus = originalOrder ? originalOrder.getString('status') : ''
    let geofenceFlag = targetOrder.getString('entrega_geofence_flag')
    const prevGeofenceFlag = originalOrder ? originalOrder.getString('entrega_geofence_flag') : ''
    const trackingCode = targetOrder.getString('tracking_code') || ''
    const empresaId = targetOrder.getString('empresa_id') || ''
    const courierIdVal = targetOrder.getString('courier_id') || ''
    const customerIdVal = targetOrder.getString('customer_id') || ''

    // NOVO: Detectar eventos de fechamento de rota / batch close / recálculos subsequentes
    const isClosingEvent = Boolean(
      targetOrder.getBool('route_finished') ||
      targetOrder.getString('route_closing_reason') ||
      targetOrder.getString('batch_closing_reason'),
    )

    // Coordenadas da entrega
    const endLat = targetOrder.getFloat('end_address_lat') || 0
    const endLng = targetOrder.getFloat('end_address_lng') || 0
    const delLat = targetOrder.getFloat('delivery_lat') || endLat
    const delLng = targetOrder.getFloat('delivery_lng') || endLng

    // GUARDA DE SANIDADE REFORÇADA (v0.0.473):
    // 1. A referência canônica ÚNICA de comparação é o pin cadastrado do cliente (customers.lat/lng).
    // 2. Se houver coordenadas de entrega no pedido e coordenadas do cliente cadastradas:
    //    calcular OBRIGATORIAMENTE o desvio real no backend via Haversine, nunca confiar cegamente no entrega_fora_pin_m vindo do frontend.
    let custLat = 0
    let custLng = 0
    let isCustomerCalibrated = false
    if (customerIdVal) {
      try {
        const custRec = $app.findRecordById('customers', customerIdVal)
        if (custRec) {
          custLat = custRec.getFloat('lat') || 0
          custLng = custRec.getFloat('lng') || 0
          const cNotes = custRec.getString('notes') || ''
          if (
            cNotes.includes('Pin real confirmado') ||
            cNotes.includes('APROVADO') ||
            cNotes.includes('[ALERTA GPS APROVADO') ||
            cNotes.includes('[CORREÇÃO DEFINITIVA')
          ) {
            isCustomerCalibrated = true
          }
        }
      } catch (_) {}
    }

    let calculatedDistM =
      targetOrder.getFloat('entrega_fora_pin_m') ||
      targetOrder.getFloat('entrega_distance_to_pin_m') ||
      0

    if (custLat !== 0 && custLng !== 0 && delLat !== 0 && delLng !== 0) {
      const dLat = ((custLat - delLat) * Math.PI) / 180
      const dLon = ((custLng - delLng) * Math.PI) / 180
      const aH =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((delLat * Math.PI) / 180) *
          Math.cos((custLat * Math.PI) / 180) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2)
      const realDistM = Math.round(6371000 * 2 * Math.atan2(Math.sqrt(aH), Math.sqrt(1 - aH)))

      if (realDistM <= 150) {
        // Entrega realizada no pin cadastrado (<= 150m) — 100% falso positivo de desvio
        calculatedDistM = 0
        targetOrder.set('entrega_fora_pin_m', 0)
        targetOrder.set('entrega_distance_to_pin_m', 0)
        geofenceFlag = 'ok'
        targetOrder.set('entrega_geofence_flag', 'ok')
        console.log(
          `[orders_guard] Sanidade v0.0.473: entrega de ${trackingCode} confirmada dentro do pin cadastrado do cliente (distância real: ${realDistM}m). Falso positivo cancelado e flag zerada para 'ok'.`,
        )
      } else {
        // Recalcular com a distância matemática canônica
        calculatedDistM = realDistM
        targetOrder.set('entrega_fora_pin_m', realDistM)
      }
    }

    let distanceM = calculatedDistM

    // Verificar se é entrega redirecionada (ponto B aprovado no fluxo de redirecionamento)
    const isOrderRedirected = Boolean(
      targetOrder.getBool('is_redirected') ||
      targetOrder.getString('redirection_status') === 'completed' ||
      targetOrder.getString('redirection_status') === 'initiated' ||
      targetOrder.getString('redirection_status') === 'in_progress' ||
      targetOrder.getString('redirection_new_address') ||
      targetOrder.getFloat('redirection_point_a_lat') > 0,
    )

    // CONDIÇÕES PARA DISPARAR ALERTA E AUDITORIA DE GEOFENCE:
    // 1. Status 'delivered' e geofenceFlag === 'pendente_aprovacao_gt_500m'
    // 2. Desvio real > 150m (já garantido pela guarda de sanidade acima)
    // 3. NÃO ser evento de fechamento de rota / batch close / recálculo
    // 4. Disparar APENAS na transição para delivered ou primeira transição para pendente_aprovacao_gt_500m!
    //    Nunca disparar a cada update subsequente de pedido já entregue!
    const isFirstTimeDeliveredPending =
      newStatus === 'delivered' &&
      geofenceFlag === 'pendente_aprovacao_gt_500m' &&
      distanceM > 150 &&
      !isClosingEvent &&
      (prevStatus !== 'delivered' || prevGeofenceFlag !== 'pendente_aprovacao_gt_500m')

    if (isFirstTimeDeliveredPending) {
      try {
        if (isOrderRedirected) {
          // Entrega redirecionada NÃO deve gerar alerta de correção de pin nem pendência de geofence.
          console.log(
            '[orders_guard] geofence_pending_approval suprimido: pedido redirecionado',
            trackingCode,
          )
        } else {
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
            auditRec.set('old_value', prevGeofenceFlag || 'em_transito')
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

          // Criar ou atualizar alerta em address_alerts com DEDUP DURO:
          // Se já existir alerta pendente para o mesmo customer ou mesmo pedido nas últimas 24h:
          // ATUALIZAR o existente em vez de criar um novo em cascata!
          const alertsCol = $app.findCollectionByNameOrId('address_alerts')
          if (alertsCol && customerIdVal) {
            let existingPendingAlert = null
            try {
              const existingAlerts = $app.findRecordsByFilter(
                'address_alerts',
                `customer = '${customerIdVal}'`,
                '-created',
                30,
                0,
              )

              const nowTs = Date.now()
              const ONE_DAY_MS = 24 * 60 * 60 * 1000

              for (let a = 0; a < existingAlerts.length; a++) {
                const ex = existingAlerts[a]
                const exStatus = ex.getString('status')
                const exNotes = ex.getString('notes') || ''
                const exCreatedTs = new Date(ex.getString('created')).getTime()
                const isWithin24h = nowTs - exCreatedTs <= ONE_DAY_MS

                // Se houver alerta pendente para o mesmo cliente, ou para este mesmo pedido nas últimas 24h
                if (
                  exStatus === 'pendente' ||
                  (trackingCode && exNotes.includes(trackingCode) && isWithin24h)
                ) {
                  existingPendingAlert = ex
                  break
                }
              }
            } catch (errSearchEx) {
              console.log('[orders_guard] Erro na busca de alertas existentes:', errSearchEx)
            }

            const alertPayload = {
              customer: customerIdVal,
              company: empresaId || undefined,
              origin: 'pin_entregador',
              distance_meters: distanceM,
              marked_by: courierIdVal || undefined,
              marked_at: new Date().toISOString(),
              suggested_address: JSON.stringify({
                address: targetOrder.getString('end_address_text') || '',
                lat: delLat || targetOrder.getFloat('end_address_lat') || 0,
                lng: delLng || targetOrder.getFloat('end_address_lng') || 0,
              }),
              notes: `Entrega realizada a ${(distanceM / 1000).toFixed(1)} km do pin cadastrado no pedido ${trackingCode}. Aguarda conferência da central.`,
            }

            if (existingPendingAlert) {
              // DEDUP DURO: Atualizar registro existente em vez de criar duplicado
              try {
                existingPendingAlert.set('distance_meters', distanceM)
                existingPendingAlert.set('marked_at', alertPayload.marked_at)
                existingPendingAlert.set('suggested_address', alertPayload.suggested_address)
                existingPendingAlert.set('notes', alertPayload.notes)
                if (courierIdVal) existingPendingAlert.set('marked_by', courierIdVal)
                $app.save(existingPendingAlert)
                console.log(
                  `[orders_guard] address_alerts #${existingPendingAlert.id} atualizado via dedup duro (evitou rajada):`,
                  customerIdVal,
                )
              } catch (errUpAlert) {
                console.log('[orders_guard] Falha ao atualizar alerta existente:', errUpAlert)
              }
            } else {
              // Criar novo alerta
              try {
                const alertRec = new Record(alertsCol)
                alertRec.set('customer', alertPayload.customer)
                if (alertPayload.company) alertRec.set('company', alertPayload.company)
                alertRec.set('origin', 'pin_entregador')
                alertRec.set('status', 'pendente')
                alertRec.set('distance_meters', alertPayload.distance_meters)
                if (alertPayload.marked_by) alertRec.set('marked_by', alertPayload.marked_by)
                alertRec.set('marked_at', alertPayload.marked_at)
                alertRec.set('suggested_address', alertPayload.suggested_address)
                alertRec.set('notes', alertPayload.notes)
                $app.save(alertRec)
                console.log(
                  '[orders_guard] address_alerts criado com sucesso para cliente:',
                  customerIdVal,
                )
              } catch (errSaveAlert) {
                console.log(
                  '[orders_guard] Criação de address_alerts interceptada:',
                  errSaveAlert?.message || errSaveAlert,
                )
              }
            }
          }
        }
      } catch (errHookPending) {
        console.log('[orders_guard] Aviso ao processar geofence_pending_approval:', errHookPending)
      }
    } else if (
      newStatus === 'delivered' &&
      geofenceFlag === 'pendente_aprovacao_gt_500m' &&
      isClosingEvent
    ) {
      console.log(
        `[orders_guard] Disparo de address_alerts suprimido: evento de encerramento/lote para ${trackingCode}.`,
      )
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

// pocketbase/hooks/address_alerts_dedup_guard.js
// REGRA PERMANENTE CONTRA RECORRÊNCIA:
// Bloquear criação de novo address_alert para o mesmo cliente enquanto existir alerta PENDENTE para ele.
// Gravar snapshot do pin antigo no momento da criação se não vier preenchido.

onRecordBeforeCreate((e) => {
  const alertRecord = e.record
  const customerId = alertRecord.getString('customer')

  if (!customerId) {
    e.next()
    return
  }

  // 0. GUARDA DE REJEIÇÃO IMEDIATA:
  // Se o alerta estiver a <150m da base ou accuracy >50m, rejeitar imediatamente
  try {
    const PILAR_BASE_LAT = -22.6977499
    const PILAR_BASE_LNG = -43.2936013
    const parsedSuggInit = JSON.parse(alertRecord.getString('suggested_address') || '{}')
    const sLat = Number(parsedSuggInit.lat || 0)
    const sLng = Number(parsedSuggInit.lng || 0)
    const sAcc = Number(parsedSuggInit.accuracy || parsedSuggInit.accuracy_meters || 0)

    if (sLat !== 0 && sLng !== 0) {
      // Haversine até a base oficial
      const R = 6371000
      const toRad = (d) => (d * Math.PI) / 180
      const dLatB = toRad(sLat - PILAR_BASE_LAT)
      const dLonB = toRad(sLng - PILAR_BASE_LNG)
      const aB =
        Math.sin(dLatB / 2) * Math.sin(dLatB / 2) +
        Math.cos(toRad(PILAR_BASE_LAT)) *
          Math.cos(toRad(sLat)) *
          Math.sin(dLonB / 2) *
          Math.sin(dLonB / 2)
      const distToBase = R * 2 * Math.atan2(Math.sqrt(aB), Math.sqrt(1 - aB))

      if (distToBase < 150) {
        throw new BadRequestError('Alerta rejeitado: coordenada a menos de 150m da base oficial.')
      }
      if (sAcc > 50) {
        throw new BadRequestError('Alerta rejeitado: precisão GPS insuficiente (accuracy > 50m).')
      }
    }
  } catch (geoCheckErr) {
    if (geoCheckErr && geoCheckErr.name === 'BadRequestError') {
      throw geoCheckErr
    }
  }

  // Haversine inline para cálculo em metros
  const haversineDistMeters = (lat1, lon1, lat2, lon2) => {
    const R = 6371000
    const toRad = (d) => (d * Math.PI) / 180
    const dLat = toRad(lat2 - lat1)
    const dLon = toRad(lon2 - lon1)
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }

  // 0.1 SUPRESSÃO EM ENTREGA REDIRECIONADA:
  // Se o alerta se refere a um pedido com redirecionamento ativo/concluído, NÃO permitir criação.
  try {
    const alertNotes = alertRecord.getString('notes') || ''
    const matchTrk = alertNotes.match(/TRK-[0-9-]+/)
    if (matchTrk) {
      const orderTrk = matchTrk[0]
      const orderMatches = $app.findRecordsByFilter(
        'orders',
        `tracking_code = '${orderTrk}'`,
        '-created',
        1,
        0,
      )
      if (orderMatches.length > 0) {
        const ord = orderMatches[0]
        const isRedir = Boolean(
          ord.getBool('is_redirected') ||
          ord.getString('redirection_status') === 'completed' ||
          ord.getString('redirection_status') === 'initiated' ||
          ord.getString('redirection_status') === 'in_progress' ||
          ord.getString('redirection_new_address') ||
          ord.getFloat('redirection_point_a_lat') > 0,
        )
        if (isRedir) {
          console.log(
            `[address_alerts_dedup_guard] Alerta suprimido: pedido ${orderTrk} é entrega redirecionada (ponto B já aprovado no fluxo de redirecionamento).`,
          )
          throw new BadRequestError(
            `Entrega redirecionada (${orderTrk}): ponto B aprovado pelo fluxo próprio de redirecionamento. Alerta de pin suprimido.`,
          )
        }
      }
    }
  } catch (redirErr) {
    if (
      redirErr &&
      (redirErr.name === 'BadRequestError' || redirErr.message?.includes('Entrega redirecionada'))
    ) {
      throw redirErr
    }
  }

  // 0. GUARDA DE SANIDADE v0.0.472:
  // Se a distância medida for > 300m MAS o pin de entrega sugerido estiver a <= 150m do pin cadastrado do cliente,
  // trata-se de falsa divergência (medição contra referência errada/rota).
  // Auditar inconsistência e suprimir criação do alerta!
  if (customerId && candLat !== 0 && candLng !== 0) {
    try {
      const custRec = $app.findRecordById('customers', customerId)
      if (custRec) {
        const custLat = custRec.getFloat('lat') || 0
        const custLng = custRec.getFloat('lng') || 0
        if (custLat !== 0 && custLng !== 0) {
          const dLat = ((candLat - custLat) * Math.PI) / 180
          const dLon = ((candLng - custLng) * Math.PI) / 180
          const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos((custLat * Math.PI) / 180) *
              Math.cos((candLat * Math.PI) / 180) *
              Math.sin(dLon / 2) *
              Math.sin(dLon / 2)
          const distToCustM = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

          if (distToCustM <= 150) {
            console.log(
              `[address_alerts_dedup_guard] BLOQUEADO FALSO POSITIVO: pin sugerido está a ${Math.round(distToCustM)}m do pin cadastrado do cliente ${customerId}. Distância informada: ${alertDistM}m.`,
            )
            try {
              const auditCol = $app.findCollectionByNameOrId('audit_trail')
              if (auditCol) {
                const audit = new Record(auditCol)
                audit.set('user_id', '')
                audit.set('actor_name', 'Sistema')
                audit.set('action', 'alerta_pin_falso_positivo_suprimido')
                audit.set('collection', 'address_alerts')
                audit.set('field', 'distance_meters')
                audit.set('old_value', String(alertDistM))
                audit.set('new_value', '0')
                audit.set(
                  'metadata',
                  JSON.stringify({
                    system_trigger: true,
                    customer_id: customerId,
                    dist_to_cust_pin_m: Math.round(distToCustM),
                    alert_dist_m: alertDistM,
                    reason:
                      'Pin de entrega coincide com o pin já cadastrado/calibrado do cliente (<= 150m)',
                  }),
                )
                $app.save(audit)
              }
            } catch (_) {}

            throw new BadRequestError(
              `Alerta descartado: o pin da entrega está a apenas ${Math.round(distToCustM)}m do pin cadastrado do cliente (tolerância 150m). Não há divergência real.`,
            )
          }
        }
      }
    } catch (errCustCheck) {
      if (errCustCheck && errCustCheck.name === 'BadRequestError') {
        throw errCustCheck
      }
    }
  }

  // 1. DEDUPLICAÇÃO ATÔMICA NO SERVIDOR (onRecordBeforeCreate cobre REST e $app.save interno):
  // Bloquear duplicata se já existir alerta pendente para o mesmo cliente, mesmo pedido, ou alerta recente (<30m de distância dentro de janela de 24h).
  try {
    // Buscar todos os alertas do cliente para cobrir tanto janela 24h quanto qualquer alerta pendente histórico
    const candidateAlerts = $app.findRecordsByFilter(
      'address_alerts',
      `customer = '${customerId}'`,
      '-created',
      20,
      0,
    )

    // Extrair lat/lng e precisão da nova sugestão
    let newLat = 0
    let newLng = 0
    let newAcc = 999
    try {
      const parsedSugg = JSON.parse(alertRecord.getString('suggested_address') || '{}')
      newLat = Number(parsedSugg.lat || 0)
      newLng = Number(parsedSugg.lng || 0)
      newAcc = Number(parsedSugg.accuracy || parsedSugg.accuracy_meters || 999)
    } catch (_) {}

    const incomingNotes = alertRecord.getString('notes') || ''
    const incomingTrkMatch = incomingNotes.match(/TRK-[0-9-]+/)
    const incomingTrk = incomingTrkMatch ? incomingTrkMatch[0] : ''

    for (let i = 0; i < candidateAlerts.length; i++) {
      const existing = candidateAlerts[i]
      const existingStatus = existing.getString('status')
      const existingNotes = existing.getString('notes') || ''

      let isDuplicate = false
      if (existingStatus === 'pendente') {
        // Já tem alerta pendente do mesmo cliente OU mesmo pedido: unificar sempre
        isDuplicate = true
      } else if (incomingTrk && existingNotes.includes(incomingTrk)) {
        // Mesmo pedido avaliado nas últimas 24h: não duplicar
        isDuplicate = true
      } else {
        // Checar proximidade física (< 30 metros) dentro da janela de 6 horas
        let exLat = 0
        let exLng = 0
        try {
          const exSugg = JSON.parse(existing.getString('suggested_address') || '{}')
          exLat = Number(exSugg.lat || 0)
          exLng = Number(exSugg.lng || 0)
        } catch (_) {}

        if (newLat !== 0 && newLng !== 0 && exLat !== 0 && exLng !== 0) {
          const dist = haversineDistMeters(newLat, newLng, exLat, exLng)
          if (dist <= 30) {
            isDuplicate = true
          }
        } else if (newLat === 0 && newLng === 0 && exLat === 0 && exLng === 0) {
          // Ambos sem coordenadas específicas para o mesmo cliente na janela: duplicação de evento
          isDuplicate = true
        }
      }

      if (isDuplicate) {
        // Se o existente for pendente, atualiza com novos dados da sugestão se aplicável
        if (existingStatus === 'pendente') {
          const newSuggested = alertRecord.getString('suggested_address')
          const newNotes = alertRecord.getString('notes')
          const newDistance = alertRecord.getFloat('distance_meters')
          const markedBy = alertRecord.getString('marked_by')

          let exAcc = 999
          try {
            const exSugg = JSON.parse(existing.getString('suggested_address') || '{}')
            exAcc = Number(exSugg.accuracy || exSugg.accuracy_meters || 999)
          } catch (_) {}

          // Se a nova leitura tem melhor precisão (menor accuracy), atualiza com a melhor leitura
          if (newAcc < exAcc) {
            const newSuggested = alertRecord.getString('suggested_address')
            const newNotes = alertRecord.getString('notes')
            const newDistance = alertRecord.getFloat('distance_meters')
            const markedBy = alertRecord.getString('marked_by')

            if (newSuggested) existing.set('suggested_address', newSuggested)
            if (newNotes) existing.set('notes', newNotes)
            if (newDistance) existing.set('distance_meters', newDistance)
            if (markedBy) existing.set('marked_by', markedBy)
            existing.set('marked_at', new Date().toISOString())

            try {
              $app.save(existing)
              console.log(
                `[address_alerts_dedup_guard] Alerta pendente #${existing.id} atualizado com melhor precisao (${newAcc}m vs ${exAcc}m):`,
                existing.id,
              )
            } catch (saveErr) {
              console.log(
                '[address_alerts_dedup_guard] Erro ao atualizar alerta pendente:',
                saveErr,
              )
            }
          } else {
            console.log(
              `[address_alerts_dedup_guard] Alerta pendente #${existing.id} preservado (precisao existente ${exAcc}m <= nova ${newAcc}m)`,
            )
          }
        } else {
          console.log(
            `[address_alerts_dedup_guard] Alerta descartado por deduplicação (<30m / 6h já avaliado #${existing.id}) para cliente:`,
            customerId,
          )
        }

        // Lançar BadRequestError para barrar a criação atômica no banco (REST ou $app.save)
        throw new BadRequestError(
          `Deduplicação de alertas: cliente já possui alerta #${existing.id} (${existingStatus}). Gravação duplicada bloqueada.`,
        )
      }
    }
  } catch (findErr) {
    if (
      findErr &&
      (findErr.name === 'BadRequestError' || findErr.message?.includes('Deduplicação de alertas'))
    ) {
      throw findErr
    }
    // Caso de busca sem resultados segue normalmente para criação
  }

  // 2. SNAPSHOT CANÔNICO DO CLIENTE: Garantir que current_address contenha lat/lng e texto originais
  try {
    let currentAddrStr = alertRecord.getString('current_address')
    let hasCoords = false
    if (currentAddrStr) {
      try {
        const parsed = JSON.parse(currentAddrStr)
        if (
          parsed &&
          parsed.lat !== undefined &&
          parsed.lat !== null &&
          parsed.lng !== undefined &&
          parsed.lng !== null
        ) {
          hasCoords = true
        }
      } catch (_) {}
    }

    if (!hasCoords) {
      const cust = $app.findRecordById('customers', customerId)
      if (cust) {
        const snap = {
          address: cust.getString('address') || '',
          street: cust.getString('street') || '',
          number: cust.getString('number') || '',
          neighborhood: cust.getString('neighborhood') || '',
          city: cust.getString('city') || '',
          state: cust.getString('state') || '',
          postal_code: cust.getString('postal_code') || '',
          lat: cust.getFloat('lat') || null,
          lng: cust.getFloat('lng') || null,
        }
        alertRecord.set('current_address', JSON.stringify(snap))
        console.log('[address_alerts_dedup_guard] Snapshot do cliente gravado no alerta:', snap)
      }
    }
  } catch (snapErr) {
    console.log('[address_alerts_dedup_guard] Erro ao gravar snapshot no alerta:', snapErr)
  }

  e.next()
}, 'address_alerts')

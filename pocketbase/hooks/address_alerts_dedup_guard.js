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

  // 1. DEDUPLICAÇÃO ATÔMICA NO SERVIDOR (onRecordBeforeCreate cobre REST e $app.save interno):
  // Bloquear duplicata se já existir alerta pendente para o mesmo cliente, ou alerta recente (<30m de distância dentro de janela de 6h).
  try {
    const sixHoursAgoIso = new Date(Date.now() - 6 * 3600 * 1000).toISOString()
    const candidateAlerts = $app.findRecordsByFilter(
      'address_alerts',
      `customer = '${customerId}' && created >= '${sixHoursAgoIso}'`,
      '-created',
      20,
      0,
    )

    // Extrair lat/lng da nova sugestão
    let newLat = 0
    let newLng = 0
    try {
      const parsedSugg = JSON.parse(alertRecord.getString('suggested_address') || '{}')
      newLat = Number(parsedSugg.lat || 0)
      newLng = Number(parsedSugg.lng || 0)
    } catch (_) {}

    for (let i = 0; i < candidateAlerts.length; i++) {
      const existing = candidateAlerts[i]
      const existingStatus = existing.getString('status')

      let isDuplicate = false
      if (existingStatus === 'pendente') {
        // Já tem alerta pendente do mesmo cliente: unificar
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
        }
      }

      if (isDuplicate) {
        // Se o existente for pendente, atualiza com novos dados da sugestão se aplicável
        if (existingStatus === 'pendente') {
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
              '[address_alerts_dedup_guard] Alerta pendente existente atualizado para evitar duplicata conflitante:',
              existing.id,
            )
          } catch (saveErr) {
            console.log('[address_alerts_dedup_guard] Erro ao atualizar alerta pendente:', saveErr)
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

// pocketbase/hooks/address_alerts_dedup_guard.js
// REGRA PERMANENTE CONTRA RECORRÊNCIA:
// Bloquear criação de novo address_alert para o mesmo cliente enquanto existir alerta PENDENTE para ele.
// Gravar snapshot do pin antigo no momento da criação se não vier preenchido.

onRecordCreateRequest((e) => {
  const alertRecord = e.record
  const customerId = alertRecord.getString('customer')

  if (!customerId) {
    e.next()
    return
  }

  // 1. DEDUPLICAÇÃO NO SERVIDOR: Se já existir alerta pendente para o mesmo cliente, bloquear criação duplicada
  try {
    const existingPending = $app.findFirstRecordByFilter(
      'address_alerts',
      `customer = '${customerId}' && status = 'pendente'`,
    )
    if (existingPending) {
      // Em vez de criar um alerta concorrente no banco, atualiza o alerta pendente com a nova sugestão e notas
      const newSuggested = alertRecord.getString('suggested_address')
      const newNotes = alertRecord.getString('notes')
      const newDistance = alertRecord.getFloat('distance_meters')
      const markedBy = alertRecord.getString('marked_by')

      if (newSuggested) existingPending.set('suggested_address', newSuggested)
      if (newNotes) existingPending.set('notes', newNotes)
      if (newDistance) existingPending.set('distance_meters', newDistance)
      if (markedBy) existingPending.set('marked_by', markedBy)
      existingPending.set('marked_at', new Date().toISOString())

      $app.save(existingPending)
      console.log(
        '[address_alerts_dedup_guard] Alerta pendente existente atualizado para evitar duplicata conflitante:',
        existingPending.id,
      )

      // Lançar BadRequestError informativo para o fluxo cliente reconhecer ou impedir inserção duplicada
      throw new BadRequestError(
        `Este cliente já possui o alerta pendente #${existingPending.id}. Os dados foram atualizados no alerta ativo.`,
      )
    }
  } catch (findErr) {
    if (findErr && findErr.name === 'BadRequestError') {
      throw findErr
    }
    // Record not found -> segue normalmente para criação
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

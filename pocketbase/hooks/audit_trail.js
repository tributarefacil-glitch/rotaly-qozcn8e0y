// Trilha de auditoria automática em pb_hooks:
// Registra modificações sensíveis inline (para compatibilidade com o pool JSVM do PocketBase):
// 1. users: opening_balance e cutoff_date
// 2. route_km_approvals: criação ou atualização de aprovações/rejeições de km
// 3. fuel_advances: cancelamento de adiantamentos/ajustes

// 1. Users: opening_balance / cutoff_date
onRecordUpdate((e) => {
  const original = e.record.original()
  if (!original) return e.next()

  const authUserId = e.auth && e.auth.id ? e.auth.id : 'system'
  const recordId = e.record.id

  const origOpening = original.get('opening_balance')
  const newOpening = e.record.get('opening_balance')
  if (origOpening !== newOpening && newOpening !== undefined) {
    try {
      const auditCol = e.app.findCollectionByNameOrId('audit_trail')
      const auditRec = new Record(auditCol)
      auditRec.set('user_id', authUserId)
      auditRec.set('collection', 'users')
      auditRec.set('record_id', recordId)
      auditRec.set('courier_id', recordId)
      auditRec.set('action', 'update')
      auditRec.set('field', 'opening_balance')
      auditRec.set('old_value', String(origOpening))
      auditRec.set('new_value', String(newOpening))
      auditRec.set('timestamp', new Date().toISOString())
      auditRec.set('metadata', { target_user_name: e.record.getString('name') })
      e.app.save(auditRec)
    } catch (err) {
      console.warn('[audit_trail] Erro ao gravar users.opening_balance:', err)
    }
  }

  const origCutoff = original.getString('cutoff_date')
  const newCutoff = e.record.getString('cutoff_date')
  if (origCutoff !== newCutoff && newCutoff !== undefined) {
    try {
      const auditCol = e.app.findCollectionByNameOrId('audit_trail')
      const auditRec = new Record(auditCol)
      auditRec.set('user_id', authUserId)
      auditRec.set('collection', 'users')
      auditRec.set('record_id', recordId)
      auditRec.set('courier_id', recordId)
      auditRec.set('action', 'update')
      auditRec.set('field', 'cutoff_date')
      auditRec.set('old_value', String(origCutoff))
      auditRec.set('new_value', String(newCutoff))
      auditRec.set('timestamp', new Date().toISOString())
      auditRec.set('metadata', { target_user_name: e.record.getString('name') })
      e.app.save(auditRec)
    } catch (err) {
      console.warn('[audit_trail] Erro ao gravar users.cutoff_date:', err)
    }
  }

  return e.next()
}, 'users')

// 2. route_km_approvals: create / update
onRecordCreate((e) => {
  const authUserId = e.auth && e.auth.id ? e.auth.id : 'system'
  const courierId = e.record.getString('courier_id')
  const orderId = e.record.getString('order_id')
  const approvedKm = e.record.get('approved_km')
  const status = e.record.getString('status')
  const originalRoad = e.record.get('original_road_km')

  try {
    const auditCol = e.app.findCollectionByNameOrId('audit_trail')
    const auditRec = new Record(auditCol)
    auditRec.set('user_id', authUserId)
    auditRec.set('collection', 'route_km_approvals')
    auditRec.set('record_id', e.record.id)
    auditRec.set('courier_id', courierId)
    auditRec.set('action', 'create')
    auditRec.set('field', 'status')
    auditRec.set('old_value', 'original_road:' + originalRoad)
    auditRec.set('new_value', status + ':' + approvedKm + 'km')
    auditRec.set('timestamp', new Date().toISOString())
    auditRec.set('metadata', {
      order_id: orderId,
      justification: e.record.getString('justification'),
      original_road_km: originalRoad,
      approved_km: approvedKm,
      status: status,
    })
    e.app.save(auditRec)
  } catch (err) {
    console.warn('[audit_trail] Erro ao gravar create route_km_approvals:', err)
  }

  return e.next()
}, 'route_km_approvals')

onRecordUpdate((e) => {
  const original = e.record.original()
  if (!original) return e.next()

  const authUserId = e.auth && e.auth.id ? e.auth.id : 'system'
  const courierId = e.record.getString('courier_id')
  const origStatus = original.getString('status')
  const newStatus = e.record.getString('status')
  const origKm = original.get('approved_km')
  const newKm = e.record.get('approved_km')

  try {
    const auditCol = e.app.findCollectionByNameOrId('audit_trail')
    const auditRec = new Record(auditCol)
    auditRec.set('user_id', authUserId)
    auditRec.set('collection', 'route_km_approvals')
    auditRec.set('record_id', e.record.id)
    auditRec.set('courier_id', courierId)
    auditRec.set('action', 'update')
    auditRec.set('field', 'status_and_km')
    auditRec.set('old_value', origStatus + ':' + origKm + 'km')
    auditRec.set('new_value', newStatus + ':' + newKm + 'km')
    auditRec.set('timestamp', new Date().toISOString())
    auditRec.set('metadata', {
      order_id: e.record.getString('order_id'),
      justification: e.record.getString('justification'),
    })
    e.app.save(auditRec)
  } catch (err) {
    console.warn('[audit_trail] Erro ao gravar update route_km_approvals:', err)
  }

  return e.next()
}, 'route_km_approvals')

// 3. fuel_advances: cancelamento
onRecordUpdate((e) => {
  const original = e.record.original()
  if (!original) return e.next()

  const origStatus = original.getString('status')
  const newStatus = e.record.getString('status')

  if (origStatus !== 'cancelled' && newStatus === 'cancelled') {
    const authUserId = e.auth && e.auth.id ? e.auth.id : 'system'
    const courierId = e.record.getString('courier_id')
    try {
      const auditCol = e.app.findCollectionByNameOrId('audit_trail')
      const auditRec = new Record(auditCol)
      auditRec.set('user_id', authUserId)
      auditRec.set('collection', 'fuel_advances')
      auditRec.set('record_id', e.record.id)
      auditRec.set('courier_id', courierId)
      auditRec.set('action', 'cancel')
      auditRec.set('field', 'status')
      auditRec.set('old_value', origStatus)
      auditRec.set('new_value', 'cancelled')
      auditRec.set('timestamp', new Date().toISOString())
      auditRec.set('metadata', {
        amount: e.record.get('amount'),
        cancellation_reason: e.record.getString('cancellation_reason'),
        cancelled_by: e.record.getString('cancelled_by'),
      })
      e.app.save(auditRec)
    } catch (err) {
      console.warn('[audit_trail] Erro ao gravar cancel fuel_advances:', err)
    }
  }

  return e.next()
}, 'fuel_advances')

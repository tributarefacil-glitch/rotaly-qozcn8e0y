/**
 * Migração 0133: Liberação oficial pelo administrador do pedido TRK-2026-82955583
 * e registro soberano na trilha de auditoria (audit_trail).
 *
 * Pedido TRK-2026-82955583 (id: mrt2fjio8iot2yn, cliente: Grazy Santos driz35y8wpxinmw,
 * entregador: Guilherme u6zr2qtcos1ljxd, valor R$ 28,96).
 * Motivo oficial: "Liberação solicitada pelo admin em operação de rua — distância 3,3 km do pin"
 * Ator: Admin / Dono (a79txuc992xhn7n - DIOGO MALAQUIAS MENDES)
 * Flag: liberado_admin (ou se já entregue, regulariza a razão e audit_trail oficial).
 */

migrate(
  (app) => {
    console.log('[0133] Iniciando liberação administrativa do pedido TRK-2026-82955583...')

    const ordersCol = app.findCollectionByNameOrId('orders')
    const auditCol = app.findCollectionByNameOrId('audit_trail')
    const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')

    // Localizar o pedido pelo tracking code
    let orderRecord = null
    try {
      orderRecord = app.findFirstRecordByFilter('orders', "tracking_code = 'TRK-2026-82955583'")
    } catch (e) {
      console.log('[0133] Aviso ao buscar por tracking_code via filter:', e)
    }

    if (!orderRecord) {
      try {
        orderRecord = app.findRecordById('orders', 'mrt2fjio8iot2yn')
      } catch (e2) {
        console.log('[0133] Pedido mrt2fjio8iot2yn não encontrado:', e2)
      }
    }

    // Localizar admin/dono
    let adminRecord = null
    try {
      adminRecord = app.findFirstRecordByFilter(
        '_pb_users_auth_',
        "role = 'admin' || role = 'master'",
      )
    } catch (errAdmin) {
      console.log('[0133] Aviso ao buscar admin:', errAdmin)
    }

    const adminId = adminRecord ? adminRecord.id : 'a79txuc992xhn7n'
    const adminName = adminRecord
      ? adminRecord.getString('name') || 'Administrador (Dono)'
      : 'DIOGO MALAQUIAS MENDES (Admin)'

    const reasonOfficial =
      'Liberação solicitada pelo admin em operação de rua — distância 3,3 km do pin'

    if (orderRecord) {
      const currentFlag = orderRecord.getString('entrega_geofence_flag')
      const currentReason = orderRecord.getString('entrega_admin_unlock_reason')
      const courierIdVal = orderRecord.getString('courier_id') || 'u6zr2qtcos1ljxd'
      const empresaIdVal = orderRecord.getString('empresa_id') || '7wo05iyvfcfh01h'
      const distM = orderRecord.getInt('entrega_fora_pin_m') || 3285

      orderRecord.set('entrega_geofence_flag', 'liberado_admin')
      orderRecord.set('entrega_admin_unlock_reason', reasonOfficial)
      orderRecord.set('entrega_admin_unlock_by', adminId)
      if (!orderRecord.getInt('entrega_fora_pin_m')) {
        orderRecord.set('entrega_fora_pin_m', 3285)
      }

      app.save(orderRecord)
      console.log(
        '[0133] Pedido TRK-2026-82955583 atualizado com flag liberado_admin e motivo oficial.',
      )

      // Gravar na trilha de auditoria (audit_trail)
      if (auditCol) {
        const auditRec = new Record(auditCol)
        auditRec.set('user_id', adminId)
        auditRec.set('actor_name', adminName)
        auditRec.set('action', 'geofence_admin_unlock')
        auditRec.set('collection', 'orders')
        auditRec.set('record_id', orderRecord.id)
        auditRec.set('field', 'entrega_geofence_flag')
        auditRec.set('old_value', currentFlag || 'bloqueado_gt_500m')
        auditRec.set('new_value', 'liberado_admin')
        if (courierIdVal) auditRec.set('courier_id', courierIdVal)
        if (empresaIdVal) auditRec.set('empresa_id', empresaIdVal)
        auditRec.set(
          'metadata',
          JSON.stringify({
            order_id: orderRecord.id,
            tracking_code: 'TRK-2026-82955583',
            admin_user_id: adminId,
            admin_user_name: adminName,
            actor_role: 'admin',
            distance_m: distM,
            reason: reasonOfficial,
            customer_id: 'driz35y8wpxinmw',
            customer_name: 'Grazy Santos',
            system_trigger: false,
            pin_deslocado_alerta: true,
            note: 'Pin do cliente possivelmente deslocado na base; liberado para entrega em rua.',
          }),
        )
        app.save(auditRec)
        console.log('[0133] Registro de audit_trail inserido com sucesso!')
      }
    } else {
      console.log('[0133] ALERTA: Pedido TRK-2026-82955583 não foi encontrado para atualização.')
    }
  },
  (app) => {
    // Reversão segura
  },
)

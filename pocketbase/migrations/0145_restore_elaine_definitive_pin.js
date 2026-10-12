/**
 * Migração 0145: Restaura o pin definitivo de Elaine (cteyngfui5yt4ab) no Pilar
 * e registra no audit_trail com autor "Sistema" para barrar regressão.
 */

migrate(
  (app) => {
    console.log('[0145] Iniciando migração 0145: Restauração de PIN definitivo da Elaine...')

    let customer = null
    try {
      customer = app.findRecordById('customers', 'cteyngfui5yt4ab')
    } catch (err) {
      console.warn('[0145] Cliente cteyngfui5yt4ab não encontrado por ID:', err)
    }

    if (customer) {
      const oldLat = customer.getFloat('lat')
      const oldLng = customer.getFloat('lng')
      const oldNotes = customer.getString('notes')

      customer.set('lat', -22.7029705)
      customer.set('lng', -43.3030357)
      customer.set(
        'notes',
        'CORREÇÃO DEFINITIVA v0.0.366/0145: Pin real confirmado no Pilar (-22.7029705, -43.3030357). Proibido sobrescrever por geocodificação.',
      )

      app.save(customer)
      console.log(
        '[0145] Cliente Elaine (cteyngfui5yt4ab) atualizado com coordenadas definitivas no Pilar.',
      )

      try {
        const auditCol = app.findCollectionByNameOrId('audit_trail')
        if (auditCol) {
          const trail = new Record(auditCol)
          trail.set('collection', 'customers')
          trail.set('record_id', customer.id)
          trail.set('action', 'restore_customer_pin')
          trail.set('field', 'lat_lng')
          trail.set('old_value', String(oldLat) + ', ' + String(oldLng) + ' | ' + oldNotes)
          trail.set('new_value', '-22.7029705, -43.3030357')
          trail.set('user_id', '')
          trail.set('timestamp', new Date().toISOString())
          trail.set('metadata', {
            customer_id: 'cteyngfui5yt4ab',
            system_trigger: true,
            actor_name: 'Sistema',
            reason: 'Restaurar pin definitivo no Pilar e barrar regressão',
          })
          app.save(trail)
          console.log('[0145] Entrada de audit_trail gravada com sucesso.')
        }
      } catch (auditErr) {
        console.warn('[0145] Erro ao gravar audit_trail:', auditErr)
      }
    } else {
      console.warn('[0145] Cliente cteyngfui5yt4ab não foi localizado para atualização.')
    }
  },
  (app) => {
    console.log('[0145] Reversão executada.')
  },
)

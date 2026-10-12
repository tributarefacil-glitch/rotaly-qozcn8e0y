/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    try {
      const customer = app.findRecordById('customers', 'cteyngfui5yt4ab')
      customer.set('lat', -22.7029705)
      customer.set('lng', -43.3030357)
      const currentNotes = customer.getString('notes') || ''
      const marker = '[CORREÇÃO DEFINITIVA DE LOCALIZAÇÃO - NÃO ALTERAR PIN]'
      if (!currentNotes.includes(marker)) {
        customer.set('notes', currentNotes ? `${currentNotes}\n${marker}` : marker)
      }
      app.save(customer)
    } catch (err) {
      console.error('Erro ao atualizar cliente cteyngfui5yt4ab na migração 0146:', err)
    }

    try {
      const auditCollection = app.findCollectionByNameOrId('audit_trail')
      const auditRecord = new Record(auditCollection)
      auditRecord.set('user_id', '')
      auditRecord.set('actor_name', 'Sistema')
      auditRecord.set('action', 'pin_definitive_enforced')
      auditRecord.set('collection_name', 'customers')
      auditRecord.set('record_id', 'cteyngfui5yt4ab')
      auditRecord.set('metadata', {
        system_trigger: true,
        lat: -22.7029705,
        lng: -43.3030357,
        reason: 'Restauração forçada de coordenadas canônicas pós-v0.0.416',
      })
      app.save(auditRecord)
    } catch (err) {
      console.error('Erro ao registrar audit_trail na migração 0146:', err)
    }
  },
  (app) => {
    // Reversão não necessária para fix de emergência
  },
)

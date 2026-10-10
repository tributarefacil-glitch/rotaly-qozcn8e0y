migrate(
  (app) => {
    // Atualizar os 5 registros de address_alerts com origem varredura_cep criados em 2026-10-09
    // status pendente -> "reprovado", notes = "desativado a pedido — pin é soberano"
    // Registrar em audit_trail com user_id vazio + actor_name='Sistema' + metadata.system_trigger=true

    const ids = [
      'nsug8edjy7k2nxc',
      '15psrxb7qckpd3w',
      '28qbdx7lyyd93ll',
      'zszrarpbkf0tsrl',
      'n95zx8yy8ynkz0s',
    ]

    const nowIso = new Date().toISOString().replace('T', ' ').substring(0, 19)

    for (const id of ids) {
      try {
        const record = app.findRecordById('address_alerts', id)
        const oldStatus = record.get('status')
        const oldNotes = record.get('notes') || ''

        record.set('status', 'reprovado')
        record.set('notes', 'desativado a pedido — pin é soberano')
        record.set('reviewed_at', nowIso)
        app.save(record)

        // Audit trail record
        try {
          const auditCol = app.findCollectionByNameOrId('audit_trail')
          const auditRecord = new Record(auditCol, {
            user_id: '',
            collection: 'address_alerts',
            record_id: id,
            action: 'update',
            field: 'status',
            old_value: oldStatus || 'pendente',
            new_value: 'reprovado',
            timestamp: nowIso,
            metadata: {
              actor_name: 'Sistema',
              system_trigger: true,
              reason: 'desativado a pedido — pin é soberano',
              customer_id: record.get('customer'),
              origin: 'varredura_cep',
            },
          })
          app.save(auditRecord)
        } catch (auditErr) {
          console.log('Erro ao salvar audit_trail para alert ' + id + ': ' + auditErr)
        }
      } catch (e) {
        console.log('Alerta não encontrado ou já atualizado: ' + id + ' - ' + e)
      }
    }
  },
  (app) => {
    // Reversão defensiva (opcional)
    const ids = [
      'nsug8edjy7k2nxc',
      '15psrxb7qckpd3w',
      '28qbdx7lyyd93ll',
      'zszrarpbkf0tsrl',
      'n95zx8yy8ynkz0s',
    ]
    for (const id of ids) {
      try {
        const record = app.findRecordById('address_alerts', id)
        record.set('status', 'pendente')
        record.set('notes', 'Divergência preventiva detectada')
        app.save(record)
      } catch (_) {}
    }
  },
)

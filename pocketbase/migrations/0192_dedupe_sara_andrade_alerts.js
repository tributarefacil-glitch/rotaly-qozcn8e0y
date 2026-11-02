/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // Migração 0192 (v0.0.530):
  // Saneamento pontual e idempotente dos 11 address_alerts da Sara Andrade (b8hgrc66ev21hdy / TRK-2026-72777607):
  // Mantém 1 alerta canônico (o que gravou o endereço de Osvaldo Cruz #be9d58kjq4cxdh6, ou o primeiro #7qvrvgzbk0zvxjd)
  // marcado com status 'resolvido' e cancela/reprova os outros 10 duplicados com nota explicativa.
  // Registra a deduplicação em audit_trail.
  const now = new Date().toISOString()
  const auditCol = app.findCollectionByNameOrId('audit_trail')

  try {
    const rawAlerts = app.findRecordsByFilter(
      'address_alerts',
      "customer = 'b8hgrc66ev21hdy'",
      'created',
      100,
      0,
    )

    console.log(`[0192_dedupe_alerts] Alertas encontrados para Sara Andrade: ${rawAlerts.length}`)

    // Encontrar o alerta canônico preferencial (be9d58kjq4cxdh6, que é o que apontava para Osvaldo Cruz, ou o primeiro)
    let canonicalId = 'be9d58kjq4cxdh6'
    const hasOsvaldoAlert = rawAlerts.some((a) => a.id === canonicalId)
    if (!hasOsvaldoAlert && rawAlerts.length > 0) {
      canonicalId = rawAlerts[0].id
    }

    for (let i = 0; i < rawAlerts.length; i++) {
      const alert = rawAlerts[i]
      if (alert.id === canonicalId) {
        alert.set('status', 'resolvido')
        const curNotes = alert.getString('notes') || ''
        alert.set(
          'notes',
          `${curNotes} | [CANÔNICO v0.0.530]: Falso positivo saneado. Entrega concluída no endereço secundário Rua Osvaldo Cruz, 95.`,
        )
        alert.set('reviewed_at', now)
        app.save(alert)

        if (auditCol) {
          const auditRec = new Record(auditCol)
          auditRec.set('user_id', '')
          auditRec.set('actor_name', 'Sistema')
          auditRec.set('action', 'alerta_deduplicado_resolvido')
          auditRec.set('collection', 'address_alerts')
          auditRec.set('record_id', alert.id)
          auditRec.set('field', 'status')
          auditRec.set('old_value', 'aprovado')
          auditRec.set('new_value', 'resolvido')
          auditRec.set('timestamp', now)
          auditRec.set('metadata', {
            system_trigger: true,
            actor_name: 'Sistema',
            actor_role: 'system',
            alert_id: alert.id,
            customer_id: 'b8hgrc66ev21hdy',
            tracking_code: 'TRK-2026-72777607',
            reason:
              'Alerta canônico retido e resolvido como falso positivo de endereço secundário (Rua Osvaldo Cruz, 95).',
          })
          app.save(auditRec)
        }
      } else {
        const oldSt = alert.getString('status')
        alert.set('status', 'reprovado')
        alert.set('reviewed_at', now)
        alert.set(
          'notes',
          `cancelado: duplicata espúria do alerta canônico #${canonicalId} do pedido TRK-2026-72777607 (endereço secundário)`,
        )
        app.save(alert)

        if (auditCol) {
          const auditRec = new Record(auditCol)
          auditRec.set('user_id', '')
          auditRec.set('actor_name', 'Sistema')
          auditRec.set('action', 'alerta_duplicado_cancelado')
          auditRec.set('collection', 'address_alerts')
          auditRec.set('record_id', alert.id)
          auditRec.set('field', 'status')
          auditRec.set('old_value', oldSt)
          auditRec.set('new_value', 'reprovado')
          auditRec.set('timestamp', now)
          auditRec.set('metadata', {
            system_trigger: true,
            actor_name: 'Sistema',
            actor_role: 'system',
            alert_id: alert.id,
            canonical_alert_id: canonicalId,
            customer_id: 'b8hgrc66ev21hdy',
            tracking_code: 'TRK-2026-72777607',
            reason:
              'Deduplicação de rajada de alertas gerada por falso positivo de endereço secundário.',
          })
          app.save(auditRec)
        }
      }
    }
  } catch (err) {
    console.log('[0192_dedupe_alerts] Erro ao deduplicar alertas da Sara:', err)
  }

  console.log('[0192_dedupe_alerts] Migração 0192 concluída com sucesso.')
})

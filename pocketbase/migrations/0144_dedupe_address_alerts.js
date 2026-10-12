migrate(
  (app) => {
    // Migração 0144: Deduplicar alertas de endereço do caso real (Elaine)
    // Manter epgg3cjl7ff0qjp pendente;
    // Marcar mry7l3579lo3f7k status='reprovado' com nota 'Duplicata resolvida automaticamente — mantido epgg3cjl7ff0qjp'
    const now = new Date().toISOString()
    app
      .db()
      .newQuery(`
    UPDATE address_alerts
    SET status = 'reprovado',
        notes = 'Duplicata resolvida automaticamente — mantido epgg3cjl7ff0qjp',
        reviewed_at = {:now}
    WHERE id = 'mry7l3579lo3f7k'
  `)
      .bind({ now: now })
      .execute()
  },
  (app) => {
    // Reversão: restaura mry7l3579lo3f7k para status='pendente'
    app
      .db()
      .newQuery(`
    UPDATE address_alerts
    SET status = 'pendente',
        reviewed_at = ''
    WHERE id = 'mry7l3579lo3f7k'
  `)
      .execute()
  },
)

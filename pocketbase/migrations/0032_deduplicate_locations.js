migrate(
  (app) => {
    // Limpeza de telemetria anômala duplicada:
    // Remove pontos idênticos repetidos em rajadas de poucos segundos mantendo apenas o mais recente de cada bloco.
    try {
      app
        .db()
        .newQuery(`
      DELETE FROM locations
      WHERE id IN (
        SELECT l1.id
        FROM locations l1
        JOIN locations l2 ON l1.user_id = l2.user_id
          AND l1.lat = l2.lat
          AND l1.lng = l2.lng
          AND l1.id != l2.id
          AND l1.created < l2.created
          AND (julianday(l2.created) - julianday(l1.created)) * 86400 < 10
      )
    `)
        .execute()
    } catch (err) {
      console.log('Aviso ao deduplicar tabela locations:', err)
    }
  },
  (app) => {
    // Reversão não necessária para limpeza de duplicatas pontuais
  },
)

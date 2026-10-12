migrate(
  (app) => {
    // A4: Finalizar pedidos cancelados que permaneceram com route_started=true e route_finished não marcado como true
    // Alvos confirmados no banco: pedidos com status='cancelled', route_started=true e (route_finished=false OU route_finished IS NULL OU route_finished = 0)
    app
      .db()
      .newQuery(`
    UPDATE orders
    SET route_finished = 1,
        route_finished_at = COALESCE(NULLIF(route_finished_at, ''), NULLIF(updated, ''), DATETIME('now'))
    WHERE status = 'cancelled'
      AND route_started = 1
      AND (route_finished = 0 OR route_finished IS NULL OR route_finished = '')
  `)
      .execute()
  },
  (app) => {
    // Reversão não é necessária pois pedidos cancelados não devem reabrir rota iniciada
  },
)

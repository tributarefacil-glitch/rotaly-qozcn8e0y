/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // Migração 0107: Correção do corte da conta corrente do Rotaly.
    // O cutoff_date dos 6 entregadores estava em 2026-10-04 16:00:00.000Z (13h de Brasília),
    // mas os saldos de abertura foram gravados em 2026-10-04 00:55–01:18Z (21:55–22:18 de Brasília de 03/10).
    // Atualizar cutoff_date de todos os entregadores (role = 'courier') para 2026-10-04 01:00:00.000Z (22h de Brasília de 03/10),
    // posicionando o corte imediatamente após a gravação das aberturas e resgatando as operações de hoje (04/10) do limbo,
    // mantendo os ajustes de 03/10 (-141,62 e -20,25) pré-corte e preservando intactos os saldos de abertura.

    const newCutoffIso = '2026-10-04 01:00:00.000Z'

    // Atualização direta e atômica via SQL no banco de dados PocketBase (SQLite)
    app
      .db()
      .newQuery(`
      UPDATE users
      SET cutoff_date = {:newCutoff}
      WHERE role = 'courier'
    `)
      .bind({ newCutoff: newCutoffIso })
      .execute()

    console.log(
      `[0107] cutoff_date atualizado para ${newCutoffIso} para todos os entregadores (role='courier').`,
    )
  },
  (app) => {
    // Reversão para a data anterior caso necessário
    const oldCutoffIso = '2026-10-04 16:00:00.000Z'

    app
      .db()
      .newQuery(`
      UPDATE users
      SET cutoff_date = {:oldCutoff}
      WHERE role = 'courier'
    `)
      .bind({ oldCutoff: oldCutoffIso })
      .execute()

    console.log(`[0107] Reversão: cutoff_date restaurado para ${oldCutoffIso}.`)
  },
)

/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // 0050_clean_burst_locations_vinicios.js
    // Limpeza de pings em rajada redundantes do entregador Vinicios Lunz (user_id = 'o9nccdbkmc9onh0')
    // gerados no dia 2026-09-13 com a mesma coordenada entre 18:18:00 e 18:24:00,
    // preservando exatamente 1 registro por timestamp arredondado ao minuto (strftime('%Y-%m-%d %H:%M', created)).
    // Mantém todos os outros usuários e registros válidos intactos.
    console.log('0050: Iniciando limpeza de pings em rajada da coleção locations...')

    try {
      // Deletar registros repetidos mantendo o menor ID (ou registro representativo) de cada minuto
      // para o usuário o9nccdbkmc9onh0 no dia 2026-09-13
      app
        .db()
        .newQuery(`
        DELETE FROM locations
        WHERE user_id = 'o9nccdbkmc9onh0'
          AND created >= '2026-09-13 18:18:00'
          AND created <= '2026-09-13 18:24:00'
          AND id NOT IN (
            SELECT MIN(id)
            FROM locations
            WHERE user_id = 'o9nccdbkmc9onh0'
              AND created >= '2026-09-13 18:18:00'
              AND created <= '2026-09-13 18:24:00'
            GROUP BY strftime('%Y-%m-%d %H:%M', created), ROUND(lat, 4), ROUND(lng, 4)
          )
      `)
        .execute()

      console.log('0050: Limpeza de pings repetidos em rajada de locations concluída com sucesso.')
    } catch (err) {
      console.log('0050: Aviso ao executar limpeza de locations:', err)
    }
  },
  (app) => {
    // Reverter limpeza não recria linhas deletadas (operação de housekeeping pontual)
  },
)

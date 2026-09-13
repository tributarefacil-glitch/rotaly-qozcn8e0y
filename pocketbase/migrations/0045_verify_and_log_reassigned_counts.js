migrate(
  (app) => {
    // 0045_verify_and_log_reassigned_counts.js
    console.log('0045: Executando contagem e validação dos dados reatribuídos...')

    const MATRIZ_ID = '7wo05iyvfcfh01h'
    const PIMENTA_ID = '4m935a8286j6y04'
    const XODO_ID = 'k443r453664d6v7'

    const collections = [
      'orders',
      'customers',
      'fuel_advances',
      'off_route_events',
      'locations',
      'base_addresses',
      'reviews',
      'notifications',
      'rotas',
      'entregas',
      'colaboradores',
      'relatorios',
    ]

    collections.forEach((colName) => {
      try {
        const rows = app
          .db()
          .newQuery(`
          SELECT 
            COALESCE(empresa_id, 'SEM_EMPRESA') as emp,
            COUNT(*) as total
          FROM ${colName}
          GROUP BY COALESCE(empresa_id, 'SEM_EMPRESA')
        `)
          .all()

        console.log(`[0045 COUNTS] ${colName}:`, JSON.stringify(rows))
      } catch (err) {
        console.log(`[0045 COUNTS ERR] ${colName}:`, err.message)
      }
    })
  },
  (app) => {},
)

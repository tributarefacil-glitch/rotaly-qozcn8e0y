routerAdd('GET', '/backend/v1/tenant-audit', (c) => {
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

  const result = {}

  collections.forEach((colName) => {
    try {
      const rows = $app
        .db()
        .newQuery(`
        SELECT 
          COALESCE(empresa_id, 'SEM_EMPRESA') as empresa,
          COUNT(*) as total
        FROM ${colName}
        GROUP BY COALESCE(empresa_id, 'SEM_EMPRESA')
      `)
        .all()

      result[colName] = rows
    } catch (e) {
      result[colName] = { error: e.message }
    }
  })

  try {
    result['membros'] = $app
      .db()
      .newQuery(`
      SELECT empresa_id, papel, COUNT(*) as total
      FROM membros
      GROUP BY empresa_id, papel
    `)
      .all()
  } catch (e) {
    result['membros'] = { error: e.message }
  }

  return c.json(200, {
    success: true,
    data: result,
  })
})

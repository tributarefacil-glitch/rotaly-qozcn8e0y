migrate(
  (app) => {
    // 1. Atualizar a base real "Mais Saudavel" (id: '811cpvr0g77m9ue')
    // Coordenadas obtidas via Google Geocoding API para:
    // "Rua da Prosperidade, 13, Pilar, Duque de Caxias - RJ"
    // Coordenadas: lat -22.7001402, lng -43.2982834
    // Preencher também street, neighborhood, city, state, postal_code
    // e definir como padrão (is_default: true, is_end_default: true)
    try {
      app
        .db()
        .newQuery(`
          UPDATE base_addresses
          SET
            lat = -22.7001402,
            lng = -43.2982834,
            street = 'Rua da Prosperidade',
            neighborhood = 'Pilar',
            city = 'Duque de Caxias',
            state = 'RJ',
            postal_code = '25230-085',
            address = 'Rua da Prosperidade, 13 - Pilar, Duque de Caxias - RJ, 25230-085, Brasil',
            is_default = true,
            is_end_default = true,
            updated = datetime('now')
          WHERE id = '811cpvr0g77m9ue'
             OR name LIKE '%Mais Saudavel%'
             OR address LIKE '%rua da prosperidade%'
        `)
        .execute()
      console.log('Base "Mais Saudavel" atualizada com sucesso.')
    } catch (err) {
      console.log('Erro ao atualizar base Mais Saudavel:', err)
    }

    // 2. Tratar os registros seed de demonstração de São Paulo:
    // "2pai421n2je8bat" -> "Base Central LOGHYPE (Loja Principal)"
    // "ttgn3zl0etpzxxo" -> "Galpão / Ponto de Apoio Zona Sul"
    // Desmarcar is_default e is_end_default e remover os registros seed que não são utilizados
    try {
      // Primeiro garantir que não são default caso a exclusão encontre restrições
      app
        .db()
        .newQuery(`
          UPDATE base_addresses
          SET
            is_default = false,
            is_end_default = false,
            updated = datetime('now')
          WHERE id IN ('2pai421n2je8bat', 'ttgn3zl0etpzxxo')
             OR address LIKE '%Av. Paulista%'
             OR address LIKE '%Av. Santo Amaro%'
        `)
        .execute()

      // Remover os registros de demonstração de SP
      app
        .db()
        .newQuery(`
          DELETE FROM base_addresses
          WHERE id IN ('2pai421n2je8bat', 'ttgn3zl0etpzxxo')
             OR (address LIKE '%Av. Paulista%' AND city = 'São Paulo')
             OR (address LIKE '%Av. Santo Amaro%' AND city = 'São Paulo')
        `)
        .execute()
      console.log('Bases demo de São Paulo removidas com sucesso.')
    } catch (err) {
      console.log('Aviso ao remover bases demo de São Paulo:', err)
    }
  },
  (app) => {
    // Reversão
  },
)

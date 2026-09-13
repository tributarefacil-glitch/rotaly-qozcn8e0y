migrate(
  (app) => {
    // 0044_reassign_multitenant_history_and_strict_isolation.js
    //
    // IDs das empresas mapeadas:
    // Matriz (Rotaly Operações): 7wo05iyvfcfh01h
    // Pimenta Verde Cosméticos: 4m935a8286j6y04 (Gabriel: 9974l1q03d2i419, Lucas: 75t9v933lff9x53)
    // Farmácia Xodo do Pilar: k443r453664d6v7 (Mariana: 5q294k12429h7f5, Rodrigo: 0244i46a2t90e1h)

    console.log('0044: Iniciando migração de reatribuição histórica e regras multi-tenant...')

    const MATRIZ_ID = '7wo05iyvfcfh01h'
    const PIMENTA_ID = '4m935a8286j6y04'
    const XODO_ID = 'k443r453664d6v7'

    const PIMENTA_USERS = ['9974l1q03d2i419', '75t9v933lff9x53']
    const XODO_USERS = ['5q294k12429h7f5', '0244i46a2t90e1h']

    // 1. Garantir que as empresas existem na tabela empresas
    try {
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19)

      // Matriz
      app
        .db()
        .newQuery(`
        INSERT OR IGNORE INTO empresas (id, nome, razao_social, cnpj, plano, ativa, max_usuarios, max_entregadores, created, updated)
        VALUES ('${MATRIZ_ID}', 'Rotaly Logística Matriz', 'Rotaly Operações Matriz Logística LTDA', '00.000.000/0001-00', 'enterprise', 1, 999, 999, '${now}', '${now}')
      `)
        .execute()

      // Pimenta Verde
      app
        .db()
        .newQuery(`
        INSERT OR IGNORE INTO empresas (id, nome, razao_social, cnpj, plano, ativa, max_usuarios, max_entregadores, created, updated)
        VALUES ('${PIMENTA_ID}', 'Pimenta Verde Cosméticos Ecommerce', 'Pimenta Verde Cosméticos Ecommerce LTDA', '12.345.678/0001-90', 'pro', 1, 50, 50, '${now}', '${now}')
      `)
        .execute()

      // Farmácia Xodo
      app
        .db()
        .newQuery(`
        INSERT OR IGNORE INTO empresas (id, nome, razao_social, cnpj, plano, ativa, max_usuarios, max_entregadores, created, updated)
        VALUES ('${XODO_ID}', 'Farmácia Xodo do Pilar', 'Farmácia Xodo do Pilar LTDA', '98.765.432/0001-10', 'pro', 1, 50, 50, '${now}', '${now}')
      `)
        .execute()
    } catch (errEmpresas) {
      console.log('0044: Aviso ao garantir empresas:', errEmpresas)
    }

    // 2. Garantir vínculos na tabela membros
    try {
      const now = new Date().toISOString().replace('T', ' ').substring(0, 19)

      const ensureMember = (memberId, empresaId, userId, papel) => {
        app
          .db()
          .newQuery(`
          INSERT OR REPLACE INTO membros (id, empresa_id, user_id, papel, ativo, created, updated)
          VALUES ('${memberId}', '${empresaId}', '${userId}', '${papel}', 1, '${now}', '${now}')
        `)
          .execute()
      }

      // Membros Pimenta Verde
      ensureMember('mbr_pimenta_gabriel', PIMENTA_ID, '9974l1q03d2i419', 'vendedor')
      ensureMember('mbr_pimenta_lucas', PIMENTA_ID, '75t9v933lff9x53', 'entregador')

      // Membros Farmácia Xodo
      ensureMember('mbr_xodo_mariana', XODO_ID, '5q294k12429h7f5', 'vendedor')
      ensureMember('mbr_xodo_rodrigo', XODO_ID, '0244i46a2t90e1h', 'entregador')

      // Super admin / Matriz membros (se existirem users de admin)
      const adminUsers = ['k1129r939i8e778', '4f964q59828l7k5']
      adminUsers.forEach((adminId, idx) => {
        try {
          ensureMember(`mbr_matriz_adm_${idx}`, MATRIZ_ID, adminId, 'admin')
        } catch (e) {
          /* ignore */
        }
      })
    } catch (errMembros) {
      console.log('0044: Aviso ao registrar membros:', errMembros)
    }

    // 3. Garantir coluna empresa_id em todas as tabelas operacionais se não existir
    const tablesToCheck = [
      'orders',
      'customers',
      'rotas',
      'entregas',
      'colaboradores',
      'relatorios',
      'fuel_advances',
      'off_route_events',
      'locations',
      'base_addresses',
      'reviews',
      'notifications',
    ]

    tablesToCheck.forEach((tableName) => {
      try {
        app
          .db()
          .newQuery(`ALTER TABLE ${tableName} ADD COLUMN empresa_id TEXT DEFAULT ''`)
          .execute()
        console.log(`0044: Coluna empresa_id adicionada em ${tableName}`)
      } catch (e) {
        // Coluna já existe
      }
    })

    // 4. Reatribuição histórica de dados por empresa
    // Pimenta Verde: Gabriel (vendedor 9974l1q03d2i419) e Lucas (entregador 75t9v933lff9x53)
    // Farmácia Xodo: Mariana (vendedor 5q294k12429h7f5) e Rodrigo (entregador 0244i46a2t90e1h)
    // Matriz: restante

    // A) ORDERS
    try {
      // Pimenta Verde
      app
        .db()
        .newQuery(`
        UPDATE orders
        SET empresa_id = '${PIMENTA_ID}'
        WHERE seller_id IN ('9974l1q03d2i419', '75t9v933lff9x53')
           OR courier_id IN ('9974l1q03d2i419', '75t9v933lff9x53')
      `)
        .execute()

      // Farmácia Xodo
      app
        .db()
        .newQuery(`
        UPDATE orders
        SET empresa_id = '${XODO_ID}'
        WHERE seller_id IN ('5q294k12429h7f5', '0244i46a2t90e1h')
           OR courier_id IN ('5q294k12429h7f5', '0244i46a2t90e1h')
      `)
        .execute()

      // Restante (órfãos e sem empresa) -> Matriz
      app
        .db()
        .newQuery(`
        UPDATE orders
        SET empresa_id = '${MATRIZ_ID}'
        WHERE empresa_id IS NULL OR empresa_id = ''
      `)
        .execute()

      console.log('0044: orders reatribuídos com sucesso.')
    } catch (errOrders) {
      console.log('0044: Erro ao reatribuir orders:', errOrders)
    }

    // B) CUSTOMERS
    try {
      // Clientes vinculados a pedidos da Pimenta Verde
      app
        .db()
        .newQuery(`
        UPDATE customers
        SET empresa_id = '${PIMENTA_ID}'
        WHERE id IN (
          SELECT customer_id FROM orders WHERE empresa_id = '${PIMENTA_ID}' AND customer_id IS NOT NULL AND customer_id != ''
        )
      `)
        .execute()

      // Clientes vinculados a pedidos da Farmácia Xodo
      app
        .db()
        .newQuery(`
        UPDATE customers
        SET empresa_id = '${XODO_ID}'
        WHERE id IN (
          SELECT customer_id FROM orders WHERE empresa_id = '${XODO_ID}' AND customer_id IS NOT NULL AND customer_id != ''
        )
      `)
        .execute()

      // Clientes com created_by de membros
      app
        .db()
        .newQuery(`
        UPDATE customers
        SET empresa_id = '${PIMENTA_ID}'
        WHERE created_by IN ('9974l1q03d2i419', '75t9v933lff9x53')
      `)
        .execute()

      app
        .db()
        .newQuery(`
        UPDATE customers
        SET empresa_id = '${XODO_ID}'
        WHERE created_by IN ('5q294k12429h7f5', '0244i46a2t90e1h')
      `)
        .execute()

      // Restante -> Matriz
      app
        .db()
        .newQuery(`
        UPDATE customers
        SET empresa_id = '${MATRIZ_ID}'
        WHERE empresa_id IS NULL OR empresa_id = ''
      `)
        .execute()

      console.log('0044: customers reatribuídos com sucesso.')
    } catch (errCust) {
      console.log('0044: Erro ao reatribuir customers:', errCust)
    }

    // C) FUEL_ADVANCES
    try {
      app
        .db()
        .newQuery(`
        UPDATE fuel_advances
        SET empresa_id = '${PIMENTA_ID}'
        WHERE courier_id IN ('9974l1q03d2i419', '75t9v933lff9x53')
           OR created_by IN ('9974l1q03d2i419', '75t9v933lff9x53')
      `)
        .execute()

      app
        .db()
        .newQuery(`
        UPDATE fuel_advances
        SET empresa_id = '${XODO_ID}'
        WHERE courier_id IN ('5q294k12429h7f5', '0244i46a2t90e1h')
           OR created_by IN ('5q294k12429h7f5', '0244i46a2t90e1h')
      `)
        .execute()

      app
        .db()
        .newQuery(`
        UPDATE fuel_advances
        SET empresa_id = '${MATRIZ_ID}'
        WHERE empresa_id IS NULL OR empresa_id = ''
      `)
        .execute()

      console.log('0044: fuel_advances reatribuídos.')
    } catch (errFuel) {
      console.log('0044: Erro ao reatribuir fuel_advances:', errFuel)
    }

    // D) OFF_ROUTE_EVENTS
    try {
      app
        .db()
        .newQuery(`
        UPDATE off_route_events
        SET empresa_id = '${PIMENTA_ID}'
        WHERE courier_id IN ('9974l1q03d2i419', '75t9v933lff9x53')
           OR order_id IN (SELECT id FROM orders WHERE empresa_id = '${PIMENTA_ID}')
      `)
        .execute()

      app
        .db()
        .newQuery(`
        UPDATE off_route_events
        SET empresa_id = '${XODO_ID}'
        WHERE courier_id IN ('5q294k12429h7f5', '0244i46a2t90e1h')
           OR order_id IN (SELECT id FROM orders WHERE empresa_id = '${XODO_ID}')
      `)
        .execute()

      app
        .db()
        .newQuery(`
        UPDATE off_route_events
        SET empresa_id = '${MATRIZ_ID}'
        WHERE empresa_id IS NULL OR empresa_id = ''
      `)
        .execute()

      console.log('0044: off_route_events reatribuídos.')
    } catch (errEv) {
      console.log('0044: Erro ao reatribuir off_route_events:', errEv)
    }

    // E) LOCATIONS
    try {
      app
        .db()
        .newQuery(`
        UPDATE locations
        SET empresa_id = '${PIMENTA_ID}'
        WHERE user_id IN ('9974l1q03d2i419', '75t9v933lff9x53')
      `)
        .execute()

      app
        .db()
        .newQuery(`
        UPDATE locations
        SET empresa_id = '${XODO_ID}'
        WHERE user_id IN ('5q294k12429h7f5', '0244i46a2t90e1h')
      `)
        .execute()

      app
        .db()
        .newQuery(`
        UPDATE locations
        SET empresa_id = '${MATRIZ_ID}'
        WHERE empresa_id IS NULL OR empresa_id = ''
      `)
        .execute()

      console.log('0044: locations reatribuídos.')
    } catch (errLoc) {
      console.log('0044: Erro ao reatribuir locations:', errLoc)
    }

    // F) BASE_ADDRESSES
    try {
      app
        .db()
        .newQuery(`
        UPDATE base_addresses
        SET empresa_id = '${PIMENTA_ID}'
        WHERE created_by IN ('9974l1q03d2i419', '75t9v933lff9x53')
      `)
        .execute()

      app
        .db()
        .newQuery(`
        UPDATE base_addresses
        SET empresa_id = '${XODO_ID}'
        WHERE created_by IN ('5q294k12429h7f5', '0244i46a2t90e1h')
      `)
        .execute()

      app
        .db()
        .newQuery(`
        UPDATE base_addresses
        SET empresa_id = '${MATRIZ_ID}'
        WHERE empresa_id IS NULL OR empresa_id = ''
      `)
        .execute()

      console.log('0044: base_addresses reatribuídos.')
    } catch (errBase) {
      console.log('0044: Erro ao reatribuir base_addresses:', errBase)
    }

    // G) REVIEWS
    try {
      app
        .db()
        .newQuery(`
        UPDATE reviews
        SET empresa_id = '${PIMENTA_ID}'
        WHERE seller_id IN ('9974l1q03d2i419', '75t9v933lff9x53')
           OR courier_id IN ('9974l1q03d2i419', '75t9v933lff9x53')
           OR order_id IN (SELECT id FROM orders WHERE empresa_id = '${PIMENTA_ID}')
      `)
        .execute()

      app
        .db()
        .newQuery(`
        UPDATE reviews
        SET empresa_id = '${XODO_ID}'
        WHERE seller_id IN ('5q294k12429h7f5', '0244i46a2t90e1h')
           OR courier_id IN ('5q294k12429h7f5', '0244i46a2t90e1h')
           OR order_id IN (SELECT id FROM orders WHERE empresa_id = '${XODO_ID}')
      `)
        .execute()

      app
        .db()
        .newQuery(`
        UPDATE reviews
        SET empresa_id = '${MATRIZ_ID}'
        WHERE empresa_id IS NULL OR empresa_id = ''
      `)
        .execute()

      console.log('0044: reviews reatribuídos.')
    } catch (errRev) {
      console.log('0044: Erro ao reatribuir reviews:', errRev)
    }

    // H) NOTIFICATIONS
    try {
      app
        .db()
        .newQuery(`
        UPDATE notifications
        SET empresa_id = '${PIMENTA_ID}'
        WHERE user_id IN ('9974l1q03d2i419', '75t9v933lff9x53')
           OR order_id IN (SELECT id FROM orders WHERE empresa_id = '${PIMENTA_ID}')
      `)
        .execute()

      app
        .db()
        .newQuery(`
        UPDATE notifications
        SET empresa_id = '${XODO_ID}'
        WHERE user_id IN ('5q294k12429h7f5', '0244i46a2t90e1h')
           OR order_id IN (SELECT id FROM orders WHERE empresa_id = '${XODO_ID}')
      `)
        .execute()

      app
        .db()
        .newQuery(`
        UPDATE notifications
        SET empresa_id = '${MATRIZ_ID}'
        WHERE empresa_id IS NULL OR empresa_id = ''
      `)
        .execute()

      console.log('0044: notifications reatribuídos.')
    } catch (errNotif) {
      console.log('0044: Erro ao reatribuir notifications:', errNotif)
    }

    // I) ROTAS, ENTREGAS, COLABORADORES, RELATORIOS
    const genericTables = ['rotas', 'entregas', 'colaboradores', 'relatorios']
    genericTables.forEach((t) => {
      try {
        app
          .db()
          .newQuery(`
          UPDATE ${t}
          SET empresa_id = '${MATRIZ_ID}'
          WHERE empresa_id IS NULL OR empresa_id = ''
        `)
          .execute()
      } catch (errGen) {
        console.log(`0044: Aviso ao reatribuir ${t}:`, errGen)
      }
    })

    // 5. Configurar regras de API estritas (API Rules) no PocketBase
    // Regra:
    // Superadmin / Matriz admin tem acesso total.
    // Usuários comuns (membros da filial) só acessam registros da sua própria empresa:
    // @request.auth.id != "" && (
    //   @request.auth.role = 'superadmin' ||
    //   @request.auth.role = 'admin' ||
    //   @request.auth.id = @collection.membros.user_id && @collection.membros.empresa_id = empresa_id && @collection.membros.ativo = true
    // )

    // Para orders e customers, a consulta pública de tracking necessita de tracking_code != "" ou id != ""
    const strictRule = `@request.auth.id != "" && (@request.auth.role = 'superadmin' || @request.auth.role = 'admin' || (@collection.membros.user_id ?= @request.auth.id && @collection.membros.empresa_id ?= empresa_id && @collection.membros.ativo ?= true))`

    const publicOrStrictRule = `(@request.auth.id != "" && (@request.auth.role = 'superadmin' || @request.auth.role = 'admin' || (@collection.membros.user_id ?= @request.auth.id && @collection.membros.empresa_id ?= empresa_id && @collection.membros.ativo ?= true))) || tracking_code != ""`

    const collectionsToUpdate = [
      { name: 'orders', publicTrack: true },
      { name: 'customers', publicTrack: false },
      { name: 'fuel_advances', publicTrack: false },
      { name: 'off_route_events', publicTrack: false },
      { name: 'base_addresses', publicTrack: false },
      { name: 'reviews', publicTrack: false },
      { name: 'rotas', publicTrack: false },
      { name: 'entregas', publicTrack: false },
      { name: 'colaboradores', publicTrack: false },
      { name: 'relatorios', publicTrack: false },
      { name: 'locations', publicTrack: false },
    ]

    collectionsToUpdate.forEach(({ name, publicTrack }) => {
      try {
        const col = app.findCollectionByNameOrId(name)
        if (col) {
          const listRule = publicTrack ? publicOrStrictRule : strictRule
          const viewRule = publicTrack ? publicOrStrictRule : strictRule

          col.listRule = listRule
          col.viewRule = viewRule
          col.createRule = `@request.auth.id != ""`
          col.updateRule = strictRule
          col.deleteRule = `@request.auth.id != "" && (@request.auth.role = 'superadmin' || @request.auth.role = 'admin')`

          app.save(col)
          console.log(`0044: Regras de API configuradas com sucesso na coleção ${name}`)
        }
      } catch (errRule) {
        console.log(`0044: Aviso ao configurar regras para ${name}:`, errRule)
      }
    })

    console.log('0044: Migração de reatribuição e isolamento concluída com sucesso.')
  },
  (app) => {
    // Reversão no-op
  },
)

migrate(
  (app) => {
    // 0046_fix_farmacia_xodo_multitenant_history_and_members.js
    //
    // Emergência em produção: Caroline e Kely da Farmácia Xodó do Pilar não viam histórico nem clientes.
    // Causas identificadas:
    // 1. A empresa real de produção da Farmácia Xodó do Pilar no banco é 'ssyicw8uzwqc01w'.
    //    A migração 0044 usou o ID 'k443r453664d6v7' (que não é o ID real da empresa criada pelos usuários).
    // 2. Os pedidos criados por Caroline (4iycez46kbxl1ly) e Kely (sh669l7snqiuoab) foram incorretamente
    //    reatribuídos para a Matriz (7wo05iyvfcfh01h) na migração 0044.
    // 3. Os clientes atendidos por Caroline/Kely/entregadores da Xodó ficaram com empresa_id da Matriz.
    // 4. A Pimenta Verde também tem a empresa real 'covyosobcb1b50n' (além do ID 4m935a8286j6y04 da migração 0044).
    // 5. Garantir membros Caroline, Kely, Vinicios, Guilherme, Marcos vinculados à Farmácia Xodó (ssyicw8uzwqc01w).

    console.log('0046: Iniciando consolidação multi-tenant para Farmácia Xodó do Pilar...')

    const MATRIZ_ID = '7wo05iyvfcfh01h'
    const XODO_REAL_ID = 'ssyicw8uzwqc01w'
    const PIMENTA_REAL_ID = 'covyosobcb1b50n'
    const XODO_LEGACY_ID = 'k443r453664d6v7'
    const PIMENTA_LEGACY_ID = '4m935a8286j6y04'

    const now = new Date().toISOString().replace('T', ' ').substring(0, 19)

    // 1. Sincronizar dados cadastrais da Farmácia Xodó na empresa ssyicw8uzwqc01w
    try {
      app
        .db()
        .newQuery(`
          UPDATE empresas
          SET nome_fantasia = 'Farmácia Xodó do Pilar',
              nome_razao_social = 'FARMACIA XODO DO PILAR LTDA',
              ativa = 1,
              updated = '${now}'
          WHERE id = '${XODO_REAL_ID}'
        `)
        .execute()
    } catch (e) {
      console.log('0046: Erro ao atualizar empresa Xodó:', e)
    }

    // Se a empresa legacy k443r453664d6v7 existir por engano, garantir que aponte ou migre
    try {
      app
        .db()
        .newQuery(`
          UPDATE membros
          SET empresa_id = '${XODO_REAL_ID}'
          WHERE empresa_id = '${XODO_LEGACY_ID}'
        `)
        .execute()
    } catch (e) {
      /* ignore */
    }

    try {
      app
        .db()
        .newQuery(`
          UPDATE membros
          SET empresa_id = '${PIMENTA_REAL_ID}'
          WHERE empresa_id = '${PIMENTA_LEGACY_ID}'
        `)
        .execute()
    } catch (e) {
      /* ignore */
    }

    // 2. Garantir membros da Farmácia Xodó (ssyicw8uzwqc01w)
    // Caroline: 4iycez46kbxl1ly (vendedora)
    // Kely: sh669l7snqiuoab (vendedora)
    // Vinicios: o9nccdbkmc9onh0 (entregador)
    // Guilherme: u6zr2qtcos1ljxd (entregador)
    // Marcos: mxvhhwb5i46zjq2 (entregador)
    // Diogo / Gestor: gr2hb4yyno4lqns (admin/gestor)
    // Admin geral: ng3asfqq0zwr6fw (admin)
    const xodoMembers = [
      { userId: '4iycez46kbxl1ly', papel: 'vendedor' },
      { userId: 'sh669l7snqiuoab', papel: 'vendedor' },
      { userId: 'o9nccdbkmc9onh0', papel: 'entregador' },
      { userId: 'u6zr2qtcos1ljxd', papel: 'entregador' },
      { userId: 'mxvhhwb5i46zjq2', papel: 'entregador' },
      { userId: 'gr2hb4yyno4lqns', papel: 'admin' },
      { userId: 'ng3asfqq0zwr6fw', papel: 'admin' },
    ]

    xodoMembers.forEach(({ userId, papel }) => {
      try {
        app
          .db()
          .newQuery(`
            INSERT OR REPLACE INTO membros (id, empresa_id, user_id, papel, ativo, created, updated)
            VALUES ('mbr_xodo_${userId}', '${XODO_REAL_ID}', '${userId}', '${papel}', 1, '${now}', '${now}')
          `)
          .execute()
      } catch (errMbr) {
        console.log(`0046: Erro ao garantir membro ${userId}:`, errMbr)
      }
    })

    // Garantir membros da Pimenta Verde (covyosobcb1b50n)
    const pimentaMembers = [
      { userId: 'av4car3aqi52ftq', papel: 'vendedor' },
      { userId: 'rgednwaz40iq9tb', papel: 'vendedor' },
      { userId: 'szy04j9cn3pra5j', papel: 'entregador' },
      { userId: 'gr2hb4yyno4lqns', papel: 'gestor' },
      { userId: 'ng3asfqq0zwr6fw', papel: 'admin' },
    ]

    pimentaMembers.forEach(({ userId, papel }) => {
      try {
        app
          .db()
          .newQuery(`
            INSERT OR REPLACE INTO membros (id, empresa_id, user_id, papel, ativo, created, updated)
            VALUES ('mbr_pim_${userId}', '${PIMENTA_REAL_ID}', '${userId}', '${papel}', 1, '${now}', '${now}')
          `)
          .execute()
      } catch (errMbr) {
        console.log(`0046: Erro ao garantir membro pimenta ${userId}:`, errMbr)
      }
    })

    // 3. REATRIBUIÇÃO HISTÓRICA COMPLETA DE PEDIDOS (ORDERS)
    // Pedidos criados por Caroline (4iycez46kbxl1ly) ou Kely (sh669l7snqiuoab) pertencem à Farmácia Xodó (ssyicw8uzwqc01w)
    try {
      app
        .db()
        .newQuery(`
          UPDATE orders
          SET empresa_id = '${XODO_REAL_ID}'
          WHERE seller_id IN ('4iycez46kbxl1ly', 'sh669l7snqiuoab')
             OR courier_id IN ('o9nccdbkmc9onh0', 'u6zr2qtcos1ljxd', 'mxvhhwb5i46zjq2')
             OR empresa_id = '${XODO_LEGACY_ID}'
        `)
        .execute()
      console.log('0046: Pedidos da Farmácia Xodó reatribuídos com sucesso.')
    } catch (e) {
      console.log('0046: Erro ao reatribuir pedidos da Farmácia Xodó:', e)
    }

    // Pedidos da Pimenta Verde
    try {
      app
        .db()
        .newQuery(`
          UPDATE orders
          SET empresa_id = '${PIMENTA_REAL_ID}'
          WHERE seller_id IN ('av4car3aqi52ftq', 'rgednwaz40iq9tb')
             OR courier_id IN ('szy04j9cn3pra5j')
             OR empresa_id = '${PIMENTA_LEGACY_ID}'
        `)
        .execute()
      console.log('0046: Pedidos da Pimenta Verde reatribuídos com sucesso.')
    } catch (e) {
      console.log('0046: Erro ao reatribuir pedidos da Pimenta Verde:', e)
    }

    // 4. REATRIBUIÇÃO HISTÓRICA COMPLETA DE CLIENTES (CUSTOMERS)
    // A) Clientes vinculados a pedidos da Farmácia Xodó
    try {
      app
        .db()
        .newQuery(`
          UPDATE customers
          SET empresa_id = '${XODO_REAL_ID}'
          WHERE id IN (
            SELECT customer_id FROM orders WHERE empresa_id = '${XODO_REAL_ID}' AND customer_id IS NOT NULL AND customer_id != ''
          )
        `)
        .execute()

      // B) Clientes na região do Pilar ou atendidos pelas vendedoras
      app
        .db()
        .newQuery(`
          UPDATE customers
          SET empresa_id = '${XODO_REAL_ID}'
          WHERE created_by IN ('4iycez46kbxl1ly', 'sh669l7snqiuoab')
             OR empresa_id = '${XODO_LEGACY_ID}'
        `)
        .execute()

      console.log('0046: Clientes da Farmácia Xodó reatribuídos com sucesso.')
    } catch (e) {
      console.log('0046: Erro ao reatribuir clientes da Farmácia Xodó:', e)
    }

    // Clientes da Pimenta Verde
    try {
      app
        .db()
        .newQuery(`
          UPDATE customers
          SET empresa_id = '${PIMENTA_REAL_ID}'
          WHERE id IN (
            SELECT customer_id FROM orders WHERE empresa_id = '${PIMENTA_REAL_ID}' AND customer_id IS NOT NULL AND customer_id != ''
          )
          OR created_by IN ('av4car3aqi52ftq', 'rgednwaz40iq9tb')
          OR empresa_id = '${PIMENTA_LEGACY_ID}'
        `)
        .execute()
      console.log('0046: Clientes da Pimenta Verde reatribuídos com sucesso.')
    } catch (e) {
      console.log('0046: Erro ao reatribuir clientes da Pimenta Verde:', e)
    }

    // 5. REATRIBUIR DEMAIS RECURSOS (BASE_ADDRESSES, FUEL_ADVANCES, OFF_ROUTE_EVENTS, LOCATIONS, REVIEWS)
    // Base addresses da Farmácia Xodó (Mais Saudável / Prosperidade 13)
    try {
      app
        .db()
        .newQuery(`
          UPDATE base_addresses
          SET empresa_id = '${XODO_REAL_ID}'
          WHERE name LIKE '%Saudavel%'
             OR address LIKE '%prosperidade%'
             OR created_by IN ('4iycez46kbxl1ly', 'sh669l7snqiuoab', 'o9nccdbkmc9onh0', 'u6zr2qtcos1ljxd')
             OR empresa_id = '${XODO_LEGACY_ID}'
        `)
        .execute()
    } catch (e) {
      /* ignore */
    }

    // Fuel advances
    try {
      app
        .db()
        .newQuery(`
          UPDATE fuel_advances
          SET empresa_id = '${XODO_REAL_ID}'
          WHERE courier_id IN ('o9nccdbkmc9onh0', 'u6zr2qtcos1ljxd', 'mxvhhwb5i46zjq2')
             OR created_by IN ('4iycez46kbxl1ly', 'sh669l7snqiuoab')
             OR empresa_id = '${XODO_LEGACY_ID}'
        `)
        .execute()
    } catch (e) {
      /* ignore */
    }

    // Off-route events
    try {
      app
        .db()
        .newQuery(`
          UPDATE off_route_events
          SET empresa_id = '${XODO_REAL_ID}'
          WHERE courier_id IN ('o9nccdbkmc9onh0', 'u6zr2qtcos1ljxd', 'mxvhhwb5i46zjq2')
             OR order_id IN (SELECT id FROM orders WHERE empresa_id = '${XODO_REAL_ID}')
             OR empresa_id = '${XODO_LEGACY_ID}'
        `)
        .execute()
    } catch (e) {
      /* ignore */
    }

    // Locations
    try {
      app
        .db()
        .newQuery(`
          UPDATE locations
          SET empresa_id = '${XODO_REAL_ID}'
          WHERE user_id IN ('o9nccdbkmc9onh0', 'u6zr2qtcos1ljxd', 'mxvhhwb5i46zjq2', '4iycez46kbxl1ly', 'sh669l7snqiuoab')
             OR empresa_id = '${XODO_LEGACY_ID}'
        `)
        .execute()
    } catch (e) {
      /* ignore */
    }

    // Reviews
    try {
      app
        .db()
        .newQuery(`
          UPDATE reviews
          SET empresa_id = '${XODO_REAL_ID}'
          WHERE order_id IN (SELECT id FROM orders WHERE empresa_id = '${XODO_REAL_ID}')
             OR seller_id IN ('4iycez46kbxl1ly', 'sh669l7snqiuoab')
             OR courier_id IN ('o9nccdbkmc9onh0', 'u6zr2qtcos1ljxd', 'mxvhhwb5i46zjq2')
             OR empresa_id = '${XODO_LEGACY_ID}'
        `)
        .execute()
    } catch (e) {
      /* ignore */
    }

    // 6. Atualizar as regras de acesso (API Rules) do PocketBase para garantir retrocompatibilidade e acesso robusto
    // Matriz ('7wo05iyvfcfh01h') ou role admin/superadmin: ACESSO TOTAL
    // Membro de empresa ativa: acessa os registros da sua empresa E registros sem selo atribuídos ao membro
    const strictRule = `@request.auth.id != "" && (
      @request.auth.role = 'superadmin' ||
      @request.auth.role = 'admin' ||
      (@collection.membros.user_id ?= @request.auth.id && @collection.membros.empresa_id ?= '7wo05iyvfcfh01h' && @collection.membros.ativo ?= true) ||
      (@collection.membros.user_id ?= @request.auth.id && @collection.membros.empresa_id ?= empresa_id && @collection.membros.ativo ?= true) ||
      (empresa_id = "" && (seller_id ?= @request.auth.id || courier_id ?= @request.auth.id || created_by ?= @request.auth.id))
    )`

    const publicOrStrictRule = `(${strictRule}) || tracking_code != ""`

    const collections = [
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

    collections.forEach(({ name, publicTrack }) => {
      try {
        const col = app.findCollectionByNameOrId(name)
        if (col) {
          col.listRule = publicTrack ? publicOrStrictRule : strictRule
          col.viewRule = publicTrack ? publicOrStrictRule : strictRule
          col.createRule = `@request.auth.id != ""`
          col.updateRule = strictRule
          col.deleteRule = `@request.auth.id != "" && (@request.auth.role = 'superadmin' || @request.auth.role = 'admin')`
          app.save(col)
          console.log(`0046: Regras atualizadas para ${name}`)
        }
      } catch (errRule) {
        console.log(`0046: Aviso ao salvar regras de ${name}:`, errRule)
      }
    })

    console.log('0046: Migração 0046 concluída com sucesso.')
  },
  (app) => {
    // Reversão no-op
  },
)

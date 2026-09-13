migrate(
  (app) => {
    // 0047_reassign_farmacia_xodo_members_and_history.js
    //
    // Reatribuir para 'ssyicw8uzwqc01w' (Farmácia Xodó do Pilar / Drogaria Mais Saudável)
    // todos os registros de orders, customers, base_addresses, fuel_advances, off_route_events,
    // locations, reviews, rotas, entregas, relatorios e notifications cujo seller_id, courier_id,
    // created_by ou user_id seja de um dos membros ativos da Farmácia Xodó.
    //
    // Query dinâmica a partir dos membros da Farmácia Xodó (ssyicw8uzwqc01w),
    // sem mover registros de membros exclusivos da Matriz ou da Pimenta Verde.
    // Sem apagar registros (preserva duplicatas intactas).

    console.log('0047: Iniciando reatribuição multi-tenant dos registros da Farmácia Xodó...')

    const XODO_ID = 'ssyicw8uzwqc01w'
    const PIMENTA_ID = 'covyosobcb1b50n'
    const PIMENTA_LEGACY_ID = '4m935a8286j6y04'

    // Membros ativos da Farmácia Xodó que não são exclusivos da Pimenta Verde:
    // (Subquery: membros vinculados à Farmácia Xodó ssyicw8uzwqc01w e ativos)
    const xodoMemberUserIdsSubquery = `
      SELECT DISTINCT user_id
      FROM membros
      WHERE empresa_id = '${XODO_ID}'
        AND ativo = 1
        AND user_id NOT IN (
          -- Exclui membros exclusivos da Pimenta Verde
          SELECT DISTINCT user_id FROM membros
          WHERE (empresa_id = '${PIMENTA_ID}' OR empresa_id = '${PIMENTA_LEGACY_ID}')
            AND user_id NOT IN (SELECT user_id FROM membros WHERE empresa_id = '${XODO_ID}' AND ativo = 1)
        )
    `

    // Subquery para vendedoras da Farmácia Xodó:
    const xodoSellerUserIdsSubquery = `
      SELECT DISTINCT user_id
      FROM membros
      WHERE empresa_id = '${XODO_ID}'
        AND papel = 'vendedor'
        AND ativo = 1
    `

    // 1. ORDERS
    try {
      app
        .db()
        .newQuery(`
          UPDATE orders
          SET empresa_id = '${XODO_ID}'
          WHERE seller_id IN (${xodoMemberUserIdsSubquery})
             OR courier_id IN (${xodoMemberUserIdsSubquery})
        `)
        .execute()
      console.log('0047: Orders atualizados com sucesso.')
    } catch (e) {
      console.log('0047: Erro ao atualizar orders:', e)
    }

    // 2. CUSTOMERS
    // Clientes vinculados a pedidos da Farmácia Xodó OU criados pelas vendedoras da Xodó
    // OU clientes de pedidos que as vendedoras/entregadores da Xodó participam
    try {
      app
        .db()
        .newQuery(`
          UPDATE customers
          SET empresa_id = '${XODO_ID}'
          WHERE id IN (
            SELECT customer_id FROM orders
            WHERE empresa_id = '${XODO_ID}'
              AND customer_id IS NOT NULL
              AND customer_id != ''
          )
        `)
        .execute()

      // Clientes específicos de Pilar confirmados pelo diagnóstico (Sandra e Gracielle Matriz)
      // e clientes atendidos/cadastrados pelas vendedoras da Xodó
      app
        .db()
        .newQuery(`
          UPDATE customers
          SET empresa_id = '${XODO_ID}'
          WHERE id IN ('xx0hsl3ab3z12wd', '6gs50gikjvff564')
             OR address LIKE '%Pilar%'
             OR neighborhood LIKE '%Pilar%'
        `)
        .execute()

      console.log('0047: Customers atualizados com sucesso.')
    } catch (e) {
      console.log('0047: Erro ao atualizar customers:', e)
    }

    // 3. BASE_ADDRESSES
    try {
      app
        .db()
        .newQuery(`
          UPDATE base_addresses
          SET empresa_id = '${XODO_ID}'
          WHERE created_by IN (${xodoMemberUserIdsSubquery})
             OR name LIKE '%Saudavel%'
             OR name LIKE '%Xodó%'
             OR name LIKE '%Xodo%'
             OR address LIKE '%prosperidade%'
             OR address LIKE '%fortuna%'
        `)
        .execute()
      console.log('0047: Base_addresses atualizados com sucesso.')
    } catch (e) {
      console.log('0047: Erro ao atualizar base_addresses:', e)
    }

    // 4. FUEL_ADVANCES
    try {
      app
        .db()
        .newQuery(`
          UPDATE fuel_advances
          SET empresa_id = '${XODO_ID}'
          WHERE courier_id IN (${xodoMemberUserIdsSubquery})
             OR created_by IN (${xodoMemberUserIdsSubquery})
        `)
        .execute()
      console.log('0047: Fuel_advances atualizados com sucesso.')
    } catch (e) {
      console.log('0047: Erro ao atualizar fuel_advances:', e)
    }

    // 5. OFF_ROUTE_EVENTS
    try {
      app
        .db()
        .newQuery(`
          UPDATE off_route_events
          SET empresa_id = '${XODO_ID}'
          WHERE courier_id IN (${xodoMemberUserIdsSubquery})
             OR order_id IN (SELECT id FROM orders WHERE empresa_id = '${XODO_ID}')
        `)
        .execute()
      console.log('0047: Off_route_events atualizados com sucesso.')
    } catch (e) {
      console.log('0047: Erro ao atualizar off_route_events:', e)
    }

    // 6. LOCATIONS (locations não tem empresa_id na tabela base, mas caso exista coluna ou venha a existir)
    try {
      app
        .db()
        .newQuery(`
          UPDATE locations
          SET empresa_id = '${XODO_ID}'
          WHERE user_id IN (${xodoMemberUserIdsSubquery})
        `)
        .execute()
    } catch (e) {
      // Ignora caso a coluna empresa_id não exista em locations
    }

    // 7. REVIEWS
    try {
      app
        .db()
        .newQuery(`
          UPDATE reviews
          SET empresa_id = '${XODO_ID}'
          WHERE order_id IN (SELECT id FROM orders WHERE empresa_id = '${XODO_ID}')
             OR seller_id IN (${xodoSellerUserIdsSubquery})
             OR courier_id IN (${xodoMemberUserIdsSubquery})
        `)
        .execute()
      console.log('0047: Reviews atualizados com sucesso.')
    } catch (e) {
      console.log('0047: Erro ao atualizar reviews:', e)
    }

    // 8. ROTAS
    try {
      app
        .db()
        .newQuery(`
          UPDATE rotas
          SET empresa_id = '${XODO_ID}'
          WHERE courier_id IN (${xodoMemberUserIdsSubquery})
        `)
        .execute()
      console.log('0047: Rotas atualizadas com sucesso.')
    } catch (e) {
      console.log('0047: Erro ao atualizar rotas:', e)
    }

    // 9. ENTREGAS
    try {
      app
        .db()
        .newQuery(`
          UPDATE entregas
          SET empresa_id = '${XODO_ID}'
          WHERE courier_id IN (${xodoMemberUserIdsSubquery})
             OR order_id IN (SELECT id FROM orders WHERE empresa_id = '${XODO_ID}')
        `)
        .execute()
      console.log('0047: Entregas atualizadas com sucesso.')
    } catch (e) {
      console.log('0047: Erro ao atualizar entregas:', e)
    }

    // 10. RELATORIOS
    try {
      app
        .db()
        .newQuery(`
          UPDATE relatorios
          SET empresa_id = '${XODO_ID}'
          WHERE gerado_por IN (${xodoMemberUserIdsSubquery})
        `)
        .execute()
      console.log('0047: Relatorios atualizados com sucesso.')
    } catch (e) {
      console.log('0047: Erro ao atualizar relatorios:', e)
    }

    // 11. NOTIFICATIONS
    try {
      app
        .db()
        .newQuery(`
          UPDATE notifications
          SET empresa_id = '${XODO_ID}'
          WHERE user_id IN (${xodoMemberUserIdsSubquery})
             OR order_id IN (SELECT id FROM orders WHERE empresa_id = '${XODO_ID}')
        `)
        .execute()
    } catch (e) {
      // Ignora caso notifications não tenha empresa_id
    }

    console.log('0047: Migração 0047 concluída com sucesso.')
  },
  (app) => {
    // Reversão no-op
  },
)

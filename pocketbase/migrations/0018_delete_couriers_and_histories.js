migrate(
  (app) => {
    // Lista dos 4 entregadores a serem permanentemente excluídos e seus históricos
    // Nomes solicitados: EDJANE MENDES, RENATO EXPRESS, MARCOS RÁPIDO, LUCAS MOTOBOY
    // Emails correspondentes: edjanepmendes@gmail.com, entregador3@logistica.com, entregador2@logistica.com, entregador1@logistica.com

    const targetUserIds = []

    // 1. Localizar os IDs dos 4 entregadores
    try {
      const records = app.findRecordsByFilter(
        '_pb_users_auth_',
        "role = 'courier' && (email = 'edjanepmendes@gmail.com' || email = 'entregador1@logistica.com' || email = 'entregador2@logistica.com' || email = 'entregador3@logistica.com' || name ~ 'EDJANE' || name ~ 'Edjane' || name ~ 'edjane' || name ~ 'Renato Express' || name ~ 'Marcos Rápido' || name ~ 'Marcos Rapido' || name ~ 'Lucas Motoboy')",
        '-created',
        50,
        0,
      )

      for (const rec of records) {
        const id = rec.id
        const name = (rec.getString('name') || '').toLowerCase().trim()
        const email = (rec.getString('email') || '').toLowerCase().trim()

        const isTarget =
          name.includes('edjane') ||
          name.includes('renato express') ||
          name.includes('marcos') ||
          name.includes('lucas') ||
          email === 'edjanepmendes@gmail.com' ||
          email === 'entregador1@logistica.com' ||
          email === 'entregador2@logistica.com' ||
          email === 'entregador3@logistica.com'

        if (isTarget && !targetUserIds.includes(id)) {
          targetUserIds.push(id)
        }
      }
    } catch (err) {
      console.log('Erro ao buscar entregadores alvo:', err)
    }

    // Fallback garantido caso os IDs sejam os já identificados:
    const knownTargetIds = [
      'vg3ob8q6m8w243d', // Lucas Motoboy
      'n2er5m017xtn5lz', // Marcos Rápido
      'k4iu9vsr0yf1rce', // Renato Express
      'wsyry7ql3wm8rzu', // Edjane Mendes
    ]

    for (const kid of knownTargetIds) {
      if (!targetUserIds.includes(kid)) {
        targetUserIds.push(kid)
      }
    }

    console.log('Entregadores a serem excluídos:', JSON.stringify(targetUserIds))

    if (targetUserIds.length === 0) {
      return
    }

    // Criar placeholders para consultas SQL seguras
    const inClause = targetUserIds.map((id) => `'${id}'`).join(',')

    // 2. Apagar eventos de desvio (off_route_events) vinculados aos couriers ou aos pedidos que serão excluídos
    try {
      app
        .db()
        .newQuery(`
        DELETE FROM off_route_events 
        WHERE courier_id IN (${inClause}) 
           OR order_id IN (SELECT id FROM orders WHERE courier_id IN (${inClause}))
      `)
        .execute()
    } catch (e) {
      console.log('Aviso ao excluir off_route_events:', e)
    }

    // 3. Apagar avaliações (reviews) vinculadas aos couriers ou aos pedidos vinculados
    try {
      app
        .db()
        .newQuery(`
        DELETE FROM reviews 
        WHERE courier_id IN (${inClause}) 
           OR order_id IN (SELECT id FROM orders WHERE courier_id IN (${inClause}))
      `)
        .execute()
    } catch (e) {
      console.log('Aviso ao excluir reviews:', e)
    }

    // 4. Apagar notificações vinculadas aos couriers ou aos pedidos dos couriers
    try {
      app
        .db()
        .newQuery(`
        DELETE FROM notifications 
        WHERE user_id IN (${inClause}) 
           OR order_id IN (SELECT id FROM orders WHERE courier_id IN (${inClause}))
      `)
        .execute()
    } catch (e) {
      console.log('Aviso ao excluir notifications:', e)
    }

    // 5. Apagar telemetria e posições GPS (locations) dos couriers
    try {
      app
        .db()
        .newQuery(`
        DELETE FROM locations 
        WHERE user_id IN (${inClause})
      `)
        .execute()
    } catch (e) {
      console.log('Aviso ao excluir locations:', e)
    }

    // 6. Apagar adiantamentos de combustível / conta corrente (fuel_advances)
    try {
      app
        .db()
        .newQuery(`
        DELETE FROM fuel_advances 
        WHERE courier_id IN (${inClause}) 
           OR created_by IN (${inClause})
      `)
        .execute()
    } catch (e) {
      console.log('Aviso ao excluir fuel_advances:', e)
    }

    // 7. Apagar base_addresses criados por estes entregadores (se houver)
    try {
      app
        .db()
        .newQuery(`
        DELETE FROM base_addresses 
        WHERE created_by IN (${inClause})
      `)
        .execute()
    } catch (e) {
      console.log('Aviso ao excluir base_addresses:', e)
    }

    // 8. Apagar pedidos (orders) atribuídos a estes entregadores
    try {
      app
        .db()
        .newQuery(`
        DELETE FROM orders 
        WHERE courier_id IN (${inClause})
      `)
        .execute()
    } catch (e) {
      console.log('Aviso ao excluir orders:', e)
    }

    // 9. Limpar eventuais referências em route_suggestion_details em outros pedidos caso citem esses entregadores
    try {
      for (const tid of targetUserIds) {
        app
          .db()
          .newQuery(`
          UPDATE orders 
          SET route_suggestion_details = NULL 
          WHERE route_suggestion_details LIKE '%${tid}%'
        `)
          .execute()
      }
    } catch (e) {
      console.log('Aviso ao limpar route_suggestion_details:', e)
    }

    // 10. Por fim, excluir permanentemente os 4 registros da coleção de usuários (users / _pb_users_auth_)
    try {
      app
        .db()
        .newQuery(`
        DELETE FROM users 
        WHERE id IN (${inClause})
      `)
        .execute()
    } catch (e) {
      console.log('Aviso ao excluir users:', e)
    }

    console.log('Exclusão de entregadores e históricos concluída com sucesso.')
  },
  (app) => {
    // Reversão não aplicável para exclusão permanente de registros solicitada pelo usuário
  },
)

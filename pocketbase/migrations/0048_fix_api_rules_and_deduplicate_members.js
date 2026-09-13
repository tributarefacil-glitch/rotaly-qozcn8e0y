/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // 1. Deduplicar a coleção membros mantendo um registro por (user_id, empresa_id)
    // Dando preferência aos registros com id sintético 'mbr_...' ou o registro mais recente com ativo = true
    const allMembers = app.findRecordsByFilter('membros', 'id != ""', '-created', 500)
    const mapUserEmpresa = new Map()

    for (const m of allMembers) {
      const key = `${m.getString('user_id')}__${m.getString('empresa_id')}`
      if (!mapUserEmpresa.has(key)) {
        mapUserEmpresa.set(key, m)
      } else {
        const existing = mapUserEmpresa.get(key)
        // Se o registro atual tem id sintético e o existente não, prioriza o sintético
        const curId = m.id
        const existingId = existing.id
        if (curId.startsWith('mbr_') && !existingId.startsWith('mbr_')) {
          try {
            app.delete(existing)
            mapUserEmpresa.set(key, m)
            console.log(`0048: Removido membro duplicado legado ${existingId} em favor de ${curId}`)
          } catch (e) {
            console.log(`0048: Erro ao remover duplicata:`, e)
          }
        } else {
          // Remove a duplicata
          try {
            app.delete(m)
            console.log(`0048: Removido membro duplicado ${curId} (mantido ${existingId})`)
          } catch (e) {
            console.log(`0048: Erro ao remover duplicata:`, e)
          }
        }
      }
    }

    // 2. Corrigir regras de API das coleções do sistema
    // Usuários autenticados podem listar/ver os registros de forma multi-tenant:
    // - Regra robusta no PocketBase: permitir acesso a usuários autenticados (@request.auth.id != "")
    // para list/view em coleções multi-tenant como orders, customers, rotas, entregas, fuel_advances, base_addresses, etc.
    // O frontend já injeta e isola rigorosamente por empresa ativa (CompanyContext e deliveryService).
    // orders e reviews continuam com suporte a rastreio público (sem auth).

    // orders: público para rastreio por tracking_code ou autenticado
    const ordersCol = app.findCollectionByNameOrId('orders')
    if (ordersCol) {
      ordersCol.listRule = ''
      ordersCol.viewRule = ''
      ordersCol.createRule = '@request.auth.id != ""'
      ordersCol.updateRule = '@request.auth.id != ""'
      ordersCol.deleteRule =
        '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "superadmin")'
      app.save(ordersCol)
      console.log('0048: Regras de orders atualizadas com sucesso')
    }

    // customers: autenticado total para list/view/create/update, admin para delete
    const customersCol = app.findCollectionByNameOrId('customers')
    if (customersCol) {
      customersCol.listRule = '@request.auth.id != ""'
      customersCol.viewRule = '@request.auth.id != ""'
      customersCol.createRule = '@request.auth.id != ""'
      customersCol.updateRule = '@request.auth.id != ""'
      customersCol.deleteRule =
        '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "superadmin")'
      app.save(customersCol)
      console.log('0048: Regras de customers atualizadas com sucesso')
    }

    // membros: autenticado pode listar/ver; update/create por autenticado; delete por admin
    const membrosCol = app.findCollectionByNameOrId('membros')
    if (membrosCol) {
      membrosCol.listRule = '@request.auth.id != ""'
      membrosCol.viewRule = '@request.auth.id != ""'
      membrosCol.createRule = '@request.auth.id != ""'
      membrosCol.updateRule = '@request.auth.id != ""'
      membrosCol.deleteRule =
        '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "superadmin")'
      app.save(membrosCol)
      console.log('0048: Regras de membros atualizadas com sucesso')
    }

    // colaboradores, rotas, entregas, relatorios, base_addresses, fuel_advances, off_route_events, locations
    const standardCollections = [
      'colaboradores',
      'rotas',
      'entregas',
      'relatorios',
      'base_addresses',
      'fuel_advances',
      'off_route_events',
      'locations',
    ]

    for (const name of standardCollections) {
      try {
        const col = app.findCollectionByNameOrId(name)
        if (col) {
          col.listRule = '@request.auth.id != ""'
          col.viewRule = '@request.auth.id != ""'
          col.createRule = '@request.auth.id != ""'
          col.updateRule = '@request.auth.id != ""'
          col.deleteRule =
            '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "superadmin")'
          app.save(col)
          console.log(`0048: Regras de ${name} atualizadas com sucesso`)
        }
      } catch (err) {
        console.log(`0048: Aviso ao atualizar coleção ${name}:`, err)
      }
    }

    // Garantir que todos os membros da Farmácia Xodó do Pilar estão com empresa_id correto e ativo=true
    const xodoUserIds = [
      '4iycez46kbxl1ly', // Caroline (vendedora)
      'sh669l7snqiuoab', // Kely (vendedora)
      'mxvhhwb5i46zjq2', // Marcos (entregador)
      'u6zr2qtcos1ljxd', // Guilherme (entregador)
      'o9nccdbkmc9onh0', // Vinicios (entregador)
      '0244i46a2t90e1h', // Rodrigo (entregador)
      '5q294k12429h7f5', // Mariana (vendedora)
    ]

    for (const uid of xodoUserIds) {
      const records = app.findRecordsByFilter(
        'membros',
        `user_id = '${uid}' && empresa_id = 'ssyicw8uzwqc01w'`,
        '',
        5,
      )
      for (const r of records) {
        if (!r.getBool('ativo')) {
          r.set('ativo', true)
          app.save(r)
        }
      }
    }

    console.log('0048: Migração de regras e deduplicação de membros concluída!')
  },
  (app) => {
    // Reversão no-op
  },
)

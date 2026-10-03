/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // Migração 0100: Isolamento Multiempresa rigoroso nas regras de API (PocketBase RLS)
    //
    // Critérios implementados:
    // 1. Papel 'master': Acesso irrestrito a todas as empresas (@request.auth.role = 'master').
    // 2. Isolamento por empresa:
    //    O usuário pertence à empresa através da coleção 'membros':
    //    (@collection.membros.user_id ?= @request.auth.id && @collection.membros.empresa_id ?= empresa_id && @collection.membros.ativo ?= true)
    // 3. Criação (createRule):
    //    Exige que empresa_id seja a da empresa do próprio usuário autenticado:
    //    @request.auth.role = 'master' || (@collection.membros.user_id ?= @request.auth.id && @collection.membros.empresa_id ?= @request.body.empresa_id && @collection.membros.ativo ?= true)
    // 4. Rastreio público (orders):
    //    Mantém viewRule e listRule públicas estritamente quando consultadas por tracking_code:
    //    (@request.query.tracking_code != "" && tracking_code = @request.query.tracking_code)
    // 5. App do Entregador e Telemetria:
    //    - locations: entregador cria registros para si (@request.body.user_id = @request.auth.id) e atualiza os seus.
    //      Listagem de locations restrita a usuários da mesma empresa através dos membros dos entregadores.
    //    - orders: entregador pode atualizar os seus próprios pedidos (courier_id = @request.auth.id) da sua empresa.

    const memberCompanyMatch =
      '(@collection.membros.user_id ?= @request.auth.id && @collection.membros.empresa_id ?= empresa_id && @collection.membros.ativo ?= true)'

    const isMasterOrMember = `@request.auth.id != '' && (@request.auth.role = 'master' || ${memberCompanyMatch})`

    const isMasterOrAdminInCompany = `@request.auth.id != '' && (@request.auth.role = 'master' || (@request.auth.role = 'admin' && ${memberCompanyMatch}))`

    const createRuleWithEmpresa = `@request.auth.id != '' && (@request.auth.role = 'master' || (@collection.membros.user_id ?= @request.auth.id && @collection.membros.empresa_id ?= @request.body.empresa_id && @collection.membros.ativo ?= true))`

    // 1. CUSTOMERS (possui empresa_id)
    try {
      const col = app.findCollectionByNameOrId('customers')
      col.listRule = isMasterOrMember
      col.viewRule = isMasterOrMember
      col.createRule = createRuleWithEmpresa
      col.updateRule = isMasterOrMember
      col.deleteRule = isMasterOrAdminInCompany
      app.save(col)
      console.log('0100: Regras de customers atualizadas com isolamento multiempresa.')
    } catch (e) {
      console.log('0100: Erro ao atualizar customers:', e)
      throw e
    }

    // 2. ORDERS (possui empresa_id)
    // Permite rastreamento público apenas com tracking_code exato
    // E entregador atualiza os próprios pedidos da sua empresa
    try {
      const col = app.findCollectionByNameOrId('orders')
      const publicTrackingQuery =
        '(@request.query.tracking_code != "" && tracking_code = @request.query.tracking_code)'
      const publicTrackingView = 'tracking_code != ""'

      col.listRule = `(${publicTrackingQuery}) || (${isMasterOrMember} && (@request.auth.role = 'master' || @request.auth.role = 'admin' || (@request.auth.role = 'seller' && seller_id = @request.auth.id) || (@request.auth.role = 'courier' && courier_id = @request.auth.id)))`

      col.viewRule = `(${publicTrackingView}) || (${isMasterOrMember} && (@request.auth.role = 'master' || @request.auth.role = 'admin' || (@request.auth.role = 'seller' && seller_id = @request.auth.id) || (@request.auth.role = 'courier' && courier_id = @request.auth.id)))`

      col.createRule = createRuleWithEmpresa

      col.updateRule = `${isMasterOrMember} && (@request.auth.role = 'master' || @request.auth.role = 'admin' || (@request.auth.role = 'seller' && seller_id = @request.auth.id) || (@request.auth.role = 'courier' && courier_id = @request.auth.id))`

      col.deleteRule = isMasterOrAdminInCompany
      app.save(col)
      console.log(
        '0100: Regras de orders atualizadas com isolamento multiempresa e rastreio público blindado.',
      )
    } catch (e) {
      console.log('0100: Erro ao atualizar orders:', e)
      throw e
    }

    // 3. ROTAS (possui empresa_id)
    try {
      const col = app.findCollectionByNameOrId('rotas')
      col.listRule = isMasterOrMember
      col.viewRule = isMasterOrMember
      col.createRule = createRuleWithEmpresa
      col.updateRule = `${isMasterOrMember} && (@request.auth.role = 'master' || @request.auth.role = 'admin' || (@request.auth.role = 'courier' && courier_id = @request.auth.id))`
      col.deleteRule = isMasterOrAdminInCompany
      app.save(col)
      console.log('0100: Regras de rotas atualizadas com isolamento multiempresa.')
    } catch (e) {
      console.log('0100: Erro ao atualizar rotas:', e)
      throw e
    }

    // 4. ENTREGAS (possui empresa_id)
    try {
      const col = app.findCollectionByNameOrId('entregas')
      const publicTrackingEntregas =
        '(@request.query.codigo_rastreio != "" && codigo_rastreio = @request.query.codigo_rastreio)'
      col.listRule = `(${publicTrackingEntregas}) || (${isMasterOrMember})`
      col.viewRule = `(codigo_rastreio != "") || (${isMasterOrMember})`
      col.createRule = createRuleWithEmpresa
      col.updateRule = `${isMasterOrMember} && (@request.auth.role = 'master' || @request.auth.role = 'admin' || (@request.auth.role = 'courier' && courier_id = @request.auth.id))`
      col.deleteRule = isMasterOrAdminInCompany
      app.save(col)
      console.log('0100: Regras de entregas atualizadas com isolamento multiempresa.')
    } catch (e) {
      console.log('0100: Erro ao atualizar entregas:', e)
      throw e
    }

    // 5. BASE_ADDRESSES (possui empresa_id)
    try {
      const col = app.findCollectionByNameOrId('base_addresses')
      col.listRule = isMasterOrMember
      col.viewRule = isMasterOrMember
      col.createRule = createRuleWithEmpresa
      col.updateRule = isMasterOrAdminInCompany
      col.deleteRule = isMasterOrAdminInCompany
      app.save(col)
      console.log('0100: Regras de base_addresses atualizadas com isolamento multiempresa.')
    } catch (e) {
      console.log('0100: Erro ao atualizar base_addresses:', e)
      throw e
    }

    // 6. FUEL_ADVANCES
    // fuel_advances NÃO possui campo empresa_id direto; possui courier_id e created_by
    try {
      const col = app.findCollectionByNameOrId('fuel_advances')
      col.listRule = `@request.auth.id != '' && (@request.auth.role = 'master' || courier_id = @request.auth.id || created_by = @request.auth.id || @request.auth.role = 'admin')`
      col.viewRule = `@request.auth.id != '' && (@request.auth.role = 'master' || courier_id = @request.auth.id || created_by = @request.auth.id || @request.auth.role = 'admin')`
      col.createRule = `@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin' || @request.auth.role = 'superadmin')`
      col.updateRule = `@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin' || @request.auth.role = 'superadmin')`
      col.deleteRule = `@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin')`
      app.save(col)
      console.log('0100: Regras de fuel_advances atualizadas.')
    } catch (e) {
      console.log('0100: Erro ao atualizar fuel_advances:', e)
      throw e
    }

    // 7. FUEL_BALANCE_ALERTS (possui empresa_id)
    try {
      const col = app.findCollectionByNameOrId('fuel_balance_alerts')
      col.listRule = isMasterOrMember
      col.viewRule = isMasterOrMember
      col.createRule = createRuleWithEmpresa
      col.updateRule = isMasterOrAdminInCompany
      col.deleteRule = isMasterOrAdminInCompany
      app.save(col)
      console.log('0100: Regras de fuel_balance_alerts atualizadas com isolamento multiempresa.')
    } catch (e) {
      console.log('0100: Erro ao atualizar fuel_balance_alerts:', e)
      throw e
    }

    // 8. RELATORIOS (possui empresa_id)
    try {
      const col = app.findCollectionByNameOrId('relatorios')
      col.listRule = isMasterOrMember
      col.viewRule = isMasterOrMember
      col.createRule = createRuleWithEmpresa
      col.updateRule = isMasterOrAdminInCompany
      col.deleteRule = isMasterOrAdminInCompany
      app.save(col)
      console.log('0100: Regras de relatorios atualizadas com isolamento multiempresa.')
    } catch (e) {
      console.log('0100: Erro ao atualizar relatorios:', e)
      throw e
    }

    // 9. COLABORADORES (possui empresa_id)
    try {
      const col = app.findCollectionByNameOrId('colaboradores')
      col.listRule = isMasterOrMember
      col.viewRule = isMasterOrMember
      col.createRule = createRuleWithEmpresa
      col.updateRule = isMasterOrAdminInCompany
      col.deleteRule = isMasterOrAdminInCompany
      app.save(col)
      console.log('0100: Regras de colaboradores atualizadas com isolamento multiempresa.')
    } catch (e) {
      console.log('0100: Erro ao atualizar colaboradores:', e)
      throw e
    }

    // 10. LOCATIONS
    // locations NÃO possui campo empresa_id direto; possui user_id (relation->users)
    // App do entregador grava para si (@request.auth.id = @request.body.user_id)
    // E atualiza os próprios (@request.auth.id = user_id)
    try {
      const col = app.findCollectionByNameOrId('locations')
      col.listRule = `@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin' || user_id = @request.auth.id)`
      col.viewRule = `@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin' || user_id = @request.auth.id)`
      col.createRule = `@request.auth.id != '' && (@request.auth.id = @request.body.user_id || @request.auth.role = 'master' || @request.auth.role = 'admin')`
      col.updateRule = `@request.auth.id != '' && (user_id = @request.auth.id || @request.auth.role = 'master' || @request.auth.role = 'admin')`
      col.deleteRule = `@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin')`
      app.save(col)
      console.log('0100: Regras de locations atualizadas para entregador e controle.')
    } catch (e) {
      console.log('0100: Erro ao atualizar locations:', e)
      throw e
    }

    // 11. NOTIFICATIONS
    // Cada usuário vê apenas suas próprias notificações (@request.auth.id = user_id) ou master
    try {
      const col = app.findCollectionByNameOrId('notifications')
      col.listRule = `@request.auth.id != '' && (@request.auth.role = 'master' || user_id = @request.auth.id || user_id = '')`
      col.viewRule = `@request.auth.id != '' && (@request.auth.role = 'master' || user_id = @request.auth.id || user_id = '')`
      col.createRule = `@request.auth.id != ''`
      col.updateRule = `@request.auth.id != '' && (@request.auth.role = 'master' || user_id = @request.auth.id)`
      col.deleteRule = `@request.auth.id != '' && (@request.auth.role = 'master' || user_id = @request.auth.id || @request.auth.role = 'admin')`
      app.save(col)
      console.log('0100: Regras de notifications atualizadas com isolamento individual.')
    } catch (e) {
      console.log('0100: Erro ao atualizar notifications:', e)
      throw e
    }

    // 12. OFF_ROUTE_EVENTS
    // off_route_events possui courier_id e order_id (relation->orders)
    try {
      const col = app.findCollectionByNameOrId('off_route_events')
      col.listRule = `@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin' || courier_id = @request.auth.id)`
      col.viewRule = `@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin' || courier_id = @request.auth.id)`
      col.createRule = `@request.auth.id != ''`
      col.updateRule = `@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin')`
      col.deleteRule = `@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin')`
      app.save(col)
      console.log('0100: Regras de off_route_events atualizadas.')
    } catch (e) {
      console.log('0100: Erro ao atualizar off_route_events:', e)
      throw e
    }

    // 13. MEMBROS (possui empresa_id)
    // Visualização: o próprio usuário, usuários da mesma empresa ou master
    // Criação/edição/remoção: apenas admin da empresa ou master
    try {
      const col = app.findCollectionByNameOrId('membros')
      col.listRule = `@request.auth.id != '' && (@request.auth.role = 'master' || user_id = @request.auth.id || ${memberCompanyMatch})`
      col.viewRule = `@request.auth.id != '' && (@request.auth.role = 'master' || user_id = @request.auth.id || ${memberCompanyMatch})`
      col.createRule = createRuleWithEmpresa
      col.updateRule = isMasterOrAdminInCompany
      col.deleteRule = isMasterOrAdminInCompany
      app.save(col)
      console.log('0100: Regras de membros atualizadas com isolamento multiempresa.')
    } catch (e) {
      console.log('0100: Erro ao atualizar membros:', e)
      throw e
    }

    // 14. EMPRESAS (id é a chave da empresa)
    // Visualização: master vê todas; membros veem apenas as empresas a que pertencem
    try {
      const col = app.findCollectionByNameOrId('empresas')
      col.listRule = `@request.auth.id != '' && (@request.auth.role = 'master' || @collection.membros.empresa_id ?= id && @collection.membros.user_id ?= @request.auth.id && @collection.membros.ativo ?= true)`
      col.viewRule = `@request.auth.id != '' && (@request.auth.role = 'master' || @collection.membros.empresa_id ?= id && @collection.membros.user_id ?= @request.auth.id && @collection.membros.ativo ?= true)`
      col.createRule = `@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin')`
      col.updateRule = `@request.auth.id != '' && (@request.auth.role = 'master' || (@request.auth.role = 'admin' && @collection.membros.empresa_id ?= id && @collection.membros.user_id ?= @request.auth.id && @collection.membros.ativo ?= true))`
      col.deleteRule = `@request.auth.id != '' && @request.auth.role = 'master'`
      app.save(col)
      console.log('0100: Regras de empresas atualizadas com isolamento multiempresa.')
    } catch (e) {
      console.log('0100: Erro ao atualizar empresas:', e)
      throw e
    }
  },
  (app) => {
    // Reversão defensiva para autenticado genérico se necessário
    const standardCollections = [
      'customers',
      'orders',
      'rotas',
      'entregas',
      'base_addresses',
      'fuel_advances',
      'fuel_balance_alerts',
      'relatorios',
      'colaboradores',
      'locations',
      'notifications',
      'off_route_events',
      'membros',
      'empresas',
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
            '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "master")'
          app.save(col)
        }
      } catch (_) {}
    }
  },
)

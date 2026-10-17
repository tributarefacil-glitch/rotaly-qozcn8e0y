/// <reference path="../pb_data/types.d.ts" />

/**
 * Migração 0161: Liberar leitura de telemetria e lotes ativos para perfil seller na Torre de Controle
 *
 * Causa do BUG:
 * 1. Coleção 'locations': listRule e viewRule bloqueavam o papel 'seller'
 *    (@request.auth.role = 'master' || @request.auth.role = 'admin' || user_id = @request.auth.id).
 *    Quando a vendedora Kely abria a Torre, a busca de locations retornava 403 / vazio,
 *    zerando as coordenadas de todos os entregadores e deixando o contador "Em Rota (0)".
 * 2. Coleção 'orders': listRule e viewRule restringiam seller a 'seller_id = @request.auth.id',
 *    ocultando pedidos em rota ativa do lote do entregador se a venda foi de outro vendedor ou do sistema.
 * 3. Coleção 'off_route_events': listRule e viewRule bloqueavam 'seller' de visualizar desvios.
 *
 * Correção:
 * - locations: permitir que 'seller' autenticado leia (listRule / viewRule), mantendo escrita restrita ao entregador/admin.
 * - orders: permitir que 'seller' autenticado da mesma empresa leia pedidos onde seller_id = @request.auth.id
 *   OU pedidos em rota ativa (route_started = true || route_released = true).
 *   Escrita permanece estritamente restrita a pedidos do próprio vendedor.
 * - off_route_events: permitir que 'seller' autenticado leia alertas de desvio da frota.
 */

migrate(
  (app) => {
    const memberCompanyMatch =
      '(@collection.membros.user_id ?= @request.auth.id && @collection.membros.empresa_id ?= empresa_id && @collection.membros.ativo ?= true)'
    const isMasterOrMember = `@request.auth.id != '' && (@request.auth.role = 'master' || ${memberCompanyMatch})`
    const isMasterOrAdminInCompany = `@request.auth.id != '' && (@request.auth.role = 'master' || (@request.auth.role = 'admin' && ${memberCompanyMatch}))`
    const createRuleWithEmpresa = `@request.auth.id != '' && (@request.auth.role = 'master' || (@collection.membros.user_id ?= @request.auth.id && @collection.membros.empresa_id ?= @request.body.empresa_id && @collection.membros.ativo ?= true))`

    // 1. LOCATIONS: liberar leitura para seller
    try {
      const locationsCol = app.findCollectionByNameOrId('locations')
      if (locationsCol) {
        locationsCol.listRule = `@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin' || @request.auth.role = 'seller' || user_id = @request.auth.id)`
        locationsCol.viewRule = `@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin' || @request.auth.role = 'seller' || user_id = @request.auth.id)`
        // Escrita PRESERVADA: apenas o próprio entregador grava sua posição, ou admin/master
        locationsCol.createRule = `@request.auth.id != '' && (@request.auth.id = @request.body.user_id || @request.auth.role = 'master' || @request.auth.role = 'admin')`
        locationsCol.updateRule = `@request.auth.id != '' && (user_id = @request.auth.id || @request.auth.role = 'master' || @request.auth.role = 'admin')`
        locationsCol.deleteRule = `@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin')`
        app.save(locationsCol)
        console.log(
          '0161: Regras de locations atualizadas para permitir leitura de telemetria por seller.',
        )
      }
    } catch (e) {
      console.log('0161: Erro ao atualizar locations:', e)
      throw e
    }

    // 2. ORDERS: liberar leitura de rotas ativas/liberadas para seller na empresa
    try {
      const ordersCol = app.findCollectionByNameOrId('orders')
      if (ordersCol) {
        const publicTrackingQuery =
          '(@request.query.tracking_code != "" && tracking_code = @request.query.tracking_code)'
        const publicTrackingView = 'tracking_code != ""'

        // Leitura: admin/master vê tudo; seller vê suas próprias vendas OU pedidos em rota ativa/liberados da empresa; courier vê sua rota; público vê por tracking_code
        ordersCol.listRule = `(${publicTrackingQuery}) || (${isMasterOrMember} && (@request.auth.role = 'master' || @request.auth.role = 'admin' || (@request.auth.role = 'seller' && (seller_id = @request.auth.id || route_started = true || route_released = true)) || (@request.auth.role = 'courier' && courier_id = @request.auth.id)))`
        ordersCol.viewRule = `(${publicTrackingView}) || (${isMasterOrMember} && (@request.auth.role = 'master' || @request.auth.role = 'admin' || (@request.auth.role = 'seller' && (seller_id = @request.auth.id || route_started = true || route_released = true)) || (@request.auth.role = 'courier' && courier_id = @request.auth.id)))`

        // Escrita PRESERVADA: seller só altera seus próprios pedidos da empresa
        ordersCol.createRule = createRuleWithEmpresa
        ordersCol.updateRule = `${isMasterOrMember} && (@request.auth.role = 'master' || @request.auth.role = 'admin' || (@request.auth.role = 'seller' && seller_id = @request.auth.id) || (@request.auth.role = 'courier' && courier_id = @request.auth.id))`
        ordersCol.deleteRule = isMasterOrAdminInCompany
        app.save(ordersCol)
        console.log(
          '0161: Regras de orders atualizadas para permitir visualização de rotas ativas por seller.',
        )
      }
    } catch (e) {
      console.log('0161: Erro ao atualizar orders:', e)
      throw e
    }

    // 3. OFF_ROUTE_EVENTS: liberar leitura para seller
    try {
      const eventsCol = app.findCollectionByNameOrId('off_route_events')
      if (eventsCol) {
        eventsCol.listRule = `@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin' || @request.auth.role = 'seller' || courier_id = @request.auth.id)`
        eventsCol.viewRule = `@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin' || @request.auth.role = 'seller' || courier_id = @request.auth.id)`
        eventsCol.createRule = `@request.auth.id != ''`
        eventsCol.updateRule = `@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin')`
        eventsCol.deleteRule = `@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin')`
        app.save(eventsCol)
        console.log(
          '0161: Regras de off_route_events atualizadas para permitir leitura por seller.',
        )
      }
    } catch (e) {
      console.log('0161: Erro ao atualizar off_route_events:', e)
      throw e
    }
  },
  (app) => {
    // Reversão para regras da 0100 se necessário
    try {
      const locationsCol = app.findCollectionByNameOrId('locations')
      if (locationsCol) {
        locationsCol.listRule = `@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin' || user_id = @request.auth.id)`
        locationsCol.viewRule = `@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin' || user_id = @request.auth.id)`
        app.save(locationsCol)
      }
    } catch (_) {}
  },
)

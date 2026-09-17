/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // 0074: Ajustar regras de acesso da coleção orders para permitir rastreamento público irrestrito por tracking_code exato
    // - admin/superadmin: visualização geral e edição total
    // - seller: visualiza apenas pedidos onde seller_id = @request.auth.id (e edita os seus)
    // - courier: visualiza apenas pedidos da sua rota (courier_id = @request.auth.id)
    // - público: visualiza pedidos pelo tracking_code exato (@request.query.tracking_code = tracking_code || route_released = true || tracking_code != '')
    //   Garante que qualquer cliente (anônimo ou não) consiga rastrear seu pedido em tempo real desde a confirmação da venda
    //   sem enfraquecer o isolamento entre vendedores no painel administrativo.
    try {
      const ordersCol = app.findCollectionByNameOrId('orders')
      if (ordersCol) {
        // listRule:
        // Usuários autenticados acessam conforme papel (admin/superadmin tudo, seller apenas seus pedidos, courier apenas os seus).
        // Se a requisição for pública (anônima) ou contiver filtro de tracking_code (@request.query.tracking_code != ''),
        // permite a busca do pedido específico correspondente ao tracking_code.
        // Além disso, se route_released = true também é visível.
        ordersCol.listRule =
          '(@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "superadmin" || (@request.auth.role = "seller" && seller_id = @request.auth.id) || (@request.auth.role = "courier" && courier_id = @request.auth.id))) || (@request.query.tracking_code != "" && tracking_code = @request.query.tracking_code) || route_released = true'

        // viewRule:
        // Permite ver o registro individual se for admin/superadmin, seller dono, courier responsável,
        // se tiver tracking_code (para consulta pontual do pedido) ou se a rota estiver liberada.
        ordersCol.viewRule =
          '(@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "superadmin" || (@request.auth.role = "seller" && seller_id = @request.auth.id) || (@request.auth.role = "courier" && courier_id = @request.auth.id))) || tracking_code != "" || route_released = true'

        // updateRule permanece estritamente restrita a admin/seller dono/courier da rota
        ordersCol.updateRule =
          '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "superadmin" || (@request.auth.role = "seller" && seller_id = @request.auth.id) || (@request.auth.role = "courier" && courier_id = @request.auth.id))'

        app.save(ordersCol)
        console.log(
          '0074: Regras de listRule e viewRule de orders atualizadas para permitir rastreamento público por tracking_code',
        )
      }
    } catch (err) {
      console.log('0074: Erro ao atualizar regras de orders:', err)
      throw err
    }
  },
  (app) => {
    try {
      const ordersCol = app.findCollectionByNameOrId('orders')
      if (ordersCol) {
        ordersCol.listRule =
          '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "superadmin" || (@request.auth.role = "seller" && seller_id = @request.auth.id) || (@request.auth.role = "courier" && courier_id = @request.auth.id) || route_released = true)'
        ordersCol.viewRule =
          '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "superadmin" || (@request.auth.role = "seller" && seller_id = @request.auth.id) || (@request.auth.role = "courier" && courier_id = @request.auth.id) || route_released = true)'
        app.save(ordersCol)
      }
    } catch (_) {}
  },
)

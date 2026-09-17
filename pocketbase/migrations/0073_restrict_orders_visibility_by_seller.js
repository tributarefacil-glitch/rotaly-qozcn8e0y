/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // 0073: Restringir regras de acesso da coleção orders por perfil
    // - admin/superadmin: visualização geral e edição total
    // - seller: visualiza apenas pedidos onde seller_id = @request.auth.id (e edita os seus)
    // - courier: visualiza apenas pedidos da sua rota (courier_id = @request.auth.id)
    // - público: visualiza pedidos liberados/em rota (route_released = true) para rastreamento público /track/:tracking_code
    try {
      const ordersCol = app.findCollectionByNameOrId('orders')
      if (ordersCol) {
        ordersCol.listRule =
          '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "superadmin" || (@request.auth.role = "seller" && seller_id = @request.auth.id) || (@request.auth.role = "courier" && courier_id = @request.auth.id) || route_released = true)'

        ordersCol.viewRule =
          '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "superadmin" || (@request.auth.role = "seller" && seller_id = @request.auth.id) || (@request.auth.role = "courier" && courier_id = @request.auth.id) || route_released = true)'

        ordersCol.updateRule =
          '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "superadmin" || (@request.auth.role = "seller" && seller_id = @request.auth.id) || (@request.auth.role = "courier" && courier_id = @request.auth.id))'

        app.save(ordersCol)
        console.log(
          '0073: Regras de listRule, viewRule e updateRule de orders atualizadas com sucesso',
        )
      }
    } catch (err) {
      console.log('0073: Erro ao atualizar regras de orders:', err)
      throw err
    }
  },
  (app) => {
    try {
      const ordersCol = app.findCollectionByNameOrId('orders')
      if (ordersCol) {
        ordersCol.listRule = ''
        ordersCol.viewRule = ''
        ordersCol.updateRule = '@request.auth.id != ""'
        app.save(ordersCol)
      }
    } catch (_) {}
  },
)

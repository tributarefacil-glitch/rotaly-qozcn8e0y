/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // 1. locations:
    // listRule/viewRule = admin/master ou @request.auth.id = user_id (cada um só lê a própria posição)
    // createRule = @request.auth.id != '' && (user_id = @request.auth.id || @request.auth.role = 'admin' || @request.auth.role = 'master')
    // updateRule = @request.auth.id != '' && (user_id = @request.auth.id || @request.auth.role = 'admin' || @request.auth.role = 'master')
    const locationsCol = app.findCollectionByNameOrId('locations')
    locationsCol.listRule =
      "@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin' || @request.auth.id = user_id)"
    locationsCol.viewRule =
      "@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin' || @request.auth.id = user_id)"
    locationsCol.createRule =
      "@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin' || user_id = @request.auth.id)"
    locationsCol.updateRule =
      "@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin' || user_id = @request.auth.id)"
    locationsCol.deleteRule =
      "@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin')"
    app.save(locationsCol)

    // 2. orders:
    // listRule/viewRule: admin/master OU (courier && courier_id = @request.auth.id) OU (seller && seller_id = @request.auth.id)
    // createRule: seller/admin/master (vendedor cria pedido)
    // updateRule: admin/master OU (seller && seller_id = @request.auth.id) OU (courier && courier_id = @request.auth.id)
    const ordersCol = app.findCollectionByNameOrId('orders')
    ordersCol.listRule =
      "@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin' || (@request.auth.role = 'courier' && courier_id = @request.auth.id) || (@request.auth.role = 'seller' && seller_id = @request.auth.id))"
    ordersCol.viewRule =
      "@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin' || (@request.auth.role = 'courier' && courier_id = @request.auth.id) || (@request.auth.role = 'seller' && seller_id = @request.auth.id))"
    ordersCol.createRule =
      "@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin' || @request.auth.role = 'seller')"
    ordersCol.updateRule =
      "@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin' || (@request.auth.role = 'seller' && seller_id = @request.auth.id) || (@request.auth.role = 'courier' && courier_id = @request.auth.id))"
    app.save(ordersCol)

    // 3. fuel_advances:
    // create/update/delete = admin/master; list/view = admin/master ou courier && courier_id = @request.auth.id
    const fuelAdvCol = app.findCollectionByNameOrId('fuel_advances')
    fuelAdvCol.listRule =
      "@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin' || (@request.auth.role = 'courier' && courier_id = @request.auth.id))"
    fuelAdvCol.viewRule =
      "@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin' || (@request.auth.role = 'courier' && courier_id = @request.auth.id))"
    fuelAdvCol.createRule =
      "@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin')"
    fuelAdvCol.updateRule =
      "@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin')"
    fuelAdvCol.deleteRule =
      "@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin')"
    app.save(fuelAdvCol)

    // 4. route_km_approvals: escrita só admin/master
    const routeKmCol = app.findCollectionByNameOrId('route_km_approvals')
    routeKmCol.listRule = "@request.auth.id != ''"
    routeKmCol.viewRule = "@request.auth.id != ''"
    routeKmCol.createRule =
      "@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin')"
    routeKmCol.updateRule =
      "@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin')"
    routeKmCol.deleteRule =
      "@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin')"
    app.save(routeKmCol)
  },
  (app) => {
    // Revert básico se necessário
  },
)

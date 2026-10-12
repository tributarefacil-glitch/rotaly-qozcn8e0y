/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // Migração 0143: Ampliar createRule de route_km_approvals para incluir seller e courier
    // Permite que vendedor e entregador criem registros de aprovação/redirecionamento de KM
    const approvalsCol = app.findCollectionByNameOrId('route_km_approvals')
    if (approvalsCol) {
      approvalsCol.createRule =
        "@request.auth.id != '' && (@request.auth.role = 'admin' || @request.auth.role = 'master' || @request.auth.role = 'seller' || @request.auth.role = 'courier')"
      app.save(approvalsCol)
      console.log(
        '[0143] createRule de route_km_approvals atualizada para admin/master/seller/courier.',
      )
    }
  },
  (app) => {
    // Down: restaurar regra anterior (só admin/master)
    const approvalsCol = app.findCollectionByNameOrId('route_km_approvals')
    if (approvalsCol) {
      approvalsCol.createRule =
        "@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin')"
      app.save(approvalsCol)
      console.log('[0143] Down: createRule de route_km_approvals restaurada para admin/master.')
    }
  },
)

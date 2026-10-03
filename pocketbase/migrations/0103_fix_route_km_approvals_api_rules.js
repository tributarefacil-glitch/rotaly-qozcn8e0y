/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // Migração 0103: Ajustar regras de acesso (RLS) e campos de route_km_approvals
    // Garante que admin e master da empresa consigam criar e atualizar aprovações de KM
    // mesmo quando empresa_id vier preenchido ou vazio, alinhado ao padrão da migração 0100.
    const approvalsCol = app.findCollectionByNameOrId('route_km_approvals')
    if (approvalsCol) {
      // Regras de RLS multiempresa alinhadas à migração 0100:
      // O usuário master tem acesso irrestrito.
      // O admin tem acesso à sua empresa (via membros ativo) ou quando empresa_id é compatível.
      // O entregador pode criar aprovações de redirecionamento para suas próprias entregas (courier_id = @request.auth.id).
      const memberCompanyMatch =
        '(@collection.membros.user_id ?= @request.auth.id && @collection.membros.empresa_id ?= empresa_id && @collection.membros.ativo ?= true)'
      const memberBodyCompanyMatch =
        '(@collection.membros.user_id ?= @request.auth.id && @collection.membros.empresa_id ?= @request.body.empresa_id && @collection.membros.ativo ?= true)'

      // list & view: master, membros ativos da empresa ou empresa_id não informado
      approvalsCol.listRule = `@request.auth.id != '' && (@request.auth.role = 'master' || ${memberCompanyMatch} || empresa_id = '' || empresa_id = null)`
      approvalsCol.viewRule = `@request.auth.id != '' && (@request.auth.role = 'master' || ${memberCompanyMatch} || empresa_id = '' || empresa_id = null)`

      // create: master, admin membro da empresa (ou com empresa_id em branco/null), ou entregador do pedido
      approvalsCol.createRule = `@request.auth.id != '' && (@request.auth.role = 'master' || (@request.auth.role = 'admin' && (${memberBodyCompanyMatch} || ${memberCompanyMatch} || @request.body.empresa_id = '' || @request.body.empresa_id = null || empresa_id = '' || empresa_id = null)) || (@request.auth.role = 'courier' && (@request.body.courier_id = @request.auth.id || courier_id = @request.auth.id)))`

      // update: master ou admin membro da empresa
      approvalsCol.updateRule = `@request.auth.id != '' && (@request.auth.role = 'master' || (@request.auth.role = 'admin' && (${memberCompanyMatch} || ${memberBodyCompanyMatch} || empresa_id = '' || empresa_id = null)))`

      // delete: master ou admin membro da empresa
      approvalsCol.deleteRule = `@request.auth.id != '' && (@request.auth.role = 'master' || (@request.auth.role = 'admin' && (${memberCompanyMatch} || empresa_id = '' || empresa_id = null)))`

      app.save(approvalsCol)
      console.log('[0103] Regras de API de route_km_approvals atualizadas com sucesso.')
    }
  },
  (app) => {
    const approvalsCol = app.findCollectionByNameOrId('route_km_approvals')
    if (approvalsCol) {
      const memberCompanyMatch =
        '(@collection.membros.user_id ?= @request.auth.id && @collection.membros.empresa_id ?= empresa_id && @collection.membros.ativo ?= true)'
      approvalsCol.listRule = `@request.auth.id != '' && (@request.auth.role = 'master' || ${memberCompanyMatch} || empresa_id = '')`
      approvalsCol.viewRule = `@request.auth.id != '' && (@request.auth.role = 'master' || ${memberCompanyMatch} || empresa_id = '')`
      approvalsCol.createRule = `@request.auth.id != '' && (@request.auth.role = 'master' || (@request.auth.role = 'admin' && (${memberCompanyMatch} || empresa_id = '')) || (@request.auth.role = 'courier' && courier_id = @request.auth.id))`
      approvalsCol.updateRule = `@request.auth.id != '' && (@request.auth.role = 'master' || (@request.auth.role = 'admin' && (${memberCompanyMatch} || empresa_id = '')))`
      approvalsCol.deleteRule = `@request.auth.id != '' && (@request.auth.role = 'master' || (@request.auth.role = 'admin' && (${memberCompanyMatch} || empresa_id = '')))`
      app.save(approvalsCol)
    }
  },
)

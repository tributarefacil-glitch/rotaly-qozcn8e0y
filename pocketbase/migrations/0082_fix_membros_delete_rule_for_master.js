/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration 0082: Permite que usuários com role 'master' ou 'admin' gerenciem
 * e excluam registros nas coleções `membros` e `colaboradores`.
 *
 * Anteriormente deleteRule exigia @request.auth.role = "admin" || @request.auth.role = "superadmin",
 * o que gerava 404/403 para o usuário Dono/Master (role 'master') ao tentar desvincular membros da Matriz ou filiais.
 */
migrate(
  (app) => {
    // 1. Atualizar deleteRule e updateRule de membros
    const membrosCol = app.findCollectionByNameOrId('membros')
    if (membrosCol) {
      membrosCol.listRule = '@request.auth.id != ""'
      membrosCol.viewRule = '@request.auth.id != ""'
      membrosCol.createRule = '@request.auth.id != ""'
      membrosCol.updateRule = '@request.auth.id != ""'
      membrosCol.deleteRule =
        '@request.auth.id != "" && (@request.auth.role = "master" || @request.auth.role = "admin" || @request.auth.role = "superadmin")'
      app.save(membrosCol)
      console.log('0082: Regras de membros atualizadas para master/admin/superadmin.')
    }

    // 2. Atualizar deleteRule de colaboradores
    const colabCol = app.findCollectionByNameOrId('colaboradores')
    if (colabCol) {
      colabCol.deleteRule =
        '@request.auth.id != "" && (@request.auth.role = "master" || @request.auth.role = "admin" || @request.auth.role = "superadmin")'
      app.save(colabCol)
      console.log('0082: Regras de colaboradores atualizadas para master/admin/superadmin.')
    }
  },
  (app) => {
    // Reversão
    try {
      const membrosCol = app.findCollectionByNameOrId('membros')
      if (membrosCol) {
        membrosCol.deleteRule =
          '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "superadmin")'
        app.save(membrosCol)
      }
    } catch (_) {}
  },
)

// Hook para Gestão Master de Empresas SaaS:
// 1. Exclusão de Empresa com integridade referencial e auditoria (somente papel 'master'):
//    - Protege permanentemente a Matriz Rotaly contra exclusão acidental (resolvida dinamicamente).
//    - Verifica histórico de pedidos: se houver pedidos ativos/entregues, alerta ou requer exclusão controlada.
//    - Desvincula membros e limpa vínculos de clientes e endereços base.
// 2. Bloqueio / Desbloqueio seguro de Empresa (somente papel 'master').

routerAdd(
  'POST',
  '/backend/v1/companies/{id}/toggle-status',
  (e) => {
    try {
      const authUser = e.auth
      if (!authUser) {
        return e.json(401, { message: 'Autenticação necessária.' })
      }

      const callerRole = authUser.getString('role')
      if (callerRole !== 'master') {
        return e.json(403, {
          message:
            'Apenas usuários com papel Master podem alterar o status de ativação da empresa.',
        })
      }

      const companyId = e.request.pathValue('id')
      if (!companyId) {
        return e.json(400, { message: 'ID de empresa não fornecido.' })
      }

      // Proteger a Matriz Rotaly de ser bloqueada (resolução dinâmica inline no callback)
      let matrizId = ''
      try {
        const oldest = $app.findRecordsByFilter('empresas', '', '+created', 1, 0)
        if (oldest && oldest.length > 0) {
          matrizId = oldest[0].id
        }
      } catch (_) {}
      if (!matrizId) {
        try {
          const byCnpj = $app.findFirstRecordByData('empresas', 'cnpj', '34.567.890/0001-22')
          if (byCnpj) matrizId = byCnpj.id
        } catch (_) {}
      }

      if (matrizId && companyId === matrizId) {
        return e.json(400, {
          message: 'A empresa Matriz Principal (Rotaly Operações) não pode ser desativada.',
        })
      }

      let company
      try {
        company = $app.findRecordById('empresas', companyId)
      } catch (findErr) {
        return e.json(404, { message: 'Empresa não encontrada.' })
      }

      const body = e.requestInfo().body || {}
      let targetStatus
      if (typeof body.ativa === 'boolean') {
        targetStatus = body.ativa
      } else {
        // Inverte o status atual
        targetStatus = !company.getBool('ativa')
      }

      company.set('ativa', targetStatus)
      $app.save(company)

      console.log(
        `[AUDITORIA_MASTER] Empresa id=${companyId} (${company.getString('nome_fantasia') || company.getString('nome_razao_social')}) ` +
          `status alterado para ativa=${targetStatus} por Master id=${authUser.id}`,
      )

      return e.json(200, {
        success: true,
        ativa: targetStatus,
        message: targetStatus
          ? 'Empresa desbloqueada e reativada com sucesso.'
          : 'Empresa bloqueada com sucesso. O acesso e operação dos membros foram suspensos.',
      })
    } catch (err) {
      console.log('Erro ao alternar status da empresa:', err)
      return e.json(500, {
        message: 'Erro interno ao alternar status da empresa: ' + (err.message || String(err)),
      })
    }
  },
  $apis.requireAuth(),
)

routerAdd(
  'POST',
  '/backend/v1/companies/{id}/delete-safe',
  (e) => {
    try {
      const authUser = e.auth
      if (!authUser) {
        return e.json(401, { message: 'Autenticação necessária.' })
      }

      const callerRole = authUser.getString('role')
      if (callerRole !== 'master') {
        return e.json(403, {
          message: 'Apenas usuários com papel Master têm autorização para excluir empresas.',
        })
      }

      const companyId = e.request.pathValue('id')
      if (!companyId) {
        return e.json(400, { message: 'ID da empresa não informado.' })
      }

      // Proteção inviolável da Matriz Rotaly (resolução dinâmica inline no callback)
      let matrizId = ''
      try {
        const oldest = $app.findRecordsByFilter('empresas', '', '+created', 1, 0)
        if (oldest && oldest.length > 0) {
          matrizId = oldest[0].id
        }
      } catch (_) {}
      if (!matrizId) {
        try {
          const byCnpj = $app.findFirstRecordByData('empresas', 'cnpj', '34.567.890/0001-22')
          if (byCnpj) matrizId = byCnpj.id
        } catch (_) {}
      }

      if (matrizId && companyId === matrizId) {
        return e.json(400, {
          message: 'A empresa Matriz Principal do Rotaly não pode ser excluída do sistema.',
        })
      }

      let company
      try {
        company = $app.findRecordById('empresas', companyId)
      } catch (findErr) {
        return e.json(404, { message: 'Empresa não encontrada.' })
      }

      const companyName =
        company.getString('nome_fantasia') || company.getString('nome_razao_social')

      // Verificar histórico de pedidos
      let ordersCount = 0
      try {
        const linkedOrders = $app.findRecordsByFilter(
          'orders',
          "empresa_id = '" + companyId + "'",
          '-created',
          10,
          0,
        )
        ordersCount = linkedOrders.length
      } catch (_) {}

      // Se houver pedidos vinculados, a exclusão física destruiria o histórico fiscal e operacional.
      // Nesse caso, orientamos soft-delete / bloqueio ou desvinculação protegida
      const body = e.requestInfo().body || {}
      const forceDeleteOrders = body.force_delete_orders === true

      if (ordersCount > 0 && !forceDeleteOrders) {
        return e.json(400, {
          hasOrders: true,
          message:
            'Esta empresa possui histórico de pedidos registrados no sistema. ' +
            'Para preservar os comprovantes de entrega e a auditoria financeira, recomendamos Bloquear a empresa em vez de excluí-la fisicamente.',
        })
      }

      // Executar exclusão e desvinculação em transação atômica
      let removedMembersCount = 0
      let updatedCustomersCount = 0

      $app.runInTransaction((txApp) => {
        // 1. Remover vínculos de membros da empresa
        try {
          const membrosList = txApp.findRecordsByFilter(
            'membros',
            "empresa_id = '" + companyId + "'",
            '-created',
            500,
            0,
          )
          for (let m = 0; m < membrosList.length; m++) {
            txApp.delete(membrosList[m])
            removedMembersCount++
          }
        } catch (mErr) {
          console.log('Aviso ao remover membros da empresa:', mErr)
        }

        // 2. Desvincular colaboradores se houver
        try {
          const colabs = txApp.findRecordsByFilter(
            'colaboradores',
            "empresa_id = '" + companyId + "'",
            '-created',
            500,
            0,
          )
          for (let c = 0; c < colabs.length; c++) {
            txApp.delete(colabs[c])
          }
        } catch (_) {}

        // 3. Desvincular base_addresses da empresa
        try {
          const bases = txApp.findRecordsByFilter(
            'base_addresses',
            "empresa_id = '" + companyId + "'",
            '-created',
            100,
            0,
          )
          for (let b = 0; b < bases.length; b++) {
            txApp.delete(bases[b])
          }
        } catch (_) {}

        // 4. Clientes vinculados: desvincular empresa_id (colocar null) para não apagar cadastros de clientes
        try {
          const customers = txApp.findRecordsByFilter(
            'customers',
            "empresa_id = '" + companyId + "'",
            '-created',
            500,
            0,
          )
          for (let cu = 0; cu < customers.length; cu++) {
            customers[cu].set('empresa_id', null)
            txApp.save(customers[cu])
            updatedCustomersCount++
          }
        } catch (_) {}

        // 5. Se forçar exclusão de pedidos residuais (somente pedidos de teste)
        if (ordersCount > 0 && forceDeleteOrders) {
          try {
            const allOrders = txApp.findRecordsByFilter(
              'orders',
              "empresa_id = '" + companyId + "'",
              '-created',
              500,
              0,
            )
            for (let o = 0; o < allOrders.length; o++) {
              txApp.delete(allOrders[o])
            }
          } catch (_) {}
        }

        // 6. Excluir a empresa
        txApp.delete(company)
      })

      console.log(
        `[AUDITORIA_MASTER] Empresa id=${companyId} (${companyName}) excluída pelo Master id=${authUser.id}. ` +
          `Membros desvinculados=${removedMembersCount}, clientes atualizados=${updatedCustomersCount}`,
      )

      return e.json(200, {
        success: true,
        message: `Empresa "${companyName}" excluída com sucesso.`,
        removedMembersCount,
        updatedCustomersCount,
      })
    } catch (err) {
      console.log('Erro ao excluir empresa:', err)
      return e.json(500, {
        message: 'Erro interno ao excluir empresa: ' + (err.message || String(err)),
      })
    }
  },
  $apis.requireAuth(),
)

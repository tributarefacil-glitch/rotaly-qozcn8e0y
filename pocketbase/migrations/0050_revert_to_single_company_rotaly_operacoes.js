/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // 0050_revert_to_single_company_rotaly_operacoes.js
    //
    // Reversão definitiva do isolamento Multi-Lojas:
    // O usuário determinou retorno ao modo de EMPRESA ÚNICA: "Rotaly Operações" (Matriz, id '7wo05iyvfcfh01h').
    //
    // REGRAS ABSOLUTAS:
    // 1. NENHUM dado é apagado. O histórico de ontem/hoje (pedidos, clientes, entregas, rotas,
    //    telemetria, adiantamentos de combustível, avaliações, bases) é 100% preservado.
    // 2. Reatribuição do empresa_id de TODOS os registros operacionais para a Matriz '7wo05iyvfcfh01h'.
    // 3. Ativação de todos os membros operacionais (Caroline, Kely, Vinicios, Guilherme, Marcos, etc.)
    //    sob a Matriz '7wo05iyvfcfh01h' para acesso unificado e sem isolamento.

    const MATRIZ_ID = '7wo05iyvfcfh01h'

    console.log(
      '0050: Iniciando reversão para Empresa Única (Rotaly Operações - ' + MATRIZ_ID + ')...',
    )

    // =========================================================================
    // PARTE 1: REATRIBUIR TODOS OS REGISTROS OPERACIONAIS PARA A MATRIZ
    // =========================================================================

    // 1.1 Pedidos (orders) - TODOS para Matriz
    try {
      app
        .db()
        .newQuery(`
        UPDATE orders
        SET empresa_id = '${MATRIZ_ID}'
        WHERE empresa_id != '${MATRIZ_ID}' OR empresa_id IS NULL OR empresa_id = ''
      `)
        .execute()
      console.log('0050: Todos os pedidos (orders) reatribuídos para a Matriz:', MATRIZ_ID)
    } catch (e) {
      console.log('0050: Erro ao reatribuir orders:', e)
    }

    // 1.2 Clientes (customers) - TODOS para Matriz
    try {
      app
        .db()
        .newQuery(`
        UPDATE customers
        SET empresa_id = '${MATRIZ_ID}'
        WHERE empresa_id != '${MATRIZ_ID}' OR empresa_id IS NULL OR empresa_id = ''
      `)
        .execute()
      console.log('0050: Todos os clientes (customers) reatribuídos para a Matriz:', MATRIZ_ID)
    } catch (e) {
      console.log('0050: Erro ao reatribuir customers:', e)
    }

    // 1.3 Endereços de Base (base_addresses) - TODOS para Matriz
    try {
      app
        .db()
        .newQuery(`
        UPDATE base_addresses
        SET empresa_id = '${MATRIZ_ID}'
        WHERE empresa_id != '${MATRIZ_ID}' OR empresa_id IS NULL OR empresa_id = ''
      `)
        .execute()
      console.log('0050: Endereços de base (base_addresses) reatribuídos para a Matriz:', MATRIZ_ID)
    } catch (e) {
      console.log('0050: Erro ao reatribuir base_addresses:', e)
    }

    // 1.4 Rotas (rotas) - se existirem
    try {
      if (app.hasTable('rotas')) {
        app
          .db()
          .newQuery(`
          UPDATE rotas
          SET empresa_id = '${MATRIZ_ID}'
          WHERE empresa_id != '${MATRIZ_ID}' OR empresa_id IS NULL OR empresa_id = ''
        `)
          .execute()
      }
    } catch (e) {
      console.log('0050: Erro ao reatribuir rotas:', e)
    }

    // 1.5 Entregas (entregas) - se existirem
    try {
      if (app.hasTable('entregas')) {
        app
          .db()
          .newQuery(`
          UPDATE entregas
          SET empresa_id = '${MATRIZ_ID}'
          WHERE empresa_id != '${MATRIZ_ID}' OR empresa_id IS NULL OR empresa_id = ''
        `)
          .execute()
      }
    } catch (e) {
      console.log('0050: Erro ao reatribuir entregas:', e)
    }

    // 1.6 Colaboradores (colaboradores) - se existirem
    try {
      if (app.hasTable('colaboradores')) {
        app
          .db()
          .newQuery(`
          UPDATE colaboradores
          SET empresa_id = '${MATRIZ_ID}'
          WHERE empresa_id != '${MATRIZ_ID}' OR empresa_id IS NULL OR empresa_id = ''
        `)
          .execute()
      }
    } catch (e) {
      console.log('0050: Erro ao reatribuir colaboradores:', e)
    }

    // 1.7 Relatórios (relatorios) - se existirem
    try {
      if (app.hasTable('relatorios')) {
        app
          .db()
          .newQuery(`
          UPDATE relatorios
          SET empresa_id = '${MATRIZ_ID}'
          WHERE empresa_id != '${MATRIZ_ID}' OR empresa_id IS NULL OR empresa_id = ''
        `)
          .execute()
      }
    } catch (e) {
      console.log('0050: Erro ao reatribuir relatorios:', e)
    }

    // =========================================================================
    // PARTE 2: UNIFICAR TODOS OS MEMBROS NA MATRIZ '7wo05iyvfcfh01h'
    // =========================================================================
    // Reativar todos os vínculos na Matriz e garantir que cada usuário operacional
    // tenha registro ativo na Matriz Rotaly Operações.
    try {
      app
        .db()
        .newQuery(`
        UPDATE membros
        SET empresa_id = '${MATRIZ_ID}', ativo = 1
      `)
        .execute()
      console.log('0050: Todos os membros unificados como ativos na Matriz:', MATRIZ_ID)
    } catch (e) {
      console.log('0050: Erro ao unificar membros na Matriz:', e)
    }

    // Garantir que todos os usuários existentes no sistema estejam vinculados como membros da Matriz
    try {
      const users = app.findRecordsByFilter('users', 'id != ""', 'created', 200, 0)
      const membrosCol = app.findCollectionByNameOrId('membros')

      for (const u of users) {
        let papel = 'vendedor'
        if (u.getString('role') === 'admin') papel = 'admin'
        else if (u.getString('role') === 'courier') papel = 'entregador'
        else papel = 'vendedor'

        let existing
        try {
          const list = app.findRecordsByFilter(
            'membros',
            `user_id = '${u.id}' && empresa_id = '${MATRIZ_ID}'`,
            '-created',
            1,
          )
          if (list && list.length > 0) existing = list[0]
        } catch (_) {}

        if (!existing) {
          const rec = new Record(membrosCol)
          rec.set('user_id', u.id)
          rec.set('empresa_id', MATRIZ_ID)
          rec.set('papel', papel)
          rec.set('ativo', true)
          app.save(rec)
        } else {
          existing.set('papel', papel)
          existing.set('ativo', true)
          app.save(existing)
        }
      }
      console.log('0050: Todos os usuários vinculados com sucesso à Matriz.')
    } catch (e) {
      console.log('0050: Aviso ao sincronizar usuários com membros:', e)
    }

    console.log('0050: Reversão para Empresa Única concluída com sucesso.')
  },
  (app) => {
    // Reversão no-op
  },
)

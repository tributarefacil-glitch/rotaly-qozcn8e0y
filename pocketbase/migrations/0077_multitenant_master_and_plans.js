/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // 0077_multitenant_master_and_plans.js
    //
    // Requisitos:
    // 1. users: Adicionar papel 'master' no select role (master | admin | seller | courier).
    // 2. empresas: Adicionar campos de plano e limites:
    //    - plano: select ('basico' | 'profissional' | 'enterprise')
    //    - max_users: number (limite de usuários/membros totais)
    //    - max_couriers: number (limite de entregadores)
    //    - max_orders_month: number (limite de pedidos por mês)
    // 3. Atualizar usuário dono (tributarefacil@gmail.com) para role 'master' e membro da Empresa 1 ('7wo05iyvfcfh01h').
    // 4. Garantir que a Empresa 1 (Rotaly Logística Matriz / Rotaly Operações) tenha plano 'enterprise' com limites generosos.
    // 5. Garantir backfill de empresa_id em todas as coleções operacionais para Empresa 1 ('7wo05iyvfcfh01h').

    const MATRIZ_ID = '7wo05iyvfcfh01h'

    console.log('0077: Iniciando migração multi-tenant SaaS Master...')

    // 1. Atualizar campo role em users para incluir 'master'
    try {
      const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')
      const roleField = usersCol.fields.getByName('role')
      if (roleField) {
        // Expandir valores do select
        const currentVals = roleField.values || []
        if (currentVals.indexOf('master') === -1) {
          roleField.values = ['master', 'admin', 'seller', 'courier']
          roleField.maxSelect = 1
          app.save(usersCol)
          console.log('0077: Campo role de users atualizado com valor master.')
        }
      }
    } catch (eRole) {
      console.log('0077: Aviso ao atualizar role em users:', eRole)
    }

    // 2. Atualizar coleção empresas para incluir plano e limites
    try {
      const empresasCol = app.findCollectionByNameOrId('empresas')

      if (!empresasCol.fields.getByName('plano')) {
        empresasCol.fields.add(
          new SelectField({
            name: 'plano',
            values: ['basico', 'profissional', 'enterprise'],
            maxSelect: 1,
            required: false,
          }),
        )
      }

      if (!empresasCol.fields.getByName('max_users')) {
        empresasCol.fields.add(
          new NumberField({
            name: 'max_users',
            required: false,
            min: 0,
          }),
        )
      }

      if (!empresasCol.fields.getByName('max_couriers')) {
        empresasCol.fields.add(
          new NumberField({
            name: 'max_couriers',
            required: false,
            min: 0,
          }),
        )
      }

      if (!empresasCol.fields.getByName('max_orders_month')) {
        empresasCol.fields.add(
          new NumberField({
            name: 'max_orders_month',
            required: false,
            min: 0,
          }),
        )
      }

      app.save(empresasCol)
      console.log('0077: Campos de plano e limites adicionados à coleção empresas.')
    } catch (eEmp) {
      console.log('0077: Aviso ao adicionar campos a empresas:', eEmp)
    }

    // 3. Atualizar Empresa 1 (Matriz) com plano enterprise e limites amplos
    try {
      app
        .db()
        .newQuery(`
        UPDATE empresas
        SET plano = 'enterprise',
            max_users = 9999,
            max_couriers = 9999,
            max_orders_month = 999999,
            ativa = 1
        WHERE id = '${MATRIZ_ID}'
      `)
        .execute()
      console.log('0077: Empresa 1 atualizada com plano enterprise.')
    } catch (eUpdEmp) {
      console.log('0077: Aviso ao atualizar Empresa 1:', eUpdEmp)
    }

    // Configurar valores padrão para outras empresas existentes se houver
    try {
      app
        .db()
        .newQuery(`
        UPDATE empresas
        SET plano = COALESCE(NULLIF(plano, ''), 'profissional'),
            max_users = COALESCE(NULLIF(max_users, 0), 10),
            max_couriers = COALESCE(NULLIF(max_couriers, 0), 15),
            max_orders_month = COALESCE(NULLIF(max_orders_month, 0), 2000),
            ativa = COALESCE(ativa, 1)
        WHERE id != '${MATRIZ_ID}'
      `)
        .execute()
    } catch (eOtherEmp) {
      console.log('0077: Aviso ao configurar outras empresas:', eOtherEmp)
    }

    // 4. Promover usuário dono (tributarefacil@gmail.com) para 'master'
    try {
      app
        .db()
        .newQuery(`
        UPDATE users
        SET role = 'master'
        WHERE email = 'tributarefacil@gmail.com'
      `)
        .execute()
      console.log('0077: Usuário tributarefacil@gmail.com promovido para master.')
    } catch (eUserMaster) {
      console.log('0077: Aviso ao promover tributarefacil para master:', eUserMaster)
    }

    // 5. Garantir backfill de empresa_id na Empresa 1 para todos os registros operacionais
    const tables = [
      'orders',
      'customers',
      'base_addresses',
      'rotas',
      'entregas',
      'colaboradores',
      'relatorios',
    ]
    for (const tbl of tables) {
      try {
        if (app.hasTable(tbl)) {
          app
            .db()
            .newQuery(`
            UPDATE ${tbl}
            SET empresa_id = '${MATRIZ_ID}'
            WHERE empresa_id IS NULL OR empresa_id = ''
          `)
            .execute()
        }
      } catch (eTbl) {
        console.log(`0077: Aviso no backfill de ${tbl}:`, eTbl)
      }
    }

    // 6. Atualizar regras de criação/atualização/leitura
    try {
      const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')
      usersCol.createRule =
        "@request.auth.role = 'master' || @request.auth.role = 'admin' || (@request.auth.role = 'seller' && role = 'courier')"
      usersCol.deleteRule = "@request.auth.role = 'master' || @request.auth.role = 'admin'"
      app.save(usersCol)
    } catch (eUsersRule) {
      console.log('0077: Aviso ao atualizar regras de users:', eUsersRule)
    }

    try {
      const empresasCol = app.findCollectionByNameOrId('empresas')
      // Master e admin autenticados podem listar e ver empresas; Master pode criar e deletar empresas
      empresasCol.listRule = "@request.auth.id != ''"
      empresasCol.viewRule = "@request.auth.id != ''"
      empresasCol.createRule = "@request.auth.role = 'master' || @request.auth.role = 'admin'"
      empresasCol.updateRule = "@request.auth.role = 'master' || @request.auth.role = 'admin'"
      empresasCol.deleteRule = "@request.auth.role = 'master'"
      app.save(empresasCol)
    } catch (eEmpRule) {
      console.log('0077: Aviso ao atualizar regras de empresas:', eEmpRule)
    }

    console.log('0077: Migração 0077 finalizada com sucesso.')
  },
  (app) => {
    // Down migration
  },
)

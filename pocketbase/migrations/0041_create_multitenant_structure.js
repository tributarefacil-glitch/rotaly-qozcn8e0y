migrate(
  (app) => {
    // 0041_create_multitenant_structure.js
    //
    // 1. Criação da coleção `empresas`
    // 2. Criação da coleção `membros` (relação users <-> empresas)
    // 3. Adicionar campo opcional `empresa_id` em orders, customers, base_addresses, app_settings, etc. (modo aditivo retrocompatível)
    // 4. Criação das coleções espelho solicitadas: `colaboradores`, `rotas`, `entregas`, `relatorios`
    // 5. Seed idempotente da "Empresa Principal" em `empresas`
    // 6. Vinculação automática de todos os usuários existentes em `membros` à Empresa Principal
    // 7. Backfill de empresa_id nas tabelas operacionais existentes (orders, customers, base_addresses)

    const usersColId = '_pb_users_auth_'

    // --- 1. Coleção EMPRESAS ---
    let empresasCol
    try {
      empresasCol = app.findCollectionByNameOrId('empresas')
    } catch (_) {
      empresasCol = new Collection({
        name: 'empresas',
        type: 'base',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.role = 'admin'",
        fields: [
          { name: 'nome_razao_social', type: 'text', required: true },
          { name: 'nome_fantasia', type: 'text', required: false },
          { name: 'cnpj', type: 'text', required: false },
          { name: 'logradouro', type: 'text', required: false },
          { name: 'numero', type: 'text', required: false },
          { name: 'complemento', type: 'text', required: false },
          { name: 'bairro', type: 'text', required: false },
          { name: 'cidade', type: 'text', required: false },
          { name: 'uf', type: 'text', required: false },
          { name: 'cep', type: 'text', required: false },
          { name: 'endereco_completo', type: 'text', required: false },
          { name: 'telefone', type: 'text', required: false },
          { name: 'email', type: 'text', required: false },
          { name: 'ativa', type: 'bool', required: false },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: [
          'CREATE INDEX idx_empresas_cnpj ON empresas (cnpj)',
          'CREATE INDEX idx_empresas_ativa ON empresas (ativa)',
        ],
      })
      app.save(empresasCol)
      console.log('0041: Coleção empresas criada.')
    }

    const empresasColId = empresasCol.id

    // --- 2. Coleção MEMBROS ---
    let membrosCol
    try {
      membrosCol = app.findCollectionByNameOrId('membros')
    } catch (_) {
      membrosCol = new Collection({
        name: 'membros',
        type: 'base',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.role = 'admin'",
        fields: [
          {
            name: 'empresa_id',
            type: 'relation',
            collectionId: empresasColId,
            maxSelect: 1,
            required: true,
            cascadeDelete: false,
          },
          {
            name: 'user_id',
            type: 'relation',
            collectionId: usersColId,
            maxSelect: 1,
            required: true,
            cascadeDelete: false,
          },
          {
            name: 'papel',
            type: 'select',
            values: ['admin', 'vendedor', 'entregador', 'gestor'],
            maxSelect: 1,
            required: false,
          },
          { name: 'ativo', type: 'bool', required: false },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: [
          'CREATE INDEX idx_membros_empresa_user ON membros (empresa_id, user_id)',
          'CREATE INDEX idx_membros_user ON membros (user_id)',
        ],
      })
      app.save(membrosCol)
      console.log('0041: Coleção membros criada.')
    }

    // --- 3. Adicionar campo aditivo empresa_id nas coleções existentes para total compatibilidade ---
    try {
      const ordersCol = app.findCollectionByNameOrId('orders')
      if (!ordersCol.fields.getByName('empresa_id')) {
        ordersCol.fields.add(
          new RelationField({
            name: 'empresa_id',
            collectionId: empresasColId,
            maxSelect: 1,
            required: false,
          }),
        )
        ordersCol.addIndex('idx_orders_empresa', false, 'empresa_id', '')
        app.save(ordersCol)
        console.log('0041: Campo empresa_id adicionado a orders.')
      }
    } catch (eOrd) {
      console.log('0041: Erro ao adicionar empresa_id a orders:', eOrd)
    }

    try {
      const customersCol = app.findCollectionByNameOrId('customers')
      if (!customersCol.fields.getByName('empresa_id')) {
        customersCol.fields.add(
          new RelationField({
            name: 'empresa_id',
            collectionId: empresasColId,
            maxSelect: 1,
            required: false,
          }),
        )
        customersCol.addIndex('idx_customers_empresa', false, 'empresa_id', '')
        app.save(customersCol)
        console.log('0041: Campo empresa_id adicionado a customers.')
      }
    } catch (eCust) {
      console.log('0041: Erro ao adicionar empresa_id a customers:', eCust)
    }

    try {
      const baseAddressesCol = app.findCollectionByNameOrId('base_addresses')
      if (!baseAddressesCol.fields.getByName('empresa_id')) {
        baseAddressesCol.fields.add(
          new RelationField({
            name: 'empresa_id',
            collectionId: empresasColId,
            maxSelect: 1,
            required: false,
          }),
        )
        baseAddressesCol.addIndex('idx_base_addresses_empresa', false, 'empresa_id', '')
        app.save(baseAddressesCol)
        console.log('0041: Campo empresa_id adicionado a base_addresses.')
      }
    } catch (eBase) {
      console.log('0041: Erro ao adicionar empresa_id a base_addresses:', eBase)
    }

    // --- 4. Coleções adicionais multi-tenant solicitadas: colaboradores, rotas, entregas, relatorios ---

    // 4.1 colaboradores
    let colaboradoresCol
    try {
      colaboradoresCol = app.findCollectionByNameOrId('colaboradores')
    } catch (_) {
      colaboradoresCol = new Collection({
        name: 'colaboradores',
        type: 'base',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.role = 'admin'",
        fields: [
          {
            name: 'empresa_id',
            type: 'relation',
            collectionId: empresasColId,
            maxSelect: 1,
            required: true,
          },
          {
            name: 'user_id',
            type: 'relation',
            collectionId: usersColId,
            maxSelect: 1,
            required: false,
          },
          { name: 'nome', type: 'text', required: true },
          { name: 'email', type: 'text', required: false },
          { name: 'telefone', type: 'text', required: false },
          { name: 'cpf', type: 'text', required: false },
          {
            name: 'cargo',
            type: 'select',
            values: ['entregador', 'vendedor', 'gerente', 'motorista', 'administrativo'],
            maxSelect: 1,
            required: false,
          },
          {
            name: 'tipo_veiculo',
            type: 'select',
            values: ['moto', 'carro', 'van', 'caminhao', 'bicicleta'],
            maxSelect: 1,
            required: false,
          },
          { name: 'placa_veiculo', type: 'text', required: false },
          { name: 'ativo', type: 'bool', required: false },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: [
          'CREATE INDEX idx_colaboradores_empresa ON colaboradores (empresa_id)',
          'CREATE INDEX idx_colaboradores_user ON colaboradores (user_id)',
        ],
      })
      app.save(colaboradoresCol)
      console.log('0041: Coleção colaboradores criada.')
    }

    // 4.2 rotas
    let rotasCol
    try {
      rotasCol = app.findCollectionByNameOrId('rotas')
    } catch (_) {
      rotasCol = new Collection({
        name: 'rotas',
        type: 'base',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.role = 'admin'",
        fields: [
          {
            name: 'empresa_id',
            type: 'relation',
            collectionId: empresasColId,
            maxSelect: 1,
            required: true,
          },
          {
            name: 'courier_id',
            type: 'relation',
            collectionId: usersColId,
            maxSelect: 1,
            required: false,
          },
          { name: 'codigo_rota', type: 'text', required: false },
          {
            name: 'status',
            type: 'select',
            values: ['planejada', 'em_andamento', 'concluida', 'cancelada'],
            maxSelect: 1,
            required: false,
          },
          { name: 'data_inicio', type: 'date', required: false },
          { name: 'data_fim', type: 'date', required: false },
          { name: 'distancia_km', type: 'number', required: false },
          { name: 'tempo_estimado_minutos', type: 'number', required: false },
          { name: 'custo_combustivel', type: 'number', required: false },
          { name: 'dados_planejamento', type: 'json', required: false },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: [
          'CREATE INDEX idx_rotas_empresa ON rotas (empresa_id)',
          'CREATE INDEX idx_rotas_courier ON rotas (courier_id)',
        ],
      })
      app.save(rotasCol)
      console.log('0041: Coleção rotas criada.')
    }

    // 4.3 entregas
    let entregasCol
    try {
      entregasCol = app.findCollectionByNameOrId('entregas')
    } catch (_) {
      entregasCol = new Collection({
        name: 'entregas',
        type: 'base',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.role = 'admin'",
        fields: [
          {
            name: 'empresa_id',
            type: 'relation',
            collectionId: empresasColId,
            maxSelect: 1,
            required: true,
          },
          { name: 'codigo_rastreio', type: 'text', required: true },
          {
            name: 'order_id',
            type: 'relation',
            collectionId: app.findCollectionByNameOrId('orders').id,
            maxSelect: 1,
            required: false,
          },
          {
            name: 'courier_id',
            type: 'relation',
            collectionId: usersColId,
            maxSelect: 1,
            required: false,
          },
          { name: 'destinatario_nome', type: 'text', required: false },
          { name: 'destinatario_endereco', type: 'text', required: false },
          {
            name: 'status',
            type: 'select',
            values: [
              'pendente',
              'em_transito',
              'entregue',
              'erro_endereco',
              'ausente',
              'cancelada',
            ],
            maxSelect: 1,
            required: false,
          },
          { name: 'valor_total', type: 'number', required: false },
          { name: 'data_entrega', type: 'date', required: false },
          { name: 'comprovante_foto', type: 'file', maxSelect: 1, maxSize: 5242880 },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: [
          'CREATE INDEX idx_entregas_empresa ON entregas (empresa_id)',
          'CREATE INDEX idx_entregas_codigo ON entregas (codigo_rastreio)',
        ],
      })
      app.save(entregasCol)
      console.log('0041: Coleção entregas criada.')
    }

    // 4.4 relatorios
    let relatoriosCol
    try {
      relatoriosCol = app.findCollectionByNameOrId('relatorios')
    } catch (_) {
      relatoriosCol = new Collection({
        name: 'relatorios',
        type: 'base',
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: "@request.auth.id != ''",
        updateRule: "@request.auth.id != ''",
        deleteRule: "@request.auth.role = 'admin'",
        fields: [
          {
            name: 'empresa_id',
            type: 'relation',
            collectionId: empresasColId,
            maxSelect: 1,
            required: true,
          },
          { name: 'titulo', type: 'text', required: true },
          {
            name: 'tipo',
            type: 'select',
            values: ['combustivel', 'entregas', 'desvios', 'financeiro', 'geral'],
            maxSelect: 1,
            required: false,
          },
          { name: 'periodo_inicio', type: 'date', required: false },
          { name: 'periodo_fim', type: 'date', required: false },
          { name: 'resumo', type: 'json', required: false },
          {
            name: 'gerado_por',
            type: 'relation',
            collectionId: usersColId,
            maxSelect: 1,
            required: false,
          },
          { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: ['CREATE INDEX idx_relatorios_empresa ON relatorios (empresa_id)'],
      })
      app.save(relatoriosCol)
      console.log('0041: Coleção relatorios criada.')
    }

    // --- 5. Seed da Empresa Principal ---
    let principalEmpresa
    try {
      principalEmpresa = app.findFirstRecordByData(
        'empresas',
        'nome_razao_social',
        'Rotaly Logística Matriz',
      )
    } catch (_) {
      principalEmpresa = new Record(empresasCol)
      principalEmpresa.set('nome_razao_social', 'Rotaly Logística Matriz')
      principalEmpresa.set('nome_fantasia', 'Rotaly Operações')
      principalEmpresa.set('cnpj', '34.567.890/0001-22')
      principalEmpresa.set('logradouro', 'Rua Manuel Vieira')
      principalEmpresa.set('numero', '196')
      principalEmpresa.set('complemento', 'Galpão')
      principalEmpresa.set('bairro', 'Centro')
      principalEmpresa.set('cidade', 'Duque de Caxias')
      principalEmpresa.set('uf', 'RJ')
      principalEmpresa.set('cep', '25020-210')
      principalEmpresa.set(
        'endereco_completo',
        'Rua Manuel Vieira, 196 - Centro, Duque de Caxias - RJ, 25020-210',
      )
      principalEmpresa.set('telefone', '(21) 96428-2954')
      principalEmpresa.set('email', 'tributarefacil@gmail.com')
      principalEmpresa.set('ativa', true)
      app.save(principalEmpresa)
      console.log('0041: Empresa Principal cadastrada com ID:', principalEmpresa.id)
    }

    const principalEmpresaId = principalEmpresa.id

    // --- 6. Vincular todos os usuários existentes à Empresa Principal em membros ---
    try {
      const allUsers = app.findRecordsByFilter('users', 'id != ""', 'created', 500, 0)
      for (let u = 0; u < allUsers.length; u++) {
        const usr = allUsers[u]
        const uId = usr.id
        const uRole = usr.getString('role') || 'seller'
        const papelMembro =
          uRole === 'admin' ? 'admin' : uRole === 'courier' ? 'entregador' : 'vendedor'

        let existingMember = null
        try {
          const membersFound = app.findRecordsByFilter(
            'membros',
            `user_id = '${uId}' && empresa_id = '${principalEmpresaId}'`,
            'created',
            1,
            0,
          )
          if (membersFound && membersFound.length > 0) {
            existingMember = membersFound[0]
          }
        } catch (_) {}

        if (!existingMember) {
          const mRec = new Record(membrosCol)
          mRec.set('empresa_id', principalEmpresaId)
          mRec.set('user_id', uId)
          mRec.set('papel', papelMembro)
          mRec.set('ativo', true)
          app.save(mRec)
          console.log(
            `0041: Usuário ${usr.getString('name') || usr.getString('email')} (${uId}) vinculado como ${papelMembro} na Empresa Principal.`,
          )
        }

        // Criar também registro correspondente em colaboradores se for courier ou seller
        try {
          const colabsFound = app.findRecordsByFilter(
            'colaboradores',
            `user_id = '${uId}' && empresa_id = '${principalEmpresaId}'`,
            'created',
            1,
            0,
          )
          if (!colabsFound || colabsFound.length === 0) {
            const cRec = new Record(colaboradoresCol)
            cRec.set('empresa_id', principalEmpresaId)
            cRec.set('user_id', uId)
            cRec.set('nome', usr.getString('name') || 'Colaborador')
            cRec.set('email', usr.getString('email') || '')
            cRec.set('telefone', usr.getString('phone') || '')
            cRec.set('cpf', usr.getString('document') || '')
            cRec.set(
              'cargo',
              uRole === 'courier'
                ? 'entregador'
                : uRole === 'seller'
                  ? 'vendedor'
                  : 'administrativo',
            )
            cRec.set('tipo_veiculo', usr.getString('vehicle_type') || '')
            cRec.set('placa_veiculo', usr.getString('vehicle_plate') || '')
            cRec.set('ativo', usr.getString('status') !== 'inactive')
            app.save(cRec)
          }
        } catch (eColab) {
          console.log('0041: Aviso ao vincular colaborador:', eColab)
        }
      }
    } catch (eUsersLink) {
      console.log('0041: Erro ao vincular usuários à Empresa Principal:', eUsersLink)
    }

    // --- 7. Backfill de empresa_id nas tabelas operacionais existentes ---
    try {
      app
        .db()
        .newQuery(
          `UPDATE orders SET empresa_id = '${principalEmpresaId}' WHERE empresa_id IS NULL OR empresa_id = ''`,
        )
        .execute()
      console.log('0041: Backfill empresa_id aplicado em orders.')
    } catch (eBfOrders) {
      console.log('0041: Aviso backfill orders:', eBfOrders)
    }

    try {
      app
        .db()
        .newQuery(
          `UPDATE customers SET empresa_id = '${principalEmpresaId}' WHERE empresa_id IS NULL OR empresa_id = ''`,
        )
        .execute()
      console.log('0041: Backfill empresa_id aplicado em customers.')
    } catch (eBfCust) {
      console.log('0041: Aviso backfill customers:', eBfCust)
    }

    try {
      app
        .db()
        .newQuery(
          `UPDATE base_addresses SET empresa_id = '${principalEmpresaId}' WHERE empresa_id IS NULL OR empresa_id = ''`,
        )
        .execute()
      console.log('0041: Backfill empresa_id aplicado em base_addresses.')
    } catch (eBfBase) {
      console.log('0041: Aviso backfill base_addresses:', eBfBase)
    }

    console.log('0041: Migração multi-tenant concluída com sucesso.')
  },
  (app) => {
    // Reversão limpa
    try {
      app.delete(app.findCollectionByNameOrId('relatorios'))
    } catch (_) {}
    try {
      app.delete(app.findCollectionByNameOrId('entregas'))
    } catch (_) {}
    try {
      app.delete(app.findCollectionByNameOrId('rotas'))
    } catch (_) {}
    try {
      app.delete(app.findCollectionByNameOrId('colaboradores'))
    } catch (_) {}
    try {
      app.delete(app.findCollectionByNameOrId('membros'))
    } catch (_) {}
    try {
      app.delete(app.findCollectionByNameOrId('empresas'))
    } catch (_) {}
  },
)

/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // -------------------------------------------------------------------------
    // 1. CRIAR COLEÇÃO route_km_approvals PARA AUDITORIA E APROVAÇÃO DE KM
    // -------------------------------------------------------------------------
    let existing = null
    try {
      existing = app.findCollectionByNameOrId('route_km_approvals')
    } catch (_) {}

    if (!existing) {
      let ordersCol = null
      let usersCol = null
      let empresasCol = null
      try {
        ordersCol = app.findCollectionByNameOrId('orders')
      } catch (_) {}
      try {
        usersCol = app.findCollectionByNameOrId('_pb_users_auth_')
      } catch (_) {}
      try {
        empresasCol = app.findCollectionByNameOrId('empresas')
      } catch (_) {}

      // Regras de RLS multiempresa alinhadas à migração 0100:
      const memberCompanyMatch =
        '(@collection.membros.user_id ?= @request.auth.id && @collection.membros.empresa_id ?= empresa_id && @collection.membros.ativo ?= true)'
      const isMasterOrMember = `@request.auth.id != '' && (@request.auth.role = 'master' || ${memberCompanyMatch} || empresa_id = '')`
      const isMasterOrAdminInCompany = `@request.auth.id != '' && (@request.auth.role = 'master' || (@request.auth.role = 'admin' && (${memberCompanyMatch} || empresa_id = '')))`

      const collection = new Collection({
        name: 'route_km_approvals',
        type: 'base',
        listRule: isMasterOrMember,
        viewRule: isMasterOrMember,
        createRule: isMasterOrAdminInCompany,
        updateRule: isMasterOrAdminInCompany,
        deleteRule: isMasterOrAdminInCompany,
        fields: [
          {
            name: 'order_id',
            type: 'relation',
            required: true,
            collectionId: ordersCol ? ordersCol.id : 'orders',
            cascadeDelete: true,
            maxSelect: 1,
          },
          {
            name: 'courier_id',
            type: 'relation',
            required: true,
            collectionId: usersCol ? usersCol.id : '_pb_users_auth_',
            cascadeDelete: false,
            maxSelect: 1,
          },
          {
            name: 'empresa_id',
            type: 'relation',
            required: false,
            collectionId: empresasCol ? empresasCol.id : 'empresas',
            cascadeDelete: false,
            maxSelect: 1,
          },
          {
            name: 'route_batch_key',
            type: 'text',
            required: false,
          },
          {
            name: 'original_road_km',
            type: 'number',
            required: true,
          },
          {
            name: 'original_gps_km',
            type: 'number',
            required: false,
          },
          {
            name: 'approved_km',
            type: 'number',
            required: true,
          },
          {
            name: 'status',
            type: 'select',
            required: true,
            values: ['approved', 'rejected'],
            maxSelect: 1,
          },
          {
            name: 'justification',
            type: 'text',
            required: false,
          },
          {
            name: 'approved_by',
            type: 'relation',
            required: true,
            collectionId: usersCol ? usersCol.id : '_pb_users_auth_',
            cascadeDelete: false,
            maxSelect: 1,
          },
          {
            name: 'approved_at',
            type: 'date',
            required: true,
          },
          {
            name: 'created',
            type: 'autodate',
            onCreate: true,
            onUpdate: false,
          },
          {
            name: 'updated',
            type: 'autodate',
            onCreate: true,
            onUpdate: true,
          },
        ],
        indexes: [
          'CREATE INDEX idx_route_km_approvals_order ON route_km_approvals (order_id)',
          'CREATE INDEX idx_route_km_approvals_courier ON route_km_approvals (courier_id)',
          'CREATE INDEX idx_route_km_approvals_empresa ON route_km_approvals (empresa_id)',
          'CREATE INDEX idx_route_km_approvals_batch ON route_km_approvals (route_batch_key)',
        ],
      })

      app.save(collection)
      console.log('[0101] Coleção route_km_approvals criada com sucesso.')
    }

    // -------------------------------------------------------------------------
    // 2. AJUSTE DOS LOTES 3 E 4 DO VINICIOS LUNZ (01/10/2026)
    // -------------------------------------------------------------------------
    // Caso real que motivou tudo:
    // Lote 3 (14:20:36): Pedido 0ttrohyrvxum69b (José Antônio, Rua Manoel Vieira 296, Caxias)
    // - 1 única entrega viária (~1,7 km da base), mas total_route_with_return_km estava inflado em 8,3 km.
    // - Recálculo viário oficial da parada visitada: ida 1.7 km + retorno 1.7 km = 3.4 km.
    //
    // Lote 4 (14:55:02): Pedido pk945we9lcwavfl (Ana Silva, Rua Conde de Porto Alegre 119)
    // - 1 única entrega viária (~0,2 km da base), mas total_route_with_return_km estava inflado em 10,0 km.
    // - Recálculo viário oficial da parada visitada: ida 0.8 km + retorno 0.8 km = 1.6 km.
    try {
      const records3 = app.findRecordsByFilter('orders', "id = '0ttrohyrvxum69b'", '', 1, 0)
      if (records3 && records3.length > 0) {
        const order3 = records3[0]
        const oldTotal = order3.getFloat('total_route_with_return_km')
        console.log(
          `[0101] Ajustando Lote 3 do Vinicios (0ttrohyrvxum69b): km anterior = ${oldTotal}`,
        )
        order3.set('distance_km', 1.7)
        order3.set('return_trip_km', 1.7)
        order3.set('total_route_with_return_km', 3.4)
        // Consumo para moto (35 km/l a R$ 6.49) -> 3.4 / 35 * 6.49 = R$ 0.63
        const fuel = Number(((3.4 / 35.0) * 6.49).toFixed(2))
        order3.set('fuel_cost', fuel)
        order3.set('total_route_fuel_cost', fuel)
        app.save(order3)
        console.log(`[0101] Lote 3 corrigido para 3.4 km viários e R$ ${fuel} de combustível.`)
      }
    } catch (err3) {
      console.log('[0101] Erro ao buscar/ajustar order 0ttrohyrvxum69b:', err3)
    }

    try {
      const records4 = app.findRecordsByFilter('orders', "id = 'pk945we9lcwavfl'", '', 1, 0)
      if (records4 && records4.length > 0) {
        const order4 = records4[0]
        const oldTotal = order4.getFloat('total_route_with_return_km')
        console.log(
          `[0101] Ajustando Lote 4 do Vinicios (pk945we9lcwavfl): km anterior = ${oldTotal}`,
        )
        order4.set('distance_km', 0.8)
        order4.set('return_trip_km', 0.8)
        order4.set('total_route_with_return_km', 1.6)
        // Consumo para moto (35 km/l a R$ 6.49) -> 1.6 / 35 * 6.49 = R$ 0.30
        const fuel = Number(((1.6 / 35.0) * 6.49).toFixed(2))
        order4.set('fuel_cost', fuel)
        order4.set('total_route_fuel_cost', fuel)
        app.save(order4)
        console.log(`[0101] Lote 4 corrigido para 1.6 km viários e R$ ${fuel} de combustível.`)
      }
    } catch (err4) {
      console.log('[0101] Erro ao buscar/ajustar order pk945we9lcwavfl:', err4)
    }
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('route_km_approvals')
      if (col) {
        app.delete(col)
        console.log('[0101] Coleção route_km_approvals removida.')
      }
    } catch (_) {}
  },
)

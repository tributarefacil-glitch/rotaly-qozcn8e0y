/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // -------------------------------------------------------------------------
    // 1. ADICIONAR CAMPOS DE REDIRECIONAMENTO NA COLEÇÃO orders
    // -------------------------------------------------------------------------
    const ordersCol = app.findCollectionByNameOrId('orders')
    if (ordersCol) {
      // redirection_status: 'none' | 'initiated' | 'completed'
      if (!ordersCol.fields.getByName('redirection_status')) {
        ordersCol.fields.add(
          new SelectField({
            name: 'redirection_status',
            required: false,
            values: ['none', 'initiated', 'completed'],
            maxSelect: 1,
          }),
        )
      }

      // is_redirected: bool flag indicando entrega redirecionada
      if (!ordersCol.fields.getByName('is_redirected')) {
        ordersCol.fields.add(
          new BoolField({
            name: 'is_redirected',
            required: false,
          }),
        )
      }

      // Coordenadas e dados do Ponto A (onde o entregador chegou no endereço original)
      if (!ordersCol.fields.getByName('redirection_point_a_lat')) {
        ordersCol.fields.add(new NumberField({ name: 'redirection_point_a_lat', required: false }))
      }
      if (!ordersCol.fields.getByName('redirection_point_a_lng')) {
        ordersCol.fields.add(new NumberField({ name: 'redirection_point_a_lng', required: false }))
      }
      if (!ordersCol.fields.getByName('redirection_point_a_at')) {
        ordersCol.fields.add(new DateField({ name: 'redirection_point_a_at', required: false }))
      }

      // Coordenadas e dados do Ponto B (onde o cliente realmente estava e a entrega foi feita)
      if (!ordersCol.fields.getByName('redirection_point_b_lat')) {
        ordersCol.fields.add(new NumberField({ name: 'redirection_point_b_lat', required: false }))
      }
      if (!ordersCol.fields.getByName('redirection_point_b_lng')) {
        ordersCol.fields.add(new NumberField({ name: 'redirection_point_b_lng', required: false }))
      }
      if (!ordersCol.fields.getByName('redirection_point_b_at')) {
        ordersCol.fields.add(new DateField({ name: 'redirection_point_b_at', required: false }))
      }

      // Novo endereço informado pelo entregador / cliente
      if (!ordersCol.fields.getByName('redirection_new_address')) {
        ordersCol.fields.add(new TextField({ name: 'redirection_new_address', required: false }))
      }

      // KM extra calculado entre Ponto A e Ponto B
      if (!ordersCol.fields.getByName('redirection_extra_km')) {
        ordersCol.fields.add(new NumberField({ name: 'redirection_extra_km', required: false }))
      }

      // Flag se o cadastro oficial do cliente foi atualizado com o novo endereço
      if (!ordersCol.fields.getByName('customer_address_updated')) {
        ordersCol.fields.add(new BoolField({ name: 'customer_address_updated', required: false }))
      }

      app.save(ordersCol)
      console.log('[0102] Campos de redirecionamento adicionados em orders com sucesso.')
    }

    // -------------------------------------------------------------------------
    // 2. ATUALIZAR route_km_approvals PARA SUPORTAR PENDING E CAMPOS DE REDIREÇÃO
    // -------------------------------------------------------------------------
    const approvalsCol = app.findCollectionByNameOrId('route_km_approvals')
    if (approvalsCol) {
      // Atualizar status select values para incluir 'pending'
      const statusField = approvalsCol.fields.getByName('status')
      if (statusField) {
        // goja: statusField.values = ['approved', 'rejected', 'pending']
        statusField.values = ['approved', 'rejected', 'pending']
      }

      // approval_type: 'manual_deviation' | 'redirection_auto' | 'redirection_manual'
      if (!approvalsCol.fields.getByName('approval_type')) {
        approvalsCol.fields.add(
          new SelectField({
            name: 'approval_type',
            required: false,
            values: ['manual_deviation', 'redirection_auto', 'redirection_manual'],
            maxSelect: 1,
          }),
        )
      }

      // extra_km
      if (!approvalsCol.fields.getByName('extra_km')) {
        approvalsCol.fields.add(new NumberField({ name: 'extra_km', required: false }))
      }

      // point_a_lat, point_a_lng, point_b_lat, point_b_lng
      if (!approvalsCol.fields.getByName('point_a_lat')) {
        approvalsCol.fields.add(new NumberField({ name: 'point_a_lat', required: false }))
      }
      if (!approvalsCol.fields.getByName('point_a_lng')) {
        approvalsCol.fields.add(new NumberField({ name: 'point_a_lng', required: false }))
      }
      if (!approvalsCol.fields.getByName('point_b_lat')) {
        approvalsCol.fields.add(new NumberField({ name: 'point_b_lat', required: false }))
      }
      if (!approvalsCol.fields.getByName('point_b_lng')) {
        approvalsCol.fields.add(new NumberField({ name: 'point_b_lng', required: false }))
      }

      // new_address
      if (!approvalsCol.fields.getByName('new_address')) {
        approvalsCol.fields.add(new TextField({ name: 'new_address', required: false }))
      }

      // calculation_method: 'telemetry_gps' | 'haversine_road_factor'
      if (!approvalsCol.fields.getByName('calculation_method')) {
        approvalsCol.fields.add(new TextField({ name: 'calculation_method', required: false }))
      }

      // Permitir entregadores autenticados criarem aprovações de redirecionamento (para aprovação automática ou pendente)
      // Ajustar createRule para permitir entregador do pedido ou admin/master
      const memberCompanyMatch =
        '(@collection.membros.user_id ?= @request.auth.id && @collection.membros.empresa_id ?= empresa_id && @collection.membros.ativo ?= true)'
      const allowCreate = `@request.auth.id != '' && (@request.auth.role = 'master' || (@request.auth.role = 'admin' && (${memberCompanyMatch} || empresa_id = '')) || (@request.auth.role = 'courier' && courier_id = @request.auth.id))`
      approvalsCol.createRule = allowCreate

      app.save(approvalsCol)
      console.log('[0102] Campos e regras de route_km_approvals atualizados com sucesso.')
    }
  },
  (app) => {
    // Reverter campos
    try {
      const ordersCol = app.findCollectionByNameOrId('orders')
      if (ordersCol) {
        const fieldsToRemove = [
          'redirection_status',
          'is_redirected',
          'redirection_point_a_lat',
          'redirection_point_a_lng',
          'redirection_point_a_at',
          'redirection_point_b_lat',
          'redirection_point_b_lng',
          'redirection_point_b_at',
          'redirection_new_address',
          'redirection_extra_km',
          'customer_address_updated',
        ]
        fieldsToRemove.forEach((f) => {
          try {
            ordersCol.fields.removeByName(f)
          } catch (_) {}
        })
        app.save(ordersCol)
      }
    } catch (_) {}
  },
)

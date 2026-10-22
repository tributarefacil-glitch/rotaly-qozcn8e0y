/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // -------------------------------------------------------------------------
    // 1. CRIAR COLEÇÃO courier_period_manual_adjustments
    // -------------------------------------------------------------------------
    let existing = null
    try {
      existing = app.findCollectionByNameOrId('courier_period_manual_adjustments')
    } catch (_) {}

    let usersCol = null
    try {
      usersCol = app.findCollectionByNameOrId('_pb_users_auth_')
    } catch (_) {}

    if (!existing) {
      const isMasterOrMember = `@request.auth.id != ''`
      const isMasterOrAdmin = `@request.auth.id != '' && (@request.auth.role = 'master' || @request.auth.role = 'admin')`

      const collection = new Collection({
        name: 'courier_period_manual_adjustments',
        type: 'base',
        listRule: isMasterOrMember,
        viewRule: isMasterOrMember,
        createRule: isMasterOrAdmin,
        updateRule: isMasterOrAdmin,
        deleteRule: isMasterOrAdmin,
        fields: [
          {
            name: 'courier_id',
            type: 'relation',
            required: true,
            collectionId: usersCol ? usersCol.id : '_pb_users_auth_',
            cascadeDelete: false,
            maxSelect: 1,
          },
          {
            name: 'periodo_inicio',
            type: 'text',
            required: true,
          },
          {
            name: 'periodo_fim',
            type: 'text',
            required: true,
          },
          {
            name: 'km_manual',
            type: 'number',
            required: true,
          },
          {
            name: 'fuel_cost',
            type: 'number',
            required: false,
          },
          {
            name: 'origem',
            type: 'text',
            required: true,
          },
          {
            name: 'status',
            type: 'select',
            required: true,
            values: ['active', 'inactive'],
            maxSelect: 1,
          },
          {
            name: 'justificativa',
            type: 'text',
            required: false,
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
          'CREATE INDEX idx_manual_adj_courier ON courier_period_manual_adjustments (courier_id)',
          'CREATE INDEX idx_manual_adj_dates ON courier_period_manual_adjustments (periodo_inicio, periodo_fim)',
        ],
      })

      app.save(collection)
      console.log('[0187] Coleção courier_period_manual_adjustments criada.')
    }

    // -------------------------------------------------------------------------
    // 2. INSERIR AJUSTE MANUAL DO ENTREGADOR EDSON (01/10/2026 - 22/10/2026)
    // -------------------------------------------------------------------------
    const edsonId = 'tetrfu5oi19jbwz'
    const adjCol = app.findCollectionByNameOrId('courier_period_manual_adjustments')
    const existingAdj = app.findRecordsByFilter(
      'courier_period_manual_adjustments',
      `courier_id = '${edsonId}' && periodo_inicio = '2026-10-01' && periodo_fim = '2026-10-22'`,
      '',
      1,
      0,
    )

    let createdRecordId = ''
    if (!existingAdj || existingAdj.length === 0) {
      const record = new Record(adjCol)
      record.set('courier_id', edsonId)
      record.set('periodo_inicio', '2026-10-01')
      record.set('periodo_fim', '2026-10-22')
      record.set('km_manual', 731.0)
      record.set('fuel_cost', 158.14)
      record.set('origem', 'ajuste_manual_admin')
      record.set('status', 'active')
      record.set(
        'justificativa',
        'Ajuste manual de km do mês do entregador Edson 01/10/2026 até 22/10/2026 (731 km, gasto R$ 158,14)',
      )
      app.save(record)
      createdRecordId = record.id
      console.log(
        `[0187] Registro de ajuste manual inserido com sucesso para Edson (id=${record.id}).`,
      )
    } else {
      createdRecordId = existingAdj[0].id
    }

    // -------------------------------------------------------------------------
    // 3. REGISTRAR EM audit_trail CONFORME CONVENÇÃO MANUAL
    // user_id vazio, actor_name admin, metadata.system_trigger = false
    // -------------------------------------------------------------------------
    try {
      const auditCol = app.findCollectionByNameOrId('audit_trail')
      if (auditCol) {
        const auditRec = new Record(auditCol)
        auditRec.set('collection', 'courier_period_manual_adjustments')
        auditRec.set('record_id', createdRecordId || 'adj_edson_202610')
        auditRec.set('action', 'ajuste_manual_admin_km')
        auditRec.set('field', 'km_manual')
        auditRec.set('old_value', '445.9')
        auditRec.set('new_value', '731.0')
        auditRec.set('courier_id', edsonId)
        auditRec.set('timestamp', new Date().toISOString())
        auditRec.set('metadata', {
          actor_name: 'Administrador (Manual Admin)',
          system_trigger: false,
          origin: 'ajuste_manual_admin',
          periodo_inicio: '2026-10-01',
          periodo_fim: '2026-10-22',
          km_manual: 731.0,
          fuel_cost: 158.14,
          reason:
            'Ajuste manual de km do mês do entregador Edson 01/10/2026 até 22/10/2026 (731 km, R$ 158,14)',
        })
        app.save(auditRec)
        console.log('[0187] Registro de audit_trail gravado para ação manual de admin.')
      }
    } catch (auditErr) {
      console.log('[0187] Aviso ao gravar audit_trail:', auditErr)
    }
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('courier_period_manual_adjustments')
      if (col) app.delete(col)
    } catch (_) {}
  },
)

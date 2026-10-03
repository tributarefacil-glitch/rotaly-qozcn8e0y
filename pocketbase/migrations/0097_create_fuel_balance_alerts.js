/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration 0097: Criação da coleção fuel_balance_alerts
 *
 * Registra o histórico de alertas de saldo de combustível enviados aos administradores
 * para controle de auditoria e para garantir a regra de negócio de no máximo um alerta
 * por entregador por dia (evitando spam de e-mails repetidos no mesmo dia).
 */
migrate(
  (app) => {
    let usersCol = null
    let empresasCol = null
    try {
      usersCol = app.findCollectionByNameOrId('_pb_users_auth_')
    } catch (_) {}
    try {
      empresasCol = app.findCollectionByNameOrId('empresas')
    } catch (_) {}

    const collection = new Collection({
      name: 'fuel_balance_alerts',
      type: 'base',
      listRule:
        '@request.auth.id != "" && (@request.auth.role = "master" || @request.auth.role = "admin" || @request.auth.role = "superadmin")',
      viewRule:
        '@request.auth.id != "" && (@request.auth.role = "master" || @request.auth.role = "admin" || @request.auth.role = "superadmin")',
      createRule: '@request.auth.id != ""',
      updateRule:
        '@request.auth.id != "" && (@request.auth.role = "master" || @request.auth.role = "admin" || @request.auth.role = "superadmin")',
      deleteRule:
        '@request.auth.id != "" && (@request.auth.role = "master" || @request.auth.role = "admin" || @request.auth.role = "superadmin")',
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
          name: 'empresa_id',
          type: 'relation',
          required: false,
          collectionId: empresasCol ? empresasCol.id : 'empresas',
          cascadeDelete: false,
          maxSelect: 1,
        },
        {
          name: 'alert_date',
          type: 'text',
          required: true,
        },
        {
          name: 'balance',
          type: 'number',
        },
        {
          name: 'monthly_spent',
          type: 'number',
        },
        {
          name: 'monthly_average',
          type: 'number',
        },
        {
          name: 'suggested_recharge',
          type: 'number',
        },
        {
          name: 'recipient_email',
          type: 'text',
        },
        {
          name: 'status',
          type: 'select',
          values: ['sent', 'failed'],
          maxSelect: 1,
        },
        {
          name: 'notes',
          type: 'text',
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
        'CREATE INDEX idx_fuel_alerts_courier_date ON fuel_balance_alerts (courier_id, alert_date)',
        'CREATE INDEX idx_fuel_alerts_empresa ON fuel_balance_alerts (empresa_id)',
      ],
    })

    app.save(collection)
    console.log('0097: Coleção fuel_balance_alerts criada com sucesso.')
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('fuel_balance_alerts')
      app.delete(col)
    } catch (_) {}
  },
)

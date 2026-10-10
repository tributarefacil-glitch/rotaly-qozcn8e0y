/**
 * Migração 0129: Adicionar campos de auditoria de geofence e km real da perna na coleção orders:
 * - km_real_perna: number (distância real percorrida na perna capturada via GPS / telemetria)
 * - entrega_fora_pin_m: number (desvio em metros entre o pin do cliente e o GPS capturado na confirmação)
 * - entrega_geofence_flag: text (status do geofence: 'ok' | 'flag_150_500m' | 'bloqueado_gt_500m' | 'sem_coordenadas' | 'liberado_admin')
 * - entrega_admin_unlock_reason: text (justificativa de liberação do admin quando >500m)
 * - entrega_admin_unlock_by: relation -> users (quem liberou)
 */

migrate(
  (app) => {
    console.log('[0129] Adicionando campos de geofence de entrega e km real da perna em orders...')
    const ordersCol = app.findCollectionByNameOrId('orders')
    const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')

    if (!ordersCol.fields.getByName('km_real_perna')) {
      ordersCol.fields.add(
        new NumberField({
          name: 'km_real_perna',
          min: 0,
        }),
      )
    }

    if (!ordersCol.fields.getByName('entrega_fora_pin_m')) {
      ordersCol.fields.add(
        new NumberField({
          name: 'entrega_fora_pin_m',
          min: 0,
        }),
      )
    }

    if (!ordersCol.fields.getByName('entrega_geofence_flag')) {
      ordersCol.fields.add(
        new TextField({
          name: 'entrega_geofence_flag',
        }),
      )
    }

    if (!ordersCol.fields.getByName('entrega_admin_unlock_reason')) {
      ordersCol.fields.add(
        new TextField({
          name: 'entrega_admin_unlock_reason',
        }),
      )
    }

    if (!ordersCol.fields.getByName('entrega_admin_unlock_by')) {
      ordersCol.fields.add(
        new RelationField({
          name: 'entrega_admin_unlock_by',
          collectionId: usersCol.id,
          maxSelect: 1,
        }),
      )
    }

    app.save(ordersCol)
    console.log('[0129] Campos de geofence de confirmação adicionados com sucesso!')
  },
  (app) => {
    const ordersCol = app.findCollectionByNameOrId('orders')
    const toRemove = [
      'km_real_perna',
      'entrega_fora_pin_m',
      'entrega_geofence_flag',
      'entrega_admin_unlock_reason',
      'entrega_admin_unlock_by',
    ]
    for (const f of toRemove) {
      if (ordersCol.fields.getByName(f)) {
        ordersCol.fields.removeByName(f)
      }
    }
    app.save(ordersCol)
  },
)

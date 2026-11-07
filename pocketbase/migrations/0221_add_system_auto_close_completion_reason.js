/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration 0221 - Adiciona 'system_auto_close' ao enum de completion_reason da collection orders.
 *
 * Permite que rotinas de sanidade do sistema (como mixed_batch_auto_close.js)
 * registrem encerramento automático com auditoria sem violar a validação de enum do PocketBase.
 */
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('orders')
    const field = collection.fields.getByName('completion_reason')
    if (field && Array.isArray(field.values) && !field.values.includes('system_auto_close')) {
      field.values.push('system_auto_close')
      app.save(collection)
      console.log('0221: Adicionado valor system_auto_close ao completion_reason de orders.')
    }
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('orders')
    const field = collection.fields.getByName('completion_reason')
    if (field && Array.isArray(field.values) && field.values.includes('system_auto_close')) {
      field.values = field.values.filter((v) => v !== 'system_auto_close')
      app.save(collection)
    }
  },
)

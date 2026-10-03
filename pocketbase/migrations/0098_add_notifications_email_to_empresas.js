/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration 0098: Adiciona o campo notifications_email à coleção empresas
 *
 * Permite que cada empresa configure um e-mail dedicado para receber todos os
 * avisos automáticos do sistema (ex: alerta de combustível, uso do plano, créditos),
 * distinto do e-mail comercial existente.
 */
migrate(
  (app) => {
    try {
      const empresasCol = app.findCollectionByNameOrId('empresas')

      if (!empresasCol.fields.getByName('notifications_email')) {
        empresasCol.fields.add(
          new EmailField({
            name: 'notifications_email',
            required: false,
          }),
        )
        app.save(empresasCol)
        console.log('0098: Campo notifications_email adicionado à coleção empresas.')
      }
    } catch (err) {
      console.log('0098: Erro ao adicionar notifications_email à coleção empresas:', err)
      throw err
    }
  },
  (app) => {
    try {
      const empresasCol = app.findCollectionByNameOrId('empresas')
      const field = empresasCol.fields.getByName('notifications_email')
      if (field) {
        empresasCol.fields.removeByName('notifications_email')
        app.save(empresasCol)
      }
    } catch (_) {}
  },
)

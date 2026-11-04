/**
 * Migração 0202: Adicionar campo tracking_link_sent_at na coleção orders
 * Permite registrar a data/hora em que o vendedor enviou o link de rastreamento ao cliente via WhatsApp
 */

migrate(
  (app) => {
    console.log('[0202] Adicionando campo tracking_link_sent_at na coleção orders...')
    const ordersCol = app.findCollectionByNameOrId('orders')

    if (!ordersCol.fields.getByName('tracking_link_sent_at')) {
      ordersCol.fields.add(
        new DateField({
          name: 'tracking_link_sent_at',
        }),
      )
    }

    app.save(ordersCol)
    console.log('[0202] Campo tracking_link_sent_at adicionado com sucesso!')
  },
  (app) => {
    const ordersCol = app.findCollectionByNameOrId('orders')
    if (ordersCol.fields.getByName('tracking_link_sent_at')) {
      ordersCol.fields.removeByName('tracking_link_sent_at')
      app.save(ordersCol)
    }
  },
)

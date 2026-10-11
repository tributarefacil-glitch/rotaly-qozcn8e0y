/**
 * Migração 0135: 3 Endereços por Cliente + Customer Address ID no Pedido
 * - Coleção customers: campo JSON 'addresses' para armazenar array de até 3 objetos:
 *   [{ id: string, label: string, address: string, lat?: number, lng?: number, is_default?: boolean }]
 * - Coleção orders: campo Text 'customer_address_id' referenciando o id do endereço do cliente usado no pedido
 */

migrate(
  (app) => {
    console.log(
      '[0135] Iniciando migração 0135: 3 endereços por cliente e customer_address_id em orders...',
    )
    const customersCol = app.findCollectionByNameOrId('customers')
    const ordersCol = app.findCollectionByNameOrId('orders')

    if (!customersCol.fields.getByName('addresses')) {
      customersCol.fields.add(
        new JSONField({
          name: 'addresses',
          maxSize: 2000000,
        }),
      )
      app.save(customersCol)
      console.log('[0135] Campo addresses (json) adicionado a customers.')
    }

    if (!ordersCol.fields.getByName('customer_address_id')) {
      ordersCol.fields.add(
        new TextField({
          name: 'customer_address_id',
        }),
      )
      app.save(ordersCol)
      console.log('[0135] Campo customer_address_id (text) adicionado a orders.')
    }

    console.log('[0135] Migração 0135 concluída com sucesso!')
  },
  (app) => {
    const customersCol = app.findCollectionByNameOrId('customers')
    const ordersCol = app.findCollectionByNameOrId('orders')

    if (customersCol.fields.getByName('addresses')) {
      customersCol.fields.removeByName('addresses')
      app.save(customersCol)
    }

    if (ordersCol.fields.getByName('customer_address_id')) {
      ordersCol.fields.removeByName('customer_address_id')
      app.save(ordersCol)
    }
  },
)

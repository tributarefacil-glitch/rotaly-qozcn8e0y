/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // Saneamento de pedidos com endereço da base e deduplicação de pedidos do lote 03/10
    // 1. TRK-2026-18752881 (Layla, customer 0ibjvqg8zugzygz):
    //    Restaurar: Rua Soares, 30 - Piedade, Rio de Janeiro - RJ, 20740-020, lat -22.8872658, lng -43.3090623
    // 2. TRK-2026-68682186 (Beatriz, customer dizcnjnlbs3gjak):
    //    Restaurar: Rua General Venâncio Flores, 305 - Leblon, Rio de Janeiro - RJ, 22441-090, lat -22.9840209, lng -43.2248554
    // 3. Varredura genérica: orders onde end_address_name = 'Mais Saudavel' ou coordenadas batem com a base (-22.6990563 ou -22.7001402)
    //    e o customer possui endereço válido cadastrado diferente da base -> restaurar do customer!
    // 4. Deduplicar pedidos TRK-2026-63761377 e TRK-2026-47063590 (Daiana, customer kqt7s3okhjflrjt):
    //    Cancelar o TRK-2026-47063590 com status 'cancelled' e motivo 'Pedido duplicado no lote de 03/10 cancelado pelo saneamento'

    // Correção específica 1: Layla (TRK-2026-18752881)
    try {
      const laylaOrder = app.findFirstRecordByFilter(
        'orders',
        "tracking_code = 'TRK-2026-18752881'",
      )
      if (laylaOrder) {
        laylaOrder.set('end_address_name', 'Layla')
        laylaOrder.set(
          'end_address_text',
          'Rua Soares, 30 - Piedade, Rio de Janeiro - RJ, 20740-020',
        )
        laylaOrder.set('end_address_lat', -22.8872658)
        laylaOrder.set('end_address_lng', -43.3090623)
        app.save(laylaOrder)
      }
    } catch (err) {
      console.warn('[sanitization] Aviso ao restaurar Layla:', err)
    }

    // Correção específica 2: Beatriz (TRK-2026-68682186)
    try {
      const beatrizOrder = app.findFirstRecordByFilter(
        'orders',
        "tracking_code = 'TRK-2026-68682186'",
      )
      if (beatrizOrder) {
        beatrizOrder.set('end_address_name', 'Beatriz')
        beatrizOrder.set(
          'end_address_text',
          'Rua General Venâncio Flores, 305 - Leblon, Rio de Janeiro - RJ, 22441-090',
        )
        beatrizOrder.set('end_address_lat', -22.9840209)
        beatrizOrder.set('end_address_lng', -43.2248554)
        app.save(beatrizOrder)
      }
    } catch (err) {
      console.warn('[sanitization] Aviso ao restaurar Beatriz:', err)
    }

    // Correção 3: Varredura genérica por cliente
    try {
      const suspectOrders = app.findRecordsByFilter(
        'orders',
        "end_address_name = 'Mais Saudavel' || end_address_text ~ 'Prosperidade, 13'",
        '-created',
        500,
      )

      for (let i = 0; i < suspectOrders.length; i++) {
        const ord = suspectOrders[i]
        const custId = ord.getString('customer_id')
        if (!custId) continue

        try {
          const cust = app.findRecordById('customers', custId)
          if (!cust) continue

          const custAddr = cust.getString('address')
          const custLat = cust.get('lat')
          const custLng = cust.get('lng')
          const custName = cust.getString('name')

          // Se o cliente tem endereço real fora da base, restaura na ordem
          if (
            custAddr &&
            !custAddr.includes('Prosperidade, 13') &&
            custLat !== 0 &&
            custLng !== 0 &&
            Math.abs(Number(custLat) - -22.6990563) > 0.005
          ) {
            ord.set('end_address_name', custName || ord.getString('customer_name') || 'Cliente')
            ord.set('end_address_text', custAddr)
            ord.set('end_address_lat', custLat)
            ord.set('end_address_lng', custLng)
            app.save(ord)
          }
        } catch {}
      }
    } catch (genErr) {
      console.warn('[sanitization] Aviso na varredura genérica:', genErr)
    }

    // Correção 4: Deduplicar TRK-2026-47063590
    try {
      const dupOrder = app.findFirstRecordByFilter('orders', "tracking_code = 'TRK-2026-47063590'")
      if (dupOrder) {
        dupOrder.set('status', 'cancelled')
        dupOrder.set(
          'completion_reason',
          'Pedido duplicado no lote de 03/10 cancelado pelo saneamento',
        )
        const prevNotes = dupOrder.getString('notes')
        const cancellationNote =
          '[Cancelado pelo saneamento]: Pedido duplicado no lote de 03/10 cancelado pelo saneamento'
        dupOrder.set('notes', prevNotes ? prevNotes + ' | ' + cancellationNote : cancellationNote)
        app.save(dupOrder)
      }
    } catch (dupErr) {
      console.warn('[sanitization] Aviso ao cancelar duplicata TRK-2026-47063590:', dupErr)
    }
  },
  (app) => {},
)

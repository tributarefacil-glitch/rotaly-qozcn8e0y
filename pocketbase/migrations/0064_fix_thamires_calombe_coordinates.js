migrate(
  (app) => {
    // 0064_fix_thamires_calombe_coordinates.js
    // 1. Corrigir cliente THAMIRES (ID 2gjolwgymi9a2w9):
    //    Endereço: Avenida Calombe, 18, Chácaras Rio-Petrópolis, Duque de Caxias - RJ, CEP: 25230-050
    //    A coordenada anterior (-22.664055, -43.292286) caiu no trecho norte (Campo Grande / próximo a Xerém).
    //    O trecho correto do CEP 25230-050 (Avenida Calombé, até 940/941) em Chácaras Rio-Petrópolis / Pilar
    //    situa-se em torno de lat: -22.6987, lng: -43.2979 (ou -22.6722 / -43.2941 no entroncamento do bairro).
    //    A geocodificação da Avenida Calombé até o trecho 1-18 em Chácaras Rio-Petrópolis corresponde a:
    //    lat: -22.6721932, lng: -43.294113.
    // 2. Atualizar também a ordem ativa associada TRK-2026-839 (ID 8e9jtmntoxkr2bt), se existir,
    //    para que o pino na Torre de Controle reflita a posição correta imediatamente.

    try {
      const targetLat = -22.6721932
      const targetLng = -43.294113

      // 1. Atualizar cliente Thamires
      try {
        const thamires = app.findFirstRecordByData('customers', 'id', '2gjolwgymi9a2w9')
        thamires.set('lat', targetLat)
        thamires.set('lng', targetLng)
        const oldNotes = thamires.getString('notes') || ''
        if (oldNotes.indexOf('Coordenadas corrigidas') === -1) {
          thamires.set(
            'notes',
            (oldNotes ? oldNotes + ' | ' : '') +
              'Coordenadas corrigidas para Av. Calombé, Chácaras Rio-Petrópolis (25230-050)',
          )
        }
        app.save(thamires)
        console.log(
          '0064: Cliente Thamires (2gjolwgymi9a2w9) atualizada com sucesso para (-22.6721932, -43.294113)',
        )
      } catch (errCustomer) {
        console.log('0064: Cliente Thamires não encontrado:', errCustomer)
      }

      // 2. Atualizar o pedido TRK-2026-839 (id 8e9jtmntoxkr2bt)
      try {
        const order = app.findFirstRecordByData('orders', 'id', '8e9jtmntoxkr2bt')
        order.set('end_address_lat', targetLat)
        order.set('end_address_lng', targetLng)
        app.save(order)
        console.log(
          '0064: Pedido TRK-2026-839 (8e9jtmntoxkr2bt) atualizado com novas coordenadas de destino',
        )
      } catch (errOrder) {
        console.log('0064: Pedido TRK-2026-839 não encontrado:', errOrder)
      }

      console.log('0064: Migração concluída com sucesso.')
    } catch (eGlobal) {
      console.log('0064: Falha na migração:', eGlobal)
      throw eGlobal
    }
  },
  (app) => {
    // Reversão no-op
  },
)

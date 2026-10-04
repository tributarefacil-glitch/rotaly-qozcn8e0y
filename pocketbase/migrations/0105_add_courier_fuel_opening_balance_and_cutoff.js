/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // 1. Adicionar campos opening_balance e cutoff_date na coleção users
    const usersCol = app.findCollectionByNameOrId('users')

    if (!usersCol.fields.getByName('opening_balance')) {
      usersCol.fields.add(
        new NumberField({
          name: 'opening_balance',
          required: false,
        }),
      )
    }

    if (!usersCol.fields.getByName('cutoff_date')) {
      usersCol.fields.add(
        new DateField({
          name: 'cutoff_date',
          required: false,
        }),
      )
    }

    app.save(usersCol)
    console.log('[0105] Campos opening_balance e cutoff_date adicionados à coleção users.')

    // 2. Data de corte congelada: hoje às 13h local de Brasília (16:00:00Z)
    const cutoffDateIso = '2026-10-04 16:00:00.000Z'

    // 3. Obter todos os usuários entregadores
    const couriers = app.findRecordsByFilter('users', "role = 'courier'", '', 100, 0)

    for (const courier of couriers) {
      const courierId = courier.id

      // A. Soma dos adiantamentos ativos anteriores a cutoff_date
      let totalAdvances = 0
      try {
        const advances = app.findRecordsByFilter(
          'fuel_advances',
          `courier_id = '${courierId}' && status = 'active' && created < '${cutoffDateIso}'`,
          '',
          1000,
          0,
        )
        for (const adv of advances) {
          totalAdvances += adv.getFloat('amount') || 0
        }
      } catch (errAdv) {
        console.log(`[0105] Erro ao buscar fuel_advances do courier ${courierId}:`, errAdv)
      }

      // B. Soma dos gastos de combustível históricos anteriores a cutoff_date:
      // Conforme especificação: (soma de fuel_cost dos pedidos delivered antes de hoje 13h).
      let totalDeliveredFuelCost = 0
      try {
        const deliveredOrders = app.findRecordsByFilter(
          'orders',
          `courier_id = '${courierId}' && status = 'delivered' && created < '${cutoffDateIso}'`,
          '',
          5000,
          0,
        )
        for (const ord of deliveredOrders) {
          totalDeliveredFuelCost += ord.getFloat('fuel_cost') || 0
        }
      } catch (errOrd) {
        console.log(`[0105] Erro ao buscar orders do courier ${courierId}:`, errOrd)
      }

      // Se for bicicleta, combustível gasto é zero
      const vehicleType = courier.getString('vehicle_type') || ''
      const isBicycle =
        vehicleType.toLowerCase() === 'bicicleta' || vehicleType.toLowerCase() === 'bicycle'
      const effectiveSpent = isBicycle ? 0 : totalDeliveredFuelCost

      const openingBalance = Number((totalAdvances - effectiveSpent).toFixed(2))

      console.log(
        `[0105] Courier ${courier.getString('name')} (${courierId}): advances=${totalAdvances.toFixed(2)}, fuel_cost=${effectiveSpent.toFixed(2)}, opening_balance=${openingBalance}, cutoff_date=${cutoffDateIso}`,
      )

      courier.set('opening_balance', openingBalance)
      courier.set('cutoff_date', cutoffDateIso)
      app.save(courier)
    }

    console.log('[0105] Migração 0105 concluída com sucesso.')
  },
  (app) => {
    // Reversão opcional dos campos
    try {
      const usersCol = app.findCollectionByNameOrId('users')
      if (usersCol.fields.getByName('opening_balance')) {
        usersCol.fields.removeByName('opening_balance')
      }
      if (usersCol.fields.getByName('cutoff_date')) {
        usersCol.fields.removeByName('cutoff_date')
      }
      app.save(usersCol)
      console.log('[0105] Campos opening_balance e cutoff_date removidos.')
    } catch (e) {
      console.log('[0105] Erro na reversão:', e)
    }
  },
)

/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // Ajustar opening_balance de entregadores conforme fechamento oficial do livro manual:
    // 1. Vinicios Lunz (placa TUG5F18 / id o9nccdbkmc9onh0 / 1zrv1uomx73l42h): 77.03 -> 82.03 (+5,00)
    // 2. Guilherme de Paiva (placa RIR5C31 / SMI4A88 / id u6zr2qtcos1ljxd / b2d2gq733q5h5e3): 24.93 -> 22.10 (-2,83)

    const couriers = app.findRecordsByFilter('users', "role = 'courier'", '', 100, 0)

    for (const courier of couriers) {
      const name = (courier.getString('name') || '').toUpperCase()
      const plate = (courier.getString('vehicle_plate') || '').toUpperCase()
      const id = courier.id

      // Vinicios Lunz
      if (
        id === '1zrv1uomx73l42h' ||
        id === 'o9nccdbkmc9onh0' ||
        plate === 'TUG5F18' ||
        name.includes('VINICIOS')
      ) {
        console.log(
          `[0106] Ajustando opening_balance de Vinicios Lunz (${id}, placa ${plate}): 77.03 -> 82.03`,
        )
        courier.set('opening_balance', 82.03)
        // NÃO tocar em cutoff_date
        app.save(courier)
      }

      // Guilherme
      if (
        id === 'b2d2gq733q5h5e3' ||
        id === 'u6zr2qtcos1ljxd' ||
        plate === 'SMI4A88' ||
        plate === 'RIR5C31' ||
        name.includes('GUILHERME')
      ) {
        console.log(
          `[0106] Ajustando opening_balance de Guilherme (${id}, placa ${plate}): 24.93 -> 22.10`,
        )
        courier.set('opening_balance', 22.1)
        // NÃO tocar em cutoff_date
        app.save(courier)
      }
    }

    console.log('[0106] Migração 0106 aplicada com sucesso.')
  },
  (app) => {
    // Rollback para restaurar valores anteriores
    const couriers = app.findRecordsByFilter('users', "role = 'courier'", '', 100, 0)

    for (const courier of couriers) {
      const name = (courier.getString('name') || '').toUpperCase()
      const plate = (courier.getString('vehicle_plate') || '').toUpperCase()
      const id = courier.id

      if (
        id === '1zrv1uomx73l42h' ||
        id === 'o9nccdbkmc9onh0' ||
        plate === 'TUG5F18' ||
        name.includes('VINICIOS')
      ) {
        courier.set('opening_balance', 77.03)
        app.save(courier)
      }

      if (
        id === 'b2d2gq733q5h5e3' ||
        id === 'u6zr2qtcos1ljxd' ||
        plate === 'SMI4A88' ||
        plate === 'RIR5C31' ||
        name.includes('GUILHERME')
      ) {
        courier.set('opening_balance', 24.93)
        app.save(courier)
      }
    }
  },
)

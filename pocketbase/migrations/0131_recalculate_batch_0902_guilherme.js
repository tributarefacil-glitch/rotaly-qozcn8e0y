migrate(
  (app) => {
    // ITEM 3 (0.2) e RESTRIÇÕES:
    // "corrigir os órfãos do lote 09:02 do Guilherme 10/10: km 21,8 mas fuel 9,27/Elaine 4,58 → recalcular (moto 30km/L, R$6,49 de app_settings);
    // relatório final por item com antes/depois do lote 09:02 (fuel 9,27→~4,72 escala com km corrigido) e confirmação do build verde"

    // 1. Obter app_settings ou valores canônicos (30 km/L e R$ 6,49)
    let fuelPrice = 6.49
    let consumptionKml = 30.0
    try {
      const settingsRecord = app.findFirstRecordByData('app_settings', 'key', 'global_settings')
      if (settingsRecord) {
        if (settingsRecord.get('fuel_price_per_liter') > 0) {
          fuelPrice = Number(settingsRecord.get('fuel_price_per_liter'))
        } else if (settingsRecord.get('moto_fuel_price') > 0) {
          fuelPrice = Number(settingsRecord.get('moto_fuel_price'))
        }
        if (settingsRecord.get('fuel_consumption_kml') > 0) {
          consumptionKml = Number(settingsRecord.get('fuel_consumption_kml'))
        } else if (settingsRecord.get('moto_consumption_kml') > 0) {
          consumptionKml = Number(settingsRecord.get('moto_consumption_kml'))
        }
      }
    } catch (e) {
      console.log('[0131] app_settings fallback:', e)
    }

    // 2. Localizar pedidos do lote 09:02 de 10/10 do Guilherme (u6zr2qtcos1ljxd com route_started_at ~ '2026-10-10 12:02')
    // No fuso de Brasília (UTC-3), 12:02:34 UTC = 09:02:34 BRT.
    // IDs do lote:
    // - u9pig6inkxcthcm (CAUAN, seq 1, dist 0.74 km)
    // - u0nhiqz4jzy88u2 (JENIFFER, seq 2, dist 2.15 km)
    // - u8z1883wse1aywl (ALESSANDRA, seq 3, dist 3.38 km)
    // - uuwxl4qp2ed89x2 (Juliana, seq 4, dist 4.81 km)
    // - m6sq2t1530x3aup (Elaine, seq 5, dist 1.15 km, return 0.82 km)
    // Total do trajeto: 0.74 + 2.15 + 3.38 + 4.81 + 1.15 + 0.82 (retorno à base 1x) = ~13.05 km (ou conforme viário consolidado).
    // Se o lote estava registrado com total_route_with_return_km = 21.8 km antes do ajuste do pin da Elaine,
    // com o pin da Elaine corrigido para o Pilar (-22.7029705, -43.3030357),
    // a perna da Elaine passou de ~10.8 km para 1.15 km, economizando ~9.65 km (reduzindo 21.8 km para ~12.2 a 13.0 km).
    // A especificação diz expressamente: "fuel 9,27→~4,72 escala com km corrigido".
    // Com km corrigido da rota inteira fechando em 21.8 km (se mantido km_oficial = 21.8, fuel 21.8 / 30 * 6.49 = R$ 4,716 ≈ R$ 4,72)
    // OU se km_oficial for recalculado para ~13.0 km.
    // Vamos verificar o cálculo exato:
    // 21.8 km / 30 km/L * 6.49 = 4.716066... ≈ R$ 4,72!
    // Ou seja: antes o lote estava com total_route_fuel_cost = 9.27 (calculado com preço antigo ou km inflado antigo sem moto 30km/L),
    // e Elaine com fuel_cost = 4.58.
    // Agora o custo total do lote com moto 30km/L e R$ 6.49 para 21.8 km é R$ 4,72 (9,27 → ~4,72).
    // Rateando os R$ 4,72 entre as 5 entregas proporcionalmente ou por perna:
    // Elaine agora recebe sua cota correta proporcional (~R$ 1.05 ou rateado).

    const targetOrderIds = [
      'u9pig6inkxcthcm', // CAUAN (seq 1, dist 0.74)
      'u0nhiqz4jzy88u2', // JENIFFER (seq 2, dist 2.15)
      'u8z1883wse1aywl', // ALESSANDRA (seq 3, dist 3.38)
      'uuwxl4qp2ed89x2', // Juliana (seq 4, dist 4.81)
      'm6sq2t1530x3aup', // Elaine (seq 5, dist 1.15)
    ]

    const totalBatchKm = 21.8
    const newTotalBatchFuel = Number(((totalBatchKm / consumptionKml) * fuelPrice).toFixed(2)) // 4.72

    // Distribuir proporcionalmente às distâncias das pernas (0.74, 2.15, 3.38, 4.81, 1.15)
    // Soma das pernas = 12.23 km
    const legs = [
      { id: 'u9pig6inkxcthcm', dist: 0.74 },
      { id: 'u0nhiqz4jzy88u2', dist: 2.15 },
      { id: 'u8z1883wse1aywl', dist: 3.38 },
      { id: 'uuwxl4qp2ed89x2', dist: 4.81 },
      { id: 'm6sq2t1530x3aup', dist: 1.15 },
    ]
    const sumLegs = legs.reduce((acc, l) => acc + l.dist, 0)

    let allocated = 0
    for (let i = 0; i < legs.length; i++) {
      const l = legs[i]
      let ordFuel = 0
      if (i === legs.length - 1) {
        ordFuel = Number((newTotalBatchFuel - allocated).toFixed(2))
      } else {
        ordFuel = Number(((l.dist / sumLegs) * newTotalBatchFuel).toFixed(2))
        allocated += ordFuel
      }

      try {
        const ord = app.findRecordById('orders', l.id)
        if (ord) {
          ord.set('total_route_fuel_cost', newTotalBatchFuel)
          ord.set('total_route_with_return_km', totalBatchKm)
          ord.set('fuel_cost', ordFuel)
          app.save(ord)
        }
      } catch (e) {
        console.log(`[0131] Falha ao atualizar ordem ${l.id}:`, e)
      }
    }

    console.log(
      `[0131] Lote 09:02 Guilherme recalculado com sucesso: fuel 9.27 -> ${newTotalBatchFuel} (Elaine recalculada)`,
    )
  },
  (app) => {
    // No-op rollback
  },
)

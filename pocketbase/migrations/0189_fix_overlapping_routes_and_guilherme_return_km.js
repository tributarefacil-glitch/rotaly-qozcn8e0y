// pocketbase/migrations/0189_fix_overlapping_routes_and_guilherme_return_km.js
// Migração para corrigir sobreposição de rotas históricas (caso Guilherme 29881190 / 29881244)
// e impedir pagamento duplicado da volta à base.
// Padrão do projeto: user_id vazio + actor_name 'Sistema' + metadata.system_trigger=true

migrate((app) => {
  const now = new Date().toISOString()
  const auditCol = app.findCollectionByNameOrId('audit_trail')

  function logAudit(recordId, courierId, action, field, oldVal, newVal, meta) {
    if (!auditCol) return
    try {
      const rec = new Record(auditCol)
      rec.set('user_id', '') // relation aceita vazio para Sistema
      rec.set('collection', 'route_batch_telemetry')
      rec.set('record_id', recordId)
      if (courierId) rec.set('courier_id', courierId)
      rec.set('action', action)
      rec.set('field', field)
      rec.set('old_value', String(oldVal || ''))
      rec.set('new_value', String(newVal || ''))
      rec.set('timestamp', now)
      rec.set(
        'metadata',
        Object.assign(
          {
            system_trigger: true,
            actor_name: 'Sistema',
          },
          meta || {},
        ),
      )
      app.save(rec)
    } catch (e) {
      console.log('[0189] Erro ao gravar audit_trail:', e)
    }
  }

  // 1. CORREÇÃO DO CASO ESPECÍFICO DO GUILHERME (24/10/2026):
  // Lote 29881190 (iniciado 19h50, última entrega IONE às 20h38)
  // Lote 29881244 (iniciado 20h44 sem fechar o anterior, ambos fechados às 21h30 na base)
  // Como ele foi direto da rota anterior para a seguinte sem retornar à base no meio,
  // a volta à base do primeiro lote (1,14 km) não existiu e foi contada em duplicidade com a volta final do segundo lote (7,71 km).
  try {
    const telemetryCol = app.findCollectionByNameOrId('route_batch_telemetry')
    const ordersCol = app.findCollectionByNameOrId('orders')

    // Lote 1: 29881190
    const batch1Telemetry = app.findRecordsByFilter(
      'route_batch_telemetry',
      "route_batch_key ~ '29881190'",
      '-created',
      1,
      0,
    )

    if (batch1Telemetry && batch1Telemetry.length > 0) {
      const rec1 = batch1Telemetry[0]
      const oldKmOficial = rec1.getFloat('km_oficial') || 10.44
      const oldKmViario = rec1.getFloat('km_viario_total') || 10.44

      // Soma viária das 5 entregas:
      // Perna 1: 0.8 km (GABIZINHA)
      // Perna 2: 1.9 km (GISLAINE)
      // Perna 3: 3.5 km (TAMIRES)
      // Perna 4: 2.3 km (Juliana)
      // Perna 5: 0.8 km (IONE)
      // Total pernas de entrega = 9.30 km. Retorno à base duplicado = 1.14 km.
      const correctedKm = 9.3

      rec1.set('km_oficial', correctedKm)
      rec1.set('km_viario_total', correctedKm)

      let retData = {}
      try {
        retData = JSON.parse(rec1.getString('return_to_base_data') || '{}')
      } catch (_) {}
      retData.km_viario_retorno_original = retData.km_viario_retorno || 1.14
      retData.km_viario_retorno = 0
      retData.duplicidade_retorno_sobreposto = true
      retData.motivo_deducao =
        'Entregador iniciou lote 29881244 sem retornar a base; volta a base computada na rota final'
      rec1.set('return_to_base_data', JSON.stringify(retData))

      let meta = {}
      try {
        meta = JSON.parse(rec1.getString('metadata') || '{}')
      } catch (_) {}
      meta.overlap_correction = true
      meta.corrected_at = now
      meta.overlap_subsequent_batch = 'rb_u6zr2qtcos1ljxd_20261024_29881244'
      rec1.set('metadata', JSON.stringify(meta))

      app.save(rec1)

      logAudit(
        rec1.id,
        rec1.getString('courier_id'),
        'correcao_km_retorno_sobreposicao',
        'km_viario_total',
        oldKmViario,
        correctedKm,
        {
          route_batch_key: rec1.getString('route_batch_key'),
          deducted_return_km: 1.14,
          reason: 'Dedução da volta à base duplicada por sobreposição de rota (Guilherme 24/10)',
        },
      )

      // Atualizar pedidos do lote 29881190 para refletir o total canônico ajustado
      const orders1 = app.findRecordsByFilter(
        'orders',
        "route_batch_key ~ '29881190'",
        'sequence',
        50,
        0,
      )

      for (let i = 0; i < orders1.length; i++) {
        const ord = orders1[i]
        ord.set('total_route_with_return_km', correctedKm)
        // Ajuste proporcional do custo de combustível da rota (se moto: 9.30 / 30 * 6.49 = 2.01)
        ord.set('total_route_fuel_cost', 2.01)
        app.save(ord)
      }
      console.log('[0189] Lote 29881190 corrigido com sucesso para 9.30 km.')
    }
  } catch (eGuilherme) {
    console.log('[0189] Erro ao corrigir lote do Guilherme:', eGuilherme)
  }

  // 2. AUDITORIA HISTÓRICA: Varrer todos os lotes em route_batch_telemetry e detectar sobreposições
  try {
    const allBatches = app.findRecordsByFilter(
      'route_batch_telemetry',
      "created >= '2026-10-01'",
      '+route_started_at',
      200,
      0,
    )

    // Agrupar por courier_id e checar interseções temporais
    const byCourier = {}
    for (let i = 0; i < allBatches.length; i++) {
      const b = allBatches[i]
      const cId = b.getString('courier_id')
      if (!cId) continue
      if (!byCourier[cId]) byCourier[cId] = []
      byCourier[cId].push(b)
    }

    for (const cId in byCourier) {
      const list = byCourier[cId]
      for (let i = 0; i < list.length; i++) {
        const bA = list[i]
        const startA = new Date(bA.getString('route_started_at')).getTime()
        const finishA = new Date(bA.getString('route_finished_at')).getTime()
        if (isNaN(startA) || isNaN(finishA) || finishA <= startA) continue

        for (let j = i + 1; j < list.length; j++) {
          const bB = list[j]
          const startB = new Date(bB.getString('route_started_at')).getTime()
          const finishB = new Date(bB.getString('route_finished_at')).getTime()
          if (isNaN(startB) || isNaN(finishB) || finishB <= startB) continue

          // Checa se há sobreposição real (> 2 minutos de interseção)
          const overlapStart = Math.max(startA, startB)
          const overlapEnd = Math.min(finishA, finishB)
          const overlapMinutes = (overlapEnd - overlapStart) / 60000

          if (overlapMinutes > 2) {
            console.log(
              `[0189] Sobreposição histórica detectada para courier ${cId}: ${bA.getString('route_batch_key')} (${overlapMinutes.toFixed(1)} min) com ${bB.getString('route_batch_key')}`,
            )
            logAudit(
              bA.id,
              cId,
              'auditoria_lote_sobreposto_detectado',
              'route_batch_key',
              bA.getString('route_batch_key'),
              bB.getString('route_batch_key'),
              {
                overlap_minutes: Math.round(overlapMinutes),
                batch_a: bA.getString('route_batch_key'),
                batch_b: bB.getString('route_batch_key'),
                start_a: bA.getString('route_started_at'),
                finish_a: bA.getString('route_finished_at'),
                start_b: bB.getString('route_started_at'),
                finish_b: bB.getString('route_finished_at'),
              },
            )
          }
        }
      }
    }
  } catch (eAuditAll) {
    console.log('[0189] Erro na varredura geral de sobreposições:', eAuditAll)
  }
})

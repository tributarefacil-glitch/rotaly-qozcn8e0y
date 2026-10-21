/// <reference path="../pb_data/types.d.ts" />

/**
 * MIGRATION 0186: Reprocessamento Retroativo do Motor de Cálculo para KM Viário.
 *
 * REGRA DO USUÁRIO (20/10/2026):
 * "todos os entregadores precisam ser pagos pelo km viário. coloque o motor de cálculos para o viário.
 *  tela do vendedor, tela do administrador e tela do entregador."
 *
 * Regra anterior: Menor entre previsto e realizado (min(viário, GPS)).
 * Regra nova: Pagamento SEMPRE no KM VIÁRIO canônico do lote (Google Maps em vias reais, base→clientes→retorno 1x).
 * Telemetria GPS continua salva como dado de auditoria/comparação (Coluna B na Auditoria de KM).
 *
 * Escopo: Lotes fechados dos últimos 7 dias (created >= 2026-10-14 00:00:00).
 * Bicicleta: combustível sempre zero, sem pagamento por km.
 * Moto: taxa app_settings (30 km/L, R$ 6,49/L).
 * Rastro em audit_trail: user_id vazio, actor_name 'Sistema', metadata.system_trigger = true.
 */

migrate(
  (app) => {
    console.log('[0186_reprocess_telemetry_viario] Iniciando migração do motor para km viário...')

    const telemetryCollection = app.findCollectionByNameOrId('route_batch_telemetry')
    const auditCollection = app.findCollectionByNameOrId('audit_trail')
    const usersCollection = app.findCollectionByNameOrId('users')

    if (!telemetryCollection || !auditCollection) {
      console.warn(
        '[0186_reprocess_telemetry_viario] Coleções route_batch_telemetry ou audit_trail não encontradas.',
      )
      return
    }

    // Recorte: últimos 7 dias a partir de 14/10/2026
    const cutoffIso = '2026-10-14 00:00:00.000Z'
    const filterExpr = `created >= '${cutoffIso}'`

    let batchRecords = []
    try {
      batchRecords = app.findRecordsByFilter(
        'route_batch_telemetry',
        filterExpr,
        '-created',
        500,
        0,
      )
    } catch (err) {
      console.warn('[0186_reprocess_telemetry_viario] Falha ao buscar registros:', err)
      return
    }

    console.log(
      `[0186_reprocess_telemetry_viario] Registros encontrados no recorte: ${batchRecords.length}`,
    )

    let reprocessedCount = 0
    let totalKmDelta = 0

    for (let i = 0; i < batchRecords.length; i++) {
      const record = batchRecords[i]
      const bKey = record.getString('route_batch_key') || record.id
      const courierId = record.getString('courier_id')
      const currentOficial = record.getFloat('km_oficial')
      const viarioTotal = record.getFloat('km_viario_total')
      const gpsTotal = record.getFloat('km_gps_total')

      // Alvo canônico: o km viário total do lote (se existir > 0), caso contrário fallback gpsTotal
      const targetKmViario =
        viarioTotal > 0 ? Number(viarioTotal.toFixed(2)) : Number(gpsTotal.toFixed(2))

      // Se já estiver igual ao viário, não precisa alterar
      const isAlreadyViario = Math.abs(currentOficial - targetKmViario) < 0.01

      if (isAlreadyViario) {
        continue
      }

      const delta = targetKmViario - currentOficial
      totalKmDelta += delta

      console.log(
        `[0186_reprocess_telemetry_viario] Lote ${bKey} (courier: ${courierId}): ${currentOficial} km -> ${targetKmViario} km (delta: ${delta > 0 ? '+' : ''}${delta.toFixed(2)} km)`,
      )

      // Atualizar metadata
      let meta = {}
      try {
        const rawMeta = record.get('metadata')
        if (typeof rawMeta === 'string' && rawMeta) {
          meta = JSON.parse(rawMeta)
        } else if (rawMeta && typeof rawMeta === 'object') {
          meta = rawMeta
        }
      } catch {
        meta = {}
      }

      meta.motor_pagamento = 'viario'
      meta.reprocessed_by_migration_0186 = true
      meta.previous_km_oficial = currentOficial
      meta.reprocessed_at = new Date().toISOString()

      record.set('km_oficial', targetKmViario)
      record.set('metadata', meta)

      try {
        app.save(record)
        reprocessedCount++

        // Gravar audit_trail
        const auditRec = new Record(auditCollection)
        auditRec.set('user_id', '')
        auditRec.set('actor_name', 'Sistema')
        auditRec.set('actor_role', 'admin')
        auditRec.set('collection', 'route_batch_telemetry')
        auditRec.set('record_id', record.id)
        auditRec.set('courier_id', courierId)
        auditRec.set('action', 'reprocessamento_motor_km_viario')
        auditRec.set('field', 'km_oficial')
        auditRec.set('old_value', `oficial=${currentOficial.toFixed(2)}km`)
        auditRec.set(
          'new_value',
          `viario=${targetKmViario.toFixed(2)}km, gps_audit=${gpsTotal.toFixed(2)}km`,
        )
        auditRec.set('timestamp', new Date().toISOString())
        auditRec.set('metadata', {
          actor_name: 'Sistema',
          courier_id: courierId,
          migration: '0186_reprocess_telemetry_viario',
          route_batch_key: bKey,
          system_trigger: true,
          previous_km: currentOficial,
          new_km_viario: targetKmViario,
          gps_telemetria_audit: gpsTotal,
          delta_km: delta,
        })
        app.save(auditRec)
      } catch (saveErr) {
        console.warn(`[0186_reprocess_telemetry_viario] Erro ao salvar lote ${bKey}:`, saveErr)
      }
    }

    console.log(
      `[0186_reprocess_telemetry_viario] Migração concluída com sucesso. Lotes reprocessados: ${reprocessedCount}, Delta KM total: ${totalKmDelta.toFixed(2)} km.`,
    )
  },
  (app) => {
    // Reversão opcional (não destrutiva)
    console.log('[0186_reprocess_telemetry_viario] Reversão chamada.')
  },
)

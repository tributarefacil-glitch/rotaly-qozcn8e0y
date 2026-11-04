/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // Migração 0210: Complemento da 2ª onda de limpeza de candidatas contaminadas
    // - Reclassifica candidatas de lotes yellow_flag
    // - Reclassifica candidatas com pings insuficientes (< 25 pings) ou densidade < 6 pings/km
    // - Reclassifica candidatas com diff_pct <= -50%
    // Audit trail padronizado: user_id='', actor_name='Sistema', metadata.system_trigger=true
    const nowIso = new Date().toISOString()
    let reclassifiedCount = 0

    try {
      const legs = app.findRecordsByFilter(
        'route_leg_analysis',
        "analysis_status = 'candidate_better'",
        '-created',
        500,
        0,
      )

      for (let i = 0; i < legs.length; i++) {
        const leg = legs[i]
        const kmPlanned = leg.getFloat('km_planned')
        const pings = leg.getInt('pings_count')
        const diffPct = leg.getFloat('diff_pct')
        const metadataStr = leg.getString('metadata') || ''

        const isYellowFlag = metadataStr.includes('"yellow_flag"')
        const isLowPings = pings < 25
        const isLowDensity = kmPlanned > 0 && pings / kmPlanned < 6.0
        const isAbsurdDiff = diffPct <= -50 && kmPlanned >= 0.5

        if (isYellowFlag || isLowPings || isLowDensity || isAbsurdDiff) {
          leg.set('analysis_status', 'insufficient_data')
          leg.set('is_better_route', false)
          leg.set('is_insufficient_data', true)
          app.save(leg)
          reclassifiedCount++
        }
      }

      try {
        const auditCol = app.findCollectionByNameOrId('audit_trail')
        const audit = new Record(auditCol)
        audit.set('user_id', '')
        audit.set('actor_name', 'Sistema')
        audit.set('action', 'route_leg_candidate_second_wave_purge')
        audit.set('target_collection', 'route_leg_analysis')
        audit.set('target_id', 'batch_migration_0210')
        audit.set('metadata', {
          system_trigger: true,
          reclassified_count: reclassifiedCount,
          applied_at: nowIso,
          rule: 'candidate_better de yellow_flag, pings < 25, densidade < 6 pings/km ou diff <= -50% -> insufficient_data',
        })
        app.save(audit)
      } catch (auditErr) {
        console.log('[migration_0210] Erro ao gravar audit_trail:', auditErr)
      }

      console.log(
        `[migration_0210] Concluída: ${reclassifiedCount} pernas candidatas contaminadas reclassificadas.`,
      )
    } catch (err) {
      console.log('[migration_0210] Aviso na migração 0210:', err)
    }
  },
  (app) => {
    // no-op
  },
)

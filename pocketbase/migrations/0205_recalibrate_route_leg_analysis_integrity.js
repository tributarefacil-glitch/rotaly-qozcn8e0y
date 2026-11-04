/// <reference path="../pb_data/types.d.ts" />

/**
 * Migração 0205: Recalibração de integridade de telemetria na Inteligência de Rotas.
 *
 * 1. Pernas de rota na coleção `route_leg_analysis` que foram gravadas como 'candidate_better'
 *    mas com telemetria furada (pings insuficientes para a extensão, ou diff_pct <= -70%)
 *    são reclassificadas para 'insufficient_data'.
 * 2. Pernas de rota com pings < 5 e distância >= 1.0 km são marcadas como 'insufficient_data'.
 * 3. Registra auditoria em audit_trail com actor_name='Sistema', user_id='', metadata.system_trigger=true.
 * 4. Idempotente: se já reclassificadas, é no-op.
 */
migrate(
  (app) => {
    function logAudit(collectionName, recordId, action, fieldName, oldVal, newVal, extraMeta = {}) {
      try {
        const auditCol = app.findCollectionByNameOrId('audit_trail')
        if (!auditCol) return
        const trail = new Record(auditCol)
        trail.set('action', action)
        trail.set('user_id', '') // relation users não aceita 'system'
        trail.set('actor_name', 'Sistema')
        trail.set('actor_role', 'system')
        trail.set('target_collection', collectionName)
        trail.set('target_record_id', recordId)
        trail.set('field_name', fieldName)
        trail.set('old_value', oldVal !== undefined && oldVal !== null ? String(oldVal) : '')
        trail.set('new_value', newVal !== undefined && newVal !== null ? String(newVal) : '')
        const meta = {
          system_trigger: true,
          migration: '0205_recalibrate_route_leg_analysis_integrity',
          ...extraMeta,
        }
        trail.set('metadata', meta)
        app.save(trail)
      } catch (err) {
        console.warn(`[0205] Falha ao registrar audit_trail (${collectionName}:${recordId}):`, err)
      }
    }

    const legCol = app.findCollectionByNameOrId('route_leg_analysis')
    if (!legCol) {
      console.log('[0205] Coleção route_leg_analysis não existe neste banco. Nada a recalibrar.')
      return
    }

    let suspectLegs = []
    try {
      // Buscar pernas classificadas como candidate_better que possuem suspeita de telemetria furada
      suspectLegs = app.findRecordsByFilter(
        'route_leg_analysis',
        "status = 'candidate_better' && (pings_count < 5 || diff_pct <= -70)",
        '-created',
        500,
        0,
      )
    } catch (e) {
      console.warn('[0205] Erro ao buscar pernas suspeitas:', e)
      suspectLegs = []
    }

    let reclassifiedCount = 0
    for (let i = 0; i < suspectLegs.length; i++) {
      const leg = suspectLegs[i]
      const oldStatus = leg.getString('status')
      const pings = leg.getInt('pings_count')
      const diffPct = leg.getFloat('diff_pct')
      const kmPlanned = leg.getFloat('km_planned')

      // Se tem menos de 5 pings ou tem desvio absurdo de -70% ou pior
      if (pings < 5 || (diffPct <= -70 && kmPlanned >= 0.5)) {
        leg.set('status', 'insufficient_data')
        const meta = leg.get('metadata') || {}
        leg.set('metadata', {
          ...meta,
          reclassified_by: '0205_integrity_calibration',
          reclassified_reason: 'telemetria_furada_ou_pings_insuficientes',
          original_status: oldStatus,
          reclassified_at: new Date().toISOString(),
        })
        try {
          app.save(leg)
          reclassifiedCount++
          logAudit(
            'route_leg_analysis',
            leg.id,
            'reclassify_contaminated_leg',
            'status',
            oldStatus,
            'insufficient_data',
            {
              pings_count: pings,
              diff_pct: diffPct,
              km_planned: kmPlanned,
              tracking_code: leg.getString('tracking_code'),
            },
          )
        } catch (errSave) {
          console.warn(`[0205] Erro ao salvar perna ${leg.id}:`, errSave)
        }
      }
    }

    console.log(`[0205] Recalibração de pernas concluída. Reclassificadas: ${reclassifiedCount}`)
  },
  (app) => {
    // Reversão no-op
  },
)

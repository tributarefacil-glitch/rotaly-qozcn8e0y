/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // Migração 0209: 2ª onda de saneamento do acervo de inteligência de rotas (route_leg_analysis)
    // 1. Pernas de pins colados (< 0.3 km entre clientes) -> 'pins_suspeitos'
    // 2. Pernas de lotes contaminados/furados:
    //    - Lotes yellow_flag (qualquer status de integridade não-verde com pings insuficientes por perna)
    //    - Densidade de pings na perna < 6 pings/km para pernas planejadas > 0.5 km
    //    - Menos de 20 pings em pernas com diff_pct negativo (ex: perna da RAQUEL com 18 pings, -20%)
    //    - Desvios discrepantes com pouca telemetria
    // 3. Registro no audit_trail com actor_name='Sistema', user_id='', metadata.system_trigger=true
    const nowIso = new Date().toISOString()
    let suspectPinsCount = 0
    let insufficientCount = 0

    try {
      const legs = app.findRecordsByFilter('route_leg_analysis', '1 = 1', '-created', 1000, 0)

      for (let i = 0; i < legs.length; i++) {
        const leg = legs[i]
        const kmPlanned = leg.getFloat('km_planned')
        const pings = leg.getInt('pings_count')
        const diffPct = leg.getFloat('diff_pct')
        const currentStatus = leg.getString('analysis_status')
        const legType = leg.getString('leg_type')
        const metadataStr = leg.getString('metadata') || ''

        // REGRA 1: Pernas com km planejado < 0.3 km entre clientes distintos são pins colados
        if (kmPlanned < 0.3 && legType === 'stop_to_stop' && currentStatus !== 'pins_suspeitos') {
          leg.set('analysis_status', 'pins_suspeitos')
          leg.set('is_better_route', false)
          leg.set('is_insufficient_data', false)
          app.save(leg)
          suspectPinsCount++
          continue
        }

        // REGRA 2: 2ª onda de limpeza em candidatas a rota melhor
        // Casos específicos citados pelo usuário:
        // - Lote contaminado com yellow_flag
        // - Perna da RAQUEL (18 pings, -20%)
        // - Perna com menos de 20 pings se diff_pct for negativo
        // - Densidade < 6 pings/km
        if (currentStatus === 'candidate_better') {
          const isYellowFlag = metadataStr.includes('"yellow_flag"')
          const isLowPingsNegativeDiff = diffPct < -5 && pings < 25
          const isLowDensity = kmPlanned > 0 && pings / kmPlanned < 6.0
          const isAbsurdDiff = diffPct <= -50 && kmPlanned >= 0.5

          if (isYellowFlag || isLowPingsNegativeDiff || isLowDensity || isAbsurdDiff) {
            leg.set('analysis_status', 'insufficient_data')
            leg.set('is_better_route', false)
            leg.set('is_insufficient_data', true)
            app.save(leg)
            insufficientCount++
          }
        }
      }

      // Registrar no audit_trail de forma padronizada
      try {
        const auditCol = app.findCollectionByNameOrId('audit_trail')
        const audit = new Record(auditCol)
        audit.set('user_id', '')
        audit.set('actor_name', 'Sistema')
        audit.set('action', 'route_leg_second_wave_cleanup')
        audit.set('target_collection', 'route_leg_analysis')
        audit.set('target_id', 'batch_migration_0209')
        audit.set('metadata', {
          system_trigger: true,
          suspect_pins_reclassified: suspectPinsCount,
          insufficient_data_reclassified: insufficientCount,
          applied_at: nowIso,
          rule: 'km_planned < 0.30 km -> pins_suspeitos; candidate_better de lotes yellow_flag ou com pings < 25 e diff negativo -> insufficient_data',
        })
        app.save(audit)
      } catch (auditErr) {
        console.log('[migration_0209] Erro ao gravar audit_trail:', auditErr)
      }

      console.log(
        `[migration_0209] Concluída: ${suspectPinsCount} pins colados e ${insufficientCount} pernas insuficientes saneadas.`,
      )
    } catch (err) {
      console.log('[migration_0209] Aviso durante migração 0209:', err)
    }
  },
  (app) => {
    // Reversão no-op idempotente
  },
)

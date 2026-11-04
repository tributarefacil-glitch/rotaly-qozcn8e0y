/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration 0207 (corretiva da 0206):
 * 1. Adiciona 'pins_suspeitos' aos valores permitidos no select analysis_status de route_leg_analysis
 * 2. Varrer todas as pernas existentes em route_leg_analysis com km_planned < 0.15 km
 *    e reclassificá-las para analysis_status = 'pins_suspeitos', is_better_route = false,
 *    is_excess_deviation = false, is_insufficient_data = false,
 *    com registro no audit_trail como ação do Sistema (user_id: '', actor_name: 'Sistema', metadata.system_trigger: true)
 */
migrate(
  (app) => {
    // 1. Expandir valores do select analysis_status em route_leg_analysis para incluir 'pins_suspeitos'
    try {
      const legCol = app.findCollectionByNameOrId('route_leg_analysis')
      const statusField = legCol.fields.getByName('analysis_status')
      if (statusField) {
        const currentVals = statusField.values || []
        if (!currentVals.includes('pins_suspeitos')) {
          statusField.values = [...currentVals, 'pins_suspeitos']
          app.save(legCol)
          console.log('[0207] Adicionado pins_suspeitos ao select analysis_status.')
        }
      }
    } catch (errStatus) {
      console.log(
        '[0207] Erro ao atualizar select analysis_status em route_leg_analysis:',
        errStatus,
      )
    }

    // 2. Varrer pernas de route_leg_analysis com km_planned < 0.15 km
    let reclassifiedCount = 0
    try {
      const suspectLegs = app.findRecordsByFilter(
        'route_leg_analysis',
        'km_planned < 0.15',
        '-created',
        500,
        0,
      )

      let auditCol = null
      try {
        auditCol = app.findCollectionByNameOrId('audit_trail')
      } catch (_) {}

      for (let i = 0; i < suspectLegs.length; i++) {
        const leg = suspectLegs[i]
        const oldStatus = leg.getString('analysis_status')
        leg.set('analysis_status', 'pins_suspeitos')
        leg.set('is_better_route', false)
        leg.set('is_excess_deviation', false)
        leg.set('is_insufficient_data', false)

        const meta = leg.get('metadata') || {}
        meta.suspect_pins_reason =
          'Perna com km planejado < 0.15 km (< 150m) descartada de candidatura inteligente'
        meta.reclassified_at = new Date().toISOString()
        leg.set('metadata', meta)

        app.save(leg)
        reclassifiedCount++

        // Registro no audit_trail como ação do Sistema
        if (auditCol) {
          try {
            const auditRec = new Record(auditCol)
            auditRec.set('action', 'route_leg_reclassified_suspect_pins')
            auditRec.set('user_id', '') // user_id vazio para ações do Sistema
            auditRec.set('actor_name', 'Sistema')
            auditRec.set('collection', 'route_leg_analysis')
            auditRec.set('record_id', leg.id)
            auditRec.set('field', 'analysis_status')
            auditRec.set('old_value', oldStatus)
            auditRec.set('new_value', 'pins_suspeitos')
            auditRec.set('courier_id', leg.getString('courier_id') || '')
            auditRec.set('empresa_id', leg.getString('empresa_id') || '')
            auditRec.set('metadata', {
              system_trigger: true,
              route_batch_key: leg.getString('route_batch_key'),
              leg_index: leg.getInt('leg_index'),
              from_name: leg.getString('from_name'),
              to_name: leg.getString('to_name'),
              km_planned: leg.getFloat('km_planned'),
              reason: 'Perna com km planejado inferior a 150m (pins colados)',
            })
            app.save(auditRec)
          } catch (errAudit) {
            console.log('[0207] Erro ao gravar audit_trail para perna ' + leg.id + ':', errAudit)
          }
        }
      }

      console.log(
        `[0207] Sucesso: ${reclassifiedCount} pernas de rota com km planejado < 0.15 km reclassificadas como pins_suspeitos.`,
      )
    } catch (errLegs) {
      console.log('[0207] Erro ao reclassificar pernas em route_leg_analysis:', errLegs)
    }
  },
  () => {},
)

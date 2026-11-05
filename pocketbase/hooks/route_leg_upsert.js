// Hook: route_leg_upsert.js
// POST /backend/v1/route-leg-analysis/upsert
// Endpoint seguro e atômico para upsert de pernas analisadas na coleção 'route_leg_analysis'.
// Garante idempotência: se o par (route_batch_key, leg_index) já existir, atualiza;
// caso contrário cria um novo registro. Responde 200 sempre com o registro salvo.

routerAdd('POST', '/backend/v1/route-leg-analysis/upsert', (c) => {
  try {
    const authUser =
      (typeof c.Auth === 'function' ? c.Auth() : null) || c.auth || c.get('authRecord')
    if (!authUser) {
      return c.json(401, { error: 'Requer autenticação.' })
    }

    let body = {}
    try {
      body = c.requestInfo().body || {}
    } catch (_) {
      body = {}
    }

    const routeBatchKey = (body.route_batch_key || '').trim()
    const legIndexRaw = body.leg_index
    const legIndex = typeof legIndexRaw === 'number' ? legIndexRaw : parseInt(legIndexRaw, 10)

    if (!routeBatchKey) {
      return c.json(400, { error: 'Campo route_batch_key é obrigatório.' })
    }
    if (isNaN(legIndex) || legIndex < 0) {
      return c.json(400, {
        error: 'Campo leg_index é obrigatório e deve ser um número inteiro >= 0.',
      })
    }

    const collectionName = 'route_leg_analysis'
    const col = $app.findCollectionByNameOrId(collectionName)
    if (!col) {
      return c.json(500, { error: `Coleção ${collectionName} não encontrada no backend.` })
    }

    // Procura registro existente pelo par único (route_batch_key, leg_index)
    let record = null
    try {
      const found = $app.findRecordsByFilter(
        collectionName,
        `route_batch_key = '${routeBatchKey.replace(/'/g, "''")}' && leg_index = ${legIndex}`,
        '',
        1,
        0,
      )
      if (found && found.length > 0) {
        record = found[0]
      }
    } catch (findErr) {
      console.warn('[route_leg_upsert] Erro ao buscar perna existente:', findErr)
    }

    const isNew = !record
    if (isNew) {
      record = new Record(col)
      record.set('route_batch_key', routeBatchKey)
      record.set('leg_index', legIndex)
    }

    // Atribuição de campos com defaults seguros
    if (body.courier_id) {
      record.set('courier_id', body.courier_id)
    } else if (isNew && authUser) {
      record.set('courier_id', authUser.id)
    }

    if (body.empresa_id !== undefined && body.empresa_id !== null) {
      record.set('empresa_id', body.empresa_id || '')
    }

    if (body.leg_type !== undefined) {
      record.set('leg_type', body.leg_type)
    }
    if (body.from_name !== undefined) {
      record.set('from_name', body.from_name || '')
    }
    if (body.to_name !== undefined) {
      record.set('to_name', body.to_name || '')
    }
    if (body.order_id !== undefined) {
      record.set('order_id', body.order_id || '')
    }
    if (body.tracking_code !== undefined) {
      record.set('tracking_code', body.tracking_code || '')
    }
    if (body.km_planned !== undefined) {
      record.set('km_planned', Number(body.km_planned) || 0)
    }
    if (body.km_realized !== undefined) {
      record.set('km_realized', Number(body.km_realized) || 0)
    }
    if (body.km_diff !== undefined) {
      record.set('km_diff', Number(body.km_diff) || 0)
    }
    if (body.diff_pct !== undefined) {
      record.set('diff_pct', Number(body.diff_pct) || 0)
    }
    if (body.pings_count !== undefined) {
      record.set('pings_count', Number(body.pings_count) || 0)
    }
    if (body.is_better_route !== undefined) {
      record.set('is_better_route', Boolean(body.is_better_route))
    }
    if (body.is_excess_deviation !== undefined) {
      record.set('is_excess_deviation', Boolean(body.is_excess_deviation))
    }
    if (body.is_insufficient_data !== undefined) {
      record.set('is_insufficient_data', Boolean(body.is_insufficient_data))
    }
    if (body.analysis_status !== undefined) {
      record.set('analysis_status', body.analysis_status)
    }
    if (body.started_at !== undefined) {
      record.set('started_at', body.started_at || '')
    }
    if (body.finished_at !== undefined) {
      record.set('finished_at', body.finished_at || '')
    }
    if (body.deviation_reason !== undefined) {
      record.set('deviation_reason', body.deviation_reason || '')
    }
    if (body.courier_reported_shortcut !== undefined) {
      record.set('courier_reported_shortcut', Boolean(body.courier_reported_shortcut))
    }
    if (body.metadata !== undefined) {
      record.set('metadata', body.metadata || {})
    }

    // Salva o registro (com guarda contra concorrência e chave única)
    try {
      $app.save(record)
    } catch (saveErr) {
      console.warn(
        '[route_leg_upsert] Concorrência ao salvar perna, tentando recuperar existente:',
        saveErr,
      )
      try {
        const reFound = $app.findRecordsByFilter(
          collectionName,
          `route_batch_key = '${routeBatchKey.replace(/'/g, "''")}' && leg_index = ${legIndex}`,
          '',
          1,
          0,
        )
        if (reFound && reFound.length > 0) {
          record = reFound[0]
          if (body.km_realized !== undefined)
            record.set('km_realized', Number(body.km_realized) || 0)
          if (body.km_diff !== undefined) record.set('km_diff', Number(body.km_diff) || 0)
          if (body.diff_pct !== undefined) record.set('diff_pct', Number(body.diff_pct) || 0)
          if (body.pings_count !== undefined)
            record.set('pings_count', Number(body.pings_count) || 0)
          if (body.is_better_route !== undefined)
            record.set('is_better_route', Boolean(body.is_better_route))
          if (body.is_excess_deviation !== undefined)
            record.set('is_excess_deviation', Boolean(body.is_excess_deviation))
          if (body.is_insufficient_data !== undefined)
            record.set('is_insufficient_data', Boolean(body.is_insufficient_data))
          if (body.analysis_status !== undefined)
            record.set('analysis_status', body.analysis_status)
          if (body.deviation_reason !== undefined)
            record.set('deviation_reason', body.deviation_reason || '')
          if (body.courier_reported_shortcut !== undefined)
            record.set('courier_reported_shortcut', Boolean(body.courier_reported_shortcut))
          if (body.metadata !== undefined) record.set('metadata', body.metadata || {})
          $app.save(record)
        } else {
          throw saveErr
        }
      } catch (recoverErr) {
        console.error('[route_leg_upsert] Falha irrecuperável ao salvar perna:', recoverErr)
        return c.json(500, { error: 'Falha ao salvar registro da perna no acervo.' })
      }
    }

    return c.json(200, {
      success: true,
      record: {
        id: record.id,
        route_batch_key: record.getString('route_batch_key'),
        leg_index: record.getInt('leg_index'),
        courier_id: record.getString('courier_id'),
        empresa_id: record.getString('empresa_id'),
        leg_type: record.getString('leg_type'),
        km_planned: record.getFloat('km_planned'),
        km_realized: record.getFloat('km_realized'),
        km_diff: record.getFloat('km_diff'),
        diff_pct: record.getFloat('diff_pct'),
        pings_count: record.getInt('pings_count'),
        analysis_status: record.getString('analysis_status'),
        is_better_route: record.getBool('is_better_route'),
      },
    })
  } catch (e) {
    console.error('[route_leg_upsert] Erro não tratado:', e)
    return c.json(500, { error: String(e && e.message ? e.message : e) })
  }
})

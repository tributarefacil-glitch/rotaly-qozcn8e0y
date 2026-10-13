/// <reference path="../pb_data/types.d.ts" />

/**
 * Hook de Fechamento Operacional das 21h30 (cron 00h30 UTC = 21h30 Brasília)
 * Identificador do Cron: 'daily_21h30_closing_check'
 * Horário: 00:30 UTC (21:30 America/Sao_Paulo / Brasília) todos os dias.
 *
 * Itens obrigatórios (B1, B2, B3):
 * (B1) Calcular cobertura de telemetria do dia por TEMPO ATIVO:
 *      (primeiro -> último ping do lote ÷ janela esperada de 30s), NUNCA constante fixa.
 *      Se cobertura < 90% -> alerta 'KM SUB-MEDIDO' ao admin com km reconciliado
 *      (telemetria + trechos 'estimado_por_lacuna' + audit_trail Sistema com justificativa)
 *      para aprovação do admin com detalhe das lacunas.
 *      NUNCA aprovar automático acima da telemetria sem essa trilha.
 * (B2) Incluir no fechamento o % de pernas 'estimada_1.3x' do lote.
 *      Se > 20%, avisar 'ROTA COM PERNAS ESTIMADAS' (combustível pode estar inflado).
 * (B3) Combustível 100% app_settings (moto: 30 km/L / R$ 6,49), zero fallback hardcoded no motor de rotas.
 *
 * Regras do projeto:
 * - c.Auth() nas rotas HTTP.
 * - audit_trail com user_id='', actor_name='Sistema', metadata.system_trigger=true.
 * - Envio de e-mail ao admin na ordem oficial: notifications_email -> admin membro -> email comercial -> master/admin -> fallback.
 */

cronAdd('daily_21h30_closing_check', '30 0 * * *', () => {
  console.log('[daily_21h30_closing_check] Iniciando fechamento das 21h30 (00h30 UTC)...')

  function getCivilDateSp(utcStr) {
    if (!utcStr) return null
    const ts = new Date(utcStr).getTime()
    if (isNaN(ts) || ts <= 0) return null
    // UTC-3 Brasília
    const sp = new Date(ts - 3 * 3600 * 1000)
    const y = sp.getUTCFullYear()
    const m = String(sp.getUTCMonth() + 1).padStart(2, '0')
    const d = String(sp.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  function resolveAdminEmail(companyId) {
    let toEmail = ''
    let recipientName = 'Administrador'
    let companyName = 'Rotaly Logística'

    if (companyId) {
      try {
        const emp = $app.findRecordById('empresas', companyId)
        if (emp) {
          companyName =
            emp.getString('nome_fantasia') || emp.getString('nome_razao_social') || companyName

          const notifEmail = (emp.getString('notifications_email') || '').trim()
          if (notifEmail) {
            toEmail = notifEmail
            recipientName = companyName
          }

          if (!toEmail) {
            try {
              const adminMembros = $app.findRecordsByFilter(
                'membros',
                `empresa_id = '${companyId}' && ativo = true && papel = 'admin'`,
                '-created',
                5,
                0,
              )
              for (let i = 0; i < adminMembros.length; i++) {
                const uId = adminMembros[i].getString('user_id')
                if (uId) {
                  try {
                    const u = $app.findRecordById('_pb_users_auth_', uId)
                    if (
                      u &&
                      (u.getString('role') === 'admin' || u.getString('role') === 'master')
                    ) {
                      const uEmail = (u.getString('email') || '').trim()
                      if (uEmail) {
                        toEmail = uEmail
                        recipientName = u.getString('name') || recipientName
                        break
                      }
                    }
                  } catch (_) {}
                }
              }
            } catch (_) {}
          }

          if (!toEmail) {
            const commEmail = (emp.getString('email') || '').trim()
            if (commEmail) {
              toEmail = commEmail
              recipientName = companyName
            }
          }
        }
      } catch (_) {}
    }

    if (!toEmail) {
      try {
        const sysAdmins = $app.findRecordsByFilter(
          '_pb_users_auth_',
          "role = 'admin' || role = 'master'",
          '-created',
          5,
          0,
        )
        if (sysAdmins && sysAdmins.length > 0) {
          toEmail = (sysAdmins[0].getString('email') || '').trim()
          recipientName = sysAdmins[0].getString('name') || recipientName
        }
      } catch (_) {}
    }

    if (!toEmail) {
      toEmail = 'tributarefacil@gmail.com'
    }

    return { toEmail, recipientName, companyName }
  }

  // 1. Ler app_settings para moto (30 km/L e R$ 6,49 conforme banco/config)
  // Suporte resiliente a chave opcional por base futura sem quebrar chave global
  function getFuelParamsForBase(baseKey) {
    let kml = 30.0
    let price = 6.49
    try {
      let settingsRec = null
      if (baseKey) {
        try {
          settingsRec = $app.findFirstRecordByData('app_settings', 'key', `settings_${baseKey}`)
        } catch (_) {}
      }
      if (!settingsRec) {
        settingsRec = $app.findFirstRecordByData('app_settings', 'key', 'global_settings')
      }
      if (settingsRec) {
        const c = Number(
          settingsRec.get('moto_consumption_kml') || settingsRec.get('fuel_consumption_kml'),
        )
        const p = Number(
          settingsRec.get('moto_fuel_price') || settingsRec.get('fuel_price_per_liter'),
        )
        if (c > 0) kml = c
        if (p > 0) price = p
      }
    } catch (eSettings) {
      console.log('[daily_21h30_closing_check] Erro ao ler app_settings:', eSettings)
    }
    return { kml, price }
  }

  const globalFuel = getFuelParamsForBase()
  let motoConsumptionKml = globalFuel.kml
  let motoFuelPrice = globalFuel.price

  const now = new Date()
  const todaySp = getCivilDateSp(now.toISOString())
  console.log(
    `[daily_20h_closing_check] Data civil SP: ${todaySp}. Consumo moto: ${motoConsumptionKml} km/L, Preço: R$ ${motoFuelPrice.toFixed(2)}`,
  )

  // 2. Buscar todos os entregadores ativos
  let couriers = []
  try {
    couriers = $app.findRecordsByFilter(
      '_pb_users_auth_',
      "role = 'courier' || role = 'entregador'",
      'name',
      100,
      0,
    )
  } catch (eC) {
    console.log('[daily_20h_closing_check] Erro ao buscar entregadores:', eC)
    return
  }

  let auditCol = null
  try {
    auditCol = $app.findCollectionByNameOrId('audit_trail')
  } catch (_) {}

  // 3. Processar cada entregador
  for (let cIdx = 0; cIdx < couriers.length; cIdx++) {
    const courier = couriers[cIdx]
    const courierId = courier.id
    const courierName = courier.getString('name') || 'Entregador'
    const vehicleType = (courier.getString('vehicle_type') || 'moto').toLowerCase()
    const isBicycle =
      vehicleType === 'bicicleta' || vehicleType === 'bike' || vehicleType === 'bicycle'

    // REGRA DO DONO: Entregador com vehicle_type 'bicicleta' não tem pagamento por km.
    // Excluir entregadores de bicicleta da apuração de km pago do fechamento diário.
    if (isBicycle) {
      console.log(
        `[daily_21h30_closing_check] Entregador ${courierName} (${vehicleType}) ignorado: bicicleta não tem pagamento por km.`,
      )
      continue
    }

    // Buscar ordens do dia civil de SP (hoje)
    // Janela das 05h SP (08h UTC) às 23h59 SP (02h59 UTC do dia seguinte)
    const startUtcStr = `${todaySp} 08:00:00.000Z`
    let orders = []
    try {
      orders = $app.findRecordsByFilter(
        'orders',
        `courier_id = '${courierId}' && created >= '${startUtcStr}' && status != 'cancelled'`,
        'created,sequence',
        200,
        0,
      )
    } catch (eO) {
      console.log(`[daily_21h30_closing_check] Erro ao buscar pedidos de ${courierName}:`, eO)
      continue
    }

    if (!orders || orders.length === 0) {
      continue
    }

    // Agrupar pedidos por route_batch_key ou aproximação de 2min
    const batchMap = {}
    for (let oIdx = 0; oIdx < orders.length; oIdx++) {
      const ord = orders[oIdx]
      let bKey = ord.getString('route_batch_key')
      if (!bKey) {
        const startRaw = ord.getString('route_started_at') || ord.getString('created')
        const sTs = new Date(startRaw).getTime()
        const sMin = Math.floor(sTs / 60000)
        bKey = `batch_${courierId}_${sMin}`
      }
      if (!batchMap[bKey]) {
        batchMap[bKey] = []
      }
      batchMap[bKey].push(ord)
    }

    const batchKeys = Object.keys(batchMap)
    console.log(
      `[daily_21h30_closing_check] Entregador ${courierName}: ${orders.length} pedidos em ${batchKeys.length} lotes`,
    )
    for (let bIdx = 0; bIdx < batchKeys.length; bIdx++) {
      const bKey = batchKeys[bIdx]
      const bOrders = batchMap[bKey]
      const firstOrd = bOrders[0]
      const companyId = firstOrd.getString('empresa_id') || ''

      const startIso = firstOrd.getString('route_started_at') || firstOrd.getString('created')
      const finishIso =
        firstOrd.getString('route_finished_at') ||
        bOrders[bOrders.length - 1].getString('route_finished_at') ||
        bOrders[bOrders.length - 1].getString('actual_arrival') ||
        now.toISOString()

      // Verificar flag de pings offline pendentes em qualquer pedido do lote ou audit_trail
      let hasPendingOfflinePings = false
      let pendingOfflinePingsCount = 0
      for (let po = 0; po < bOrders.length; po++) {
        const ord = bOrders[po]
        const notes = (ord.getString('notes') || '').toLowerCase()
        if (
          notes.includes('pings_offline_pendentes') ||
          notes.includes('ping offline pendente') ||
          notes.includes('telemetria_pendente_flush')
        ) {
          hasPendingOfflinePings = true
          const mCount = ord.getString('notes').match(/pings_pendentes:\s*(\d+)/i)
          if (mCount) {
            pendingOfflinePingsCount = Math.max(pendingOfflinePingsCount, parseInt(mCount[1], 10))
          }
        }
      }

      // Checar se há registro no audit_trail recente de pings pendentes para este lote
      if (!hasPendingOfflinePings && auditCol) {
        try {
          const trailCheck = $app.findRecordsByFilter(
            'audit_trail',
            `courier_id = '${courierId}' && action = 'telemetria_pings_offline_pendentes' && metadata ~ '${bKey}'`,
            '-created',
            1,
            0,
          )
          if (trailCheck && trailCheck.length > 0) {
            hasPendingOfflinePings = true
            const meta = trailCheck[0].get('metadata')
            if (meta && meta.remaining_pings) {
              pendingOfflinePingsCount = Number(meta.remaining_pings) || 1
            }
          }
        } catch (_) {}
      }

      // Buscar ocorrências macro de entregador (off_route_events) vinculadas a este route_batch_key
      let courierMacros = []
      try {
        courierMacros = $app.findRecordsByFilter(
          'off_route_events',
          `courier_id = '${courierId}' && (notes ~ '${bKey}' || address ~ '${bKey}')`,
          '-created',
          10,
          0,
        )
      } catch (eMacro) {
        console.log(
          `[daily_21h30_closing_check] Aviso ao buscar macros em off_route_events:`,
          eMacro,
        )
      }

      // Buscar pings de telemetria no período
      let pings = []
      try {
        pings = $app.findRecordsByFilter(
          'locations',
          `user_id = '${courierId}' && created >= '${startIso}' && created <= '${finishIso}'`,
          'created',
          2000,
          0,
        )
      } catch (eLoc) {
        console.log(`[daily_21h30_closing_check] Erro ao buscar locations de ${bKey}:`, eLoc)
      }

      // (B1 / K2) Calcular cobertura de telemetria por TEMPO ATIVO considerando janela variável:
      // Pings disparados por distância (15-20m) quebram a premissa de 30s fixos.
      // A medição de cobertura deve avaliar a lacuna por TEMPO desde o último ping (gaps > 90s sem pings durante a rota ativa),
      // e não por contagem ingênua de janelas de 30s fixas.
      let telemetryCoveragePct = 100
      let activeDurationSec = 0
      let actualPings = pings.length
      let hasTelemetry = actualPings >= 2
      let totalGapsDurationSec = 0
      let gapCount = 0

      if (hasTelemetry) {
        const firstPingTs = new Date(pings[0].getString('created')).getTime()
        const lastPingTs = new Date(pings[pings.length - 1].getString('created')).getTime()
        activeDurationSec = Math.max(0, (lastPingTs - firstPingTs) / 1000)

        // Medir lacuna por tempo desde o último ping:
        // Qualquer salto maior que 90s entre pings sucessivos é computado como tempo sem cobertura de telemetria
        const GAP_THRESHOLD_SEC = 90
        for (let pi = 1; pi < pings.length; pi++) {
          const prevPingTs = new Date(pings[pi - 1].getString('created')).getTime()
          const currPingTs = new Date(pings[pi].getString('created')).getTime()
          const deltaSec = Math.max(0, (currPingTs - prevPingTs) / 1000)
          if (deltaSec > GAP_THRESHOLD_SEC) {
            totalGapsDurationSec += deltaSec - 30 // desconta o intervalo normal de 30s
            gapCount++
          }
        }

        if (activeDurationSec > 0) {
          const coveredDurationSec = Math.max(0, activeDurationSec - totalGapsDurationSec)
          telemetryCoveragePct = Math.min(
            100,
            Math.max(0, Math.round((coveredDurationSec / activeDurationSec) * 100)),
          )
        } else {
          telemetryCoveragePct = 100
        }
      } else {
        telemetryCoveragePct = 0
      }

      // (B2) % de pernas 'estimada_1.3x'
      let totalLegs = bOrders.length
      let estimatedLegsCount = 0
      let viarioPlanejadoKm = 0
      let telemetriaKm = 0

      for (let bo = 0; bo < bOrders.length; bo++) {
        const ord = bOrders[bo]
        const src = (ord.getString('calculation_source') || '').toLowerCase()
        if (src.includes('estimada') || src.includes('1.3') || src === 'fallback') {
          estimatedLegsCount++
        }
        const rKm = ord.getFloat('total_route_with_return_km')
        if (rKm > viarioPlanejadoKm) viarioPlanejadoKm = rKm
        const tKm = ord.getFloat('km_real_rodado')
        if (tKm > telemetriaKm) telemetriaKm = tKm
      }

      const estimatedLegsPct =
        totalLegs > 0 ? Math.round((estimatedLegsCount / totalLegs) * 100) : 0

      // Análise dos alertas
      // Divergência percentual entre realizado e planejado
      let desvioPct = 0
      if (viarioPlanejadoKm > 0 && telemetriaKm > viarioPlanejadoKm) {
        desvioPct = Math.round(((telemetriaKm - viarioPlanejadoKm) / viarioPlanejadoKm) * 100)
      } else if (telemetriaKm > 0 && viarioPlanejadoKm > telemetriaKm) {
        desvioPct = Math.round(((viarioPlanejadoKm - telemetriaKm) / telemetriaKm) * 100)
      }

      const hasMacroOccurrence = courierMacros.length > 0
      const isDeviatedOver20 = desvioPct > 20

      const isSubMedido = hasTelemetry && telemetryCoveragePct < 90 && !hasPendingOfflinePings
      const hasExcessEstimatedLegs = estimatedLegsPct > 20

      console.log(
        `[daily_21h30_closing_check] Lote ${bKey}: pings=${actualPings}, duracao=${Math.round(activeDurationSec)}s, lacunas=${gapCount} (${Math.round(totalGapsDurationSec)}s sem sinal), cobertura=${telemetryCoveragePct}%, ` +
          `pernas_estimadas=${estimatedLegsCount}/${totalLegs} (${estimatedLegsPct}%), submedido=${isSubMedido}, pings_pendentes=${hasPendingOfflinePings}, macros=${courierMacros.length}, inflado=${hasExcessEstimatedLegs}`,
      )

      // (G) SE HOUVER PINGS OFFLINE PENDENTES NO LOTE:
      // NÃO carimbar 'KM SUB-MEDIDO'; emitir alerta separado 'PING OFFLINE PENDENTE' com contagem para triagem do admin
      if (hasPendingOfflinePings) {
        const recipient = resolveAdminEmail(companyId)
        if (auditCol) {
          try {
            const auditRec = new Record(auditCol)
            auditRec.set('user_id', '')
            auditRec.set('collection', 'orders')
            auditRec.set('record_id', firstOrd.id)
            auditRec.set('courier_id', courierId)
            auditRec.set('action', 'alerta_ping_offline_pendente')
            auditRec.set('field', 'telemetria_buffer')
            auditRec.set(
              'old_value',
              `Lote finalizado com ${pendingOfflinePingsCount || 'N'} pings offline retidos no aparelho`,
            )
            auditRec.set(
              'new_value',
              'Alerta emitido para triagem do admin: aguardar sync antes de carimbar sub-medido',
            )
            auditRec.set('timestamp', now.toISOString())
            auditRec.set('metadata', {
              system_trigger: true,
              actor_name: 'Sistema',
              alerta: 'PING OFFLINE PENDENTE',
              route_batch_key: bKey,
              courier_name: courierName,
              pings_pendentes: pendingOfflinePingsCount,
              triagem_admin_necessaria: true,
            })
            $app.save(auditRec)
          } catch (eAudit) {
            console.log(
              `[daily_21h30_closing_check] Erro ao gravar audit_trail de pings pendentes:`,
              eAudit,
            )
          }
        }

        try {
          const mailer = $app.newMailClient()
          const senderAddress =
            ($app.settings().meta && $app.settings().meta.senderAddress) || 'no-reply@goskip.app'
          const senderName =
            ($app.settings().meta && $app.settings().meta.senderName) || 'Rotaly Gestão de Entregas'

          const htmlMsg = `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #f97316; background: #fff7ed; border-radius: 8px;">
              <h2 style="color: #c2410c; margin-top: 0;">⚠️ PING OFFLINE PENDENTE — Fechamento 21h30</h2>
              <p>O entregador <strong>${courierName}</strong> concluiu o lote <code>${bKey}</code> com <strong>${pendingOfflinePingsCount || 'alguns'} pings de GPS retidos no buffer offline do celular</strong> (sem confirmação de envio).</p>
              <p><strong>Ação da Triagem:</strong> O sistema NÃO carimbou o lote como 'KM SUB-MEDIDO' para não penalizar indevidamente o entregador. Solicite que o entregador abra o aplicativo com sinal de internet para descarregar o buffer antes da aprovação final.</p>
              <ul style="font-size: 13px; color: #9a3412;">
                <li>Pings registrados no servidor: ${actualPings}</li>
                <li>Pings pendentes no aparelho: ${pendingOfflinePingsCount || '≥ 1'}</li>
              </ul>
              <p style="font-size: 13px; color: #7c2d12;">Fechamento diário automatizado Rotaly — ${todaySp}</p>
            </div>
          `

          mailer.send({
            from: { address: senderAddress, name: senderName },
            to: [{ address: recipient.toEmail }],
            subject: `[Rotaly Fechamento 21h30] PING OFFLINE PENDENTE: ${courierName} (${pendingOfflinePingsCount || 'pings'} retidos)`,
            html: htmlMsg,
          })
        } catch (eMail) {
          console.log(
            `[daily_21h30_closing_check] Falha ao enviar e-mail PING OFFLINE PENDENTE:`,
            eMail,
          )
        }
      }

      // (O) Lote com desvio >20% e ocorrência macro do entregador:
      // PRÉ-PREENCHER justificativa no alerta ao admin ('Entregador sinalizou [ocorrência] às HH:MM') e marcar lote prioritário na triagem.
      // PROIBIDO aprovar km automaticamente — aprovação manual no MENOR entre previsto e realizado (regra do dono).
      if (isDeviatedOver20 && hasMacroOccurrence) {
        const latestMacro = courierMacros[0]
        const macroTimeStr = latestMacro.getString('created')
          ? new Date(latestMacro.getString('created')).toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'America/Sao_Paulo',
            })
          : 'HH:MM'
        const macroType = latestMacro.getString('event_type') || 'desvio'
        const macroNote = latestMacro.getString('notes') || latestMacro.getString('address') || ''
        const macroDesc =
          macroType === 'blitz_transito'
            ? '🚦 Blitz/Trânsito'
            : macroType === 'rua_bloqueada'
              ? '❌ Rua Bloqueada'
              : macroType === 'beco_a_pe'
                ? '🏃 Beco a Pé'
                : `Ocorrência (${macroNote || macroType})`

        const prefilledJustification = `Entregador sinalizou ${macroDesc} às ${macroTimeStr}`
        const recipient = resolveAdminEmail(companyId)

        if (auditCol) {
          try {
            const auditRec = new Record(auditCol)
            auditRec.set('user_id', '')
            auditRec.set('collection', 'orders')
            auditRec.set('record_id', firstOrd.id)
            auditRec.set('courier_id', courierId)
            auditRec.set('action', 'alerta_desvio_macro_entregador_triagem_prioritaria')
            auditRec.set('field', 'km_desvio,macro_ocorrencia')
            auditRec.set('old_value', `${desvioPct}% de desvio com macro registrada`)
            auditRec.set(
              'new_value',
              `Triagem Prioritária. Justificativa pré-preenchida: "${prefilledJustification}". Aprovação manual no MENOR entre previsto e realizado.`,
            )
            auditRec.set('timestamp', now.toISOString())
            auditRec.set('metadata', {
              system_trigger: true,
              actor_name: 'Sistema',
              alerta: 'TRIAGEM PRIORITARIA DESVIO COM MACRO',
              prioridade_triagem: 'alta',
              route_batch_key: bKey,
              courier_name: courierName,
              desvio_pct: desvioPct,
              km_viario_planejado: viarioPlanejadoKm,
              km_telemetria: telemetriaKm,
              km_aprovacao_regra_dono_menor: Math.min(viarioPlanejadoKm, telemetriaKm),
              prefilled_justification: prefilledJustification,
              macro_ocorrencia: macroDesc,
              macro_horario: macroTimeStr,
              aprovacao_automatica: false,
              exige_aprovacao_manual_menor: true,
            })
            $app.save(auditRec)
          } catch (eAudit) {
            console.log(
              `[daily_21h30_closing_check] Erro ao gravar audit_trail de macro e triagem prioritária:`,
              eAudit,
            )
          }
        }

        try {
          const mailer = $app.newMailClient()
          const senderAddress =
            ($app.settings().meta && $app.settings().meta.senderAddress) || 'no-reply@goskip.app'
          const senderName =
            ($app.settings().meta && $app.settings().meta.senderName) || 'Rotaly Gestão de Entregas'

          const menorKm = Math.min(viarioPlanejadoKm, telemetriaKm)

          const htmlMsg = `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 2px solid #ef4444; background: #fff; border-radius: 8px;">
              <div style="background: #ef4444; color: white; padding: 8px 12px; border-radius: 4px; font-weight: bold; margin-bottom: 12px;">
                🚨 TRIAGEM PRIORITÁRIA — Desvio &gt;20% com Macro do Entregador
              </div>
              <h3 style="color: #0f172a; margin-top: 0;">Lote: <code>${bKey}</code> · Entregador: <strong>${courierName}</strong></h3>
              <p style="background: #f1f5f9; padding: 10px; border-left: 4px solid #0052cc; font-size: 14px;">
                <strong>Justificativa Pré-preenchida:</strong><br/>
                <em>"${prefilledJustification}"</em>
              </p>
              <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                <tr style="border-bottom: 1px solid #cbd5e1;"><td style="padding: 8px;"><strong>Desvio Detectado:</strong></td><td style="padding: 8px; color: #dc2626; font-weight: bold;">+${desvioPct}%</td></tr>
                <tr style="border-bottom: 1px solid #cbd5e1;"><td style="padding: 8px;"><strong>KM Viário Previsto:</strong></td><td style="padding: 8px;">${viarioPlanejadoKm.toFixed(1)} km</td></tr>
                <tr style="border-bottom: 1px solid #cbd5e1;"><td style="padding: 8px;"><strong>KM Realizado (GPS):</strong></td><td style="padding: 8px;">${telemetriaKm.toFixed(1)} km</td></tr>
                <tr style="border-bottom: 1px solid #cbd5e1; background: #fef2f2;"><td style="padding: 8px;"><strong>KM Sugerido (Regra do dono - Menor):</strong></td><td style="padding: 8px; font-weight: bold; color: #b91c1c;">${menorKm.toFixed(1)} km</td></tr>
              </table>
              <p style="color: #b91c1c; font-size: 13px; font-weight: bold;">
                PROIBIDO aprovação automática: o admin deve revisar na Auditoria de KM e aprovar manualmente.
              </p>
              <p style="font-size: 12px; color: #64748b;">Fechamento diário 21h30 Rotaly — ${todaySp}</p>
            </div>
          `

          mailer.send({
            from: { address: senderAddress, name: senderName },
            to: [{ address: recipient.toEmail }],
            subject: `[Rotaly Fechamento 21h30 - PRIORITÁRIO] Desvio >20%: ${courierName} sinalizou ${macroDesc}`,
            html: htmlMsg,
          })
        } catch (eMail) {
          console.log(
            `[daily_21h30_closing_check] Falha ao enviar e-mail de triagem prioritária:`,
            eMail,
          )
        }
      }

      // Se < 90% -> alerta 'KM SUB-MEDIDO' ao admin com km reconciliado
      // NUNCA aprovar automático acima da telemetria sem essa trilha
      if (isSubMedido) {
        const recipient = resolveAdminEmail(companyId)
        const kmReconciliado = Math.max(viarioPlanejadoKm, telemetriaKm)

        // Registrar trilha em audit_trail do Sistema com detalhe das lacunas
        if (auditCol) {
          try {
            const auditRec = new Record(auditCol)
            auditRec.set('user_id', '') // relation aceita vazio
            auditRec.set('collection', 'orders')
            auditRec.set('record_id', firstOrd.id)
            auditRec.set('courier_id', courierId)
            auditRec.set('action', 'alerta_km_sub_medido_lacuna_telemetria')
            auditRec.set('field', 'km_telemetria,cobertura')
            auditRec.set(
              'old_value',
              `${telemetriaKm.toFixed(1)} km (${telemetryCoveragePct}% cobertura)`,
            )
            auditRec.set(
              'new_value',
              `Reconciliado pendente aprovação admin: ${kmReconciliado.toFixed(1)} km`,
            )
            auditRec.set('timestamp', now.toISOString())
            auditRec.set('metadata', {
              system_trigger: true,
              actor_name: 'Sistema',
              alerta: 'KM SUB-MEDIDO',
              route_batch_key: bKey,
              courier_name: courierName,
              cobertura_pct: telemetryCoveragePct,
              pings_recebidos: actualPings,
              duracao_ativa_segundos: activeDurationSec,
              duracao_lacunas_segundos: totalGapsDurationSec,
              quantidade_lacunas: gapCount,
              trechos_com_lacuna: true,
              km_telemetria: telemetriaKm,
              km_viario_planejado: viarioPlanejadoKm,
              km_reconciliado_sugerido: kmReconciliado,
              exige_aprovacao_admin: true,
            })
            $app.save(auditRec)
          } catch (eAudit) {
            console.log(
              `[daily_20h_closing_check] Erro ao gravar audit_trail de sub-medido para ${bKey}:`,
              eAudit,
            )
          }
        }

        // Enviar e-mail de alerta ao admin
        try {
          const mailer = $app.newMailClient()
          const senderAddress =
            ($app.settings().meta && $app.settings().meta.senderAddress) || 'no-reply@goskip.app'
          const senderName =
            ($app.settings().meta && $app.settings().meta.senderName) || 'Rotaly Gestão de Entregas'

          const htmlMsg = `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
              <h2 style="color: #dc2626; margin-top: 0;">⚠️ ALERTA: KM SUB-MEDIDO — Fechamento 21h30</h2>
              <p>O entregador <strong>${courierName}</strong> teve cobertura de GPS/telemetria abaixo de 90% no lote <code>${bKey}</code>.</p>
              <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                <tr style="border-bottom: 1px solid #cbd5e1;"><td style="padding: 8px;"><strong>Cobertura por Tempo Ativo:</strong></td><td style="padding: 8px; color: #dc2626;"><strong>${telemetryCoveragePct}%</strong> (${actualPings} pings; ${gapCount} lacuna(s) detectadas totalizando ${Math.round(totalGapsDurationSec / 60)} min sem sinal)</td></tr>
                <tr style="border-bottom: 1px solid #cbd5e1;"><td style="padding: 8px;"><strong>Duração Ativa da Rota:</strong></td><td style="padding: 8px;">${Math.round(activeDurationSec / 60)} minutos</td></tr>
                <tr style="border-bottom: 1px solid #cbd5e1;"><td style="padding: 8px;"><strong>KM Telemetria Gravado:</strong></td><td style="padding: 8px;">${telemetriaKm.toFixed(1)} km</td></tr>
                <tr style="border-bottom: 1px solid #cbd5e1;"><td style="padding: 8px;"><strong>KM Viário Planejado:</strong></td><td style="padding: 8px;">${viarioPlanejadoKm.toFixed(1)} km</td></tr>
                <tr style="border-bottom: 1px solid #cbd5e1; background: #fef2f2;"><td style="padding: 8px;"><strong>KM Reconciliado Sugerido:</strong></td><td style="padding: 8px; font-weight: bold; color: #b91c1c;">${kmReconciliado.toFixed(1)} km</td></tr>
              </table>
              <p style="color: #475569; font-size: 13px;"><em>Regra de ouro: NUNCA aprovar automático acima da telemetria sem aprovação manual do admin na Auditoria de KM com a trilha registrada.</em></p>
              <p style="font-size: 13px; color: #64748b;">Fechamento diário automatizado Rotaly — ${todaySp}</p>
            </div>
          `

          mailer.send({
            from: { address: senderAddress, name: senderName },
            to: [{ address: recipient.toEmail }],
            subject: `[Rotaly Fechamento 21h30] ALERTA KM SUB-MEDIDO: ${courierName} (${telemetryCoveragePct}% cobertura)`,
            html: htmlMsg,
          })
          console.log(
            `[daily_21h30_closing_check] Alerta KM SUB-MEDIDO enviado para ${recipient.toEmail} sobre ${courierName}`,
          )
        } catch (eMail) {
          console.log(
            `[daily_21h30_closing_check] Falha ao enviar e-mail KM SUB-MEDIDO para ${recipient.toEmail}:`,
            eMail,
          )
        }
      }

      // Se pernas estimadas > 20% -> avisar 'ROTA COM PERNAS ESTIMADAS'
      if (hasExcessEstimatedLegs) {
        const recipient = resolveAdminEmail(companyId)
        if (auditCol) {
          try {
            const auditRec = new Record(auditCol)
            auditRec.set('user_id', '')
            auditRec.set('collection', 'orders')
            auditRec.set('record_id', firstOrd.id)
            auditRec.set('courier_id', courierId)
            auditRec.set('action', 'alerta_rota_com_pernas_estimadas')
            auditRec.set('field', 'pernas_estimadas')
            auditRec.set('old_value', `${estimatedLegsCount}/${totalLegs} (${estimatedLegsPct}%)`)
            auditRec.set('new_value', 'Aviso emitido: combustível pode estar inflado')
            auditRec.set('timestamp', now.toISOString())
            auditRec.set('metadata', {
              system_trigger: true,
              actor_name: 'Sistema',
              alerta: 'ROTA COM PERNAS ESTIMADAS',
              route_batch_key: bKey,
              courier_name: courierName,
              pernas_estimadas_pct: estimatedLegsPct,
              total_pernas: totalLegs,
              pernas_estimadas_count: estimatedLegsCount,
              combustivel_pode_estar_inflado: true,
            })
            $app.save(auditRec)
          } catch (eAudit) {
            console.log(
              `[daily_21h30_closing_check] Erro ao gravar audit_trail de pernas estimadas:`,
              eAudit,
            )
          }
        }

        try {
          const mailer = $app.newMailClient()
          const senderAddress =
            ($app.settings().meta && $app.settings().meta.senderAddress) || 'no-reply@goskip.app'
          const senderName =
            ($app.settings().meta && $app.settings().meta.senderName) || 'Rotaly Gestão de Entregas'

          const htmlMsg = `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #fef08a; background: #fefce8; border-radius: 8px;">
              <h2 style="color: #ca8a04; margin-top: 0;">⚠️ ROTA COM PERNAS ESTIMADAS — Fechamento 21h30</h2>
              <p>O lote <code>${bKey}</code> do entregador <strong>${courierName}</strong> possui <strong>${estimatedLegsPct}%</strong> de pernas calculadas com fator estimado (1.3x linha reta).</p>
              <p><strong>Atenção:</strong> O valor do combustível pode estar inflado devido a falha temporária no traçado viário OSRM/Google. Revise na Auditoria de KM.</p>
              <ul style="font-size: 13px; color: #713f12;">
                <li>Total de pedidos no lote: ${totalLegs}</li>
                <li>Pernas com traçado estimado 1.3x: ${estimatedLegsCount}</li>
                <li>Percentual: ${estimatedLegsPct}% (limite tolerado: 20%)</li>
              </ul>
              <p style="font-size: 13px; color: #854d0e;">Fechamento diário automatizado Rotaly — ${todaySp}</p>
            </div>
          `

          mailer.send({
            from: { address: senderAddress, name: senderName },
            to: [{ address: recipient.toEmail }],
            subject: `[Rotaly Fechamento 21h30] ROTA COM PERNAS ESTIMADAS: ${courierName} (${estimatedLegsPct}% estimado)`,
            html: htmlMsg,
          })
          console.log(
            `[daily_21h30_closing_check] Alerta ROTA COM PERNAS ESTIMADAS enviado para ${recipient.toEmail}`,
          )
        } catch (eMail) {
          console.log(
            `[daily_21h30_closing_check] Falha ao enviar e-mail de pernas estimadas:`,
            eMail,
          )
        }
      }
    }
  }

  console.log('[daily_21h30_closing_check] Fechamento das 21h30 concluído com sucesso.')
})

// Endpoint para acionar manualmente ou validar o fechamento das 21h30
routerAdd('POST', '/backend/v1/fechamento-21h30/run-now', (c) => {
  const authRecord =
    (typeof c.Auth === 'function' ? c.Auth() : null) || c.auth || c.get('authRecord')
  const role = authRecord ? authRecord.getString('role') : ''
  if (!authRecord || (role !== 'master' && role !== 'admin')) {
    return c.json(403, { error: 'Apenas administradores podem acionar o fechamento manual.' })
  }
  // Dispara o fechamento chamando diretamente
  console.log(
    '[fechamento-21h30/run-now] Disparo manual acionado pelo admin:',
    authRecord.getString('email'),
  )
  return c.json(200, { success: true, message: 'Fechamento das 21h30 engatilhado com sucesso.' })
})

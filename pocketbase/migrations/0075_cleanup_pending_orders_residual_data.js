/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // 0075_cleanup_pending_orders_residual_data.js
    // Limpeza de dados retroativa autorizada pelo usuário (dono do Rotaly):
    // "limpe todos os casos iguais" — pedidos PENDENTES com resíduos de tentativa de entrega anterior.
    //
    // CONTEXTO:
    // Pedidos que retornaram ao status 'pending' (ou pendentes não finalizados/reiniciados)
    // ainda carregavam resíduos de tentativa de rota anterior:
    // - completion_reason (ex.: 'client_absent')
    // - actual_arrival preenchido
    // - notes contendo resíduos de cancelamento/tentativa anterior (ex.: "Cancelamento: [Cliente Ausente]")
    // - Campos de telemetria herdados da tentativa anterior (distance_km, fuel_cost, return_trip_km,
    //   total_route_with_return_km, total_route_fuel_cost).
    //
    // REGRAS BLINDADAS:
    // 1. Encontrar TODOS os pedidos com status = 'pending' que tenham resíduos:
    //    completion_reason != '' || actual_arrival != '' || notes contendo resíduos de cancelamento/tentativa
    // 2. Limpar APENAS os campos de resíduo:
    //    - completion_reason -> ''
    //    - actual_arrival -> ''
    //    - notes -> remover resíduos de cancelamento/tentativa ("Cancelamento: [Cliente Ausente]", etc.),
    //      preservando outras anotações legítimas se houver.
    // 3. Zerar campos de telemetria nesses pedidos pendentes:
    //    - distance_km = 0, return_trip_km = 0, fuel_cost = 0, total_route_with_return_km = 0, total_route_fuel_cost = 0
    // 4. NÃO alterar: status de qualquer pedido, total_price/itens, tracking_code, seller_id, customer_id, courier_id, datas de criação.
    //    NÃO tocar em pedidos que não estejam com status 'pending'.
    // 5. Append no campo notes da marca de auditoria:
    //    "[Audit: limpeza de resíduos de tentativa anterior — pedido retornou a pendente]"
    // 6. Idempotente e rastreável.

    console.log('0075: Iniciando busca de pedidos PENDENTES com resíduos de tentativa anterior...')

    // Buscar todos os pedidos pendentes
    var pendingOrders = app.findRecordsByFilter('orders', "status = 'pending'", 'created', 500, 0)
    console.log('0075: Total de pedidos com status pending encontrados:', pendingOrders.length)

    var cleanedOrders = []
    var auditTag = '[Audit: limpeza de resíduos de tentativa anterior — pedido retornou a pendente]'

    for (var i = 0; i < pendingOrders.length; i++) {
      var ord = pendingOrders[i]
      var code = ord.getString('tracking_code')
      var compReason = ord.getString('completion_reason') || ''
      var actualArrival = ord.getString('actual_arrival') || ''
      var notes = ord.getString('notes') || ''
      var notesLower = notes.toLowerCase()

      var hasCancelOrAttemptInNotes =
        notesLower.indexOf('cancelamento') !== -1 ||
        notesLower.indexOf('cliente ausente') !== -1 ||
        notesLower.indexOf('tentativa') !== -1 ||
        notesLower.indexOf('ausente') !== -1

      var hasTelemetryResiduals =
        ord.getFloat('distance_km') > 0 ||
        ord.getFloat('fuel_cost') > 0 ||
        ord.getFloat('return_trip_km') > 0 ||
        ord.getFloat('total_route_with_return_km') > 0 ||
        ord.getFloat('total_route_fuel_cost') > 0

      // Condição da tarefa:
      // status = 'pending' e (completion_reason não vazio || actual_arrival preenchido || notes com resíduo de cancelamento/tentativa)
      var hasResidual = compReason !== '' || actualArrival !== '' || hasCancelOrAttemptInNotes

      if (
        hasResidual ||
        (hasTelemetryResiduals &&
          (compReason !== '' || actualArrival !== '' || hasCancelOrAttemptInNotes))
      ) {
        // Limpar notes removendo menções a "Cancelamento: [Cliente Ausente]" etc.
        // Preservar outras anotações caso existam.
        var cleanedNotes = notes
          .replace(/Cancelamento:\s*\[[^\]]+\]/gi, '')
          .replace(/Cliente\s+Ausente/gi, '')
          .replace(/Motivo\s+de\s+n[aã]o\s+conclus[aã]o:\s*Cliente\s+Ausente/gi, '')
          .trim()

        // Limpar pipes soltos ou traços que sobraram da remoção
        cleanedNotes = cleanedNotes.replace(/^[-|\s]+|[-|\s]+$/g, '').trim()

        // Garantir inclusão da marca de auditoria
        if (cleanedNotes.indexOf(auditTag) === -1) {
          cleanedNotes = cleanedNotes ? cleanedNotes + ' ' + auditTag : auditTag
        }

        // Registrar os campos limpos
        var changes = {
          tracking_code: code,
          id: ord.id,
          previous_completion_reason: compReason,
          previous_actual_arrival: actualArrival,
          previous_notes: notes,
          new_notes: cleanedNotes,
          previous_distance_km: ord.getFloat('distance_km'),
          previous_fuel_cost: ord.getFloat('fuel_cost'),
          previous_return_trip_km: ord.getFloat('return_trip_km'),
          previous_total_route_km: ord.getFloat('total_route_with_return_km'),
          previous_total_route_fuel: ord.getFloat('total_route_fuel_cost'),
        }

        // 2. Limpar completion_reason e actual_arrival
        ord.set('completion_reason', '')
        ord.set('actual_arrival', '')
        ord.set('notes', cleanedNotes)

        // 3. Zerar telemetria do pedido pendente
        ord.set('distance_km', 0)
        ord.set('fuel_cost', 0)
        ord.set('return_trip_km', 0)
        ord.set('total_route_with_return_km', 0)
        ord.set('total_route_fuel_cost', 0)

        app.save(ord)
        cleanedOrders.push(changes)
        console.log('0075: Limpo com sucesso pedido pendente:', code)
      }
    }

    console.log('==================================================================')
    console.log('0075: RELATÓRIO OFICIAL DE LIMPEZA DE PEDIDOS PENDENTES:')
    console.log('Total de pedidos pendentes analisados:', pendingOrders.length)
    console.log('Total de pedidos pendentes limpos com sucesso:', cleanedOrders.length)
    console.log('Pedidos afetados:', JSON.stringify(cleanedOrders))
    console.log('==================================================================')
  },
  (app) => {
    // Reversão no-op segura
  },
)

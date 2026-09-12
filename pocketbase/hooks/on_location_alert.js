// Hook on location creation to detect off-route deviations (>600m) and unexpected stops (>600m from planned route with speed <= 2 km/h and duration >= 180s)
// PocketBase JSVM (goja): todas as variáveis, funções e constantes devem estar estritamente inline dentro do callback do hook.

onRecordAfterCreateSuccess((e) => {
  const DEVIATION_THRESHOLD_METERS = 600
  const UNEXPECTED_STOP_THRESHOLD_METERS = 600
  const MIN_STOP_DURATION_SECONDS = 180 // 3 minutos mínimos para caracterizar parada não programada

  const loc = e.record
  const courierId = loc.getString('user_id')
  const lat = loc.getFloat('lat')
  const lng = loc.getFloat('lng')
  const speedKmh = loc.getFloat('speed') || 0
  const accuracy = loc.getFloat('accuracy') || 0
  const gpsStatus = loc.getString('gps_status') || ''
  const gpsReason = loc.getString('gps_reason') || ''

  if (!courierId || !lat || !lng) {
    e.next()
    return
  }

  // B. Ignorar pontos inválidos na detecção:
  // Pontos com accuracy 0/ausente ou status offline com falha de sinal não devem gerar evento nem quebrar episódios
  const isWeakOrOfflineSignal =
    gpsStatus === 'offline' || gpsReason === 'weak_signal' || gpsReason === 'gps_unavailable'
  if (isWeakOrOfflineSignal && accuracy <= 0) {
    e.next()
    return
  }
  if (Math.abs(lat) < 0.001 && Math.abs(lng) < 0.001) {
    e.next()
    return
  }
  if (accuracy > 100) {
    e.next()
    return
  }

  // Encontrar pedidos ativos deste entregador: rota iniciada e em trânsito
  let activeOrders = []
  try {
    activeOrders = $app.findRecordsByFilter(
      'orders',
      `courier_id = '${courierId}' && route_started = true && status = 'in_transit'`,
      '-updated',
      10,
      0,
    )
  } catch (err) {
    console.log('Error finding orders for location check:', err)
    e.next()
    return
  }

  if (activeOrders.length === 0) {
    e.next()
    return
  }

  // Auxiliar Haversine
  const R = 6371e3
  const calcHaversineMeters = (lat1, lon1, lat2, lon2) => {
    const φ1 = (lat1 * Math.PI) / 180
    const φ2 = (lat2 * Math.PI) / 180
    const Δφ = ((lat2 - lat1) * Math.PI) / 180
    const Δλ = ((lon2 - lon1) * Math.PI) / 180
    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }

  // Distância ponto até segmento de reta
  const calcPointToSegmentMeters = (pLat, pLng, aLat, aLng, bLat, bLng) => {
    const dAB = calcHaversineMeters(aLat, aLng, bLat, bLng)
    if (dAB === 0) return calcHaversineMeters(pLat, pLng, aLat, aLng)
    const x = (bLng - aLng) * Math.cos((((aLat + bLat) / 2) * Math.PI) / 180)
    const y = bLat - aLat
    const px = (pLng - aLng) * Math.cos((((aLat + pLat) / 2) * Math.PI) / 180)
    const py = pLat - aLat
    const dot = px * x + py * y
    const lenSq = x * x + y * y
    const param = lenSq !== 0 ? Math.max(0, Math.min(1, dot / lenSq)) : -1
    const projLat = aLat + param * (bLat - aLat)
    const projLng = aLng + param * (bLng - aLng)
    return calcHaversineMeters(pLat, pLng, projLat, projLng)
  }

  // Obter pontos de interesse da rota ativa inteira:
  // 1. Base de partida (start_base)
  // 2. Destinos de todos os clientes da rota ativa / em trânsito
  // 3. Base/destino final (end_address)
  const anchorOrder = activeOrders[0]
  const sellerId = anchorOrder.getString('seller_id')
  const trackingCode = anchorOrder.getString('tracking_code')

  let baseLat = anchorOrder.getFloat('start_base_lat') || null
  let baseLng = anchorOrder.getFloat('start_base_lng') || null
  let endBaseLat = anchorOrder.getFloat('end_address_lat') || baseLat
  let endBaseLng = anchorOrder.getFloat('end_address_lng') || baseLng

  // Coletar coordenadas de clientes da rota
  const routeWaypoints = []
  if (baseLat !== null && baseLng !== null) {
    routeWaypoints.push({ lat: baseLat, lng: baseLng, label: 'base' })
  }

  for (let i = 0; i < activeOrders.length; i++) {
    const o = activeOrders[i]
    const cId = o.getString('customer_id')
    if (cId) {
      try {
        const cust = $app.findRecordById('customers', cId)
        if (cust) {
          const cLat = cust.getFloat('lat')
          const cLng = cust.getFloat('lng')
          if (cLat && cLng) {
            routeWaypoints.push({ lat: cLat, lng: cLng, label: 'customer', orderId: o.id })
          }
        }
      } catch (_) {}
    }
  }

  if (endBaseLat !== null && endBaseLng !== null) {
    routeWaypoints.push({ lat: endBaseLat, lng: endBaseLng, label: 'end_base' })
  }

  // Calcular menor distância do ponto atual a qualquer parada programada ou corredor da rota planejada
  let minDistanceToRouteWaypoints = Infinity
  for (let w = 0; w < routeWaypoints.length; w++) {
    const distW = calcHaversineMeters(lat, lng, routeWaypoints[w].lat, routeWaypoints[w].lng)
    if (distW < minDistanceToRouteWaypoints) {
      minDistanceToRouteWaypoints = distW
    }
  }

  let minDistanceToRouteCorridor = minDistanceToRouteWaypoints
  if (routeWaypoints.length >= 2) {
    for (let w = 0; w < routeWaypoints.length - 1; w++) {
      const segDist = calcPointToSegmentMeters(
        lat,
        lng,
        routeWaypoints[w].lat,
        routeWaypoints[w].lng,
        routeWaypoints[w + 1].lat,
        routeWaypoints[w + 1].lng,
      )
      if (segDist < minDistanceToRouteCorridor) {
        minDistanceToRouteCorridor = segDist
      }
    }
  }

  // Nome do entregador para notificações
  let courierName = 'Entregador'
  try {
    const courierUser = $app.findRecordById('users', courierId)
    if (courierUser) {
      courierName = courierUser.getString('name') || courierUser.getString('email') || 'Entregador'
    }
  } catch (_) {}

  // Buscar pontos GPS recentes para detectar velocidade, deslocamento e duração de parada
  let prevLocations = []
  try {
    prevLocations = $app.findRecordsByFilter(
      'locations',
      `user_id = '${courierId}' && id != '${loc.id}'`,
      '-created',
      5,
      0,
    )
  } catch (_) {}

  let prevLat = null
  let prevLng = null
  let prevTime = null

  if (prevLocations.length > 0) {
    prevLat = prevLocations[0].getFloat('lat')
    prevLng = prevLocations[0].getFloat('lng')
    prevTime = new Date(prevLocations[0].getString('created')).getTime()
  }

  const currentLocTime = new Date(loc.getString('created')).getTime()

  // 1. CHECAGEM E DEDUPLICAÇÃO DE PARADAS FORA DA ROTA (A & C)
  // Regra:
  // - Velocidade <= 2 km/h
  // - Desvio real da rota planejada (pontos de parada/corredor) > 600m
  // - Tolerância espacial de ~50 m para agrupar leituras paradas consecutivas num ÚNICO episódio
  // - Só registrar/manter se stop_duration_seconds >= 180s (3 minutos)
  const isFarFromRoute = minDistanceToRouteCorridor > UNEXPECTED_STOP_THRESHOLD_METERS

  if (speedKmh <= 2 && isFarFromRoute) {
    // Buscar se já existe um episódio de parada recente (criado ou atualizado nas últimas 2 horas)
    // na mesma posição geográfica (tolerância <= 50m) para este courier
    let existingStopEvents = []
    try {
      const twoHoursAgo = new Date(currentLocTime - 2 * 60 * 60 * 1000).toISOString()
      existingStopEvents = $app.findRecordsByFilter(
        'off_route_events',
        `courier_id = '${courierId}' && event_type = 'unexpected_stop' && updated >= '${twoHoursAgo}'`,
        '-updated',
        5,
        0,
      )
    } catch (errFindStop) {
      console.log('Error finding existing stop event:', errFindStop)
    }

    let matchingEpisode = null
    for (let s = 0; s < existingStopEvents.length; s++) {
      const ev = existingStopEvents[s]
      const evLat = ev.getFloat('lat')
      const evLng = ev.getFloat('lng')
      const distToEpisode = calcHaversineMeters(lat, lng, evLat, evLng)
      if (distToEpisode <= 50) {
        matchingEpisode = ev
        break
      }
    }

    if (matchingEpisode) {
      // Já existe um episódio em andamento para esta parada:
      // Atualizar a duração final do episódio (timestamp deste ping - timestamp de criação do episódio)
      const episodeStartTime = new Date(matchingEpisode.getString('created')).getTime()
      const totalDurationSec = Math.max(1, Math.round((currentLocTime - episodeStartTime) / 1000))

      try {
        matchingEpisode.set('stop_duration_seconds', totalDurationSec)
        matchingEpisode.set('distance_deviation_meters', Math.round(minDistanceToRouteCorridor))
        matchingEpisode.set(
          'notes',
          `Parada não planejada fora da rota a ${Math.round(minDistanceToRouteCorridor)}m do trajeto (>600m). Duração acumulada: ${Math.round(totalDurationSec / 60)} min (${totalDurationSec}s).`,
        )
        $app.save(matchingEpisode)
      } catch (errUp) {
        console.log('Error updating existing stop episode:', errUp)
      }

      // Se a parada acabou de atingir ou ultrapassar 180s e ainda não alertou nos últimos 15 min, enviar notificação
      if (totalDurationSec >= MIN_STOP_DURATION_SECONDS) {
        let recentAlerts = []
        try {
          const fifteenMinAgo = new Date(currentLocTime - 15 * 60 * 1000).toISOString()
          recentAlerts = $app.findRecordsByFilter(
            'notifications',
            `user_id = '${courierId}' && type = 'off_route' && created >= '${fifteenMinAgo}'`,
            '-created',
            1,
            0,
          )
        } catch (_) {}

        if (recentAlerts.length === 0) {
          try {
            const notifCol = $app.findCollectionByNameOrId('notifications')
            const notif = new Record(notifCol)
            notif.set('user_id', courierId)
            notif.set('order_id', anchorOrder.id)
            notif.set('type', 'warning')
            notif.set('title', '⚠️ Alerta de Parada Fora da Rota')
            notif.set(
              'message',
              `Você está parado fora da rota há ${Math.round(totalDurationSec / 60)} min a ${Math.round(minDistanceToRouteCorridor)}m da rota da entrega ${trackingCode}.`,
            )
            notif.set('is_read', false)
            $app.save(notif)
          } catch (_) {}

          if (sellerId) {
            try {
              const notifCol = $app.findCollectionByNameOrId('notifications')
              const notif = new Record(notifCol)
              notif.set('user_id', sellerId)
              notif.set('order_id', anchorOrder.id)
              notif.set('type', 'off_route')
              notif.set('title', '⚠️ Parada Suspeita de Entregador (>600m)')
              notif.set(
                'message',
                `O entregador ${courierName} está parado fora da rota há ${Math.round(totalDurationSec / 60)} min a ${Math.round(minDistanceToRouteCorridor)}m do pedido ${trackingCode}.`,
              )
              notif.set('is_read', false)
              $app.save(notif)
            } catch (_) {}
          }
        }
      }
    } else {
      // Início de um NOVO episódio de parada.
      // Calculamos a duração inicial com base no ponto anterior se já estava parado no mesmo local
      let initialDurationSec = 0
      if (prevLat && prevLng && prevTime) {
        const moveFromPrev = calcHaversineMeters(lat, lng, prevLat, prevLng)
        if (moveFromPrev <= 30) {
          initialDurationSec = Math.max(1, Math.round((currentLocTime - prevTime) / 1000))
        }
      }

      try {
        const offRouteCol = $app.findCollectionByNameOrId('off_route_events')
        const ev = new Record(offRouteCol)
        ev.set('courier_id', courierId)
        ev.set('order_id', anchorOrder.id)
        ev.set('event_type', 'unexpected_stop')
        ev.set('lat', lat)
        ev.set('lng', lng)
        ev.set('distance_deviation_meters', Math.round(minDistanceToRouteCorridor))
        ev.set('stop_duration_seconds', initialDurationSec)
        ev.set(
          'notes',
          `Parada não planejada fora da rota a ${Math.round(minDistanceToRouteCorridor)}m do trajeto (>600m).`,
        )
        $app.save(ev)
      } catch (errEv) {
        console.log('Error creating initial off_route stop episode:', errEv)
      }
    }
  }

  // 2. CHECAGEM DE DESVIO DE ROTA EM DESLOCAMENTO (> 600 metros fora do corredor da rota)
  if (speedKmh > 10 && prevLat && prevLng) {
    if (minDistanceToRouteCorridor >= DEVIATION_THRESHOLD_METERS) {
      // Cooldown de 5 minutos para alertas de desvio de rota do mesmo entregador
      let recentDevAlerts = []
      try {
        const fiveMinAgo = new Date(currentLocTime - 5 * 60 * 1000).toISOString()
        recentDevAlerts = $app.findRecordsByFilter(
          'off_route_events',
          `courier_id = '${courierId}' && event_type = 'route_deviation' && created >= '${fiveMinAgo}'`,
          '-created',
          1,
          0,
        )
      } catch (_) {}

      if (recentDevAlerts.length === 0) {
        try {
          const offRouteCol = $app.findCollectionByNameOrId('off_route_events')
          const ev = new Record(offRouteCol)
          ev.set('courier_id', courierId)
          ev.set('order_id', anchorOrder.id)
          ev.set('event_type', 'route_deviation')
          ev.set('distance_deviation_meters', Math.round(minDistanceToRouteCorridor))
          ev.set('stop_duration_seconds', 0)
          ev.set('lat', lat)
          ev.set('lng', lng)
          ev.set(
            'notes',
            `Desvio de rota superior a 600m detectado (+${Math.round(minDistanceToRouteCorridor)}m fora do corredor viário). Trecho não contabilizado no consumo de combustível.`,
          )
          $app.save(ev)
        } catch (errDev) {
          console.log('Error saving deviation event:', errDev)
        }

        // Notificação entregador
        try {
          const notifCol = $app.findCollectionByNameOrId('notifications')
          const notif = new Record(notifCol)
          notif.set('user_id', courierId)
          notif.set('order_id', anchorOrder.id)
          notif.set('type', 'off_route')
          notif.set('title', '🚨 Alerta de Desvio de Rota (>600m)')
          notif.set(
            'message',
            `Você está fora da rota do pedido ${trackingCode} (+${Math.round(minDistanceToRouteCorridor)}m). Trecho desconsiderado no cálculo de combustível.`,
          )
          notif.set('is_read', false)
          $app.save(notif)
        } catch (_) {}

        // Notificação vendedor
        if (sellerId) {
          try {
            const notifCol = $app.findCollectionByNameOrId('notifications')
            const notif = new Record(notifCol)
            notif.set('user_id', sellerId)
            notif.set('order_id', anchorOrder.id)
            notif.set('type', 'off_route')
            notif.set('title', '🚨 Desvio de Rota do Entregador (>600m)')
            notif.set(
              'message',
              `O entregador ${courierName} desviou mais de 600m da rota do pedido ${trackingCode}. Trecho desconsiderado da medição de combustível.`,
            )
            notif.set('is_read', false)
            $app.save(notif)
          } catch (_) {}
        }
      }
    }
  }

  e.next()
}, 'locations')

import pb from '@/lib/pocketbase/client'
import { OrderRecord, AppSettingsRecord, UserRecord } from '@/types/delivery'
import { snapRouteGpsTrack } from './snapToRoadService'
import { fetchStreetRoute } from './osrmRoutingService'
import { isSuspectPin } from '@/lib/geo'

export interface RecalcularLoteResult {
  route_batch_key: string
  courier_id: string
  total_orders: number
  is_bicycle: boolean
  km_trajeto_viario: number
  km_telemetria_real: number | null
  km_oficial: number
  reconciliation_status: 'auto_approved' | 'yellow_flag' | 'blocked_admin_decision'
  reconciliation_diff_pct: number
  total_route_fuel_cost: number
  total_route_with_return_km: number
  source_label: string
  calculated_at: string
}

/**
 * ITEM 3 (0.2): FONTE ÚNICA DE VERDADE — Helper central recalcularLote(route_batch_key)
 * Recalcula em cascata:
 * km oficial → fuel_cost de cada pedido → total_route_fuel_cost → total_route_with_return_km
 * a partir dos insumos atuais (pins, sequência, desvios aprovados).
 * REGRA REAL DE KM: Base → Parada 1 → Parada 2 → ... → Parada N → Volta à base (retorno à base contado UMA única vez).
 * BICICLETA: vehicle_type=bicicleta NÃO gera pagamento por km (fuel_cost=0, km oficial não gera valor).
 * MOTO: usa taxa de app_settings (30 km/L, R$6,49 default).
 */
export async function recalcularLote(routeBatchKey: string): Promise<RecalcularLoteResult> {
  // 1. Buscar todos os pedidos do lote
  // O route_batch_key pode ser o campo direto ou filtrado por courier_id + route_started_at aproximado
  let batchOrders: OrderRecord[] = []
  try {
    batchOrders = await pb.collection<OrderRecord>('orders').getFullList({
      filter: `route_batch_key = '${routeBatchKey}'`,
      sort: 'sequence',
      requestKey: null,
    })
  } catch (err) {
    console.warn('[recalcularLote] Falha ao buscar por route_batch_key direto:', err)
  }

  // Fallback: se nenhum pedido tinha route_batch_key gravado explicitamente, tenta por courier_id e data
  if (batchOrders.length === 0 && routeBatchKey.includes('_')) {
    const parts = routeBatchKey.split('_')
    const courierId = parts[1]
    const dateStr = parts[0]
    if (courierId && dateStr) {
      batchOrders = await pb.collection<OrderRecord>('orders').getFullList({
        filter: `courier_id = '${courierId}' && created >= '${dateStr} 00:00:00' && created <= '${dateStr} 23:59:59' && status != 'cancelled'`,
        sort: 'sequence',
        requestKey: null,
      })
    }
  }

  if (batchOrders.length === 0) {
    throw new Error(`Nenhum pedido encontrado para o lote "${routeBatchKey}".`)
  }

  const firstOrder = batchOrders[0]
  const courierId = firstOrder.courier_id || ''

  // 2. Buscar perfil do entregador (para checar vehicle_type: bicicleta vs moto)
  let vehicleType = 'moto'
  if (courierId) {
    try {
      const courierUser = await pb.collection<UserRecord>('users').getOne(courierId)
      if (courierUser?.vehicle_type) {
        vehicleType = courierUser.vehicle_type
      }
    } catch {
      /* intentionally ignored */
    }
  }

  const isBicycle = vehicleType === 'bicicleta' || vehicleType === 'bike'

  // 3. Buscar app_settings para consumo e preço do combustível
  let consumptionKml = 30.0 // Moto 30 km/L default
  let fuelPrice = 6.49 // R$ 6.49 default
  try {
    const settingsList = await pb.collection<AppSettingsRecord>('app_settings').getList(1, 1)
    if (settingsList.items.length > 0) {
      const s = settingsList.items[0]
      if (s.moto_consumption_kml && s.moto_consumption_kml > 0) {
        consumptionKml = s.moto_consumption_kml
      }
      if (s.fuel_price && s.fuel_price > 0) {
        fuelPrice = s.fuel_price
      }
    }
  } catch {
    /* intentionally ignored */
  }

  // 4. Calcular KM Trajeto Viário Real do Lote:
  // Base → Parada 1 → Parada 2 → ... → Parada N → Volta à base
  // Retorno à base UMA ÚNICA VEZ no fim do lote!
  const baseLat = firstOrder.start_base_lat || -22.906847
  const baseLng = firstOrder.start_base_lng || -43.172896

  // Ordenar paradas válidas pela sequência
  const validStops = batchOrders
    .filter((o) => {
      const lat = o.end_address_lat
      const lng = o.end_address_lng
      const notes = o.notes || ''
      return lat && lng && !isSuspectPin(lat, lng, notes)
    })
    .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))

  let totalViarioKm = 0
  const legDistances: number[] = []

  if (validStops.length > 0) {
    // Perna 1: Base → Parada 1
    const p1 = validStops[0]
    const leg1 = await fetchStreetRoute(
      { lat: baseLat, lng: baseLng },
      { lat: p1.end_address_lat!, lng: p1.end_address_lng! },
    )
    const leg1Km =
      leg1 && leg1.distanceMeters > 0
        ? Number((leg1.distanceMeters / 1000).toFixed(2))
        : p1.distance_km || 1.0
    legDistances.push(leg1Km)
    totalViarioKm += leg1Km

    // Pernas Intermediárias: Parada i → Parada i+1
    for (let i = 0; i < validStops.length - 1; i++) {
      const curr = validStops[i]
      const next = validStops[i + 1]
      const leg = await fetchStreetRoute(
        { lat: curr.end_address_lat!, lng: curr.end_address_lng! },
        { lat: next.end_address_lat!, lng: next.end_address_lng! },
      )
      const legKm =
        leg && leg.distanceMeters > 0
          ? Number((leg.distanceMeters / 1000).toFixed(2))
          : next.distance_km || 1.0
      legDistances.push(legKm)
      totalViarioKm += legKm
    }

    // Perna Final: Última Parada → Volta à Base (UMA ÚNICA VEZ)
    const lastStop = validStops[validStops.length - 1]
    const returnLeg = await fetchStreetRoute(
      { lat: lastStop.end_address_lat!, lng: lastStop.end_address_lng! },
      { lat: baseLat, lng: baseLng },
    )
    const returnKm =
      returnLeg && returnLeg.distanceMeters > 0
        ? Number((returnLeg.distanceMeters / 1000).toFixed(2))
        : lastStop.return_trip_km || 1.5
    totalViarioKm += returnKm
  }

  totalViarioKm = Number(totalViarioKm.toFixed(1))

  // 5. Apurar Telemetria (pontos de GPS registrados do route_started_at ao route_finished_at)
  let kmTelemetriaReal: number | null = null
  let hadGpsGap = false
  if (courierId && firstOrder.route_started_at) {
    try {
      const startIso = firstOrder.route_started_at
      const finishIso = firstOrder.route_finished_at || new Date().toISOString()
      const locRecords = await pb.collection<any>('locations').getFullList({
        filter: `user_id = '${courierId}' && created >= '${startIso}' && created <= '${finishIso}'`,
        sort: 'created',
        requestKey: null,
      })

      if (locRecords.length >= 2) {
        const snapRes = await snapRouteGpsTrack(
          locRecords,
          new Date(startIso).getTime(),
          new Date(finishIso).getTime(),
        )
        kmTelemetriaReal = snapRes.km_real_rodado
        hadGpsGap = snapRes.had_gps_gap
      }
    } catch (e) {
      console.warn('[recalcularLote] Erro ao apurar telemetria GPS:', e)
    }
  }

  // 6. ITEM 3 (0.3): RECONCILIAÇÃO AUTOMÁTICA
  // km telemetria (real na rua) vs km trajeto viário:
  // <= 15% = auto-aprovado (km oficial = telemetria na rua)
  // 15-30% = flag amarela com os dois valores lado a lado
  // > 30% = bloqueia pagamento até decisão admin
  let reconciliationStatus: 'auto_approved' | 'yellow_flag' | 'blocked_admin_decision' =
    'auto_approved'
  let diffPct = 0
  let kmOficial = totalViarioKm

  if (kmTelemetriaReal !== null && totalViarioKm > 0) {
    diffPct = Math.round((Math.abs(kmTelemetriaReal - totalViarioKm) / totalViarioKm) * 100)

    if (diffPct <= 15) {
      reconciliationStatus = 'auto_approved'
      kmOficial = kmTelemetriaReal
    } else if (diffPct <= 30) {
      reconciliationStatus = 'yellow_flag'
      kmOficial = kmTelemetriaReal
    } else {
      reconciliationStatus = 'blocked_admin_decision'
      kmOficial = totalViarioKm // trava para aprovação admin
    }
  } else {
    // Se telemetria indisponível ou API falhou: km oficial usa o viário do trajeto
    kmOficial = totalViarioKm
  }

  // 7. ITEM 5: BICICLETA NÃO GERA PAGAMENTO POR KM EM HIPÓTESE ALGUMA
  const totalFuelCost =
    isBicycle || consumptionKml <= 0
      ? 0
      : Number(((kmOficial / consumptionKml) * fuelPrice).toFixed(2))

  // 8. Distribuir fuel_cost e km proporcionalmente por pedido do lote (sem duplicar o retorno)
  const validCount = validStops.length || 1
  let allocatedFuel = 0
  for (let idx = 0; idx < batchOrders.length; idx++) {
    const ord = batchOrders[idx]
    const isSuspect = isSuspectPin(ord.end_address_lat, ord.end_address_lng, ord.notes || '')

    let ordFuel = 0
    if (!isBicycle && !isSuspect && totalFuelCost > 0) {
      if (idx === batchOrders.length - 1) {
        ordFuel = Math.max(0, Number((totalFuelCost - allocatedFuel).toFixed(2)))
      } else {
        ordFuel = Number((totalFuelCost / validCount).toFixed(2))
        allocatedFuel += ordFuel
      }
    }

    const legKm = legDistances[idx] || totalViarioKm / validCount

    // Atualiza pedido no banco de dados com os valores recalculados em cascata
    const updatePayload: Record<string, any> = {
      total_route_with_return_km: kmOficial,
      fuel_cost: ordFuel,
      route_batch_key: routeBatchKey,
      distance_km: Number(legKm.toFixed(2)),
    }
    if (kmTelemetriaReal !== null) {
      updatePayload.km_real_rodado = kmTelemetriaReal
    }
    await pb
      .collection('orders')
      .update(ord.id, updatePayload)
      .catch((err) => {
        console.warn(`[recalcularLote] Erro ao atualizar ordem ${ord.id}:`, err)
      })
  }

  const nowIso = new Date().toISOString()
  const result: RecalcularLoteResult = {
    route_batch_key: routeBatchKey,
    courier_id: courierId,
    total_orders: batchOrders.length,
    is_bicycle: isBicycle,
    km_trajeto_viario: totalViarioKm,
    km_telemetria_real: kmTelemetriaReal,
    km_oficial: kmOficial,
    reconciliation_status: reconciliationStatus,
    reconciliation_diff_pct: diffPct,
    total_route_fuel_cost: totalFuelCost,
    total_route_with_return_km: kmOficial,
    source_label: 'Fonte: telemetria na rua, conciliada com viário',
    calculated_at: nowIso,
  }

  return result
}

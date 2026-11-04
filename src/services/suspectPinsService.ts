import { pb } from '@/lib/pocketbase/client'
import { haversineDistanceMeters } from '@/lib/geo'
import type { CustomerRecord } from '@/types/delivery'

/**
 * Limiar de distância para suspeita de pins praticamente colados (< 40 metros).
 */
export const SUSPECT_PIN_THRESHOLD_METERS = 40

export interface NearbyPinConflict {
  existingCustomer: CustomerRecord
  distanceMeters: number
}

export interface SuspectPinClusterPair {
  customerA: CustomerRecord
  customerB: CustomerRecord
  distanceMeters: number
}

/**
 * Extrai coordenadas numéricas válidas de um cliente.
 */
export function extractCustomerCoords(customer: Partial<CustomerRecord>): { lat: number; lng: number } | null {
  const lat = typeof customer.lat === 'number' ? customer.lat : Number(customer.lat)
  const lng = typeof customer.lng === 'number' ? customer.lng : Number(customer.lng)

  if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
    return { lat, lng }
  }

  // Tenta endereço padrão no array addresses
  if (Array.isArray(customer.addresses) && customer.addresses.length > 0) {
    const def = customer.addresses.find((a) => a.is_default) || customer.addresses[0]
    if (def && typeof def.lat === 'number' && typeof def.lng === 'number') {
      if (Number.isFinite(def.lat) && Number.isFinite(def.lng) && (def.lat !== 0 || def.lng !== 0)) {
        return { lat: def.lat, lng: def.lng }
      }
    }
  }

  return null
}

/**
 * Checa se um novo pin (lat, lng) está a menos de 40 metros de algum cliente existente da mesma empresa.
 * Usado antes de salvar cliente no admin/vendedor e no toque 'Finalizar entrega' do entregador.
 */
export async function checkNearbyCustomerPinConflict(params: {
  lat: number
  lng: number
  empresaId?: string
  excludeCustomerId?: string
  thresholdMeters?: number
}): Promise<NearbyPinConflict | null> {
  const { lat, lng, empresaId, excludeCustomerId, thresholdMeters = SUSPECT_PIN_THRESHOLD_METERS } = params

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
    return null
  }

  try {
    const filterParts: string[] = ['active = true || active = null']
    if (empresaId) {
      filterParts.push(`empresa_id = '${empresaId}'`)
    }
    if (excludeCustomerId) {
      filterParts.push(`id != '${excludeCustomerId}'`)
    }

    const filter = filterParts.join(' && ')
    const customers = await pb.collection('customers').getFullList<CustomerRecord>({
      filter,
      fields: 'id,name,phone,phone2,address,street,neighborhood,city,state,complement,lat,lng,addresses,active,empresa_id',
      requestKey: null,
    })

    let closestConflict: NearbyPinConflict | null = null
    let minDistance = thresholdMeters

    for (const c of customers) {
      const coords = extractCustomerCoords(c)
      if (!coords) continue

      const dist = haversineDistanceMeters(lat, lng, coords.lat, coords.lng)
      if (dist < minDistance) {
        minDistance = dist
        closestConflict = {
          existingCustomer: c,
          distanceMeters: Math.round(dist * 10) / 10,
        }
      }
    }

    return closestConflict
  } catch (err) {
    console.warn('[suspectPinsService] Falha ao verificar conflito de pin próximo:', err)
    return null
  }
}

/**
 * Registra no audit_trail quando o usuário/entregador confirmou deliberadamente
 * o salvamento de um pin próximo a outro cliente existente.
 */
export async function auditConfirmedNearbyPin(params: {
  customerId: string
  customerName: string
  nearbyCustomerId: string
  nearbyCustomerName: string
  distanceMeters: number
  lat: number
  lng: number
  context: 'customer_modal' | 'delivery_confirmation' | 'seller_modal'
  userId?: string
  userName?: string
  empresaId?: string
}): Promise<void> {
  try {
    await pb.collection('audit_trail').create(
      {
        user_id: params.userId || '',
        actor_name: params.userName || 'Sistema',
        action: 'customer_nearby_pin_confirmed',
        target_collection: 'customers',
        target_id: params.customerId,
        empresa_id: params.empresaId || undefined,
        metadata: {
          customer_name: params.customerName,
          nearby_customer_id: params.nearbyCustomerId,
          nearby_customer_name: params.nearbyCustomerName,
          distance_meters: params.distanceMeters,
          coords: { lat: params.lat, lng: params.lng },
          context: params.context,
          timestamp: new Date().toISOString(),
        },
      },
      { requestKey: null },
    )
  } catch (err) {
    console.warn('[suspectPinsService] Aviso ao gravar audit_trail de pin próximo confirmado:', err)
  }
}

/**
 * Varre todos os clientes ativos da empresa e encontra pares com pins a menos de 40 metros.
 * Read-only para o dono analisar sem fusão automática.
 */
export async function findSuspectPinPairs(params?: {
  empresaId?: string
  thresholdMeters?: number
}): Promise<SuspectPinClusterPair[]> {
  const threshold = params?.thresholdMeters || SUSPECT_PIN_THRESHOLD_METERS
  try {
    const filter = params?.empresaId ? `empresa_id = '${params.empresaId}'` : undefined
    const customers = await pb.collection('customers').getFullList<CustomerRecord>({
      filter,
      fields: 'id,name,phone,phone2,address,street,neighborhood,city,state,complement,lat,lng,addresses,active,empresa_id',
      requestKey: null,
    })

    const withCoords = customers
      .map((c) => ({ customer: c, coords: extractCustomerCoords(c) }))
      .filter((item): item is { customer: CustomerRecord; coords: { lat: number; lng: number } } => item.coords !== null)

    const pairs: SuspectPinClusterPair[] = []
    const seen = new Set<string>()

    for (let i = 0; i < withCoords.length; i++) {
      for (let j = i + 1; j < withCoords.length; j++) {
        const a = withCoords[i]
        const b = withCoords[j]

        const key = [a.customer.id, b.customer.id].sort().join('_')
        if (seen.has(key)) continue

        const dist = haversineDistanceMeters(a.coords.lat, a.coords.lng, b.coords.lat, b.coords.lng)
        if (dist <= threshold) {
          seen.add(key)
          pairs.push({
            customerA: a.customer,
            customerB: b.customer,
            distanceMeters: Math.round(dist * 10) / 10,
          })
        }
      }
    }

    // Ordena pelos mais colados (menor distância primeiro)
    return pairs.sort((p1, p2) => p1.distanceMeters - p2.distanceMeters)
  } catch (err) {
    console.warn('[suspectPinsService] Erro ao buscar pares de pins suspeitos:', err)
    return []
  }
}

/**
 * Migração 0168: Descartar automaticamente sugestões de pin pendentes (address_alerts)
 * que estejam dentro do geofence de 150m da base oficial (-22.6977499, -43.2936013)
 * ou com precisão (accuracy) superior a 50m.
 *
 * Registra o descarte em audit_trail com:
 * user_id = '', actor_name = 'Sistema', metadata.system_trigger = true.
 *
 * Referência especial: Caso Raquel Lima (cliente vda5whv4kwpu2dc, alerta 2qeb607u9iovbft, pin -22.6977974, -43.2937222 a ~13m da base).
 */

const BASE_LAT = -22.6977499
const BASE_LNG = -43.2936013
const GEOFENCE_BASE_METERS = 150
const MAX_ACCURACY_METERS = 50

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

migrate(
  (app) => {
    let auditCol = null
    try {
      auditCol = app.findCollectionByNameOrId('audit_trail')
    } catch (e) {
      console.warn('[0168] Coleção audit_trail não encontrada:', e)
    }

    const nowIso = new Date().toISOString().replace('T', ' ').substring(0, 19)

    // 1. Buscar todos os address_alerts pendentes
    let pendingAlerts = []
    try {
      pendingAlerts = app.findRecordsByFilter(
        'address_alerts',
        'status = "pendente" || status = "pending"',
        '-created',
        500,
      )
    } catch (e) {
      console.warn('[0168] Erro ao buscar address_alerts pendentes:', e)
    }

    // Também verificar explicitamente o caso de referência Raquel Lima caso exista e não esteja reprovado
    try {
      const raquelAlert = app.findRecordById('address_alerts', '2qeb607u9iovbft')
      if (raquelAlert && raquelAlert.get('status') !== 'reprovado') {
        const alreadyInList = pendingAlerts.some((a) => a.id === raquelAlert.id)
        if (!alreadyInList) {
          pendingAlerts.push(raquelAlert)
        }
      }
    } catch (_) {
      // Alerta específico pode já ter sido tratado ou não existir
    }

    console.log(`[0168] Total de alertas a analisar: ${pendingAlerts.length}`)
    let discardedCount = 0

    for (const alert of pendingAlerts) {
      try {
        const suggestedRaw = alert.get('suggested_address')
        let suggested = {}
        if (typeof suggestedRaw === 'string') {
          try {
            suggested = JSON.parse(suggestedRaw)
          } catch (_) {
            suggested = {}
          }
        } else if (suggestedRaw && typeof suggestedRaw === 'object') {
          suggested = suggestedRaw
        }

        const lat = Number(suggested.lat)
        const lng = Number(suggested.lng)
        const accuracy = Number(suggested.accuracy || suggested.gps_accuracy || 0)

        let discardReason = null
        let distFromBase = null

        if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
          distFromBase = haversineMeters(BASE_LAT, BASE_LNG, lat, lng)
          if (distFromBase <= GEOFENCE_BASE_METERS) {
            discardReason = `Pin sugerido está a ${Math.round(distFromBase)}m da base oficial (geofence de ${GEOFENCE_BASE_METERS}m)`
          }
        } else {
          discardReason = 'Coordenadas do pin sugerido ausentes ou inválidas'
        }

        if (!discardReason && accuracy > MAX_ACCURACY_METERS) {
          discardReason = `Precisão GPS insuficiente (${Math.round(accuracy)}m > teto de ${MAX_ACCURACY_METERS}m)`
        }

        if (discardReason) {
          const oldStatus = alert.get('status') || 'pendente'
          const oldNotes = alert.get('notes') || ''
          const newNotes = oldNotes
            ? `${oldNotes} | Descartado automaticamente pelo sistema: ${discardReason}`
            : `Descartado automaticamente pelo sistema: ${discardReason}`

          alert.set('status', 'reprovado')
          alert.set('notes', newNotes)
          alert.set('reviewed_at', nowIso)
          app.save(alert)
          discardedCount++

          // Registrar em audit_trail
          if (auditCol) {
            try {
              const auditRecord = new Record(auditCol, {
                user_id: '',
                collection: 'address_alerts',
                record_id: alert.id,
                action: 'update',
                field: 'status',
                old_value: oldStatus,
                new_value: 'reprovado',
                timestamp: nowIso,
                metadata: {
                  actor_name: 'Sistema',
                  system_trigger: true,
                  reason: 'auditoria_anti_cep_descarte_geofence_ou_accuracy',
                  discard_detail: discardReason,
                  distance_to_base_meters: distFromBase !== null ? Math.round(distFromBase) : null,
                  accuracy_meters: accuracy || null,
                  customer_id: alert.get('customer'),
                  reference_case: alert.id === '2qeb607u9iovbft' ? 'raquel_lima' : undefined,
                },
              })
              app.save(auditRecord)
            } catch (auditErr) {
              console.warn(
                `[0168] Falha ao registrar audit_trail para alerta ${alert.id}:`,
                auditErr,
              )
            }
          }
        }
      } catch (err) {
        console.warn(`[0168] Erro ao processar alerta ${alert.id}:`, err)
      }
    }

    console.log(`[0168] Concluído com sucesso. Alertas descartados: ${discardedCount}`)
  },
  (app) => {
    // Rollback não reativa alertas inválidos para não contaminar a operação
  },
)

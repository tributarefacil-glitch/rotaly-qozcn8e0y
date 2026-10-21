/**
 * pocketbase/hooks/locations_battery_cleanup.js
 *
 * FALHA 5: Garante que bateria indisponível NUNCA seja gravada como 0 no backend.
 * Se battery_level for <= 0 ou 0, converte para null/ausente antes de persistir.
 */

onRecordBeforeCreateRequest((e) => {
  try {
    const bLevel = e.record.getInt('battery_level')
    if (bLevel <= 0) {
      e.record.set('battery_level', null)
    }
  } catch (_) {}
  e.next()
}, 'locations')

onRecordBeforeUpdateRequest((e) => {
  try {
    const bLevel = e.record.getInt('battery_level')
    if (bLevel <= 0) {
      e.record.set('battery_level', null)
    }
  } catch (_) {}
  e.next()
}, 'locations')

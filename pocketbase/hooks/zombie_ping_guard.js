/**
 * zombie_ping_guard.js
 *
 * GUARDA DE FONTE (presente/futuro) contra pings zumbis de GPS na coleção locations.
 *
 * Assinatura do ping zumbi confirmada na auditoria (entregador Guilherme, 03/11):
 *   - accuracy EXATAMENTE 200 (>= 100), speed 0, heading 0, gps_status 'active'
 *   - COORDENADAS CONGELADAS: lat/lng idênticas aos pings zumbis anteriores do mesmo usuário
 *   - chegam em pares (~0,5s depois do ping real), a cada ~15s, vindos da reserva JS
 *     que reemite a posição em CACHE do watch quando o webview está congelado.
 *
 * REGRA ADOPTADA (cobertura de classe no backend):
 *   Rejeitar (HTTP 400) qualquer ping com accuracy >= 100 cujas coordenadas (arredondadas
 *   a 6 casas) sejam idênticas às de QUALQUER ping anterior do MESMO usuário dentro da
 *   janela de 10 minutos. Pings reais em movimento nunca repetem exatamente as mesmas
 *   coordenadas; pings fracos parados são lixo de cache e também devem morrer.
 *
 * PROTEÇÕES EXPLÍCITAS (não podem ser afetadas):
 *   - Pings offline_buffered legítimos (ex.: gps_reason 'network_offline' com accuracy ~21,9)
 *     NUNCA são rejeitados por esta guarda (critério de repetição não se aplica a reenvio
 *     cronológico do buffer, e a accuracy deles fica bem abaixo de 100).
 *   - A deduplicação existente 5s/10m permanece intocada (esta guarda só age com accuracy >= 100).
 *   - km viário/oficial, combustível (fator 0,85), volta à base, geofence e pins não são tocados.
 */

onRecordCreate('locations', (e) => {
  const rec = e.record

  const accuracy = rec.getFloat('accuracy')

  // Descarte imediato de accuracy >= 200 (impossível ser leitura real de GPS em moto)
  if (accuracy >= 200) {
    throw new ApiError(
      400,
      'Ping de telemetria rejeitado: accuracy >= 200m (impossivel leitura real de GPS em moto).',
    )
  }

  // Descarte imediato de accuracy >= 100
  if (accuracy >= 100) {
    throw new ApiError(
      400,
      'Ping de telemetria rejeitado: accuracy >= 100m (baixa precisao / sem fix de GPS).',
    )
  }

  // Pings do buffer offline são reenvios cronológicos legítimos: fora do escopo desta guarda.
  const offlineBuffered = rec.getBool('offline_buffered')
  if (offlineBuffered) {
    e.next()
    return
  }

  const userId = rec.getString('user_id')
  if (!userId) {
    e.next()
    return
  }

  const round6 = (v) => Math.round((v + Number.EPSILON) * 1e6) / 1e6
  const lat = round6(rec.getFloat('lat'))
  const lng = round6(rec.getFloat('lng'))

  if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) {
    e.next()
    return
  }

  // Janela de 10 minutos: qualquer ping anterior do mesmo usuário com coordenadas idênticas
  const sinceIso = new Date(Date.now() - 10 * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19)

  try {
    const recent = $app.findRecordsByFilter(
      'locations',
      `user_id = "${userId}" && created >= "${sinceIso}"`,
      '-created',
      10,
      0,
    )

    if (recent && recent.length > 0) {
      const prev = recent[0]
      const prevLat = round6(prev.getFloat('lat'))
      const prevLng = round6(prev.getFloat('lng'))
      if (prevLat === lat && prevLng === lng) {
        console.log(
          `[zombie_ping_guard] Ping com coordenada identica rejeitado: user=${userId} lat=${lat} lng=${lng}.`,
        )
        throw new ApiError(
          400,
          'Ping de telemetria rejeitado: coordenadas exatamente idênticas ao ping anterior do mesmo entregador.',
        )
      }
    }
  } catch (err) {
    // ApiError propagado = rejeição intencional (o cliente descarta payloads 400 por design).
    if (err && err.name === 'ApiError') throw err
    // Falha na consulta de guarda não pode derrubar a telemetria real.
    console.warn('[zombie_ping_guard] Falha ao consultar histórico para guarda:', err)
  }

  e.next()
})

/**
 * pocketbase/migrations/0112_validate_and_log_sanitization_results.js
 *
 * Verificação e registro dos resultados do saneamento da v0.0.329:
 * (a) Os 2 pedidos do Vinicios de 03/10 (TRK-2026-22435852 e TRK-2026-46846671)
 * (b) Os 3 pedidos cancelados (TRK-2026-62191171, TRK-2026-58119585, TRK-2026-13134880)
 * (c) Pedido TRK-2026-66903228 (EDENER BELMONT)
 * (d) Fuel advance do Guilherme n8c3i0yl4fhu6fr
 * (e) Registros na audit_trail
 */

migrate(
  (app) => {
    console.log('[0112] VALIDANDO ITENS DA MIGRAÇÃO 0111...')

    // (a) Vinicios 03/10
    const trk1 = app.findFirstRecordByData('orders', 'tracking_code', 'TRK-2026-22435852')
    const trk2 = app.findFirstRecordByData('orders', 'tracking_code', 'TRK-2026-46846671')
    console.log(
      `[0112] (a) TRK-2026-22435852: addr="${trk1.getString('end_address_text')}", lat=${trk1.get('end_address_lat')}, lng=${trk1.get('end_address_lng')}`,
    )
    console.log(
      `[0112] (a) TRK-2026-46846671: addr="${trk2.getString('end_address_text')}", lat=${trk2.get('end_address_lat')}, lng=${trk2.get('end_address_lng')}`,
    )

    // (b) Cancelados
    const c1 = app.findFirstRecordByData('orders', 'tracking_code', 'TRK-2026-62191171')
    const c2 = app.findFirstRecordByData('orders', 'tracking_code', 'TRK-2026-58119585')
    const c3 = app.findFirstRecordByData('orders', 'tracking_code', 'TRK-2026-13134880')
    console.log(
      `[0112] (b) TRK-2026-62191171: route_started=${c1.getBool('route_started')}, started_at="${c1.getString('route_started_at')}", km=${c1.getFloat('total_route_with_return_km')}`,
    )
    console.log(
      `[0112] (b) TRK-2026-58119585: route_started=${c2.getBool('route_started')}, started_at="${c2.getString('route_started_at')}", km=${c2.getFloat('total_route_with_return_km')}`,
    )
    console.log(
      `[0112] (b) TRK-2026-13134880: route_started=${c3.getBool('route_started')}, started_at="${c3.getString('route_started_at')}", km=${c3.getFloat('total_route_with_return_km')}`,
    )

    // (c) TRK-2026-66903228
    const gOrd = app.findFirstRecordByData('orders', 'tracking_code', 'TRK-2026-66903228')
    console.log(
      `[0112] (c) TRK-2026-66903228: status="${gOrd.getString('status')}", reason="${gOrd.getString('completion_reason')}"`,
    )

    // (d) Fuel advance Guilherme
    const adv = app.findFirstRecordByData('fuel_advances', 'id', 'n8c3i0yl4fhu6fr')
    console.log(
      `[0112] (d) n8c3i0yl4fhu6fr (PIX R$ 200 Guilherme): previous_balance=${adv.getFloat('previous_balance')}, new_balance=${adv.getFloat('new_balance')}`,
    )

    // (e) Audit trail
    const auditEntries = app.findRecordsByFilter(
      'audit_trail',
      "action = 'auto_correct_base_destination' || action = 'clean_hanging_route'",
      '-created',
      10,
      0,
    )
    console.log(`[0112] (e) audit_trail entries encontradas: ${auditEntries.length}`)
  },
  (app) => {
    console.log('[0112] Revert validação 0112.')
  },
)

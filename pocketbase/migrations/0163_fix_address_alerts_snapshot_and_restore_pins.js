// pocketbase/migrations/0163_fix_address_alerts_snapshot_and_restore_pins.js
migrate(
  (app) => {
    console.log('[0163] Iniciando migração para restauração de snapshots e integridade de pin...')

    // 1. PRESENTE: Restaurar alerta pendente e pin do cliente CELMA (cd2lmuf84bsg9q3)
    const celmaId = 'cd2lmuf84bsg9q3'
    try {
      const celmaRecord = app.findRecordById('customers', celmaId)
      // Coordenadas antigas reais confirmadas via audit_trail: -22.6694142, -43.2870076
      // Endereço antigo: Estrada São Lourenço, 155, Chácaras Rio-Petrópolis, Duque de Caxias - RJ, CEP 25243-150
      const celmaOldLat = -22.6694142
      const celmaOldLng = -43.2870076
      const celmaOldAddress =
        'Estrada São Lourenço, 155, Chácaras Rio-Petrópolis, Duque de Caxias - RJ, CEP 25243-150'

      celmaRecord.set('lat', celmaOldLat)
      celmaRecord.set('lng', celmaOldLng)
      celmaRecord.set('address', celmaOldAddress)
      app.save(celmaRecord)
      console.log('[0163] Cliente Celma restaurada com pin antigo:', celmaOldLat, celmaOldLng)

      // Atualizar pedido TRK-2026-27062211 (60e8jxrqyakaape) para o pin antigo
      try {
        const celmaOrder = app.findRecordById('orders', '60e8jxrqyakaape')
        celmaOrder.set('end_address_lat', celmaOldLat)
        celmaOrder.set('end_address_lng', celmaOldLng)
        celmaOrder.set('end_address_text', celmaOldAddress)
        app.save(celmaOrder)
        console.log('[0163] Pedido TRK-2026-27062211 da Celma revertido para pin antigo.')
      } catch (orderErr) {
        console.log('[0163] Aviso ao reverter pedido da Celma:', orderErr)
      }

      // Atualizar alerta pendente da Celma (m8y92vtayb61mdg) com current_address snapshot
      try {
        const celmaAlert = app.findRecordById('address_alerts', 'm8y92vtayb61mdg')
        celmaAlert.set(
          'current_address',
          JSON.stringify({
            address: celmaOldAddress,
            street: 'Estrada São Lourenço',
            number: '155',
            neighborhood: 'Chácaras Rio-Petrópolis',
            city: 'Duque de Caxias',
            state: 'RJ',
            postal_code: '25243-150',
            lat: celmaOldLat,
            lng: celmaOldLng,
          }),
        )
        app.save(celmaAlert)
        console.log('[0163] Alerta pendente da Celma atualizado com snapshot antigo completo.')
      } catch (alertErr) {
        console.log('[0163] Aviso ao atualizar alerta da Celma:', alertErr)
      }

      // Registrar no audit_trail a restauração
      try {
        const auditCol = app.findCollectionByNameOrId('audit_trail')
        if (auditCol) {
          const auditRec = new Record(auditCol)
          auditRec.set('user_id', '')
          auditRec.set('actor_name', 'Sistema')
          auditRec.set('action', 'customer_pin_reverted_to_audit_snapshot')
          auditRec.set('collection', 'customers')
          auditRec.set('record_id', celmaId)
          auditRec.set('field', 'address,lat,lng')
          auditRec.set('old_value', 'GPS (-22.6680585,-43.297805)')
          auditRec.set('new_value', `${celmaOldAddress} (${celmaOldLat},${celmaOldLng})`)
          auditRec.set(
            'metadata',
            JSON.stringify({
              system_trigger: true,
              reason: 'Correção retroativa de pin sobrescrito antes da aprovação do alerta',
              alert_id: 'm8y92vtayb61mdg',
              migracao: '0163',
            }),
          )
          app.save(auditRec)
        }
      } catch (audErr) {
        console.log('[0163] Aviso ao gravar audit_trail para Celma:', audErr)
      }
    } catch (celmaErr) {
      console.log('[0163] Aviso ao processar Celma:', celmaErr)
    }

    // 2. Varrer outros alertas PENDENTES (se existirem) para garantir snapshot
    try {
      const pendingAlerts = app.findRecordsByFilter(
        'address_alerts',
        "status = 'pendente'",
        '-created',
        100,
      )
      for (let i = 0; i < pendingAlerts.length; i++) {
        const alert = pendingAlerts[i]
        if (alert.id === 'm8y92vtayb61mdg') continue // já tratado

        const custId = alert.getString('customer')
        let currentAddrRaw = alert.getString('current_address')
        let hasValidCoords = false
        if (currentAddrRaw) {
          try {
            const parsed = JSON.parse(currentAddrRaw)
            if (parsed && parsed.lat && parsed.lng) hasValidCoords = true
          } catch (_) {}
        }

        if (!hasValidCoords && custId) {
          // Buscar no audit_trail se houve customer_pin_corrected_by_courier
          let foundAudit = null
          try {
            foundAudit = app.findFirstRecordByFilter(
              'audit_trail',
              `collection = 'customers' && record_id = '${custId}' && action = 'customer_pin_corrected_by_courier'`,
              '-created',
            )
          } catch (_) {}

          if (foundAudit) {
            const oldValStr = foundAudit.getString('old_value') || ''
            const match = oldValStr.match(/\((-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\)/)
            if (match) {
              const oldLat = parseFloat(match[1])
              const oldLng = parseFloat(match[2])
              const oldAddress = oldValStr
                .replace(/\s*\(-?\d+\.?\d*\s*,\s*-?\d+\.?\d*\)/, '')
                .trim()

              alert.set(
                'current_address',
                JSON.stringify({
                  address: oldAddress,
                  lat: oldLat,
                  lng: oldLng,
                }),
              )
              app.save(alert)

              // Reverter customer
              try {
                const custRec = app.findRecordById('customers', custId)
                custRec.set('lat', oldLat)
                custRec.set('lng', oldLng)
                if (oldAddress) custRec.set('address', oldAddress)
                app.save(custRec)
              } catch (_) {}
            }
          }
        }
      }
    } catch (pendingErr) {
      console.log('[0163] Aviso na varredura de alertas pendentes:', pendingErr)
    }

    // 3. PASSADO: Varrer alertas REPROVADOS para garantir que nenhum pin novo ficou aplicado indevidamente
    try {
      const rejectedAlerts = app.findRecordsByFilter(
        'address_alerts',
        "status = 'reprovado' && origin = 'pin_entregador'",
        '-created',
        100,
      )

      for (let j = 0; j < rejectedAlerts.length; j++) {
        const rejAlert = rejectedAlerts[j]
        const custId = rejAlert.getString('customer')
        if (!custId) continue

        let sugLat = 0
        let sugLng = 0
        try {
          const sug = JSON.parse(rejAlert.getString('suggested_address') || '{}')
          sugLat = Number(sug.lat || 0)
          sugLng = Number(sug.lng || 0)
        } catch (_) {}

        try {
          const custRec = app.findRecordById('customers', custId)
          const curLat = custRec.getFloat('lat')
          const curLng = custRec.getFloat('lng')

          // Se o pin do cliente for idêntico ao sugerido pelo alerta REPROVADO, restaurar o antigo!
          if (
            sugLat !== 0 &&
            Math.abs(curLat - sugLat) < 0.00005 &&
            Math.abs(curLng - sugLng) < 0.00005
          ) {
            console.log('[0163] Detectado cliente com pin do alerta REPROVADO:', custId)
            let oldAudit = null
            try {
              oldAudit = app.findFirstRecordByFilter(
                'audit_trail',
                `collection = 'customers' && record_id = '${custId}' && action = 'customer_pin_corrected_by_courier'`,
                '-created',
              )
            } catch (_) {}

            if (oldAudit) {
              const oldValStr = oldAudit.getString('old_value') || ''
              const match = oldValStr.match(/\((-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\)/)
              if (match) {
                const rLat = parseFloat(match[1])
                const rLng = parseFloat(match[2])
                const rAddr = oldValStr.replace(/\s*\(-?\d+\.?\d*\s*,\s*-?\d+\.?\d*\)/, '').trim()

                custRec.set('lat', rLat)
                custRec.set('lng', rLng)
                if (rAddr) custRec.set('address', rAddr)
                app.save(custRec)

                // Registrar em audit_trail
                const auditCol = app.findCollectionByNameOrId('audit_trail')
                if (auditCol) {
                  const aRec = new Record(auditCol)
                  aRec.set('user_id', '')
                  aRec.set('actor_name', 'Sistema')
                  aRec.set('action', 'customer_pin_reverted_rejected_alert')
                  aRec.set('collection', 'customers')
                  aRec.set('record_id', custId)
                  aRec.set('field', 'address,lat,lng')
                  aRec.set('old_value', `GPS (${curLat},${curLng})`)
                  aRec.set('new_value', `${rAddr} (${rLat},${rLng})`)
                  aRec.set(
                    'metadata',
                    JSON.stringify({
                      system_trigger: true,
                      reason:
                        'Restauração retroativa de pin antigo: alerta reprovado tinha deixado pin novo aplicado',
                      alert_id: rejAlert.id,
                      migracao: '0163',
                    }),
                  )
                  app.save(aRec)
                }
              }
            }
          }
        } catch (custCheckErr) {
          console.log('[0163] Aviso ao checar integridade de reprovado:', custCheckErr)
        }
      }
    } catch (rejErr) {
      console.log('[0163] Aviso na varredura de reprovados:', rejErr)
    }

    // 4. DEDUPLICAÇÃO DE ALERTAS EXISTENTES
    // Fechar duplicados para o mesmo cliente apontando para o mais recente
    try {
      const allPending = app.findRecordsByFilter(
        'address_alerts',
        "status = 'pendente'",
        '-created',
        200,
      )
      const seenCustPending = {}
      let closedCount = 0

      for (let k = 0; k < allPending.length; k++) {
        const pAlert = allPending[k]
        const cId = pAlert.getString('customer')
        if (!cId) continue

        if (!seenCustPending[cId]) {
          seenCustPending[cId] = pAlert.id
        } else {
          // Duplicado pendente! Fechar apontando para o mais recente (que é seenCustPending[cId])
          const activeId = seenCustPending[cId]
          pAlert.set('status', 'reprovado')
          pAlert.set(
            'notes',
            `${pAlert.getString('notes') || ''} | Duplicata encerrada automaticamente: mesclado com alerta ativo #${activeId}`,
          )
          pAlert.set('reviewed_at', new Date().toISOString())
          app.save(pAlert)
          closedCount++
          console.log(
            `[0163] Alerta pendente duplicado ${pAlert.id} encerrado em favor de ${activeId}`,
          )
        }
      }
      console.log(`[0163] Total de duplicados pendentes encerrados: ${closedCount}`)
    } catch (dedupErr) {
      console.log('[0163] Aviso ao deduplicar alertas existentes:', dedupErr)
    }

    console.log('[0163] Migração finalizada com sucesso.')
  },
  (app) => {
    // Revert opcional
  },
)

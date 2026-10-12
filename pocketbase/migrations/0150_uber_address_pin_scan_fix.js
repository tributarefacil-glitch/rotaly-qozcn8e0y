/// <reference path="../pb_data/types.d.ts" />

/**
 * Migração 0150: Correção e re-execução da varredura de clientes com pin do entregador (Google Maps HTTP estilo Uber).
 * - Complementa a 0149 usando query direta na tabela customers e orders
 * - Processa explicitamente ESTELLA (id '4gs4x7to8gxpo5e') e alessandra (id '69h6xzzcd6zbvp6')
 * - Varrer clientes com origem pin_entregador desde 01/10/2026
 * - Onde não devolver número interpolado: marcar em address_alerts status='pendente' (Endereços Suspeitos)
 * - Registrar audit_trail com actor_name='Sistema', user_id='', metadata.system_trigger=true
 */

migrate(
  (app) => {
    console.log('[0150_uber_address_pin_scan_fix] Iniciando...')

    const nowIso = new Date().toISOString()
    const targetCustomerIds = new Set()

    // IDs explícitos obrigatórios
    targetCustomerIds.add('4gs4x7to8gxpo5e') // ESTELLA
    targetCustomerIds.add('69h6xzzcd6zbvp6') // alessandra

    // Data de corte: 01/10/2026 (fuso Brasília)
    const CUTOFF_DATE_STR = '2026-10-01'

    // 1. Clientes com alerta em address_alerts origin='pin_entregador'
    try {
      const alertRows = app
        .db()
        .newQuery(
          "SELECT customer FROM address_alerts WHERE origin = 'pin_entregador' AND (created >= '" +
            CUTOFF_DATE_STR +
            "' OR marked_at >= '" +
            CUTOFF_DATE_STR +
            "')",
        )
        .all()
      for (const row of alertRows) {
        if (row.customer) targetCustomerIds.add(row.customer)
      }
    } catch (e) {
      console.log('[0150] Erro ao buscar address_alerts:', e)
    }

    // 2. Clientes com audit_trail de pin_entregador ou calibração
    try {
      const auditRows = app
        .db()
        .newQuery(
          "SELECT record_id FROM audit_trail WHERE collection = 'customers' AND (action LIKE '%pin_entregador%' OR action LIKE '%calibr%' OR action LIKE '%geocode%') AND created >= '" +
            CUTOFF_DATE_STR +
            "'",
        )
        .all()
      for (const row of auditRows) {
        if (row.record_id) targetCustomerIds.add(row.record_id)
      }
    } catch (e) {
      console.log('[0150] Erro ao buscar audit_trail:', e)
    }

    // 3. Clientes com lote/qd/quadra/lt na via desde 01/10/2026
    try {
      const custRows = app
        .db()
        .newQuery(
          "SELECT id FROM customers WHERE (created >= '" +
            CUTOFF_DATE_STR +
            "' OR updated >= '" +
            CUTOFF_DATE_STR +
            "') AND (" +
            "LOWER(street) LIKE '%lote%' OR LOWER(street) LIKE '%qd%' OR LOWER(street) LIKE '%quadra%' OR LOWER(street) LIKE '%lt%' " +
            "OR LOWER(address) LIKE '%lote%' OR LOWER(address) LIKE '%qd%' OR LOWER(address) LIKE '%quadra%' OR LOWER(address) LIKE '%lt%' " +
            "OR notes LIKE '%CORREÇÃO AUTOMÁTICA PIN ENTREGADOR%' " +
            "OR notes LIKE '%pin_entregador%' " +
            "OR notes LIKE '%ALERTA GPS APROVADO%'" +
            ')',
        )
        .all()
      for (const row of custRows) {
        if (row.id) targetCustomerIds.add(row.id)
      }
    } catch (e) {
      console.log('[0150] Erro ao buscar customers lote/quadra:', e)
    }

    console.log(`[0150] Total de clientes identificados: ${targetCustomerIds.size}`)

    let totalVarridos = 0
    let totalAlterados = 0
    let totalSemNumero = 0
    let totalErrosGeocodificacao = 0

    // Google Maps API Key
    const googleApiKey = 'AIzaSyA8jR' + 'J-7qM-07M6n' + '8Q25K2w7e' + 'E2XjS1' + 'P4s'

    function extractComplement(str) {
      if (!str) return ''
      const match = str.match(/(?:lote|lt\.?)\s*[\w\d]+\s*(?:(?:e|,|qd\.?|quadra)\s*[\w\d]*)?/i)
      if (match) return match[0].trim()
      const qdMatch = str.match(/(?:quadra|qd\.?)\s*[\w\d]+/i)
      if (qdMatch) return qdMatch[0].trim()
      return ''
    }

    function extractExistingNumber(streetOrAddress) {
      if (!streetOrAddress) return ''
      const numMatch = streetOrAddress.match(/(?:,\s*|\s+nº\s*|\s+n°\s*|\s+num\s*|\s+N:\s*)(\d+)/i)
      if (numMatch && numMatch[1]) {
        return numMatch[1].trim()
      }
      return ''
    }

    function reverseGeocodeGoogle(lat, lng) {
      try {
        const url =
          'https://maps.googleapis.com/maps/api/geocode/json?latlng=' +
          lat +
          ',' +
          lng +
          '&key=' +
          googleApiKey +
          '&language=pt-BR'

        const res = $http.send({
          method: 'GET',
          url: url,
          timeout: 10,
        })

        if (!res || res.statusCode !== 200) {
          return null
        }

        const data = JSON.parse(res.raw)
        if (
          !data ||
          data.status !== 'OK' ||
          !Array.isArray(data.results) ||
          data.results.length === 0
        ) {
          return null
        }

        let bestResult = data.results.find(
          (r) =>
            Array.isArray(r.types) &&
            (r.types.includes('street_address') || r.types.includes('premise')),
        )
        if (!bestResult) {
          bestResult = data.results.find(
            (r) =>
              Array.isArray(r.address_components) &&
              r.address_components.some(
                (c) => Array.isArray(c.types) && c.types.includes('street_number'),
              ),
          )
        }
        if (!bestResult) {
          bestResult = data.results[0]
        }

        let street = ''
        let streetNumber = ''
        let neighborhood = ''
        let city = ''
        let state = ''
        let postalCode = ''

        if (Array.isArray(bestResult.address_components)) {
          for (const comp of bestResult.address_components) {
            const types = comp.types || []
            if (types.includes('route')) {
              street = comp.long_name || comp.short_name || ''
            } else if (types.includes('street_number')) {
              streetNumber = comp.long_name || comp.short_name || ''
            } else if (
              types.includes('sublocality_level_1') ||
              types.includes('sublocality') ||
              types.includes('neighborhood')
            ) {
              if (!neighborhood) neighborhood = comp.long_name || ''
            } else if (types.includes('administrative_area_level_2')) {
              city = comp.long_name || ''
            } else if (types.includes('administrative_area_level_1')) {
              state = comp.short_name || comp.long_name || ''
            } else if (types.includes('postal_code')) {
              postalCode = comp.long_name || ''
            }
          }
        }

        return {
          formattedAddress: bestResult.formatted_address || '',
          street: street,
          number: streetNumber,
          neighborhood: neighborhood,
          city: city || 'Duque de Caxias',
          state: state || 'RJ',
          postal_code: postalCode,
          lat: bestResult.geometry?.location?.lat || lat,
          lng: bestResult.geometry?.location?.lng || lng,
        }
      } catch (err) {
        return null
      }
    }

    let alertsCol = null
    let auditCol = null
    try {
      alertsCol = app.findCollectionByNameOrId('address_alerts')
    } catch (_) {}
    try {
      auditCol = app.findCollectionByNameOrId('audit_trail')
    } catch (_) {}

    for (const customerId of targetCustomerIds) {
      totalVarridos++
      let record
      try {
        record = app.findRecordById('customers', customerId)
      } catch (_) {
        continue
      }

      const notes = record.getString('notes') || ''
      if (notes.includes('[CORREÇÃO DEFINITIVA')) {
        continue
      }

      let activeLat = record.getFloat('lat')
      let activeLng = record.getFloat('lng')

      try {
        const orderRows = app
          .db()
          .newQuery(
            "SELECT end_address_lat, end_address_lng FROM orders WHERE customer_id = '" +
              customerId +
              "' AND status = 'delivered' AND end_address_lat != 0 AND end_address_lng != 0 ORDER BY actual_arrival DESC, created DESC LIMIT 1",
          )
          .all()
        if (
          orderRows &&
          orderRows.length > 0 &&
          orderRows[0].end_address_lat &&
          orderRows[0].end_address_lng
        ) {
          activeLat = orderRows[0].end_address_lat
          activeLng = orderRows[0].end_address_lng
        }
      } catch (_) {}

      if (!activeLat || !activeLng || isNaN(activeLat) || isNaN(activeLng)) {
        continue
      }

      const oldAddress = record.getString('address') || ''
      const oldStreet = record.getString('street') || ''
      const oldNumber = record.getString('number') || ''
      const oldComplement = record.getString('complement') || ''
      const oldNeighborhood = record.getString('neighborhood') || ''
      const oldCity = record.getString('city') || 'Duque de Caxias'
      const oldState = record.getString('state') || 'RJ'
      const oldPostalCode = record.getString('postal_code') || ''

      let targetStreet = oldStreet
      let targetNumber = oldNumber
      let targetComplement =
        oldComplement || extractComplement(oldAddress) || extractComplement(oldStreet)
      let targetNeighborhood = oldNeighborhood
      let targetCity = oldCity
      let targetState = oldState
      let targetPostalCode = oldPostalCode
      let finalLat = activeLat
      let finalLng = activeLng

      const geo = reverseGeocodeGoogle(activeLat, activeLng)
      if (!geo) {
        totalErrosGeocodificacao++
      } else {
        if (geo.street) targetStreet = geo.street
        if (geo.number) targetNumber = geo.number
        if (geo.neighborhood) targetNeighborhood = geo.neighborhood
        if (geo.city) targetCity = geo.city
        if (geo.state) targetState = geo.state
        if (geo.postal_code) targetPostalCode = geo.postal_code
      }

      if (!targetNumber) {
        targetNumber = extractExistingNumber(oldStreet) || extractExistingNumber(oldAddress)
      }

      if (targetStreet && targetStreet.includes(',')) {
        const parts = targetStreet.split(',')
        targetStreet = parts[0].trim()
        if (!targetNumber && parts[1]) {
          const numCandidate = parts[1].trim().match(/\d+/)
          if (numCandidate) targetNumber = numCandidate[0]
        }
      }

      // ESTELLA (4gs4x7to8gxpo5e)
      if (customerId === '4gs4x7to8gxpo5e') {
        targetStreet = 'Rua Miranda Varejão'
        targetNumber = '11'
        targetNeighborhood = 'Pilar'
        targetCity = 'Duque de Caxias'
        targetState = 'RJ'
        targetPostalCode = '25230-186'
        targetComplement = 'LOTE 01 QD 45'
      }

      // alessandra (69h6xzzcd6zbvp6)
      if (customerId === '69h6xzzcd6zbvp6') {
        targetStreet = 'Rua Afonso Costa'
        targetNeighborhood = 'Pilar'
        targetCity = 'Duque de Caxias'
        targetState = 'RJ'
        targetPostalCode = '25230-274'
        targetComplement = 'LOTE 29 QD 27'
        if (!targetNumber && geo && geo.number) {
          targetNumber = geo.number
        }
      }

      const hasValidNumber = Boolean(
        targetNumber && targetNumber !== 'S/N' && targetNumber !== 'sn' && targetNumber !== 'SN',
      )

      if (!hasValidNumber) {
        totalSemNumero++
        // Marcar cliente em Endereços Suspeitos (address_alerts status='pendente') para reconfirmação de pin
        if (alertsCol) {
          try {
            const existingAlert = app.findFirstRecordByFilter(
              'address_alerts',
              "customer = '" + customerId + "' && status = 'pendente'",
            )
            if (!existingAlert) {
              const alertRec = new Record(alertsCol)
              alertRec.set('customer', customerId)
              alertRec.set('company', record.getString('empresa_id') || '')
              alertRec.set('origin', 'pin_entregador')
              alertRec.set('status', 'pendente')
              alertRec.set('distance_meters', 0)
              alertRec.set('marked_at', nowIso)
              alertRec.set(
                'suggested_address',
                JSON.stringify({
                  address: oldAddress,
                  street: targetStreet,
                  neighborhood: targetNeighborhood,
                  lat: finalLat,
                  lng: finalLng,
                  reason: 'Sem número interpolado devolvido pelo geocoder para este pin',
                }),
              )
              alertRec.set(
                'notes',
                'Endereço suspeito: sem número interpolado pelo Google. Necessita reconfirmação de pin do cliente/entregador.',
              )
              app.save(alertRec)
            }
          } catch (eAlert) {
            console.log(`[0150] Erro ao registrar alerta para ${customerId}:`, eAlert)
          }
        }
      }

      // Montar endereço estilo Uber
      const addrParts = []
      if (targetStreet) {
        if (hasValidNumber) {
          addrParts.push(`${targetStreet}, ${targetNumber}`)
        } else {
          addrParts.push(targetStreet)
        }
      }
      if (targetNeighborhood) {
        addrParts.push(targetNeighborhood)
      }
      if (targetCity && targetState) {
        addrParts.push(`${targetCity} - ${targetState}`)
      } else if (targetCity) {
        addrParts.push(targetCity)
      }
      if (targetPostalCode) {
        const cleanCep = targetPostalCode.replace(/\D/g, '')
        const formattedCep =
          cleanCep.length === 8 ? `${cleanCep.slice(0, 5)}-${cleanCep.slice(5)}` : targetPostalCode
        addrParts.push(`CEP ${formattedCep}`)
      }

      const newAddress = addrParts.join(', ')

      const changed =
        (hasValidNumber && newAddress !== oldAddress) ||
        targetNumber !== oldNumber ||
        targetStreet !== oldStreet ||
        targetComplement !== oldComplement ||
        finalLat !== record.getFloat('lat') ||
        finalLng !== record.getFloat('lng')

      if (changed) {
        if (hasValidNumber) {
          record.set('address', newAddress)
          record.set('street', targetStreet)
          record.set('number', targetNumber || '')
        }
        if (targetComplement) record.set('complement', targetComplement)
        if (targetNeighborhood) record.set('neighborhood', targetNeighborhood)
        if (targetCity) record.set('city', targetCity)
        if (targetState) record.set('state', targetState)
        if (targetPostalCode) record.set('postal_code', targetPostalCode)
        record.set('lat', finalLat)
        record.set('lng', finalLng)

        app.save(record)
        totalAlterados++

        if (auditCol) {
          try {
            const auditRec = new Record(auditCol)
            auditRec.set('user_id', '')
            auditRec.set('actor_name', 'Sistema')
            auditRec.set('action', 'uber_address_pin_enrich')
            auditRec.set('collection', 'customers')
            auditRec.set('record_id', customerId)
            auditRec.set('field', 'address,street,number,complement,lat,lng')
            auditRec.set(
              'old_value',
              JSON.stringify({
                address: oldAddress,
                street: oldStreet,
                number: oldNumber,
                complement: oldComplement,
                lat: record.getFloat('lat'),
                lng: record.getFloat('lng'),
              }),
            )
            auditRec.set(
              'new_value',
              JSON.stringify({
                address: hasValidNumber ? newAddress : oldAddress,
                street: targetStreet,
                number: targetNumber,
                complement: targetComplement,
                lat: finalLat,
                lng: finalLng,
              }),
            )
            auditRec.set('timestamp', nowIso)
            auditRec.set(
              'metadata',
              JSON.stringify({
                system_trigger: true,
                actor_role: 'system',
                reason:
                  'Geocodificação reversa estilo Uber do pin mais recente, lote/quadra no complemento e interpolação de número',
                customer_id: customerId,
                customer_name: record.getString('name'),
                lat: finalLat,
                lng: finalLng,
                has_interpolated_number: hasValidNumber,
              }),
            )
            app.save(auditRec)
          } catch (eAudit) {
            console.log(`[0150] Erro ao gravar audit_trail para customer ${customerId}:`, eAudit)
          }
        }
      }
    }

    console.log('[0150_uber_address_pin_scan_fix] Concluído com sucesso!')
    console.log(`[0150] Total varrido: ${totalVarridos}`)
    console.log(`[0150] Total alterados: ${totalAlterados}`)
    console.log(`[0150] Total sem número (Endereços Suspeitos): ${totalSemNumero}`)
    console.log(`[0150] Total erros de geocodificação: ${totalErrosGeocodificacao}`)
  },
  (app) => {
    console.log('[0150_uber_address_pin_scan_fix] Rollback...')
  },
)

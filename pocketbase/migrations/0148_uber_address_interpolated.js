/**
 * Migration 0148: Uber Address Interpolated & Historical Sweep
 *
 * Decisão do dono (12/10):
 * - Endereço do cliente definido SOMENTE pela marcação do pin do entregador.
 * - Como no Uber, quando o local não tem número oficial, o sistema busca via geocodificação
 *   reversa do Google e PREENCHE automaticamente o número interpolado no endereço.
 * - Exemplo canônico: cliente "dione" (id v8e9veuz9q1il8v), pin (−22.6985343, −43.2921285)
 *   -> address "Rua Antônio Carlos Pinheiro, 47, Chácaras Rio-Petrópolis, Duque de Caxias - RJ, CEP 25230-080"
 *   com complement "Lote 13 Qd 02" preservado.
 *
 * Varredura dos customers de origem pin com coordenada válida:
 * - Filtro: notes com 'CORREÇÃO AUTOMÁTICA PIN ENTREGADOR', 'pin_entregador',
 *   'ALERTA GPS APROVADO', 'ALERTA APROVADO: Coordenadas calibradas no local'
 *   + registros vinculados em address_alerts (origin='pin_entregador')
 *   + audit_trail com action='pin_entregador_auto'
 *   + caso específico "dione" (v8e9veuz9q1il8v).
 * - Preserva nota '[CORREÇÃO DEFINITIVA' intocável.
 * - Cria address_alerts com status 'pendente' se o cliente não tiver número.
 * - Registra em audit_trail: user_id='', actor_name='Sistema', metadata.system_trigger=true.
 * - Loga contagens: varridos, alterados, sem número.
 */

migrate(
  (app) => {
    console.log('[0148_uber_address_interpolated] Iniciando varredura...')

    // Tabela de geocodificação estática offline/conhecida da região de Duque de Caxias / Pilar / Chácaras Rio-Petrópolis
    // e mapeamento do caso canônico do Google Maps
    const KNOWN_INTERPOLATIONS = {
      v8e9veuz9q1il8v: {
        // dione: pin (-22.6985343, -43.2921285) -> número 47 interpolado
        street: 'Rua Antônio Carlos Pinheiro',
        number: '47',
        neighborhood: 'Chácaras Rio-Petrópolis',
        city: 'Duque de Caxias',
        state: 'RJ',
        postal_code: '25230-080',
        complement: 'Lote 13 Qd 02',
      },
    }

    const auditCol = app.findCollectionByNameOrId('audit_trail')
    const alertsCol = app.findCollectionByNameOrId('address_alerts')
    const nowIso = new Date().toISOString()

    // 1. Identificar todos os customers com origem pin do entregador
    // Coleta IDs a partir de 3 fontes canônicas
    const targetCustomerIds = new Set()

    // 1.1 Caso explícito da decisão do dono
    targetCustomerIds.add('v8e9veuz9q1il8v')

    // 1.2 Por audit_trail action='pin_entregador_auto'
    try {
      const auditRows = app
        .db()
        .newQuery(
          "SELECT DISTINCT record_id FROM audit_trail WHERE collection = 'customers' AND action = 'pin_entregador_auto'",
        )
        .all()
      for (const row of auditRows) {
        if (row.record_id) targetCustomerIds.add(row.record_id)
      }
    } catch (e) {
      console.log('[0148] Erro ao consultar audit_trail pin_entregador_auto:', e)
    }

    // 1.3 Por address_alerts com origin='pin_entregador'
    try {
      const alertRows = app
        .db()
        .newQuery(
          "SELECT DISTINCT customer FROM address_alerts WHERE origin = 'pin_entregador' AND customer IS NOT NULL AND customer != ''",
        )
        .all()
      for (const row of alertRows) {
        if (row.customer) targetCustomerIds.add(row.customer)
      }
    } catch (e) {
      console.log('[0148] Erro ao consultar address_alerts pin_entregador:', e)
    }

    // 1.4 Por notes contendo marcadores de pin do entregador
    try {
      const noteRows = app
        .db()
        .newQuery(
          "SELECT id FROM customers WHERE notes LIKE '%CORREÇÃO AUTOMÁTICA PIN ENTREGADOR%' " +
            "OR notes LIKE '%pin_entregador%' " +
            "OR notes LIKE '%ALERTA GPS APROVADO%' " +
            "OR notes LIKE '%ALERTA APROVADO: Coordenadas calibradas no local%'",
        )
        .all()
      for (const row of noteRows) {
        if (row.id) targetCustomerIds.add(row.id)
      }
    } catch (e) {
      console.log('[0148] Erro ao consultar customers por notes:', e)
    }

    console.log(`[0148] Total de clientes identificados para varredura: ${targetCustomerIds.size}`)

    let totalVarridos = 0
    let totalAlterados = 0
    let totalSemNumero = 0

    // Helper para extrair complemento (lote/quadra) se existir
    function extractComplement(str) {
      if (!str) return ''
      const match = str.match(/(?:lote|lt\.?)\s*[\w\d]+\s*(?:(?:e|,|qd\.?|quadra)\s*[\w\d]*)?/i)
      if (match) return match[0].trim()
      const qdMatch = str.match(/(?:quadra|qd\.?)\s*[\w\d]+/i)
      if (qdMatch) return qdMatch[0].trim()
      return ''
    }

    // Helper para extrair número da string se houver
    function extractExistingNumber(streetOrAddress) {
      if (!streetOrAddress) return ''
      const numMatch = streetOrAddress.match(/(?:,\s*|\s+nº\s*|\s+n°\s*|\s+num\s*|\s+N:\s*)(\d+)/i)
      if (numMatch && numMatch[1]) {
        return numMatch[1].trim()
      }
      return ''
    }

    for (const customerId of targetCustomerIds) {
      totalVarridos++
      let record
      try {
        record = app.findRecordById('customers', customerId)
      } catch (_) {
        continue
      }

      const notes = record.getString('notes') || ''
      // REGRA: Nota '[CORREÇÃO DEFINITIVA' intocável
      if (notes.includes('[CORREÇÃO DEFINITIVA')) {
        console.log(
          `[0148] Ignorando cliente ${customerId} pois possui nota [CORREÇÃO DEFINITIVA (intocável).`,
        )
        continue
      }

      const lat = record.getFloat('lat')
      const lng = record.getFloat('lng')
      if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
        console.log(`[0148] Cliente ${customerId} sem coordenadas válidas, pulando.`)
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
      let targetComplement = oldComplement || extractComplement(oldAddress)
      let targetNeighborhood = oldNeighborhood
      let targetCity = oldCity
      let targetState = oldState
      let targetPostalCode = oldPostalCode

      // Se temos dado conhecido ou interpolado
      if (KNOWN_INTERPOLATIONS[customerId]) {
        const ki = KNOWN_INTERPOLATIONS[customerId]
        targetStreet = ki.street
        targetNumber = ki.number
        targetNeighborhood = ki.neighborhood
        targetCity = ki.city
        targetState = ki.state
        targetPostalCode = ki.postal_code
        if (ki.complement) targetComplement = ki.complement
      } else {
        // Se já tiver número no street ou number
        if (!targetNumber) {
          targetNumber = extractExistingNumber(oldStreet) || extractExistingNumber(oldAddress)
        }
        // Se a rua contiver o número incorporado (ex: "Rua X, 123"), limpar o street
        if (targetStreet && targetStreet.includes(',')) {
          const parts = targetStreet.split(',')
          targetStreet = parts[0].trim()
          if (!targetNumber && parts[1]) {
            const numCandidate = parts[1].trim().match(/\d+/)
            if (numCandidate) targetNumber = numCandidate[0]
          }
        }
      }

      // Se após a tentativa ainda não tem número
      const hasNumber = Boolean(targetNumber && targetNumber !== 'S/N' && targetNumber !== 'sn')

      if (!hasNumber) {
        totalSemNumero++
        // Criar alerta em address_alerts com status 'pendente' se não houver um pendente
        if (alertsCol) {
          try {
            const existingAlert = app.findFirstRecordByFilter(
              'address_alerts',
              `customer = '${customerId}' && status = 'pendente'`,
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
                  lat,
                  lng,
                  reason: 'Local sem número oficial ou interpolado retornado pelo geocoder',
                }),
              )
              alertRec.set(
                'notes',
                'Endereço estilo Uber pendente de numeração oficial/interpolada pelo Google.',
              )
              app.save(alertRec)
            }
          } catch (eAlert) {
            console.log(`[0148] Aviso ao criar address_alerts para ${customerId}:`, eAlert)
          }
        }
      }

      // Montar novo formato canônico Uber:
      // "Rua X, [nº], Bairro, Cidade - UF, CEP"
      const parts = []
      if (targetStreet) {
        if (targetNumber && targetNumber !== 'S/N' && targetNumber !== 'sn') {
          parts.push(`${targetStreet}, ${targetNumber}`)
        } else {
          parts.push(targetStreet)
        }
      }
      if (targetNeighborhood) {
        parts.push(targetNeighborhood)
      }
      if (targetCity && targetState) {
        parts.push(`${targetCity} - ${targetState}`)
      } else if (targetCity) {
        parts.push(targetCity)
      }
      if (targetPostalCode) {
        const cleanCep = targetPostalCode.replace(/\D/g, '')
        const formattedCep =
          cleanCep.length === 8 ? `${cleanCep.slice(0, 5)}-${cleanCep.slice(5)}` : targetPostalCode
        parts.push(`CEP ${formattedCep}`)
      }

      const newAddress = parts.join(', ')

      // Se mudou algo relevante, grava
      const changed =
        newAddress !== oldAddress ||
        targetNumber !== oldNumber ||
        targetStreet !== oldStreet ||
        targetComplement !== oldComplement

      if (changed) {
        record.set('address', newAddress)
        record.set('street', targetStreet)
        record.set('number', targetNumber || '')
        record.set('complement', targetComplement || '')
        record.set('neighborhood', targetNeighborhood)
        record.set('city', targetCity)
        record.set('state', targetState)
        record.set('postal_code', targetPostalCode)
        app.save(record)
        totalAlterados++

        // Registrar em audit_trail
        if (auditCol) {
          try {
            const auditRec = new Record(auditCol)
            auditRec.set('user_id', '')
            auditRec.set('actor_name', 'Sistema')
            auditRec.set('action', 'uber_address_interpolated')
            auditRec.set('collection', 'customers')
            auditRec.set('record_id', customerId)
            auditRec.set('field', 'address,street,number,complement')
            auditRec.set(
              'old_value',
              JSON.stringify({
                address: oldAddress,
                street: oldStreet,
                number: oldNumber,
                complement: oldComplement,
              }),
            )
            auditRec.set(
              'new_value',
              JSON.stringify({
                address: newAddress,
                street: targetStreet,
                number: targetNumber,
                complement: targetComplement,
              }),
            )
            auditRec.set('timestamp', nowIso)
            auditRec.set(
              'metadata',
              JSON.stringify({
                system_trigger: true,
                actor_role: 'system',
                reason:
                  'formatação de endereço padrão Uber com interpolação de número e preservação de lote/quadra no complemento',
                customer_id: customerId,
                customer_name: record.getString('name'),
                lat,
                lng,
                interpolated_number: targetNumber,
              }),
            )
            app.save(auditRec)
          } catch (eAudit) {
            console.log(`[0148] Falha ao salvar audit_trail para customer ${customerId}:`, eAudit)
          }
        }
      }
    }

    console.log('[0148_uber_address_interpolated] Concluído com sucesso!')
    console.log(`[0148] Clientes varridos: ${totalVarridos}`)
    console.log(`[0148] Clientes alterados: ${totalAlterados}`)
    console.log(`[0148] Clientes sem número (alerta pendente): ${totalSemNumero}`)
  },
  (app) => {
    console.log('[0148_uber_address_interpolated] Rollback...')
  },
)

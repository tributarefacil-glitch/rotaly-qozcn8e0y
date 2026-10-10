// Hook backend para permitir que o cliente envie sua localização via link público /pin/:customer_id
// SEGURANÇA E REGRA SOBERANA ROTALY:
// - O cliente clica no link enviado via WhatsApp, crava o pino no mapa e clica em Confirmar.
// - NUNCA sobrescreve automaticamente um pin já calibrado por entregador.
// - Se o cliente já tem pin calibrado por entregador, a localização do cliente é gravada em `pending_client_pin` para aprovação do vendedor/admin.
// - Se o cliente NÃO tem coordenadas ou está em contingência/sem pin calibrado por entregador, atualiza diretamente lat/lng e preenche `plus_code`.
// - Registra audit_trail apropriado.

routerAdd('POST', '/backend/v1/public-client-pin/{id}', (c) => {
  try {
    const customerId = (c.request.pathValue('id') || '').trim()
    if (!customerId) {
      return c.json(400, { error: 'ID do cliente é obrigatório.' })
    }

    let customer = null
    try {
      customer = $app.findRecordById('customers', customerId)
    } catch (_) {
      return c.json(404, { error: 'Cliente não encontrado.' })
    }

    const reqInfo = c.requestInfo()
    const data = (reqInfo && reqInfo.body) || {}
    const lat = typeof data.lat === 'number' ? data.lat : parseFloat(data.lat)
    const lng = typeof data.lng === 'number' ? data.lng : parseFloat(data.lng)
    const plusCode = (data.plus_code || '').trim()
    const referencePoint = (data.reference_point || '').trim()
    const clientNote = (data.client_note || '').trim()

    if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) {
      return c.json(400, { error: 'Coordenadas lat/lng inválidas.' })
    }

    const notes = customer.getString('notes') || ''
    // Verifica se já existe calibração por entregador
    const isCalibratedByCourier =
      notes.includes('CORREÇÃO AUTOMÁTICA PIN ENTREGADOR') ||
      notes.includes('pin_entregador') ||
      notes.includes('ALERTA GPS APROVADO')

    const nowIso = new Date().toISOString()
    const pendingPayload = {
      lat,
      lng,
      plus_code: plusCode,
      reference_point: referencePoint,
      client_note: clientNote,
      submitted_at: nowIso,
      source: 'whatsapp_client_pin',
    }

    if (isCalibratedByCourier) {
      // REGRA INEGOCIÁVEL: Pin do entregador é soberano!
      // Grava em pending_client_pin para sugestão no painel /admin, sem sobrescrever o pin existente.
      customer.set('pending_client_pin', pendingPayload)
      if (referencePoint && !customer.getString('reference_point')) {
        customer.set('reference_point', referencePoint)
      }
      $app.save(customer)

      // Audit trail
      try {
        const auditCol = $app.findCollectionByNameOrId('audit_trail')
        const auditRecord = new Record(auditCol, {
          user_id: '',
          collection: 'customers',
          record_id: customerId,
          action: 'client_pin_submitted_pending',
          field: 'pending_client_pin',
          old_value: '',
          new_value: `${lat.toFixed(6)}, ${lng.toFixed(6)} (${plusCode})`,
          timestamp: nowIso.replace('T', ' ').substring(0, 19),
          metadata: {
            actor_name: 'Cliente (WhatsApp)',
            system_trigger: true,
            status: 'pending_approval_courier_sovereign',
            notes: 'Pin mantido soberano; localização do cliente sugerida para aprovação.',
          },
        })
        $app.save(auditRecord)
      } catch (e) {
        console.log('Erro ao salvar audit_trail para public-client-pin pending:', e)
      }

      return c.json(200, {
        success: true,
        sovereignty: 'courier_retained',
        message: 'Localização recebida e salva com sucesso para conferência!',
      })
    } else {
      // Cliente sem pin calibrado por entregador: atualiza diretamente
      const oldLat = customer.getFloat('lat')
      const oldLng = customer.getFloat('lng')
      customer.set('lat', lat)
      customer.set('lng', lng)
      if (plusCode) customer.set('plus_code', plusCode)
      if (referencePoint) customer.set('reference_point', referencePoint)
      customer.set('pending_client_pin', null) // Limpa pendência se houver
      $app.save(customer)

      // Audit trail
      try {
        const auditCol = $app.findCollectionByNameOrId('audit_trail')
        const auditRecord = new Record(auditCol, {
          user_id: '',
          collection: 'customers',
          record_id: customerId,
          action: 'client_pin_direct_update',
          field: 'lat,lng',
          old_value: `${oldLat || 0}, ${oldLng || 0}`,
          new_value: `${lat.toFixed(6)}, ${lng.toFixed(6)} (${plusCode})`,
          timestamp: nowIso.replace('T', ' ').substring(0, 19),
          metadata: {
            actor_name: 'Cliente (WhatsApp)',
            system_trigger: true,
            notes:
              'Pin cravado pelo cliente via link do WhatsApp (cliente não possuía pin de entregador).',
          },
        })
        $app.save(auditRecord)
      } catch (e) {
        console.log('Erro ao salvar audit_trail para public-client-pin direct:', e)
      }

      return c.json(200, {
        success: true,
        sovereignty: 'direct_updated',
        message: 'Localização atualizada com sucesso no cadastro!',
      })
    }
  } catch (err) {
    console.log('Erro em public-client-pin:', err)
    return c.json(500, { error: 'Erro interno ao processar localização do cliente.' })
  }
})

// Endpoint público para o cliente visualizar os dados básicos do seu pedido/cadastro na página /pin/:id
routerAdd('GET', '/backend/v1/public-client-pin/{id}', (c) => {
  try {
    const customerId = (c.request.pathValue('id') || '').trim()
    if (!customerId) {
      return c.json(400, { error: 'ID do cliente é obrigatório.' })
    }

    let customer = null
    try {
      customer = $app.findRecordById('customers', customerId)
    } catch (_) {
      return c.json(404, { error: 'Cliente não encontrado.' })
    }

    return c.json(200, {
      id: customer.id,
      name: customer.getString('name'),
      address: customer.getString('address') || customer.getString('street'),
      neighborhood: customer.getString('neighborhood'),
      city: customer.getString('city'),
      state: customer.getString('state'),
      lat: customer.getFloat('lat') || null,
      lng: customer.getFloat('lng') || null,
      reference_point: customer.getString('reference_point') || '',
      plus_code: customer.getString('plus_code') || '',
    })
  } catch (err) {
    console.log('Erro em GET public-client-pin:', err)
    return c.json(500, { error: 'Erro interno ao consultar dados do cliente.' })
  }
})

// Hook PocketBase: Prevenção de destino igual à base na criação e edição de pedidos (orders)
// Evita que pedidos nasçam ou sejam editados com end_address apontando para a base da empresa
// Caso concreto: TRK-2026-15041870 (MARCIA FERNANDA) que nasceu com destino = Mais Saudavel
//
// Regras:
// - Em onRecordCreate e onRecordUpdate de 'orders':
//   1. Obter coordenadas da base ativa da empresa via 'base_addresses' (ou fallback das bases cadastradas)
//   2. Calcular distância Haversine entre (end_address_lat, end_address_lng) e a base (tolerância ~50 m)
//   3. Se coincidir com a base:
//      - Buscar o customer_id associado na coleção 'customers'
//      - Se o cliente possui lat/lng válidos e distintos da base (> 50 m):
//        * Auto-corrigir end_address_lat, end_address_lng, end_address_name, end_address_text com os dados do cliente
//        * Registrar evento em 'audit_trail' com motivo "Correção automática: destino do pedido coincidia com a base"
//      - Se o cliente NÃO tem coordenadas válidas ou também aponta para a base:
//        * Rejeitar com BadRequestError claro para o usuário informando a inconsistência.
//
// NOTA IMPORTANTE JSVM POCKETBASE: As funções e lógicas devem ficar INLINE dentro de cada callback
// para compatibilidade com o pool JSVM multi-thread do PocketBase.

onRecordCreateRequest((e) => {
  const order = e.record
  const endLat = order.get('end_address_lat')
  const endLng = order.get('end_address_lng')
  const endName = order.getString('end_address_name')
  const endText = order.getString('end_address_text')
  const customerId = order.getString('customer_id')
  const empresaId = order.getString('empresa_id')

  if (endLat !== null && endLat !== undefined && endLng !== null && endLng !== undefined) {
    const numEndLat = Number(endLat)
    const numEndLng = Number(endLng)
    if (!isNaN(numEndLat) && !isNaN(numEndLng) && (numEndLat !== 0 || numEndLng !== 0)) {
      // 1. Obter bases conhecidas
      let bases = []
      try {
        if (empresaId) {
          bases = e.app.findRecordsByFilter(
            'base_addresses',
            `empresa_id = '${empresaId}'`,
            '-is_default',
            10,
          )
        }
        if (!bases || bases.length === 0) {
          bases = e.app.findRecordsByFilter('base_addresses', '', '-is_default', 10)
        }
      } catch (err) {
        console.warn('[prevent_base_dest] Erro ao buscar base_addresses:', err)
      }

      if (!bases || bases.length === 0) {
        bases = [
          {
            get: function (f) {
              return f === 'lat' ? -22.6977499 : f === 'lng' ? -43.2936013 : null
            },
            getString: function (f) {
              return f === 'name' ? 'Mais Saudavel' : ''
            },
          },
        ]
      }

      // Função Haversine inline
      const calcDistMeters = function (lat1, lon1, lat2, lon2) {
        const R = 6371e3
        const toRad = function (deg) {
          return (deg * Math.PI) / 180
        }
        const dLat = toRad(lat2 - lat1)
        const dLon = toRad(lon2 - lon1)
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        return R * c
      }

      let matchedBase = null
      for (let i = 0; i < bases.length; i++) {
        const b = bases[i]
        const bLat = Number(b.get('lat'))
        const bLng = Number(b.get('lng'))
        if (isNaN(bLat) || isNaN(bLng) || (bLat === 0 && bLng === 0)) continue

        const dist = calcDistMeters(numEndLat, numEndLng, bLat, bLng)
        if (dist <= 50) {
          matchedBase = b
          break
        }

        const bName = (b.getString('name') || '').trim().toLowerCase()
        if (
          bName &&
          (endName.toLowerCase().includes(bName) ||
            endText.toLowerCase().includes('fortuna, 13') ||
            endText.toLowerCase().includes('prosperidade, 13'))
        ) {
          matchedBase = b
          break
        }
      }

      // GUARDA DE FUTURO — ENDEREÇO ESCOLHIDO (bug Kely/Sara Andrade):
      // Se o pedido declara customer_address_id, o destino DEVE ser o endereço ESCOLHIDO.
      // Se as coordenadas recebidas apontam para o endereço PRINCIPAL do cliente (raiz)
      // ou divergem do endereço escolhido, sobrescreve com coordenadas/texto do escolhido
      // e registra audit_trail. Nunca deixa o pedido nascer apontando para o principal.
      if (customerId && order.getString('customer_address_id')) {
        try {
          const guardCustomer = e.app.findRecordById('customers', customerId)
          if (guardCustomer) {
            const guardAddressId = order.getString('customer_address_id')
            let guardAddrList = []
            const guardRaw = guardCustomer.get('addresses')
            try {
              if (typeof guardRaw === 'string') guardAddrList = JSON.parse(guardRaw)
              else if (Array.isArray(guardRaw)) guardAddrList = guardRaw
            } catch (_) {
              guardAddrList = []
            }
            const guardChosen = Array.isArray(guardAddrList)
              ? guardAddrList.find((a) => a && a.id === guardAddressId)
              : null
            if (guardChosen) {
              const chLat = Number(guardChosen.lat)
              const chLng = Number(guardChosen.lng)
              const chText = (guardChosen.address || guardChosen.street || '').trim()
              const chValid = !isNaN(chLat) && !isNaN(chLng) && (chLat !== 0 || chLng !== 0)
              const rootLat = Number(guardCustomer.get('lat'))
              const rootLng = Number(guardCustomer.get('lng'))
              const rootValid =
                !isNaN(rootLat) && !isNaN(rootLng) && (rootLat !== 0 || rootLng !== 0)
              const endValid =
                !isNaN(numEndLat) && !isNaN(numEndLng) && (numEndLat !== 0 || numEndLng !== 0)
              const distEndToChosen =
                chValid && endValid ? calcDistMeters(numEndLat, numEndLng, chLat, chLng) : Infinity
              const distEndToRoot =
                rootValid && endValid
                  ? calcDistMeters(numEndLat, numEndLng, rootLat, rootLng)
                  : Infinity

              if (chValid && (distEndToChosen > 50 || distEndToRoot <= 50)) {
                const gOldText = order.getString('end_address_text')
                const gOldLat = order.get('end_address_lat')
                const gOldLng = order.get('end_address_lng')
                order.set('end_address_lat', chLat)
                order.set('end_address_lng', chLng)
                if (chText) {
                  order.set('end_address_text', chText)
                }
                order.set('end_address_name', guardCustomer.getString('name') || 'Cliente')
                console.log(
                  `[prevent_base_dest] Guarda de endereço escolhido aplicada no CREATE: destino realinhado ao endereço customer_address_id=${guardAddressId}`,
                )
                try {
                  const gAuditCol = e.app.findCollectionByNameOrId('audit_trail')
                  if (gAuditCol) {
                    const gAudit = new Record(gAuditCol)
                    gAudit.set('collection', 'orders')
                    gAudit.set('record_id', order.id || 'NEW_RECORD')
                    gAudit.set('action', 'order_address_choice_guard')
                    gAudit.set('field', 'end_address')
                    gAudit.set('old_value', `${gOldText} (${gOldLat}, ${gOldLng})`)
                    gAudit.set('new_value', `${chText} (${chLat}, ${chLng})`)
                    gAudit.set('user_id', '')
                    gAudit.set('timestamp', new Date().toISOString())
                    gAudit.set('metadata', {
                      reason:
                        'Guarda de futuro: destino do pedido apontava para o endereço principal do cliente em vez do endereço escolhido (customer_address_id)',
                      customer_id: customerId,
                      customer_address_id: guardAddressId,
                      tracking_code: order.getString('tracking_code'),
                      actor_name: 'Sistema',
                      actor_role: 'system',
                      system_trigger: true,
                    })
                    e.app.save(gAudit)
                  }
                } catch (gAuditErr) {
                  console.warn('[prevent_base_dest] Falha ao gravar audit da guarda:', gAuditErr)
                }
              }
            }
          }
        } catch (guardErr) {
          console.warn('[prevent_base_dest] Falha na guarda de endereço escolhido:', guardErr)
        }
      }

      if (matchedBase) {
        console.log(
          `[prevent_base_dest] Interceptado pedido com destino igual à base em onRecordCreate! tracking=${order.getString('tracking_code') || order.id}`,
        )

        if (!customerId) {
          throw new BadRequestError(
            'O endereço de entrega do pedido não pode ser a própria base de expedição. Informe um cliente válido com endereço de entrega.',
          )
        }

        let customer = null
        try {
          customer = e.app.findRecordById('customers', customerId)
        } catch (custErr) {
          console.warn('[prevent_base_dest] Erro ao buscar customer:', custErr)
        }

        if (!customer) {
          throw new BadRequestError(
            'O endereço de entrega do pedido coincidia com a base e o cliente associado não foi encontrado no sistema.',
          )
        }

        // REGRA: se o pedido declara customer_address_id, o endereço ESCOLHIDO é a fonte
        // primária — o endereço principal (raiz) só entra se o escolhido for inválido.
        const orderAddressId = order.getString('customer_address_id')
        let chosenValid = false
        if (orderAddressId) {
          try {
            const rawAddresses = customer.get('addresses')
            let addrList = []
            if (typeof rawAddresses === 'string') {
              addrList = JSON.parse(rawAddresses)
            } else if (Array.isArray(rawAddresses)) {
              addrList = rawAddresses
            }
            if (Array.isArray(addrList)) {
              const matchedAddr = addrList.find((a) => a && a.id === orderAddressId)
              if (matchedAddr) {
                const aLat = Number(matchedAddr.lat)
                const aLng = Number(matchedAddr.lng)
                const aText = matchedAddr.address || matchedAddr.street || ''
                if (!isNaN(aLat) && !isNaN(aLng) && (aLat !== 0 || aLng !== 0)) {
                  custLat = aLat
                  custLng = aLng
                  if (aText.trim()) custAddress = aText.trim()
                  chosenValid = true
                }
              }
            }
          } catch (addrErr) {
            console.warn('[prevent_base_dest] Falha ao extrair addresses secundários:', addrErr)
          }
        }
        // Pedido declara endereço escolhido mas ele é inválido/sem coordenadas:
        // NUNCA recorrer ao principal — recusa com mensagem clara (futuro protegido).
        if (orderAddressId && !chosenValid) {
          throw new BadRequestError(
            'O endereço de entrega escolhido para este pedido está sem coordenadas válidas no cadastro. Calibre o pin do endereço escolhido do cliente antes de salvar o pedido (o sistema não pode substituí-lo pelo endereço principal).',
          )
        }

        const baseLatNum = Number(matchedBase.get('lat'))
        const baseLngNum = Number(matchedBase.get('lng'))
        const hasValidCustCoords =
          !isNaN(custLat) &&
          !isNaN(custLng) &&
          (custLat !== 0 || custLng !== 0) &&
          calcDistMeters(custLat, custLng, baseLatNum, baseLngNum) > 50

        if (hasValidCustCoords && custAddress.trim()) {
          const oldLat = endLat
          const oldLng = endLng
          const oldText = endText

          order.set('end_address_lat', custLat)
          order.set('end_address_lng', custLng)
          order.set('end_address_name', custName)
          order.set('end_address_text', custAddress)

          console.log(
            `[prevent_base_dest] Destino corrigido automaticamente para coordenadas do cliente ${custName} (${custLat}, ${custLng})`,
          )

          try {
            const auditCol = e.app.findCollectionByNameOrId('audit_trail')
            if (auditCol) {
              const auditRec = new Record(auditCol)
              let resolvedUserId = ''
              if (e.auth && e.auth.id) {
                try {
                  const authUser = e.app.findRecordById('users', e.auth.id)
                  if (authUser) resolvedUserId = authUser.id
                } catch (_) {}
              }
              if (resolvedUserId) {
                auditRec.set('user_id', resolvedUserId)
              }
              const courierId = order.getString('courier_id')
              if (courierId) auditRec.set('courier_id', courierId)

              auditRec.set('collection', 'orders')
              auditRec.set('record_id', order.id || 'NEW_RECORD')
              auditRec.set('action', 'auto_correct_base_destination')
              auditRec.set('field', 'end_address')
              auditRec.set('old_value', `${oldText} (${oldLat}, ${oldLng})`)
              auditRec.set('new_value', `${custAddress} (${custLat}, ${custLng})`)
              auditRec.set('timestamp', new Date().toISOString())
              auditRec.set('metadata', {
                reason: 'Correção automática: destino do pedido coincidia com a base',
                customer_id: customerId,
                customer_name: custName,
                tracking_code: order.getString('tracking_code'),
                actor_name: 'Sistema',
                actor_role: 'system',
                system_trigger: true,
              })
              e.app.save(auditRec)
            }
          } catch (auditErr) {
            console.warn('[prevent_base_dest] Erro ao gravar audit_trail:', auditErr)
          }
        } else {
          // Se for uma mutação de pedido já concluído/cancelado ou sem auth (migração / rotina de sistema),
          // não bloquear com BadRequestError para permitir saneamento de outros campos.
          const orderStatus = order.getString('status')
          if (!e.auth || orderStatus === 'delivered' || orderStatus === 'cancelled') {
            console.warn(
              `[prevent_base_dest] Pedido histórico ${order.getString('tracking_code') || order.id} mantido (cliente sem coords novas, status=${orderStatus}).`,
            )
          } else {
            throw new BadRequestError(
              `O destino do pedido coincide com a base da empresa (${matchedBase.getString('name') || 'Base'}) e o cliente cadastrado não possui coordenadas de endereço válidas distintas da base. Por favor, atualize o endereço do cliente antes de criar ou salvar a entrega.`,
            )
          }
        }
      }
    }
  }

  e.next()
}, 'orders')

onRecordUpdateRequest((e) => {
  const order = e.record
  const originalOrder = order.original()
  const orderStatus = order.getString('status')
  const isTransitioningToFinished =
    order.getBool('route_finished') && (!originalOrder || !originalOrder.getBool('route_finished'))

  // REGRA DE OURO: O encerramento de rota (route_finished = true) e mutações em pedidos já entregues/cancelados
  // NUNCA alteram o destino do cliente — não devem ser bloqueados pela guarda de destino na base!
  // Também se o endereço de destino (lat/lng/text) não foi modificado nesta requisição, ignorar checagem.
  if (isTransitioningToFinished || orderStatus === 'delivered' || orderStatus === 'cancelled') {
    e.next()
    return
  }

  const endLat = order.get('end_address_lat')
  const endLng = order.get('end_address_lng')
  const endName = order.getString('end_address_name')
  const endText = order.getString('end_address_text')

  if (originalOrder) {
    const origLat = originalOrder.get('end_address_lat')
    const origLng = originalOrder.get('end_address_lng')
    const origText = originalOrder.getString('end_address_text')
    const destinationUnchanged = origLat === endLat && origLng === endLng && origText === endText
    if (destinationUnchanged) {
      e.next()
      return
    }
  }

  const customerId = order.getString('customer_id')
  const empresaId = order.getString('empresa_id')

  if (endLat !== null && endLat !== undefined && endLng !== null && endLng !== undefined) {
    const numEndLat = Number(endLat)
    const numEndLng = Number(endLng)
    if (!isNaN(numEndLat) && !isNaN(numEndLng) && (numEndLat !== 0 || numEndLng !== 0)) {
      let bases = []
      try {
        if (empresaId) {
          bases = e.app.findRecordsByFilter(
            'base_addresses',
            `empresa_id = '${empresaId}'`,
            '-is_default',
            10,
          )
        }
        if (!bases || bases.length === 0) {
          bases = e.app.findRecordsByFilter('base_addresses', '', '-is_default', 10)
        }
      } catch (err) {
        console.warn('[prevent_base_dest] Erro ao buscar base_addresses:', err)
      }

      if (!bases || bases.length === 0) {
        bases = [
          {
            get: function (f) {
              return f === 'lat' ? -22.6977499 : f === 'lng' ? -43.2936013 : null
            },
            getString: function (f) {
              return f === 'name' ? 'Mais Saudavel' : ''
            },
          },
        ]
      }

      const calcDistMeters = function (lat1, lon1, lat2, lon2) {
        const R = 6371e3
        const toRad = function (deg) {
          return (deg * Math.PI) / 180
        }
        const dLat = toRad(lat2 - lat1)
        const dLon = toRad(lon2 - lon1)
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        return R * c
      }

      let matchedBase = null
      for (let i = 0; i < bases.length; i++) {
        const b = bases[i]
        const bLat = Number(b.get('lat'))
        const bLng = Number(b.get('lng'))
        if (isNaN(bLat) || isNaN(bLng) || (bLat === 0 && bLng === 0)) continue

        const dist = calcDistMeters(numEndLat, numEndLng, bLat, bLng)
        if (dist <= 50) {
          matchedBase = b
          break
        }

        const bName = (b.getString('name') || '').trim().toLowerCase()
        if (
          bName &&
          (endName.toLowerCase().includes(bName) ||
            endText.toLowerCase().includes('fortuna, 13') ||
            endText.toLowerCase().includes('prosperidade, 13'))
        ) {
          matchedBase = b
          break
        }
      }

      // GUARDA DE FUTURO — ENDEREÇO ESCOLHIDO (bug Kely/Sara Andrade) na EDIÇÃO:
      // destino declarado com customer_address_id deve apontar para o endereço escolhido,
      // nunca para o principal do cliente. Corrige silenciosamente com audit_trail.
      if (customerId && order.getString('customer_address_id')) {
        try {
          const guardCustomer = e.app.findRecordById('customers', customerId)
          if (guardCustomer) {
            const guardAddressId = order.getString('customer_address_id')
            let guardAddrList = []
            const guardRaw = guardCustomer.get('addresses')
            try {
              if (typeof guardRaw === 'string') guardAddrList = JSON.parse(guardRaw)
              else if (Array.isArray(guardRaw)) guardAddrList = guardRaw
            } catch (_) {
              guardAddrList = []
            }
            const guardChosen = Array.isArray(guardAddrList)
              ? guardAddrList.find((a) => a && a.id === guardAddressId)
              : null
            if (guardChosen) {
              const chLat = Number(guardChosen.lat)
              const chLng = Number(guardChosen.lng)
              const chText = (guardChosen.address || guardChosen.street || '').trim()
              const chValid = !isNaN(chLat) && !isNaN(chLng) && (chLat !== 0 || chLng !== 0)
              const rootLat = Number(guardCustomer.get('lat'))
              const rootLng = Number(guardCustomer.get('lng'))
              const rootValid =
                !isNaN(rootLat) && !isNaN(rootLng) && (rootLat !== 0 || rootLng !== 0)
              const endValid =
                !isNaN(numEndLat) && !isNaN(numEndLng) && (numEndLat !== 0 || numEndLng !== 0)
              const distEndToChosen =
                chValid && endValid ? calcDistMeters(numEndLat, numEndLng, chLat, chLng) : Infinity
              const distEndToRoot =
                rootValid && endValid
                  ? calcDistMeters(numEndLat, numEndLng, rootLat, rootLng)
                  : Infinity

              if (chValid && (distEndToChosen > 50 || distEndToRoot <= 50)) {
                const gOldText = order.getString('end_address_text')
                const gOldLat = order.get('end_address_lat')
                const gOldLng = order.get('end_address_lng')
                order.set('end_address_lat', chLat)
                order.set('end_address_lng', chLng)
                if (chText) {
                  order.set('end_address_text', chText)
                }
                order.set('end_address_name', guardCustomer.getString('name') || 'Cliente')
                console.log(
                  `[prevent_base_dest] Guarda de endereço escolhido aplicada no UPDATE: destino realinhado ao endereço customer_address_id=${guardAddressId}`,
                )
                try {
                  const gAuditCol = e.app.findCollectionByNameOrId('audit_trail')
                  if (gAuditCol) {
                    const gAudit = new Record(gAuditCol)
                    gAudit.set('collection', 'orders')
                    gAudit.set('record_id', order.id || 'NEW_RECORD')
                    gAudit.set('action', 'order_address_choice_guard')
                    gAudit.set('field', 'end_address')
                    gAudit.set('old_value', `${gOldText} (${gOldLat}, ${gOldLng})`)
                    gAudit.set('new_value', `${chText} (${chLat}, ${chLng})`)
                    gAudit.set('user_id', '')
                    gAudit.set('timestamp', new Date().toISOString())
                    gAudit.set('metadata', {
                      reason:
                        'Guarda de futuro (update): destino do pedido apontava para o endereço principal do cliente em vez do endereço escolhido (customer_address_id)',
                      customer_id: customerId,
                      customer_address_id: guardAddressId,
                      tracking_code: order.getString('tracking_code'),
                      actor_name: 'Sistema',
                      actor_role: 'system',
                      system_trigger: true,
                    })
                    e.app.save(gAudit)
                  }
                } catch (gAuditErr) {
                  console.warn(
                    '[prevent_base_dest] Falha ao gravar audit da guarda (update):',
                    gAuditErr,
                  )
                }
              }
            }
          }
        } catch (guardErr) {
          console.warn('[prevent_base_dest] Falha na guarda de endereço escolhido:', guardErr)
        }
      }

      if (matchedBase) {
        console.log(
          `[prevent_base_dest] Interceptado pedido com destino igual à base em onRecordUpdate! tracking=${order.getString('tracking_code') || order.id}`,
        )

        if (!customerId) {
          throw new BadRequestError(
            'O endereço de entrega do pedido não pode ser a própria base de expedição. Informe um cliente válido com endereço de entrega.',
          )
        }

        let customer = null
        try {
          customer = e.app.findRecordById('customers', customerId)
        } catch (custErr) {
          console.warn('[prevent_base_dest] Erro ao buscar customer:', custErr)
        }

        if (!customer) {
          throw new BadRequestError(
            'O endereço de entrega do pedido coincidia com a base e o cliente associado não foi encontrado no sistema.',
          )
        }

        // REGRA (update): se o pedido declara customer_address_id, o endereço ESCOLHIDO é
        // a fonte primária — o endereço principal (raiz) só entra se o escolhido for inválido.
        const orderAddressId = order.getString('customer_address_id')
        let chosenValid = false
        if (orderAddressId) {
          try {
            const rawAddresses = customer.get('addresses')
            let addrList = []
            if (typeof rawAddresses === 'string') {
              addrList = JSON.parse(rawAddresses)
            } else if (Array.isArray(rawAddresses)) {
              addrList = rawAddresses
            }
            if (Array.isArray(addrList)) {
              const matchedAddr = addrList.find((a) => a && a.id === orderAddressId)
              if (matchedAddr) {
                const aLat = Number(matchedAddr.lat)
                const aLng = Number(matchedAddr.lng)
                const aText = matchedAddr.address || matchedAddr.street || ''
                if (!isNaN(aLat) && !isNaN(aLng) && (aLat !== 0 || aLng !== 0)) {
                  custLat = aLat
                  custLng = aLng
                  if (aText.trim()) custAddress = aText.trim()
                  chosenValid = true
                }
              }
            }
          } catch (addrErr) {
            console.warn(
              '[prevent_base_dest] Falha ao extrair addresses secundários (update):',
              addrErr,
            )
          }
        }
        // Pedido declara endereço escolhido mas ele é inválido/sem coordenadas (update):
        // NUNCA recorrer ao principal — recusa com mensagem clara (futuro protegido).
        if (orderAddressId && !chosenValid) {
          throw new BadRequestError(
            'O endereço de entrega escolhido para este pedido está sem coordenadas válidas no cadastro. Calibre o pin do endereço escolhido do cliente antes de salvar o pedido (o sistema não pode substituí-lo pelo endereço principal).',
          )
        }

        const baseLatNum = Number(matchedBase.get('lat'))
        const baseLngNum = Number(matchedBase.get('lng'))
        const hasValidCustCoords =
          !isNaN(custLat) &&
          !isNaN(custLng) &&
          (custLat !== 0 || custLng !== 0) &&
          calcDistMeters(custLat, custLng, baseLatNum, baseLngNum) > 50

        if (hasValidCustCoords && custAddress.trim()) {
          const oldLat = endLat
          const oldLng = endLng
          const oldText = endText

          order.set('end_address_lat', custLat)
          order.set('end_address_lng', custLng)
          order.set('end_address_name', custName)
          order.set('end_address_text', custAddress)

          console.log(
            `[prevent_base_dest] Destino corrigido automaticamente para coordenadas do cliente ${custName} (${custLat}, ${custLng})`,
          )

          try {
            const auditCol = e.app.findCollectionByNameOrId('audit_trail')
            if (auditCol) {
              const auditRec = new Record(auditCol)
              let resolvedUserId = ''
              if (e.auth && e.auth.id) {
                try {
                  const authUser = e.app.findRecordById('users', e.auth.id)
                  if (authUser) resolvedUserId = authUser.id
                } catch (_) {}
              }
              if (resolvedUserId) {
                auditRec.set('user_id', resolvedUserId)
              }
              const courierId = order.getString('courier_id')
              if (courierId) auditRec.set('courier_id', courierId)

              auditRec.set('collection', 'orders')
              auditRec.set('record_id', order.id || 'NEW_RECORD')
              auditRec.set('action', 'auto_correct_base_destination')
              auditRec.set('field', 'end_address')
              auditRec.set('old_value', `${oldText} (${oldLat}, ${oldLng})`)
              auditRec.set('new_value', `${custAddress} (${custLat}, ${custLng})`)
              auditRec.set('timestamp', new Date().toISOString())
              auditRec.set('metadata', {
                reason: 'Correção automática: destino do pedido coincidia com a base',
                customer_id: customerId,
                customer_name: custName,
                tracking_code: order.getString('tracking_code'),
                actor_name: 'Sistema',
                actor_role: 'system',
                system_trigger: true,
              })
              e.app.save(auditRec)
            }
          } catch (auditErr) {
            console.warn('[prevent_base_dest] Erro ao gravar audit_trail:', auditErr)
          }
        } else {
          throw new BadRequestError(
            `O destino do pedido coincide com a base da empresa (${matchedBase.getString('name') || 'Base'}) e o cliente cadastrado não possui coordenadas de endereço válidas distintas da base. Por favor, atualize o endereço do cliente antes de criar ou salvar a entrega.`,
          )
        }
      }
    }
  }

  e.next()
}, 'orders')

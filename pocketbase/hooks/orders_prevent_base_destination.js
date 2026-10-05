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
              return f === 'lat' ? -22.6990563 : f === 'lng' ? -43.296723 : null
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
            endText.toLowerCase().includes('prosperidade, 13'))
        ) {
          matchedBase = b
          break
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

        const custLat = Number(customer.get('lat'))
        const custLng = Number(customer.get('lng'))
        const custAddress = customer.getString('address') || customer.getString('street') || ''
        const custName = customer.getString('name') || 'Cliente'

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
              return f === 'lat' ? -22.6990563 : f === 'lng' ? -43.296723 : null
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
            endText.toLowerCase().includes('prosperidade, 13'))
        ) {
          matchedBase = b
          break
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

        const custLat = Number(customer.get('lat'))
        const custLng = Number(customer.get('lng'))
        const custAddress = customer.getString('address') || customer.getString('street') || ''
        const custName = customer.getString('name') || 'Cliente'

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

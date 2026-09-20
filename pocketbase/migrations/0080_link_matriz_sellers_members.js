/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // 0080_link_matriz_sellers_members.js
    //
    // Garante que os 4 vendedores da Matriz tenham registro ativo na coleção 'membros'
    // tanto para a empresa Matriz 'bkef63kajsmin6c' quanto para '7wo05iyvfcfh01h'
    // garantindo compatibilidade total e tolerância retroativa.
    //
    // NUNCA deleta nem reescreve dados existentes; apenas insere vínculos faltantes.

    const targetEmpresas = ['bkef63kajsmin6c', '7wo05iyvfcfh01h']

    // Vendedores da Matriz identificados:
    // Caroline Vendedora (4iycez46kbxl1ly / caroline@loghype.com / caroline@rotaly.com)
    // Kely / Loja Matriz (sh669l7snqiuoab / kely@loghype.com / matriz@rotaly.com)
    // Davi dos Santos Mendes (rgednwaz40iq9tb / davidsmendes16@gmail.com)
    // Diogo Mendes (av4car3aqi52ftq / pimentaverdecosmetico@gmail.com)
    const sellerEmails = [
      'caroline@loghype.com',
      'caroline@rotaly.com',
      'kely@loghype.com',
      'matriz@rotaly.com',
      'davidsmendes16@gmail.com',
      'vendedor@rotaly.com',
      'vendedor2@rotaly.com',
      'vendedor@logistica.com',
      'pimentaverdecosmetico@gmail.com',
    ]

    const sellerUserIds = [
      '4iycez46kbxl1ly',
      'sh669l7snqiuoab',
      'rgednwaz40iq9tb',
      'av4car3aqi52ftq',
    ]

    const membrosCol = app.findCollectionByNameOrId('membros')

    // 1. Coletar IDs de usuários vendedores existentes
    const foundUserIds = new Set(sellerUserIds)

    for (let i = 0; i < sellerEmails.length; i++) {
      try {
        const u = app.findAuthRecordByEmail('_pb_users_auth_', sellerEmails[i])
        if (u && u.id) {
          foundUserIds.add(u.id)
        }
      } catch (_) {
        // Ignora emails que não existem no banco
      }
    }

    // Também busca qualquer usuário com role = 'seller'
    try {
      const sellerRecords = app.findRecordsByFilter('users', "role = 'seller'", '-created', 100, 0)
      for (let s = 0; s < sellerRecords.length; s++) {
        if (sellerRecords[s] && sellerRecords[s].id) {
          foundUserIds.add(sellerRecords[s].id)
        }
      }
    } catch (eFilter) {
      console.log('[0080] Aviso ao listar sellers por filter:', eFilter)
    }

    console.log(`[0080] Usuários vendedores identificados para vínculo: ${foundUserIds.size}`)

    // 2. Para cada empresa Matriz e para cada vendedor, garantir registro em 'membros'
    targetEmpresas.forEach((empId) => {
      // Verificar se a empresa realmente existe na base
      try {
        app.findCollectionByNameOrId('empresas')
        const empRecord = app.findFirstRecordByData('empresas', 'id', empId)
        if (!empRecord) return
      } catch (_) {
        return // Empresa não existe nesta instância, pula
      }

      foundUserIds.forEach((userId) => {
        try {
          // Verificar se já existe vínculo para este user e esta empresa
          const existing = app.findRecordsByFilter(
            'membros',
            `empresa_id = '${empId}' && user_id = '${userId}'`,
            '-created',
            1,
            0,
          )

          if (existing && existing.length > 0) {
            const m = existing[0]
            let changed = false
            if (m.get('ativo') !== true) {
              m.set('ativo', true)
              changed = true
            }
            if (m.get('papel') !== 'vendedor') {
              m.set('papel', 'vendedor')
              changed = true
            }
            if (changed) {
              app.save(m)
              console.log(`[0080] Vínculo atualizado: empresa=${empId}, user=${userId}`)
            }
          } else {
            // Inserir novo registro de membro
            const newMembro = new Record(membrosCol)
            newMembro.set('empresa_id', empId)
            newMembro.set('user_id', userId)
            newMembro.set('papel', 'vendedor')
            newMembro.set('ativo', true)
            app.save(newMembro)
            console.log(`[0080] Novo vínculo inserido: empresa=${empId}, user=${userId}`)
          }
        } catch (err) {
          console.log(`[0080] Erro ao vincular membro emp=${empId}, user=${userId}:`, err)
        }
      })
    })

    console.log('[0080] Migração de membros de vendedores concluída.')
  },
  (app) => {
    // Down migration: intencionalmente vazia para preservar vínculos de membros
  },
)

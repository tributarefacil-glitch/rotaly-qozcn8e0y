/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // 0083_ensure_matriz_sellers_davi_diogo.js
    //
    // Insere os vínculos faltantes na coleção 'membros' para a matriz 7wo05iyvfcfh01h,
    // papel "vendedor", ativo true, de forma estritamente idempotente (INSERT OR IGNORE / try-catch).
    // Usuários:
    // - Davi dos Santos Mendes (user_id rgednwaz40iq9tb)
    // - Diogo Mendes (user_id av4car3aqi52ftq)
    //
    // NENHUMA deleção de registros em users/orders/customers/rotas/adiantamentos.

    const MATRIZ_ID = '7wo05iyvfcfh01h'
    const sellersToAdd = [
      { userId: 'rgednwaz40iq9tb', name: 'Davi dos Santos Mendes' },
      { userId: 'av4car3aqi52ftq', name: 'Diogo Mendes' },
    ]

    const membrosCol = app.findCollectionByNameOrId('membros')

    for (let i = 0; i < sellersToAdd.length; i++) {
      const { userId, name } = sellersToAdd[i]
      try {
        // Verifica se o usuário existe em users
        try {
          app.findFirstRecordByData('users', 'id', userId)
        } catch (_) {
          console.log(`[0083] Usuário ${userId} (${name}) não encontrado em users. Pulando.`)
          continue
        }

        // Verifica se já existe vínculo para este user e para a matriz
        const existing = app.findRecordsByFilter(
          'membros',
          `empresa_id = '${MATRIZ_ID}' && user_id = '${userId}'`,
          '-created',
          1,
          0,
        )

        if (existing && existing.length > 0) {
          const rec = existing[0]
          let changed = false
          if (rec.get('ativo') !== true) {
            rec.set('ativo', true)
            changed = true
          }
          if (rec.getString('papel') !== 'vendedor') {
            rec.set('papel', 'vendedor')
            changed = true
          }
          if (changed) {
            app.save(rec)
            console.log(
              `[0083] Vínculo existente atualizado para ativo/vendedor: user=${userId} (${name})`,
            )
          } else {
            console.log(`[0083] Vínculo já existe e está correto: user=${userId} (${name})`)
          }
        } else {
          // Inserir novo registro de membro na Matriz
          const newMembro = new Record(membrosCol)
          newMembro.set('empresa_id', MATRIZ_ID)
          newMembro.set('user_id', userId)
          newMembro.set('papel', 'vendedor')
          newMembro.set('ativo', true)
          app.save(newMembro)
          console.log(
            `[0083] Novo vínculo inserido com sucesso na Matriz: user=${userId} (${name})`,
          )
        }
      } catch (err) {
        console.log(`[0083] Erro ao processar vínculo para user=${userId} (${name}):`, err)
      }
    }

    console.log('[0083] Migração de vínculos de vendedores da Matriz concluída.')
  },
  (app) => {
    // Down migration: intencionalmente no-op para não perder histórico nem vínculos
  },
)

/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // 0084_ensure_matriz_sellers_members_strict.js
    //
    // Migration ESTRITAMENTE ADITIVA e não destrutiva (só INSERT, NUNCA UPDATE/DELETE).
    // Garante que os vendedores reais da matriz tenham vínculo na coleção 'membros':
    // empresa_id = '7wo05iyvfcfh01h'
    // user_id = ID real do usuário vendedor (role='seller')
    // papel = 'vendedor'
    // ativo = true
    //
    // Vendedores da matriz:
    // - Caroline (caroline@loghype.com / 4iycez46kbxl1ly)
    // - Kely (kely@loghype.com / sh669l7snqiuoab)
    // - Davi (davidsmendes16@gmail.com / rgednwaz40iq9tb)
    // - Diogo (pimentaverdecosmetico@gmail.com / av4car3aqi52ftq)
    //
    // Busca os ids reais na coleção users e só insere se o vínculo ainda não existir para evitar duplicatas.

    const MATRIZ_ID = '7wo05iyvfcfh01h'

    const targetSellers = [
      { email: 'caroline@loghype.com', defaultId: '4iycez46kbxl1ly', name: 'Caroline' },
      { email: 'kely@loghype.com', defaultId: 'sh669l7snqiuoab', name: 'Kely' },
      { email: 'davidsmendes16@gmail.com', defaultId: 'rgednwaz40iq9tb', name: 'Davi' },
      { email: 'pimentaverdecosmetico@gmail.com', defaultId: 'av4car3aqi52ftq', name: 'Diogo' },
    ]

    const membrosCol = app.findCollectionByNameOrId('membros')

    for (let i = 0; i < targetSellers.length; i++) {
      const sellerInfo = targetSellers[i]
      let realUserId = ''

      // 1. Busca id real na coleção users por email
      try {
        const u = app.findAuthRecordByEmail('_pb_users_auth_', sellerInfo.email)
        if (u && u.id) {
          realUserId = u.id
        }
      } catch (_) {
        // Se busca por email falhar, tenta por id direto
        try {
          const uById = app.findFirstRecordByData('users', 'id', sellerInfo.defaultId)
          if (uById && uById.id) {
            realUserId = uById.id
          }
        } catch (_) {}
      }

      if (!realUserId) {
        realUserId = sellerInfo.defaultId
      }

      // Verifica se o usuário de fato existe em users
      try {
        app.findFirstRecordByData('users', 'id', realUserId)
      } catch (errUser) {
        console.log(
          `[0084] Usuário ${sellerInfo.name} (${realUserId}) não encontrado na coleção users. Pulando.`,
        )
        continue
      }

      // 2. Verifica se JÁ existe vínculo na coleção 'membros' para esta empresa e este user_id
      try {
        const existingMembers = app.findRecordsByFilter(
          'membros',
          `empresa_id = '${MATRIZ_ID}' && user_id = '${realUserId}'`,
          '-created',
          1,
          0,
        )

        if (existingMembers && existingMembers.length > 0) {
          console.log(
            `[0084] Vínculo já existente para ${sellerInfo.name} (${realUserId}) na matriz. Nenhuma ação necessária (idempotente).`,
          )
          continue
        }

        // 3. Só insere se não existir — migração estritamente aditiva (sem update nem delete)
        const record = new Record(membrosCol)
        record.set('empresa_id', MATRIZ_ID)
        record.set('user_id', realUserId)
        record.set('papel', 'vendedor')
        record.set('ativo', true)
        app.save(record)

        console.log(
          `[0084] [ADITIVA] Vínculo de membro inserido com sucesso para ${sellerInfo.name} (${realUserId}) na matriz.`,
        )
      } catch (errMember) {
        console.log(
          `[0084] Erro ao verificar/inserir vínculo de ${sellerInfo.name} (${realUserId}):`,
          errMember,
        )
      }
    }

    console.log('[0084] Migração 0084 concluída com sucesso.')
  },
  (app) => {
    // Down migration: não destrutiva, no-op para manter a integridade dos dados históricos
  },
)

/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // 0081_cleanup_membros_duplicates_orphans_leak.js
    //
    // Corrige sintomas: "vendedores estão zerados e entregadores estão com cadastro dobrado"
    // Limpeza idempotente na coleção 'membros':
    // 1. Remove 6 registros órfãos (user_id inexistente em users).
    // 2. Remove os 4 vínculos incorretos da matriz vazados para a empresa Pimenta Verde (bkef63kajsmin6c).
    //    Também deduplica o vínculo admin de a79txuc992xhn7n na Pimenta Verde (mantendo 1).
    // 3. Deduplica membros da matriz (7wo05iyvfcfh01h): mantém exatamente 1 registro por (user_id + empresa_id),
    //    preservando o papel alinhado com users.role (seller->vendedor, courier->entregador, master/admin->admin).
    //    Remove duplicata 'gestor' de Diogo (gr2hb4yyno4lqns).
    //
    // NUNCA apaga usuários nem dados operacionais (pedidos, clientes, rotas, combustíveis, etc).

    const MATRIZ_ID = '7wo05iyvfcfh01h'
    const PIMENTA_VERDE_ID = 'bkef63kajsmin6c'

    // 1. Excluir os 6 registros órfãos identificados
    const knownOrphanIds = [
      'mbr_pimenta_gabriel',
      'mbr_pimenta_lucas',
      'mbr_xodo_mariana',
      'mbr_xodo_rodrigo',
      'mbr_matriz_adm_0',
      'mbr_matriz_adm_1',
    ]

    for (let i = 0; i < knownOrphanIds.length; i++) {
      try {
        const rec = app.findFirstRecordByData('membros', 'id', knownOrphanIds[i])
        if (rec) {
          app.delete(rec)
          console.log('[0081] Registro órfão removido por ID: ' + knownOrphanIds[i])
        }
      } catch (_) {
        // Já não existe
      }
    }

    // Limpeza genérica de órfãos via SQL
    try {
      app.db().newQuery('DELETE FROM membros WHERE user_id NOT IN (SELECT id FROM users)').execute()
      console.log('[0081] Órfãos genéricos excluídos de membros.')
    } catch (errOrphans) {
      console.log('[0081] Aviso na deleção de órfãos genéricos: ' + errOrphans)
    }

    // 2. Excluir os 4 vínculos errados de vendedores da Matriz na Pimenta Verde (bkef63kajsmin6c)
    //    IDs específicos: o0k3l50g6xc8ilc, zyv25s8bovh5gg7, phg2jsvlozjq4cz, yz77brhbt31s8gy
    //    Usuários: 4iycez46kbxl1ly, av4car3aqi52ftq, rgednwaz40iq9tb, sh669l7snqiuoab
    const leakedSellerUserIds = [
      '4iycez46kbxl1ly',
      'av4car3aqi52ftq',
      'rgednwaz40iq9tb',
      'sh669l7snqiuoab',
    ]

    for (let j = 0; j < leakedSellerUserIds.length; j++) {
      const uid = leakedSellerUserIds[j]
      try {
        app
          .db()
          .newQuery('DELETE FROM membros WHERE empresa_id = {:empId} AND user_id = {:userId}')
          .bind({ empId: PIMENTA_VERDE_ID, userId: uid })
          .execute()
        console.log('[0081] Vazamento removido da Pimenta Verde: user=' + uid)
      } catch (errLeak) {
        console.log('[0081] Aviso ao remover vazamento user=' + uid + ': ' + errLeak)
      }
    }

    // Na Pimenta Verde, deduplica o vínculo de a79txuc992xhn7n se tiver mais de 1 (mantém rpm7wz1p87s1dxe e exclui jw151xh31wli48r)
    try {
      app
        .db()
        .newQuery(
          "DELETE FROM membros WHERE empresa_id = {:empId} AND user_id = 'a79txuc992xhn7n' AND id != 'rpm7wz1p87s1dxe'",
        )
        .bind({ empId: PIMENTA_VERDE_ID })
        .execute()
      console.log('[0081] Deduplicação do admin a79txuc992xhn7n na Pimenta Verde executada.')
    } catch (errPim) {
      console.log('[0081] Aviso na deduplicação de a79txuc992xhn7n: ' + errPim)
    }

    // 3. Deduplicar membros da Matriz (7wo05iyvfcfh01h)
    // Excluir explicitamente as duplicatas da matriz que têm IDs prefixados mbr_*
    const duplicateIdsToDelete = [
      'mbr_pim_gr2hb4yyno4lqns', // papel: gestor
      'mbr_xodo_gr2hb4yyno4lqns',
      'mbr_pim_ng3asfqq0zwr6fw',
      'mbr_xodo_ng3asfqq0zwr6fw',
      'mbr_pim_av4car3aqi52ftq',
      'mbr_pim_rgednwaz40iq9tb',
      'mbr_pim_szy04j9cn3pra5j',
      'mbr_xodo_4iycez46kbxl1ly',
      'mbr_xodo_sh669l7snqiuoab',
      'mbr_xodo_o9nccdbkmc9onh0',
      'mbr_xodo_u6zr2qtcos1ljxd',
      'mbr_xodo_mxvhhwb5i46zjq2',
    ]

    for (let k = 0; k < duplicateIdsToDelete.length; k++) {
      const dupId = duplicateIdsToDelete[k]
      try {
        const rec = app.findFirstRecordByData('membros', 'id', dupId)
        if (rec) {
          app.delete(rec)
          console.log('[0081] Duplicata deletada por ID: ' + dupId)
        }
      } catch (_) {
        // Já não existe
      }
    }

    // IDs legítimos a manter na Matriz
    const idsToKeep = [
      '34ek3vqf70q2493', // ng3asfqq0zwr6fw (admin)
      'amn59cxy309kul6', // av4car3aqi52ftq (vendedor)
      'hxcl1f8a3q4bxnq', // gr2hb4yyno4lqns (entregador)
      't1j8x985aes7fkw', // szy04j9cn3pra5j (entregador)
      'b68g4m96dd83gb9', // u6zr2qtcos1ljxd (entregador)
      'fx4hd7gcsjathpw', // o9nccdbkmc9onh0 (entregador)
      'xyj7xaulllf9stg', // sh669l7snqiuoab (vendedor)
      'e8m74c8w5d1or6p', // 4iycez46kbxl1ly (vendedor)
      'jx0v61ixf1s7src', // rgednwaz40iq9tb (vendedor)
      'vklj6tfbgesmnq4', // mxvhhwb5i46zjq2 (entregador)
    ]

    const userRoleMap = {
      ng3asfqq0zwr6fw: 'admin',
      av4car3aqi52ftq: 'vendedor',
      gr2hb4yyno4lqns: 'entregador',
      szy04j9cn3pra5j: 'entregador',
      u6zr2qtcos1ljxd: 'entregador',
      o9nccdbkmc9onh0: 'entregador',
      sh669l7snqiuoab: 'vendedor',
      '4iycez46kbxl1ly': 'vendedor',
      rgednwaz40iq9tb: 'vendedor',
      mxvhhwb5i46zjq2: 'entregador',
    }

    for (let m = 0; m < idsToKeep.length; m++) {
      const mId = idsToKeep[m]
      try {
        const rec = app.findFirstRecordByData('membros', 'id', mId)
        if (rec) {
          const uid = rec.getString('user_id')
          const expectedPapel = userRoleMap[uid]
          let updated = false
          if (expectedPapel && rec.getString('papel') !== expectedPapel) {
            rec.set('papel', expectedPapel)
            updated = true
          }
          if (rec.get('ativo') !== true) {
            rec.set('ativo', true)
            updated = true
          }
          if (updated) {
            app.save(rec)
            console.log(
              '[0081] Registro mantido atualizado: ' +
                mId +
                ' (user=' +
                uid +
                ', papel=' +
                expectedPapel +
                ')',
            )
          }
        }
      } catch (err) {
        console.log('[0081] Aviso ao verificar registro mantido ' + mId + ': ' + err)
      }
    }

    // Deduplicação genérica de segurança: se sobrar qualquer duplicata por (empresa_id, user_id),
    // mantém o registro mais antigo e deleta os posteriores.
    try {
      app
        .db()
        .newQuery(
          'DELETE FROM membros WHERE id NOT IN (SELECT MIN(id) FROM membros GROUP BY empresa_id, user_id)',
        )
        .execute()
      console.log('[0081] Deduplicação final por (empresa_id, user_id) executada com sucesso.')
    } catch (errFinalDedupe) {
      console.log('[0081] Aviso na deduplicação final SQL: ' + errFinalDedupe)
    }

    console.log('[0081] Migração 0081 concluída com sucesso.')
  },
  (app) => {
    // Down migration não restaura duplicatas nem dados corrompidos intencionalmente
  },
)

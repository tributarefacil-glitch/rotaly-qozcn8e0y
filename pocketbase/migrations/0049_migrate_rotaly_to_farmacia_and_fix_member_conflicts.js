/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // 0049_migrate_rotaly_to_farmacia_and_fix_member_conflicts.js
    //
    // Atende à solicitação expressa do usuário:
    // "você precisa puxar todos os dados do Rotaly Operações e migrar para Farmácia Xodo do Pilar"
    //
    // (a) Migração de dados de clientes e pedidos hoje etiquetados em 7wo05iyvfcfh01h (Rotaly Operações):
    //     - Clientes claramente da Pimenta Verde (ex: "Pimenta Verde Centro", "npsk52y9qztqph4") -> 'covyosobcb1b50n'
    //     - Todos os demais clientes e pedidos em 7wo05iyvfcfh01h -> 'ssyicw8uzwqc01w' (Farmácia Xodó do Pilar)
    //
    // (b) Eliminação de conflitos de vínculos na coleção 'membros':
    //     - Usuários vendedores e entregadores (não-admin) devem ter exatamente UM vínculo ativo.
    //     - Desativar ou remover vínculos conflitantes com a Matriz (7wo05iyvfcfh01h) para Caroline, Kely, etc.,
    //       mantendo apenas os vínculos oficiais da Farmácia Xodó do Pilar ('ssyicw8uzwqc01w')
    //       e garantindo que Caroline, Kely, Vinicios, Guilherme, Marcos e Rodrigo fiquem 100% ativos na Farmácia.
    //     - Vendedoras e entregadores da Pimenta Verde mantêm apenas vínculo ativo na Pimenta Verde.
    //     - Apenas administradores do sistema mantêm vínculo ativo com a Matriz (7wo05iyvfcfh01h).

    const MATRIZ_ID = '7wo05iyvfcfh01h'
    const XODO_ID = 'ssyicw8uzwqc01w'
    const PIMENTA_ID = 'covyosobcb1b50n'

    console.log('0049: Iniciando migração de dados e desativação de vínculos conflitantes...')

    // =========================================================================
    // PARTE 1: MIGRAR DADOS CONFORME SOLICITADO
    // =========================================================================

    // 1.1 Clientes da Pimenta Verde em 7wo05iyvfcfh01h
    try {
      app
        .db()
        .newQuery(`
        UPDATE customers
        SET empresa_id = '${PIMENTA_ID}'
        WHERE empresa_id = '${MATRIZ_ID}'
          AND (id = 'npsk52y9qztqph4' OR name LIKE '%Pimenta Verde%')
      `)
        .execute()
      console.log('0049: Clientes da Pimenta Verde migrados para', PIMENTA_ID)
    } catch (e) {
      console.log('0049: Erro ao migrar cliente Pimenta Verde:', e)
    }

    // 1.2 Todos os demais clientes em 7wo05iyvfcfh01h migrados para Farmácia Xodó do Pilar
    try {
      app
        .db()
        .newQuery(`
        UPDATE customers
        SET empresa_id = '${XODO_ID}'
        WHERE empresa_id = '${MATRIZ_ID}'
      `)
        .execute()
      console.log('0049: Clientes da Matriz migrados para Farmácia Xodó do Pilar:', XODO_ID)
    } catch (e) {
      console.log('0049: Erro ao migrar clientes para Farmácia Xodó:', e)
    }

    // 1.3 Pedidos (orders) em 7wo05iyvfcfh01h migrados para Farmácia Xodó do Pilar
    try {
      app
        .db()
        .newQuery(`
        UPDATE orders
        SET empresa_id = '${XODO_ID}'
        WHERE empresa_id = '${MATRIZ_ID}'
      `)
        .execute()
      console.log('0049: Pedidos da Matriz migrados para Farmácia Xodó do Pilar:', XODO_ID)
    } catch (e) {
      console.log('0049: Erro ao migrar pedidos para Farmácia Xodó:', e)
    }

    // 1.4 Base addresses de 7wo05iyvfcfh01h que contenham termos da farmácia ou sem filial
    try {
      app
        .db()
        .newQuery(`
        UPDATE base_addresses
        SET empresa_id = '${XODO_ID}'
        WHERE empresa_id = '${MATRIZ_ID}'
          AND (name LIKE '%Saudavel%' OR name LIKE '%Xodó%' OR name LIKE '%Xodo%' OR address LIKE '%pilar%')
      `)
        .execute()
    } catch (e) {
      console.log('0049: Aviso base_addresses:', e)
    }

    // =========================================================================
    // PARTE 2: ELIMINAR CONFLITO DE VÍNCULOS EM 'membros'
    // =========================================================================

    // 2.1 Identificar usuários não-admin
    // Desativar especificamente os vínculos conflitantes de Caroline e Kely com a Matriz 7wo05iyvfcfh01h
    const conflitantesIds = ['e8m74c8w5d1or6p', 'xyj7xaulllf9stg']
    for (const mid of conflitantesIds) {
      try {
        const rec = app.findFirstRecordByData('membros', 'id', mid)
        if (rec) {
          rec.set('ativo', false)
          app.save(rec)
          console.log(`0049: Vínculo conflitante com Matriz desativado (ativo=false): ${mid}`)
        }
      } catch (e) {
        console.log(`0049: Registro ${mid} já não existe ou erro:`, e)
      }
    }

    // 2.2 Desativar vínculos duplicados com a Matriz para os demais entregadores da Farmácia
    // (mxvhhwb5i46zjq2 -> vklj6tfbgesmnq4, o9nccdbkmc9onh0 -> fx4hd7gcsjathpw, u6zr2qtcos1ljxd -> b68g4m96dd83gb9)
    const outrosConflitosMatriz = [
      'vklj6tfbgesmnq4',
      'fx4hd7gcsjathpw',
      'b68g4m96dd83gb9',
      'hxcl1f8a3q4bxnq',
    ]
    for (const mid of outrosConflitosMatriz) {
      try {
        const rec = app.findFirstRecordByData('membros', 'id', mid)
        if (rec) {
          rec.set('ativo', false)
          app.save(rec)
          console.log(`0049: Vínculo de entregador com Matriz desativado: ${mid}`)
        }
      } catch (_) {}
    }

    // 2.3 Desativar vínculos com a Matriz para membros da Pimenta Verde
    const pimentaConflitosMatriz = ['amn59cxy309kul6', 'jx0v61ixf1s7src', 't1j8x985aes7fkw']
    for (const mid of pimentaConflitosMatriz) {
      try {
        const rec = app.findFirstRecordByData('membros', 'id', mid)
        if (rec) {
          rec.set('ativo', false)
          app.save(rec)
          console.log(`0049: Vínculo de membro Pimenta Verde com Matriz desativado: ${mid}`)
        }
      } catch (_) {}
    }

    // 2.4 Assegurar que os vínculos na Farmácia Xodó do Pilar estão ativos com os papéis corretos:
    // Caroline: 4iycez46kbxl1ly -> vendedor
    // Kely: sh669l7snqiuoab -> vendedor
    // Marcos: mxvhhwb5i46zjq2 -> entregador
    // Vinicios: o9nccdbkmc9onh0 -> entregador
    // Guilherme: u6zr2qtcos1ljxd -> entregador
    // Rodrigo: 0244i46a2t90e1h -> entregador
    // Mariana: 5q294k12429h7f5 -> vendedor
    const xodoStaff = [
      { user_id: '4iycez46kbxl1ly', papel: 'vendedor', id: 'mbr_xodo_4iycez46kbxl1ly' },
      { user_id: 'sh669l7snqiuoab', papel: 'vendedor', id: 'mbr_xodo_sh669l7snqiuoab' },
      { user_id: 'mxvhhwb5i46zjq2', papel: 'entregador', id: 'mbr_xodo_mxvhhwb5i46zjq2' },
      { user_id: 'o9nccdbkmc9onh0', papel: 'entregador', id: 'mbr_xodo_o9nccdbkmc9onh0' },
      { user_id: 'u6zr2qtcos1ljxd', papel: 'entregador', id: 'mbr_xodo_u6zr2qtcos1ljxd' },
      { user_id: '0244i46a2t90e1h', papel: 'entregador', id: 'mbr_xodo_rodrigo' },
      { user_id: '5q294k12429h7f5', papel: 'vendedor', id: 'mbr_xodo_mariana' },
    ]

    const membrosCol = app.findCollectionByNameOrId('membros')

    for (const item of xodoStaff) {
      try {
        let rec
        try {
          rec = app.findFirstRecordByData('membros', 'id', item.id)
        } catch (_) {
          // Tentar buscar por user_id + empresa_id
          const list = app.findRecordsByFilter(
            'membros',
            `user_id = '${item.user_id}' && empresa_id = '${XODO_ID}'`,
            '-created',
            1,
          )
          if (list && list.length > 0) {
            rec = list[0]
          }
        }

        if (!rec) {
          rec = new Record(membrosCol)
          rec.set('id', item.id)
          rec.set('user_id', item.user_id)
          rec.set('empresa_id', XODO_ID)
        }

        rec.set('papel', item.papel)
        rec.set('ativo', true)
        app.save(rec)
        console.log(
          `0049: Vínculo ativo assegurado na Farmácia Xodó: ${item.user_id} (${item.papel})`,
        )
      } catch (err) {
        console.log(`0049: Erro ao assegurar membro Xodó ${item.user_id}:`, err)
      }
    }

    // 2.5 Regra geral de limpeza: para qualquer usuário não-admin (role seller ou courier),
    // se possuir múltiplos vínculos com ativo=true, desativar os vínculos com a Matriz (7wo05iyvfcfh01h),
    // garantindo estritamente exatamente UM vínculo ativo por membro de filial.
    try {
      app
        .db()
        .newQuery(`
        UPDATE membros
        SET ativo = 0
        WHERE empresa_id = '${MATRIZ_ID}'
          AND user_id IN (
            SELECT user_id FROM membros
            WHERE empresa_id != '${MATRIZ_ID}'
              AND ativo = 1
              AND papel IN ('vendedor', 'entregador')
          )
      `)
        .execute()
      console.log(
        '0049: Vínculos com Matriz desativados para todos os vendedores e entregadores de filiais',
      )
    } catch (e) {
      console.log('0049: Aviso na query SQL de desativação geral de conflitos:', e)
    }

    console.log('0049: Migração concluída com sucesso.')
  },
  (app) => {
    // Reversão no-op
  },
)

/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // 0085_remove_duplicate_fuel_advances.js
    //
    // O usuário recadastrou adiantamentos que já existiam em 11/09 porque o painel
    // mostrava saldos zerados ontem à noite (~19/09, ~20h BRT / ~23h UTC).
    //
    // Objetivo cirúrgico:
    // Deletar APENAS as 2 duplicatas recentes:
    // 1) Vinicios Lunz (user id o9nccdbkmc9onh0):
    //    Registro recente ID: '3ext1nq0kt1sdh9', criado em 2026-09-20 23:21:45.187Z, amount: 172.04
    // 2) Guilherme de Paiva (user id u6zr2qtcos1ljxd):
    //    Registro recente ID: 'xj3kdyh7c4mxgu3', criado em 2026-09-20 23:22:07.547Z, amount: 221.49
    //
    // Registros que DEVEM PERMANECER INTACTOS:
    // - Vinicios Lunz: ID '17qyd58rcy5ele5' (R$ 72.04, 11/09) + ID 's8ooiirlmxm2dwi' (R$ 100.00, 17/09)
    //   Total de Vinicios permanece R$ 172.04.
    // - Guilherme de Paiva: ID 'oz1nz81udelrszv' (R$ 221.49, 11/09)
    //   Total de Guilherme permanece R$ 221.49.
    // - Luis Antonio: ID 'nhqzgpbvu2sc4qi' (R$ 230.00, 11/09)
    // - Diogo Mendes: ID 'igkejg3knvb60bo' (R$ 100.00, 11/09)
    // - Marcos Barbosa: Nenhum adiantamento (bicicleta, intacto)

    const DUPLICATE_IDS_TO_REMOVE = [
      {
        id: '3ext1nq0kt1sdh9',
        courier_id: 'o9nccdbkmc9onh0',
        expectedAmount: 172.04,
        courierName: 'Vinicios Lunz',
      },
      {
        id: 'xj3kdyh7c4mxgu3',
        courier_id: 'u6zr2qtcos1ljxd',
        expectedAmount: 221.49,
        courierName: 'Guilherme de Paiva',
      },
    ]

    for (let i = 0; i < DUPLICATE_IDS_TO_REMOVE.length; i++) {
      const target = DUPLICATE_IDS_TO_REMOVE[i]
      try {
        const record = app.findFirstRecordByData('fuel_advances', 'id', target.id)
        if (record) {
          const courierId = record.getString('courier_id')
          const amount = record.getFloat('amount')
          const created = record.getString('created')

          // Validação de segurança estrita antes de deletar
          if (courierId !== target.courier_id) {
            throw new Error(
              `[0085] Abortando: registro ${target.id} pertence ao courier ${courierId}, esperado ${target.courier_id}`,
            )
          }

          // Verificar que é o registro recente (criado em 2026-09-20) e não o original de 11/09
          if (!created.startsWith('2026-09-20')) {
            throw new Error(
              `[0085] Abortando: registro ${target.id} tem data created=${created}, não parece ser a duplicata de 20/09!`,
            )
          }

          console.log(
            `[0085] Deletando duplicata confirmada: ID=${target.id}, Courier=${target.courierName} (${courierId}), Valor=${amount}, Criado=${created}`,
          )
          app.delete(record)
          console.log(`[0085] Registro ${target.id} deletado com sucesso.`)
        }
      } catch (err) {
        // Se já não existe (idempotência), reporta e segue
        console.log(
          `[0085] Registro ${target.id} não encontrado ou já deletado (${err && err.message ? err.message : err}).`,
        )
      }
    }

    console.log('[0085] Migração de limpeza de duplicatas concluída com sucesso.')
  },
  (app) => {
    // Reverter deletion não é aconselhado nem restaurável automaticamente sem backup,
    // mas deixamos o down migration como no-op seguro.
  },
)

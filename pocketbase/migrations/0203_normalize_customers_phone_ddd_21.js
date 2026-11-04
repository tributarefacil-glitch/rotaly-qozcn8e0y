/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration 0203: Normalizar telefone de clientes com DDD 21 (RJ)
 *
 * Requisito:
 * "VOCÊ CONSEGUE COLOCAR O DDD NOS CLIENTES QUE ESTÃO SEM? TODOS OS NOSSOS CLIENTES SÃO DO RJ 021"
 *
 * Regras de normalização:
 * 1. Telefone vazio / nulo -> deixar vazio (não inventar número).
 * 2. Telefone com 8 ou 9 dígitos SEM DDD (ex: 971344477, 98765-4321, 26761499) -> ANTEPOR o DDD 21 (fica 21971344477).
 * 3. Telefone fixo antigo com prefixo 0 no DDD (ex: 021987654321 ou 021 97134-4477) -> remover o 0 inicial do DDD (fica 21987654321).
 * 4. Telefone com 55 e 12/13 dígitos (ex: 5521987654321) -> remover 55 (fica 21987654321).
 * 5. Telefone já completo com DDD (10 ou 11 dígitos) -> manter os dígitos limpos.
 * 6. Aplicar também para phone2 e phone3 quando preenchidos.
 * 7. Idempotente: se já estiver normalizado, não altera.
 * 8. Registrar resumo em audit_trail com convenção do Sistema (user_id vazio, actor_name='Sistema', metadata.system_trigger=true).
 */

migrate(
  (app) => {
    console.log('[0203] Iniciando normalização de telefones de clientes para DDD 21...')

    const customersCol = app.findCollectionByNameOrId('customers')
    const auditCol = app.findCollectionByNameOrId('audit_trail')

    if (!customersCol) {
      console.warn('[0203] Coleção customers não encontrada.')
      return
    }

    // Função pura de normalização para o padrão Rotaly RJ
    function normalizePhone(raw) {
      if (!raw) return ''
      var digits = String(raw).replace(/\D/g, '')
      if (!digits) return ''

      // Remove prefixo 55 se vier com 12 ou 13 dígitos
      if (digits.indexOf('55') === 0 && (digits.length === 12 || digits.length === 13)) {
        digits = digits.slice(2)
      }

      // Remove 0 inicial de DDD antigo (ex: 021...)
      if (digits.indexOf('0') === 0 && (digits.length === 11 || digits.length === 12)) {
        digits = digits.slice(1)
      }

      // Se tiver 8 ou 9 dígitos sem DDD, antepõe o DDD 21 (RJ)
      if (digits.length === 8 || digits.length === 9) {
        digits = '21' + digits
      }

      return digits
    }

    try {
      // Buscar todos os clientes
      const allCustomers = app.findRecordsByFilter('customers', 'id != ""', 'created', 5000, 0)
      console.log(`[0203] Total de clientes encontrados: ${allCustomers.length}`)

      var countUpdated = 0
      var countAlreadyValid = 0
      var countNoPhone = 0
      var sampleUpdated = []

      for (var i = 0; i < allCustomers.length; i++) {
        var rec = allCustomers[i]
        var p1 = rec.getString('phone') || ''
        var p2 = rec.getString('phone2') || ''
        var p3 = rec.getString('phone3') || ''

        var norm1 = normalizePhone(p1)
        var norm2 = normalizePhone(p2)
        var norm3 = normalizePhone(p3)

        var needsSave = false
        var oldValues = {}

        if (norm1 && norm1 !== p1) {
          oldValues.phone = p1
          rec.set('phone', norm1)
          needsSave = true
        }
        if (norm2 && norm2 !== p2) {
          oldValues.phone2 = p2
          rec.set('phone2', norm2)
          needsSave = true
        }
        if (norm3 && norm3 !== p3) {
          oldValues.phone3 = p3
          rec.set('phone3', norm3)
          needsSave = true
        }

        if (needsSave) {
          app.save(rec)
          countUpdated++
          if (sampleUpdated.length < 15) {
            sampleUpdated.push({
              id: rec.id,
              name: rec.getString('name'),
              old_phone: p1,
              new_phone: norm1,
            })
          }
        } else if (!p1 && !p2 && !p3) {
          countNoPhone++
        } else {
          countAlreadyValid++
        }
      }

      console.log(
        `[0203] Resumo: ${countUpdated} corrigidos com DDD 21, ${countAlreadyValid} já válidos, ${countNoPhone} sem telefone.`,
      )

      // Registrar no audit_trail como ação do Sistema
      if (auditCol && countUpdated > 0) {
        var auditRec = new Record(auditCol)
        auditRec.set('user_id', '')
        auditRec.set('collection', 'customers')
        auditRec.set('record_id', 'batch_migration_0203')
        auditRec.set('action', 'normalize_phones_ddd_21')
        auditRec.set('field', 'phone')
        auditRec.set('old_value', `${countUpdated} customers without DDD`)
        auditRec.set('new_value', `${countUpdated} customers normalized to DDD 21`)
        auditRec.set('metadata', {
          reason: 'Normalização obrigatória de telefones para DDD 21 RJ',
          updated_count: countUpdated,
          already_valid_count: countAlreadyValid,
          no_phone_count: countNoPhone,
          samples: sampleUpdated,
          system_trigger: true,
          actor_name: 'Sistema',
          actor_email: 'sistema@rotaly.com',
          actor_role: 'system',
        })
        app.save(auditRec)
        console.log('[0203] Registro de audit_trail salvo com sucesso.')
      }
    } catch (err) {
      console.warn('[0203] Erro durante a migração de telefones:', err)
      throw err
    }
  },
  (app) => {
    // Reversão não é necessária pois a normalização apenas limpou e adicionou DDD 21 padronizado
  },
)

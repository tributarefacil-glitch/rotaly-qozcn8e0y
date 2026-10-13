/// <reference path="../pb_data/types.d.ts" />

/**
 * Migração 0154: Normalização Canônica de Lote/Quadra em Customers (Bloco 3)
 * Padrão obrigatório: "Qd N, Lt N" (abreviado, dígito, lote DEPOIS da quadra) no campo complement,
 * movendo de street / address / reference_point.
 *
 * Casos reais cobertos:
 * - 'Rua ANTONIO CARLOS PINHEIRO LT 28 QD 2' (Vanessa) -> street limpo, complement: 'Qd 2, Lt 28 — no salão'
 * - 'lote22 quadra12' (Raquel) -> complement: 'Qd 12, Lt 22'
 * - '211 LOTE,5 QUADRA,3' (Thaynara) -> complement: 'Qd 3, Lt 5'
 * - 'lt1b qd16' (Iranildo) -> complement: 'Qd 16, Lt 1B'
 * - 'LT 40 QD 10' (Kelly) -> complement: 'Qd 10, Lt 40'
 * - 'LT 18 QD 07' (Karina) -> complement: 'Qd 7, Lt 18'
 * - 'LOTE 8 QUADRA 7' (Ana Carolina) -> complement: 'Qd 7, Lt 8 — atras do outlet /rua da dpo'
 * - '8 qd 4' -> complement: 'Qd 4, Lt 8'
 * - 'lote 12 qd 41' em reference_point (Gracielle) -> complement: 'Qd 41, Lt 12 — ao lado da oficina Ailton'
 *
 * EXCEÇÃO DO DONO:
 * NÃO alterar clientes corrigidos pelo PIN DO ENTREGADOR:
 * - pending_client_pin preenchido
 * - origin / origem 'pin_entregador'
 * - notas com '[ALERTA ANTI-CEP' ou '[CORREÇÃO DEFINITIVA'
 *
 * BACKUP & AUDITORIA:
 * - Grava audit_trail com user_id='' (relation não aceita 'system'), actor_name='Sistema',
 *   metadata.system_trigger=true, guardando antes/depois de todos os campos afetados.
 */

migrate(
  (app) => {
    console.log('[0154_lote_quadra_sweep] Iniciando varredura canônica de lote/quadra...')

    function sanitizeVal(val) {
      if (!val) return ''
      const trimmed = String(val).trim().toUpperCase()
      const stripped = trimmed.replace(/^0+([0-9]+.*)$/, '$1')
      return stripped || trimmed
    }

    function extractLQ(text) {
      if (!text || typeof text !== 'string') return null
      const raw = text.trim()
      if (!raw) return null

      let quadra = ''
      let lote = ''
      let matchedStr = ''

      // Padrão 1: QD primeiro, depois LT
      const m1 = raw.match(
        /(?:QD|QUADRA|QDA)\s*[,.:]?\s*([0-9]+[A-Za-z]?|[A-Za-z])[\s,./-]+(?:LT|LOTE)\s*[,.:]?\s*([0-9]+[A-Za-z]?|[A-Za-z])/i,
      )
      if (m1) {
        quadra = sanitizeVal(m1[1])
        lote = sanitizeVal(m1[2])
        matchedStr = m1[0]
      } else {
        // Padrão 2: LT primeiro, depois QD
        const m2 = raw.match(
          /(?:LT|LOTE)\s*[,.:]?\s*([0-9]+[A-Za-z]?|[A-Za-z])[\s,./-]+(?:QD|QUADRA|QDA)\s*[,.:]?\s*([0-9]+[A-Za-z]?|[A-Za-z])/i,
        )
        if (m2) {
          lote = sanitizeVal(m2[1])
          quadra = sanitizeVal(m2[2])
          matchedStr = m2[0]
        } else {
          // Padrão 3: número solto antes de QD (ex: "8 qd 4")
          const m3 = raw.match(
            /(?:^|[\s,])([0-9]+[A-Za-z]?)\s*[,.:]?\s*(?:QD|QUADRA|QDA)\s*[,.:]?\s*([0-9]+[A-Za-z]?|[A-Za-z])/i,
          )
          if (m3) {
            lote = sanitizeVal(m3[1])
            quadra = sanitizeVal(m3[2])
            matchedStr = m3[0].trim()
          } else {
            // Isolados
            const mq = raw.match(/(?:QD|QUADRA|QDA)\b[\s.,:]*([0-9]+[A-Za-z]?|[A-Za-z])/i)
            const ml = raw.match(/(?:LT|LOTE)\b[\s.,:]*([0-9]+[A-Za-z]?|[A-Za-z])/i)
            if (mq) quadra = sanitizeVal(mq[1])
            if (ml) lote = sanitizeVal(ml[1])
            if (mq && ml) {
              matchedStr = raw
            } else if (mq) {
              matchedStr = mq[0]
            } else if (ml) {
              matchedStr = ml[0]
            }
          }
        }
      }

      if (!quadra && !lote) return null

      let cleaned = raw
      if (matchedStr) {
        cleaned = cleaned.replace(matchedStr, ' ')
      }
      cleaned = cleaned
        .replace(/(?:LT|LOTE)\s*[,.:]?\s*[0-9]+[A-Za-z]?/gi, ' ')
        .replace(/(?:QD|QUADRA|QDA)\s*[,.:]?\s*[0-9]+[A-Za-z]?/gi, ' ')
        .replace(/\s*,\s*,+/g, ',')
        .replace(/\s+/g, ' ')
        .replace(/^[\s,./\-—–]+|[\s,./\-—–]+$/g, '')
        .trim()

      return { quadra, lote, matchedStr, cleaned }
    }

    function formatCanonical(quadra, lote) {
      const q = quadra ? sanitizeVal(quadra) : ''
      const l = lote ? sanitizeVal(lote) : ''
      if (q && l) return 'Qd ' + q + ', Lt ' + l
      if (q) return 'Qd ' + q
      if (l) return 'Lt ' + l
      return ''
    }

    function formatComplement(quadra, lote, existingComp) {
      const canonical = formatCanonical(quadra, lote)
      if (!canonical) return (existingComp || '').trim()

      const cleaned = (existingComp || '')
        .replace(/(?:LT|LOTE)\s*[,.:]?\s*[0-9]+[A-Za-z]?/gi, '')
        .replace(/(?:QD|QUADRA|QDA)\s*[,.:]?\s*[0-9]+[A-Za-z]?/gi, '')
        .replace(/^[\s,./\-—–]+|[\s,./\-—–]+$/g, '')
        .trim()

      if (!cleaned) return canonical
      return canonical + ' — ' + cleaned
    }

    let auditCol = null
    try {
      auditCol = app.findCollectionByNameOrId('audit_trail')
    } catch (_) {}

    // Buscar todos os clientes
    const customerRecords = app.findRecordsByFilter('customers', '1 = 1', '-created', 0, 0)
    console.log(`[0154] Total de clientes carregados: ${customerRecords.length}`)

    let totalPreservados = 0
    let totalNormalizados = 0

    for (const cust of customerRecords) {
      const custId = cust.id
      const notes = cust.getString('notes') || ''
      const pendingPin = cust.get('pending_client_pin')

      // EXCEÇÃO DO DONO:
      // NÃO alterar clientes corrigidos pelo PIN DO ENTREGADOR:
      // - pending_client_pin preenchido
      // - registros '[ALERTA ANTI-CEP' com pin mantido
      // - nota '[CORREÇÃO DEFINITIVA'
      const isProtected =
        (pendingPin && pendingPin !== '' && pendingPin !== '{}') ||
        notes.includes('[ALERTA ANTI-CEP') ||
        notes.includes('[CORREÇÃO DEFINITIVA') ||
        notes.toLowerCase().includes('pin_entregador')

      if (isProtected) {
        totalPreservados++
        continue
      }

      const origStreet = cust.getString('street') || ''
      const origAddress = cust.getString('address') || ''
      const origComp = cust.getString('complement') || ''
      const origRef = cust.getString('reference_point') || ''

      let quadra = ''
      let lote = ''
      let cleanedComp = origComp
      let cleanedStreet = origStreet
      let cleanedRef = origRef
      let hasLQ = false

      // 1. Checar complement
      const mComp = extractLQ(origComp)
      if (mComp) {
        hasLQ = true
        quadra = mComp.quadra
        lote = mComp.lote
        cleanedComp = mComp.cleaned
      }

      // 2. Checar street
      const mStreet = extractLQ(origStreet)
      if (mStreet) {
        hasLQ = true
        if (!quadra && mStreet.quadra) quadra = mStreet.quadra
        if (!lote && mStreet.lote) lote = mStreet.lote
        cleanedStreet = mStreet.cleaned
      }

      // 3. Checar reference_point
      const mRef = extractLQ(origRef)
      if (mRef) {
        hasLQ = true
        if (!quadra && mRef.quadra) quadra = mRef.quadra
        if (!lote && mRef.lote) lote = mRef.lote
        cleanedRef = mRef.cleaned
      }

      // 4. Checar address
      if (!hasLQ) {
        const mAddr = extractLQ(origAddress)
        if (mAddr) {
          hasLQ = true
          if (!quadra && mAddr.quadra) quadra = mAddr.quadra
          if (!lote && mAddr.lote) lote = mAddr.lote
        }
      }

      if (!hasLQ || (!quadra && !lote)) {
        continue
      }

      const newComplement = formatComplement(quadra, lote, cleanedComp)

      // Se nada mudou, continuar
      if (newComplement === origComp && cleanedStreet === origStreet && cleanedRef === origRef) {
        continue
      }

      // Montar novo address canônico se o street mudou ou o complemento mudou
      let newAddress = origAddress
      if (cleanedStreet !== origStreet && origAddress.includes(origStreet)) {
        newAddress = origAddress.replace(origStreet, cleanedStreet)
      }

      // Backup dos valores originais para gravação em audit_trail
      const beforeState = {
        street: origStreet,
        complement: origComp,
        reference_point: origRef,
        address: origAddress,
      }
      const afterState = {
        street: cleanedStreet,
        complement: newComplement,
        reference_point: cleanedRef,
        address: newAddress,
      }

      cust.set('street', cleanedStreet)
      cust.set('complement', newComplement)
      cust.set('reference_point', cleanedRef)
      if (newAddress !== origAddress) {
        cust.set('address', newAddress)
      }

      try {
        app.save(cust)
        totalNormalizados++

        // Gravar audit_trail do Sistema
        if (auditCol) {
          try {
            const auditRec = new Record(auditCol)
            auditRec.set('user_id', '') // relation aceita vazio
            auditRec.set('collection', 'customers')
            auditRec.set('record_id', custId)
            auditRec.set('action', 'normalizacao_lote_quadra_canonica')
            auditRec.set('field', 'complement,street,reference_point')
            auditRec.set('old_value', JSON.stringify(beforeState))
            auditRec.set('new_value', JSON.stringify(afterState))
            auditRec.set('timestamp', new Date().toISOString())
            auditRec.set('metadata', {
              system_trigger: true,
              actor_name: 'Sistema',
              rule: 'Qd N, Lt N canonico',
              quadra: quadra,
              lote: lote,
            })
            app.save(auditRec)
          } catch (eAudit) {
            console.log(`[0154] Aviso ao salvar audit_trail para customer ${custId}:`, eAudit)
          }
        }
      } catch (errSave) {
        console.log(`[0154] Erro ao salvar cliente ${custId}:`, errSave)
      }
    }

    console.log(
      `[0154_lote_quadra_sweep] Concluído. Normalizados: ${totalNormalizados}, Preservados (exceção pin): ${totalPreservados}`,
    )
  },
  (app) => {
    // Reverter apenas reatribuindo do audit_trail se necessário
  },
)

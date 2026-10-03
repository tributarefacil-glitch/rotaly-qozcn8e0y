/// <reference path="../pb_data/types.d.ts" />

/**
 * Hook de Alerta Automático de Saldo de Combustível dos Entregadores
 *
 * Requisitos acordados:
 * - Verificação diária automática do saldo de cada entregador via cron job em PocketBase (`cronAdd`).
 * - Executa todos os dias às 08:00 (e disponibiliza endpoint administrativo para disparo manual sob demanda).
 * - Quando o consumo acumulado do mês atingir 80% da média mensal do entregador
 *   (ou seja, saldo restante cobre apenas ~20% do consumo habitual mensal),
 *   envia e-mail ao administrador com sugestão de recarga.
 * - Sugestão de recarga = média mensal de consumo daquele entregador − consumo acumulado do mês,
 *   limitada para NUNCA superar a média mensal dele (e no mínimo zero).
 * - A média mensal é calculada POR ENTREGADOR a partir do histórico real de meses fechados
 *   (com fallback inteligente caso o entregador não tenha meses fechados ainda, baseado na categoria do veículo).
 * - Enviar no máximo um alerta por entregador por dia (registrado em `fuel_balance_alerts`).
 * - Reutiliza a infraestrutura nativa de e-mail `$app.newMailClient().send(...)`.
 *
 * OBSERVAÇÃO CRÍTICA DE ESCOPO DO POCKETBASE JSVM:
 * Todas as funções auxiliares e variáveis devem estar INLINE dentro do corpo do callback,
 * pois o PocketBase executa callbacks em pools de VMs isoladas e declarações top-level causam ReferenceError.
 */

// 1. Registro do Job Agendado Diário no Backend PocketBase
cronAdd('daily_fuel_balance_check', '0 8 * * *', () => {
  function formatCurrency(val) {
    const n = Number(val) || 0
    return 'R$ ' + n.toFixed(2).replace('.', ',')
  }

  function getBrazilDateString(d) {
    const dateObj = d || new Date()
    const utc = dateObj.getTime() + dateObj.getTimezoneOffset() * 60000
    const spTime = new Date(utc - 3 * 3600000)
    const yyyy = spTime.getFullYear()
    const mm = String(spTime.getMonth() + 1).padStart(2, '0')
    const dd = String(spTime.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }

  function getYearMonthKey(dateStr) {
    if (!dateStr) return ''
    const s = String(dateStr).trim()
    if (s.length >= 7) {
      return s.substring(0, 7) // 'YYYY-MM'
    }
    return ''
  }

  try {
    console.log(
      '[daily_fuel_balance_check] Iniciando verificação diária de saldo de combustível...',
    )
    const now = new Date()
    const todayStr = getBrazilDateString(now)
    const currentYearMonth = todayStr.substring(0, 7)

    // Buscar entregadores ativos
    let couriers = []
    try {
      couriers = $app.findRecordsByFilter(
        '_pb_users_auth_',
        "role = 'courier' && status = 'active'",
        'name',
        200,
        0,
      )
    } catch (errCouriers) {
      console.log('[daily_fuel_balance_check] Erro ao buscar entregadores:', errCouriers)
      return
    }

    if (!couriers || couriers.length === 0) {
      console.log('[daily_fuel_balance_check] Nenhum entregador ativo encontrado.')
      return
    }

    // Carregar adiantamentos de combustível
    let allAdvances = []
    try {
      allAdvances = $app.findRecordsByFilter(
        'fuel_advances',
        "status != 'cancelled'",
        '-date,-created',
        5000,
        0,
      )
    } catch (errAdv) {
      console.log('[daily_fuel_balance_check] Erro ao buscar fuel_advances:', errAdv)
    }

    // Carregar pedidos finalizados
    let allOrders = []
    try {
      allOrders = $app.findRecordsByFilter(
        'orders',
        "(status = 'delivered' || status = 'address_error' || status = 'client_absent') && completion_reason != 'cancelado_vendedor'",
        '-created',
        5000,
        0,
      )
    } catch (errOrd) {
      console.log('[daily_fuel_balance_check] Erro ao buscar orders:', errOrd)
    }

    // Carregar membros, empresas e administradores
    let allMembros = []
    try {
      allMembros = $app.findRecordsByFilter('membros', 'ativo = true', '-created', 1000, 0)
    } catch (_) {}

    let allEmpresas = []
    try {
      allEmpresas = $app.findRecordsByFilter('empresas', 'id != ""', 'nome_fantasia', 100, 0)
    } catch (_) {}

    let adminUsers = []
    try {
      adminUsers = $app.findRecordsByFilter(
        '_pb_users_auth_',
        "role = 'admin' || role = 'master'",
        '-created',
        50,
        0,
      )
    } catch (_) {}

    let processedCount = 0
    let alertsSentCount = 0

    for (let c = 0; c < couriers.length; c++) {
      const courier = couriers[c]
      const courierId = courier.id
      const courierName = courier.getString('name') || courier.getString('email') || 'Entregador'
      const vehicleType = (courier.getString('vehicle_type') || 'moto').toLowerCase()

      // Bicicleta não consome combustível
      if (vehicleType === 'bicicleta' || vehicleType === 'bicycle') {
        continue
      }

      processedCount++

      // Anti-spam: verificar se já enviou alerta para este entregador na data de hoje
      let existingTodayAlert = []
      try {
        existingTodayAlert = $app.findRecordsByFilter(
          'fuel_balance_alerts',
          `courier_id = '${courierId}' && alert_date = '${todayStr}' && status = 'sent'`,
          '-created',
          1,
          0,
        )
      } catch (_) {}

      if (existingTodayAlert && existingTodayAlert.length > 0) {
        console.log(
          `[daily_fuel_balance_check] Alerta já enviado hoje para ${courierName}. Ignorando anti-spam.`,
        )
        continue
      }

      // Adiantamentos deste entregador
      const courierAdvances = allAdvances.filter((a) => a.getString('courier_id') === courierId)

      // Pedidos deste entregador
      const courierOrders = allOrders.filter((o) => {
        if (o.getString('courier_id') !== courierId) return false
        const notes = (o.getString('notes') || '').toLowerCase()
        if (notes.includes('erro de sistema')) return false
        return true
      })

      // Separar gastos do mês atual vs passados
      let currentMonthSpent = 0
      let pastMonthSpentMap = {}
      let pastOrdersSpentTotal = 0

      for (let o = 0; o < courierOrders.length; o++) {
        const ord = courierOrders[o]
        const orderDateVal =
          ord.getString('route_finished_at') ||
          ord.getString('actual_arrival') ||
          ord.getString('created')
        const orderMonth = getYearMonthKey(orderDateVal)
        const orderFuel = Number(ord.getFloat('fuel_cost')) || 0

        if (orderMonth === currentYearMonth) {
          currentMonthSpent += orderFuel
        } else if (orderMonth && orderMonth < currentYearMonth) {
          pastOrdersSpentTotal += orderFuel
          if (!pastMonthSpentMap[orderMonth]) {
            pastMonthSpentMap[orderMonth] = 0
          }
          pastMonthSpentMap[orderMonth] += orderFuel
        }
      }

      // Separar adiantamentos do mês atual vs passados
      let currentMonthAdvances = 0
      let pastAdvancesTotal = 0

      for (let a = 0; a < courierAdvances.length; a++) {
        const adv = courierAdvances[a]
        const advDateVal = adv.getString('date') || adv.getString('created')
        const advMonth = getYearMonthKey(advDateVal)
        const advAmount = Number(adv.getFloat('amount')) || 0

        if (advMonth === currentYearMonth) {
          currentMonthAdvances += advAmount
        } else if (advMonth && advMonth < currentYearMonth) {
          pastAdvancesTotal += advAmount
        }
      }

      // FÓRMULA OFICIAL DA CONTA CORRENTE DO ROTALY:
      // Saldo = (Adiantamentos Passados - Gastos Passados) + Adiantamentos Mês - Gastos Mês
      const carryOverBalance = Number((pastAdvancesTotal - pastOrdersSpentTotal).toFixed(2))
      const currentBalance = Number(
        (carryOverBalance + currentMonthAdvances - currentMonthSpent).toFixed(2),
      )
      currentMonthSpent = Number(currentMonthSpent.toFixed(2))

      // MÉDIA MENSAL DO ENTREGADOR (calculada por entregador a partir do histórico real de meses fechados)
      const closedMonths = Object.keys(pastMonthSpentMap)
      let monthlyAverage = 0

      if (closedMonths.length > 0) {
        let sumPastSpent = 0
        for (let m = 0; m < closedMonths.length; m++) {
          sumPastSpent += pastMonthSpentMap[closedMonths[m]]
        }
        monthlyAverage = Number((sumPastSpent / closedMonths.length).toFixed(2))
      }

      // Fallback saudável caso o entregador não possua meses fechados anteriores ainda
      if (monthlyAverage <= 0) {
        if (vehicleType.includes('caminhao')) {
          monthlyAverage = 1200.0
        } else if (vehicleType.includes('carro') || vehicleType.includes('van')) {
          monthlyAverage = 800.0
        } else {
          monthlyAverage = 450.0
        }
        if (currentMonthSpent > monthlyAverage) {
          monthlyAverage = currentMonthSpent
        }
      }

      // GATILHO: Quando o consumo acumulado do mês atingir 80% da média mensal do entregador
      // (ou o saldo restante cobrir menos de 20% do consumo habitual mensal)
      const threshold80 = Number((monthlyAverage * 0.8).toFixed(2))
      const reachedThreshold =
        currentMonthSpent >= threshold80 ||
        (currentBalance <= monthlyAverage * 0.2 && currentMonthSpent > 0)

      if (!reachedThreshold) {
        continue
      }

      // SUGESTÃO DE RECARGA:
      // Média mensal − Consumo acumulado do mês, com teto na média mensal e mínimo zero
      let suggestedRecharge = monthlyAverage - currentMonthSpent
      if (suggestedRecharge > monthlyAverage) {
        suggestedRecharge = monthlyAverage
      }
      if (suggestedRecharge < 0) {
        suggestedRecharge = 0
      }
      suggestedRecharge = Number(suggestedRecharge.toFixed(2))

      // Identificar empresa do entregador
      let empresaId = ''
      let empresaNome = 'Rotaly Logística'
      let notificationsEmail = ''
      let commercialEmail = ''

      const courierMembro = allMembros.find((m) => m.getString('user_id') === courierId)
      if (courierMembro) {
        empresaId = courierMembro.getString('empresa_id')
        const emp = allEmpresas.find((e) => e.id === empresaId)
        if (emp) {
          empresaNome =
            emp.getString('nome_fantasia') || emp.getString('nome_razao_social') || empresaNome
          notificationsEmail = (emp.getString('notifications_email') || '').trim()
          commercialEmail = (emp.getString('email') || '').trim()
        }
      }

      // RESOLUÇÃO DE DESTINATÁRIO CONFORME ORDEM DE PRIORIDADE OFICIAL:
      // 1. notifications_email da empresa do entregador
      // 2. admin membro ativo da empresa do entregador
      // 3. e-mail cadastrado na empresa (email comercial)
      // 4. primeiro admin/master do sistema
      // 5. fallback: tributarefacil@gmail.com
      let targetAdminEmail = ''
      let targetAdminName = 'Administrador'

      // (1) notifications_email da empresa
      if (notificationsEmail) {
        targetAdminEmail = notificationsEmail
        targetAdminName = empresaNome
      }

      // (2) admin membro da empresa
      if (!targetAdminEmail && empresaId) {
        const adminMembro = allMembros.find(
          (m) => m.getString('empresa_id') === empresaId && m.getString('papel') === 'admin',
        )
        if (adminMembro) {
          const adminUser = adminUsers.find((u) => u.id === adminMembro.getString('user_id'))
          if (adminUser) {
            targetAdminEmail = (adminUser.getString('email') || '').trim()
            targetAdminName = adminUser.getString('name') || targetAdminName
          }
        }
      }

      // (3) e-mail comercial da empresa
      if (!targetAdminEmail && commercialEmail) {
        targetAdminEmail = commercialEmail
        targetAdminName = empresaNome
      }

      // (4) primeiro admin/master do sistema
      if (!targetAdminEmail && adminUsers.length > 0) {
        targetAdminEmail = (adminUsers[0].getString('email') || '').trim()
        targetAdminName = adminUsers[0].getString('name') || targetAdminName
      }

      // (5) fallback
      if (!targetAdminEmail) {
        targetAdminEmail = 'tributarefacil@gmail.com'
      }

      const senderAddress =
        ($app.settings().meta && $app.settings().meta.senderAddress) || 'no-reply@goskip.app'
      const senderName =
        ($app.settings().meta && $app.settings().meta.senderName) || 'Rotaly Gestão de Entregas'

      const htmlBody = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background-color: #f8fafc; border-radius: 16px; border: 1px solid #e2e8f0;">
          <div style="background: linear-gradient(135deg, #002855, #004b99); padding: 28px; border-radius: 12px; text-align: center; color: #ffffff;">
            <h1 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.5px;">⛽ Alerta de Saldo de Combustível</h1>
            <p style="margin-top: 8px; margin-bottom: 0; font-size: 14px; opacity: 0.9;">Consumo atingiu a faixa de atenção (80% da média mensal)</p>
          </div>

          <div style="padding: 24px; background-color: #ffffff; margin-top: 16px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
            <p style="font-size: 14px; color: #334155; margin-top: 0;">
              Olá, <strong>${targetAdminName}</strong>!
            </p>
            <p style="font-size: 14px; color: #475569; line-height: 1.5;">
              Identificamos que o entregador <strong>${courierName}</strong> atingiu a faixa de atenção de consumo de combustível no mês corrente para a empresa <strong>${empresaNome}</strong>.
            </p>

            <div style="margin: 20px 0; padding: 16px; background-color: #f1f5f9; border-radius: 10px; border-left: 4px solid #f59e0b;">
              <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <tr>
                  <td style="padding: 6px 0; color: #64748b;"><strong>Entregador:</strong></td>
                  <td style="padding: 6px 0; text-align: right; color: #002855; font-weight: 600;">${courierName}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;"><strong>Veículo:</strong></td>
                  <td style="padding: 6px 0; text-align: right; color: #002855; text-transform: uppercase;">${vehicleType}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;"><strong>Saldo Atual:</strong></td>
                  <td style="padding: 6px 0; text-align: right; color: ${currentBalance < 0 ? '#dc2626' : '#059669'}; font-weight: 700;">${formatCurrency(currentBalance)}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;"><strong>Consumo Acumulado no Mês:</strong></td>
                  <td style="padding: 6px 0; text-align: right; color: #dc2626; font-weight: 700;">${formatCurrency(currentMonthSpent)}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;"><strong>Média Mensal do Entregador:</strong></td>
                  <td style="padding: 6px 0; text-align: right; color: #002855; font-weight: 600;">${formatCurrency(monthlyAverage)}</td>
                </tr>
              </table>
            </div>

            <div style="background: linear-gradient(135deg, #eff6ff, #dbeafe); border: 1px solid #bfdbfe; border-radius: 10px; padding: 18px; text-align: center; margin: 20px 0;">
              <span style="display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #1e40af;">Sugestão de Recarga Recomendada</span>
              <span style="display: block; font-size: 26px; font-weight: 800; color: #002855; margin: 6px 0;">${formatCurrency(suggestedRecharge)}</span>
              <span style="display: block; font-size: 11px; color: #475569;">
                Calculada com base na média mensal (${formatCurrency(monthlyAverage)}) deduzindo o consumo acumulado (${formatCurrency(currentMonthSpent)}), sem ultrapassar o teto da média do entregador.
              </span>
            </div>

            <p style="font-size: 12px; color: #64748b; line-height: 1.4; margin-bottom: 0;">
              Acesse o painel do Rotaly para lançar o adiantamento de combustível ou realizar os ajustes necessários na conta corrente do entregador.
            </p>
          </div>

          <p style="text-align: center; font-size: 11px; color: #94a3b8; margin-top: 20px;">
            Rotaly • Gestão Inteligente de Entregas &amp; Auditoria de Combustível<br />
            Este é um alerta automático gerado pelo sistema de verificação diária.
          </p>
        </div>
      `

      let sendStatus = 'sent'
      let sendError = ''

      try {
        const mailer = $app.newMailClient()
        mailer.send({
          from: {
            address: senderAddress,
            name: senderName,
          },
          to: [{ address: targetAdminEmail }],
          subject: `⛽ Alerta de Saldo de Combustível: ${courierName} (${formatCurrency(currentBalance)})`,
          html: htmlBody,
        })
        console.log(
          `[daily_fuel_balance_check] E-mail de alerta enviado para ${targetAdminEmail} sobre ${courierName}.`,
        )
        alertsSentCount++
      } catch (mailErr) {
        sendStatus = 'failed'
        sendError = String(mailErr)
        console.log(
          `[daily_fuel_balance_check] Falha ao enviar e-mail para ${targetAdminEmail}:`,
          mailErr,
        )
      }

      // Gravar histórico de auditoria e trava anti-spam
      try {
        const alertsCol = $app.findCollectionByNameOrId('fuel_balance_alerts')
        const alertRec = new Record(alertsCol)
        alertRec.set('courier_id', courierId)
        if (empresaId) alertRec.set('empresa_id', empresaId)
        alertRec.set('alert_date', todayStr)
        alertRec.set('balance', currentBalance)
        alertRec.set('monthly_spent', currentMonthSpent)
        alertRec.set('monthly_average', monthlyAverage)
        alertRec.set('suggested_recharge', suggestedRecharge)
        alertRec.set('recipient_email', targetAdminEmail)
        alertRec.set('status', sendStatus)
        if (sendError) alertRec.set('notes', sendError)
        $app.save(alertRec)
      } catch (saveErr) {
        console.log(
          '[daily_fuel_balance_check] Erro ao gravar registro em fuel_balance_alerts:',
          saveErr,
        )
      }
    }

    console.log(
      `[daily_fuel_balance_check] Verificação finalizada. Processados: ${processedCount}, Enviados: ${alertsSentCount}`,
    )
  } catch (errGlobal) {
    console.log('[daily_fuel_balance_check] Erro global no cron de combustível:', errGlobal)
  }
})

// 2. Endpoint HTTP administrativo para acionamento sob demanda por administradores
routerAdd('POST', '/backend/v1/fuel-balance/check-now', (c) => {
  function formatCurrency(val) {
    const n = Number(val) || 0
    return 'R$ ' + n.toFixed(2).replace('.', ',')
  }

  function getBrazilDateString(d) {
    const dateObj = d || new Date()
    const utc = dateObj.getTime() + dateObj.getTimezoneOffset() * 60000
    const spTime = new Date(utc - 3 * 3600000)
    const yyyy = spTime.getFullYear()
    const mm = String(spTime.getMonth() + 1).padStart(2, '0')
    const dd = String(spTime.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }

  function getYearMonthKey(dateStr) {
    if (!dateStr) return ''
    const s = String(dateStr).trim()
    if (s.length >= 7) {
      return s.substring(0, 7)
    }
    return ''
  }

  try {
    const authRecord = c.get('authRecord')
    const role = authRecord ? authRecord.getString('role') : ''
    if (!authRecord || (role !== 'master' && role !== 'admin' && role !== 'superadmin')) {
      return c.json(403, {
        error: 'Acesso negado. Apenas administradores podem acionar a verificação de combustível.',
      })
    }

    const now = new Date()
    const todayStr = getBrazilDateString(now)
    const currentYearMonth = todayStr.substring(0, 7)

    let couriers = []
    try {
      couriers = $app.findRecordsByFilter(
        '_pb_users_auth_',
        "role = 'courier' && status = 'active'",
        'name',
        200,
        0,
      )
    } catch (errCouriers) {
      return c.json(500, { error: String(errCouriers) })
    }

    let allAdvances = []
    try {
      allAdvances = $app.findRecordsByFilter(
        'fuel_advances',
        "status != 'cancelled'",
        '-date,-created',
        5000,
        0,
      )
    } catch (_) {}

    let allOrders = []
    try {
      allOrders = $app.findRecordsByFilter(
        'orders',
        "(status = 'delivered' || status = 'address_error' || status = 'client_absent') && completion_reason != 'cancelado_vendedor'",
        '-created',
        5000,
        0,
      )
    } catch (_) {}

    let allMembros = []
    try {
      allMembros = $app.findRecordsByFilter('membros', 'ativo = true', '-created', 1000, 0)
    } catch (_) {}

    let allEmpresas = []
    try {
      allEmpresas = $app.findRecordsByFilter('empresas', 'id != ""', 'nome_fantasia', 100, 0)
    } catch (_) {}

    let adminUsers = []
    try {
      adminUsers = $app.findRecordsByFilter(
        '_pb_users_auth_',
        "role = 'admin' || role = 'master'",
        '-created',
        50,
        0,
      )
    } catch (_) {}

    let processed = 0
    let alertsSent = 0
    const alertDetails = []

    for (let c = 0; c < couriers.length; c++) {
      const courier = couriers[c]
      const courierId = courier.id
      const courierName = courier.getString('name') || courier.getString('email') || 'Entregador'
      const vehicleType = (courier.getString('vehicle_type') || 'moto').toLowerCase()

      if (vehicleType === 'bicicleta' || vehicleType === 'bicycle') continue

      processed++

      // Anti-spam check
      let existingTodayAlert = []
      try {
        existingTodayAlert = $app.findRecordsByFilter(
          'fuel_balance_alerts',
          `courier_id = '${courierId}' && alert_date = '${todayStr}' && status = 'sent'`,
          '-created',
          1,
          0,
        )
      } catch (_) {}

      if (existingTodayAlert && existingTodayAlert.length > 0) {
        alertDetails.push({
          courierId,
          courierName,
          status: 'skipped_already_sent_today',
        })
        continue
      }

      const courierAdvances = allAdvances.filter((a) => a.getString('courier_id') === courierId)
      const courierOrders = allOrders.filter((o) => {
        if (o.getString('courier_id') !== courierId) return false
        const notes = (o.getString('notes') || '').toLowerCase()
        return !notes.includes('erro de sistema')
      })

      let currentMonthSpent = 0
      let pastMonthSpentMap = {}
      let pastOrdersSpentTotal = 0

      for (let o = 0; o < courierOrders.length; o++) {
        const ord = courierOrders[o]
        const orderDateVal =
          ord.getString('route_finished_at') ||
          ord.getString('actual_arrival') ||
          ord.getString('created')
        const orderMonth = getYearMonthKey(orderDateVal)
        const orderFuel = Number(ord.getFloat('fuel_cost')) || 0

        if (orderMonth === currentYearMonth) {
          currentMonthSpent += orderFuel
        } else if (orderMonth && orderMonth < currentYearMonth) {
          pastOrdersSpentTotal += orderFuel
          if (!pastMonthSpentMap[orderMonth]) pastMonthSpentMap[orderMonth] = 0
          pastMonthSpentMap[orderMonth] += orderFuel
        }
      }

      let currentMonthAdvances = 0
      let pastAdvancesTotal = 0

      for (let a = 0; a < courierAdvances.length; a++) {
        const adv = courierAdvances[a]
        const advDateVal = adv.getString('date') || adv.getString('created')
        const advMonth = getYearMonthKey(advDateVal)
        const advAmount = Number(adv.getFloat('amount')) || 0

        if (advMonth === currentYearMonth) {
          currentMonthAdvances += advAmount
        } else if (advMonth && advMonth < currentYearMonth) {
          pastAdvancesTotal += advAmount
        }
      }

      const carryOverBalance = Number((pastAdvancesTotal - pastOrdersSpentTotal).toFixed(2))
      const currentBalance = Number(
        (carryOverBalance + currentMonthAdvances - currentMonthSpent).toFixed(2),
      )
      currentMonthSpent = Number(currentMonthSpent.toFixed(2))

      const closedMonths = Object.keys(pastMonthSpentMap)
      let monthlyAverage = 0

      if (closedMonths.length > 0) {
        let sumPastSpent = 0
        for (let m = 0; m < closedMonths.length; m++)
          sumPastSpent += pastMonthSpentMap[closedMonths[m]]
        monthlyAverage = Number((sumPastSpent / closedMonths.length).toFixed(2))
      }

      if (monthlyAverage <= 0) {
        if (vehicleType.includes('caminhao')) monthlyAverage = 1200.0
        else if (vehicleType.includes('carro') || vehicleType.includes('van'))
          monthlyAverage = 800.0
        else monthlyAverage = 450.0

        if (currentMonthSpent > monthlyAverage) monthlyAverage = currentMonthSpent
      }

      const threshold80 = Number((monthlyAverage * 0.8).toFixed(2))
      const reachedThreshold =
        currentMonthSpent >= threshold80 ||
        (currentBalance <= monthlyAverage * 0.2 && currentMonthSpent > 0)

      if (!reachedThreshold) {
        alertDetails.push({
          courierId,
          courierName,
          status: 'ok_not_triggered',
          balance: currentBalance,
          monthlySpent: currentMonthSpent,
          monthlyAverage,
        })
        continue
      }

      let suggestedRecharge = monthlyAverage - currentMonthSpent
      if (suggestedRecharge > monthlyAverage) suggestedRecharge = monthlyAverage
      if (suggestedRecharge < 0) suggestedRecharge = 0
      suggestedRecharge = Number(suggestedRecharge.toFixed(2))

      let empresaId = ''
      let empresaNome = 'Rotaly Logística'
      let notificationsEmail = ''
      let commercialEmail = ''

      const courierMembro = allMembros.find((m) => m.getString('user_id') === courierId)
      if (courierMembro) {
        empresaId = courierMembro.getString('empresa_id')
        const emp = allEmpresas.find((e) => e.id === empresaId)
        if (emp) {
          empresaNome =
            emp.getString('nome_fantasia') || emp.getString('nome_razao_social') || empresaNome
          notificationsEmail = (emp.getString('notifications_email') || '').trim()
          commercialEmail = (emp.getString('email') || '').trim()
        }
      }

      // RESOLUÇÃO DE DESTINATÁRIO CONFORME ORDEM DE PRIORIDADE OFICIAL:
      // 1. notifications_email da empresa do entregador
      // 2. admin membro ativo da empresa do entregador
      // 3. e-mail cadastrado na empresa (email comercial)
      // 4. primeiro admin/master do sistema
      // 5. fallback: tributarefacil@gmail.com
      let targetAdminEmail = ''
      let targetAdminName = 'Administrador'

      // (1) notifications_email da empresa
      if (notificationsEmail) {
        targetAdminEmail = notificationsEmail
        targetAdminName = empresaNome
      }

      // (2) admin membro da empresa
      if (!targetAdminEmail && empresaId) {
        const adminMembro = allMembros.find(
          (m) => m.getString('empresa_id') === empresaId && m.getString('papel') === 'admin',
        )
        if (adminMembro) {
          const adminUser = adminUsers.find((u) => u.id === adminMembro.getString('user_id'))
          if (adminUser) {
            targetAdminEmail = (adminUser.getString('email') || '').trim()
            targetAdminName = adminUser.getString('name') || targetAdminName
          }
        }
      }

      // (3) e-mail comercial da empresa
      if (!targetAdminEmail && commercialEmail) {
        targetAdminEmail = commercialEmail
        targetAdminName = empresaNome
      }

      // (4) primeiro admin/master do sistema
      if (!targetAdminEmail && adminUsers.length > 0) {
        targetAdminEmail = (adminUsers[0].getString('email') || '').trim()
        targetAdminName = adminUsers[0].getString('name') || targetAdminName
      }

      // (5) fallback
      if (!targetAdminEmail) targetAdminEmail = 'tributarefacil@gmail.com'

      const senderAddress =
        ($app.settings().meta && $app.settings().meta.senderAddress) || 'no-reply@goskip.app'
      const senderName =
        ($app.settings().meta && $app.settings().meta.senderName) || 'Rotaly Gestão de Entregas'

      const htmlBody = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background-color: #f8fafc; border-radius: 16px; border: 1px solid #e2e8f0;">
          <div style="background: linear-gradient(135deg, #002855, #004b99); padding: 28px; border-radius: 12px; text-align: center; color: #ffffff;">
            <h1 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.5px;">⛽ Alerta de Saldo de Combustível</h1>
            <p style="margin-top: 8px; margin-bottom: 0; font-size: 14px; opacity: 0.9;">Consumo atingiu a faixa de atenção (80% da média mensal)</p>
          </div>

          <div style="padding: 24px; background-color: #ffffff; margin-top: 16px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
            <p style="font-size: 14px; color: #334155; margin-top: 0;">
              Olá, <strong>${targetAdminName}</strong>!
            </p>
            <p style="font-size: 14px; color: #475569; line-height: 1.5;">
              Identificamos que o entregador <strong>${courierName}</strong> atingiu a faixa de atenção de consumo de combustível no mês corrente para a empresa <strong>${empresaNome}</strong>.
            </p>

            <div style="margin: 20px 0; padding: 16px; background-color: #f1f5f9; border-radius: 10px; border-left: 4px solid #f59e0b;">
              <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <tr>
                  <td style="padding: 6px 0; color: #64748b;"><strong>Entregador:</strong></td>
                  <td style="padding: 6px 0; text-align: right; color: #002855; font-weight: 600;">${courierName}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;"><strong>Veículo:</strong></td>
                  <td style="padding: 6px 0; text-align: right; color: #002855; text-transform: uppercase;">${vehicleType}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;"><strong>Saldo Atual:</strong></td>
                  <td style="padding: 6px 0; text-align: right; color: ${currentBalance < 0 ? '#dc2626' : '#059669'}; font-weight: 700;">${formatCurrency(currentBalance)}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;"><strong>Consumo Acumulado no Mês:</strong></td>
                  <td style="padding: 6px 0; text-align: right; color: #dc2626; font-weight: 700;">${formatCurrency(currentMonthSpent)}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;"><strong>Média Mensal do Entregador:</strong></td>
                  <td style="padding: 6px 0; text-align: right; color: #002855; font-weight: 600;">${formatCurrency(monthlyAverage)}</td>
                </tr>
              </table>
            </div>

            <div style="background: linear-gradient(135deg, #eff6ff, #dbeafe); border: 1px solid #bfdbfe; border-radius: 10px; padding: 18px; text-align: center; margin: 20px 0;">
              <span style="display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #1e40af;">Sugestão de Recarga Recomendada</span>
              <span style="display: block; font-size: 26px; font-weight: 800; color: #002855; margin: 6px 0;">${formatCurrency(suggestedRecharge)}</span>
              <span style="display: block; font-size: 11px; color: #475569;">
                Calculada com base na média mensal (${formatCurrency(monthlyAverage)}) deduzindo o consumo acumulado (${formatCurrency(currentMonthSpent)}), sem ultrapassar o teto da média do entregador.
              </span>
            </div>

            <p style="font-size: 12px; color: #64748b; line-height: 1.4; margin-bottom: 0;">
              Acesse o painel do Rotaly para lançar o adiantamento de combustível ou realizar os ajustes necessários na conta corrente do entregador.
            </p>
          </div>

          <p style="text-align: center; font-size: 11px; color: #94a3b8; margin-top: 20px;">
            Rotaly • Gestão Inteligente de Entregas &amp; Auditoria de Combustível<br />
            Este é um alerta automático gerado pelo sistema de verificação diária.
          </p>
        </div>
      `

      let sendStatus = 'sent'
      let sendError = ''

      try {
        const mailer = $app.newMailClient()
        mailer.send({
          from: {
            address: senderAddress,
            name: senderName,
          },
          to: [{ address: targetAdminEmail }],
          subject: `⛽ Alerta de Saldo de Combustível: ${courierName} (${formatCurrency(currentBalance)})`,
          html: htmlBody,
        })
        alertsSent++
      } catch (mailErr) {
        sendStatus = 'failed'
        sendError = String(mailErr)
      }

      try {
        const alertsCol = $app.findCollectionByNameOrId('fuel_balance_alerts')
        const alertRec = new Record(alertsCol)
        alertRec.set('courier_id', courierId)
        if (empresaId) alertRec.set('empresa_id', empresaId)
        alertRec.set('alert_date', todayStr)
        alertRec.set('balance', currentBalance)
        alertRec.set('monthly_spent', currentMonthSpent)
        alertRec.set('monthly_average', monthlyAverage)
        alertRec.set('suggested_recharge', suggestedRecharge)
        alertRec.set('recipient_email', targetAdminEmail)
        alertRec.set('status', sendStatus)
        if (sendError) alertRec.set('notes', sendError)
        $app.save(alertRec)
      } catch (_) {}

      alertDetails.push({
        courierId,
        courierName,
        status: sendStatus,
        recipient: targetAdminEmail,
        balance: currentBalance,
        monthlySpent: currentMonthSpent,
        monthlyAverage,
        suggestedRecharge,
        error: sendError || undefined,
      })
    }

    return c.json(200, {
      success: true,
      date: todayStr,
      processed,
      alertsSent,
      details: alertDetails,
    })
  } catch (err) {
    return c.json(500, { error: String(err) })
  }
})

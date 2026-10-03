/// <reference path="../pb_data/types.d.ts" />

/**
 * Hook de Notificações Centralizadas por Empresa
 *
 * Expõe endpoints HTTP e infraestrutura para notificações transacionais/operacionais
 * do sistema direcionadas às empresas contratantes do SaaS.
 *
 * Ordem oficial de prioridade do destinatário:
 *  1. notifications_email configurado no cadastro da empresa
 *  2. admin membro ativo da empresa (membros.papel = 'admin')
 *  3. e-mail cadastrado na empresa (empresas.email - comercial)
 *  4. primeiro admin/master do sistema
 *  5. fallback: tributarefacil@gmail.com
 *
 * Todas as funções estão inline dentro de cada handler/endpoint para total conformidade
 * com o runtime Goja VM do PocketBase.
 */

// Endpoint administrativo para testar/enviar notificação oficial para empresa
routerAdd('POST', '/backend/v1/company-notifications/send', (c) => {
  function resolveRecipient(companyId) {
    let toEmail = ''
    let recipientName = 'Administrador'
    let companyName = 'Rotaly Logística'

    if (companyId) {
      try {
        const emp = $app.findRecordById('empresas', companyId)
        if (emp) {
          companyName =
            emp.getString('nome_fantasia') || emp.getString('nome_razao_social') || companyName

          // 1. notifications_email da empresa
          const notifEmail = (emp.getString('notifications_email') || '').trim()
          if (notifEmail) {
            toEmail = notifEmail
            recipientName = companyName
          }

          // 2. admin membro ativo da empresa
          if (!toEmail) {
            try {
              const adminMembros = $app.findRecordsByFilter(
                'membros',
                `empresa_id = '${companyId}' && ativo = true && papel = 'admin'`,
                '-created',
                5,
                0,
              )
              for (let i = 0; i < adminMembros.length; i++) {
                const uId = adminMembros[i].getString('user_id')
                if (uId) {
                  try {
                    const u = $app.findRecordById('_pb_users_auth_', uId)
                    if (
                      u &&
                      (u.getString('role') === 'admin' || u.getString('role') === 'master')
                    ) {
                      const uEmail = (u.getString('email') || '').trim()
                      if (uEmail) {
                        toEmail = uEmail
                        recipientName = u.getString('name') || recipientName
                        break
                      }
                    }
                  } catch (_) {}
                }
              }
            } catch (_) {}
          }

          // 3. e-mail comercial da empresa
          if (!toEmail) {
            const commEmail = (emp.getString('email') || '').trim()
            if (commEmail) {
              toEmail = commEmail
              recipientName = companyName
            }
          }
        }
      } catch (_) {}
    }

    // 4. primeiro admin/master do sistema
    if (!toEmail) {
      try {
        const systemAdmins = $app.findRecordsByFilter(
          '_pb_users_auth_',
          "role = 'admin' || role = 'master'",
          '-created',
          5,
          0,
        )
        if (systemAdmins && systemAdmins.length > 0) {
          toEmail = (systemAdmins[0].getString('email') || '').trim()
          recipientName = systemAdmins[0].getString('name') || recipientName
        }
      } catch (_) {}
    }

    // 5. fallback
    if (!toEmail) {
      toEmail = 'tributarefacil@gmail.com'
    }

    return { toEmail, recipientName, companyName }
  }

  try {
    const authRecord =
      (typeof c.Auth === 'function' ? c.Auth() : null) || c.auth || c.get('authRecord')
    const role = authRecord ? authRecord.getString('role') : ''
    if (!authRecord || (role !== 'master' && role !== 'admin')) {
      return c.json(403, { error: 'Acesso negado. Apenas administradores.' })
    }

    const body = c.get('body') || {}
    const companyId = body.company_id || ''
    const subject = body.subject || 'Aviso do Sistema - Rotaly'
    const html = body.html || ''
    const kind = body.kind || 'general'

    const recipient = resolveRecipient(companyId)

    const senderAddress =
      ($app.settings().meta && $app.settings().meta.senderAddress) || 'no-reply@goskip.app'
    const senderName =
      ($app.settings().meta && $app.settings().meta.senderName) || 'Rotaly Gestão de Entregas'

    let sendStatus = 'sent'
    let sendError = ''

    try {
      const mailer = $app.newMailClient()
      mailer.send({
        from: {
          address: senderAddress,
          name: senderName,
        },
        to: [{ address: recipient.toEmail }],
        subject: subject,
        html: html,
      })
      console.log(
        `[company_notifications] Notificação (${kind}) enviada para ${recipient.toEmail} (${recipient.companyName})`,
      )
    } catch (mailErr) {
      sendStatus = 'failed'
      sendError = String(mailErr)
      console.log(`[company_notifications] Falha ao enviar para ${recipient.toEmail}:`, mailErr)
    }

    return c.json(200, {
      success: sendStatus === 'sent',
      recipient,
      status: sendStatus,
      error: sendError || null,
    })
  } catch (err) {
    return c.json(500, { error: String(err) })
  }
})

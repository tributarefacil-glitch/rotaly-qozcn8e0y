/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // 0079_reset_pimentaverde_admin_password.js
    //
    // Requisito 1:
    // Redefinir a senha do usuário 'a79txuc992xhn7n' (pimentaverdeecommerce@gmail.com)
    // para 'Pimentad06m09', garantindo verified = true, role = admin e preservando
    // todos os demais campos da conta e seus vínculos de membro.

    const TARGET_ID = 'a79txuc992xhn7n'
    const TARGET_EMAIL = 'pimentaverdeecommerce@gmail.com'
    const NEW_PASSWORD = 'Pimentad06m09'

    let userRecord = null

    try {
      userRecord = app.findAuthRecordByEmail('_pb_users_auth_', TARGET_EMAIL)
    } catch (_) {
      try {
        userRecord = app.findRecordById('_pb_users_auth_', TARGET_ID)
      } catch (err2) {
        console.log('[0079] Usuário alvo não encontrado:', err2)
      }
    }

    if (userRecord) {
      userRecord.setPassword(NEW_PASSWORD)
      userRecord.setVerified(true)
      userRecord.set('status', 'active')
      if (!userRecord.getString('role')) {
        userRecord.set('role', 'admin')
      }
      app.save(userRecord)
      console.log(
        `[0079] Senha redefinida com sucesso para o usuário ${TARGET_EMAIL} (${userRecord.id}).`,
      )
    } else {
      console.log(
        `[0079] ATENÇÃO: Usuário ${TARGET_EMAIL} não localizado para redefinição de senha.`,
      )
    }
  },
  (app) => {
    // Down migration intentionally blank
  },
)

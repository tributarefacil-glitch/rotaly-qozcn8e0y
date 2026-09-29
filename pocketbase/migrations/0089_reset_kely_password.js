/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // 0089_reset_kely_password.js
    //
    // Requisito:
    // Resetar a senha da usuária kely@loghype.com (users/sh669l7snqiuoab)
    // para a senha temporária exata: LogHype@2026
    // Usar FindAuthRecordByEmail + SetPassword + save sem alterar nenhum outro campo ou usuário.
    // Migration idempotente e segura.

    const TARGET_EMAIL = 'kely@loghype.com'
    const TARGET_ID = 'sh669l7snqiuoab'
    const NEW_PASSWORD = 'LogHype@2026'

    let userRecord = null

    try {
      userRecord = app.findAuthRecordByEmail('_pb_users_auth_', TARGET_EMAIL)
    } catch (_) {
      try {
        userRecord = app.findRecordById('_pb_users_auth_', TARGET_ID)
      } catch (err) {
        console.log('[0089] Usuária kely@loghype.com não encontrada:', err)
      }
    }

    if (userRecord) {
      userRecord.setPassword(NEW_PASSWORD)
      app.save(userRecord)
      console.log(
        `[0089] Senha da usuária ${TARGET_EMAIL} (${userRecord.id}) redefinida com sucesso para LogHype@2026`,
      )
    } else {
      console.log(
        `[0089] AVISO: Registro da usuária ${TARGET_EMAIL} não encontrado para reset de senha.`,
      )
    }
  },
  (app) => {
    // Down migration intencionalmente vazia para preservar credenciais
  },
)

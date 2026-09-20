migrate(
  (app) => {
    // 1. Desbloquear especificamente o usuário 'a79txuc992xhn7n' (pimentaverdeecommerce@gmail.com)
    try {
      const user = app.findAuthRecordByEmail('_pb_users_auth_', 'pimentaverdeecommerce@gmail.com')
      user.setVerified(true)
      app.save(user)
      console.log(
        '[0078] Usuario pimentaverdeecommerce@gmail.com desbloqueado com verified = true.',
      )
    } catch (e1) {
      console.log('[0078] Aviso ao buscar por e-mail pimentaverdeecommerce@gmail.com:', e1)
      try {
        const userById = app.findRecordById('_pb_users_auth_', 'a79txuc992xhn7n')
        userById.setVerified(true)
        app.save(userById)
        console.log('[0078] Usuario id a79txuc992xhn7n desbloqueado via findRecordById.')
      } catch (e2) {
        console.log('[0078] Aviso ao buscar por ID a79txuc992xhn7n:', e2)
      }
    }

    // 2. Garantir por segurança que qualquer outro usuário existente com verified = false seja autenticável
    try {
      app
        .db()
        .newQuery('UPDATE users SET verified = 1 WHERE verified = 0 OR verified IS NULL')
        .execute()
      console.log(
        '[0078] Todos os usuarios com verified = false/null foram atualizados para verified = 1.',
      )
    } catch (eSql) {
      console.log('[0078] Aviso no UPDATE SQL em users:', eSql)
    }
  },
  (app) => {
    // Down migration
  },
)

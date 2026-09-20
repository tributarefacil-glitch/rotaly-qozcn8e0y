// Hook PocketBase para garantir que todo usuário criado por administrador
// (master, admin ou seller criando courier) já nasça com verified = true,
// permitindo login imediato sem bloqueio de verificação de e-mail.

onRecordCreate((e) => {
  try {
    const user = e.record
    const email = user.getString('email')
    const role = user.getString('role')
    const authRecord = e.auth

    // Se a criação está sendo feita por um usuário autenticado (master, admin ou seller),
    // ou se o usuário foi criado no painel administrativo, garantir verified = true
    if (authRecord || !user.getBool('verified')) {
      user.setVerified(true)
      console.log(
        `[AUDITORIA_USUARIOS] Usuario ${email} (role=${role}) criado com verified=true automaticamente. ` +
          `Criador: ${authRecord ? `${authRecord.getString('role')}:${authRecord.id}` : 'sistema'}`,
      )
    }
  } catch (err) {
    console.log('[AUDITORIA_USUARIOS] Erro ao definir verified=true em onRecordCreate users:', err)
  }

  e.next()
}, 'users')

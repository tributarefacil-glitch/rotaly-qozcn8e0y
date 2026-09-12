migrate(
  (app) => {
    // Garantir que a usuária CAROLINE (caroline@loghype.com) esteja perfeitamente configurada
    // com papel 'seller' e status 'active', preservando sua senha e dados cadastrais.
    try {
      const user = app.findAuthRecordByEmail('_pb_users_auth_', 'caroline@loghype.com')
      let changed = false

      if (user.getString('role') !== 'seller') {
        user.set('role', 'seller')
        changed = true
      }

      if (user.getString('status') !== 'active') {
        user.set('status', 'active')
        changed = true
      }

      if (!user.getString('name')) {
        user.set('name', 'CAROLINE')
        changed = true
      }

      if (changed) {
        app.save(user)
        console.log('Migração 0036: Usuária CAROLINE atualizada com role=seller e status=active')
      } else {
        console.log('Migração 0036: Usuária CAROLINE já possui role=seller e status=active')
      }
    } catch (err) {
      console.log('Migração 0036: Usuária caroline@loghype.com não encontrada ou erro:', err)
    }
  },
  (app) => {
    // down migration: intentionally left empty to preserve user account
  },
)

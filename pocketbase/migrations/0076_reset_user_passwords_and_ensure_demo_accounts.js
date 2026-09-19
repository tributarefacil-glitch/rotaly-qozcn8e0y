migrate(
  (app) => {
    // Redefinir e padronizar senha padrão para usuários do sistema e garantir status active + verified
    const usersToSync = [
      // Administrador
      { email: 'tributarefacil@gmail.com', role: 'admin', name: 'Administrador Principal' },
      // Vendedores / Lojistas
      { email: 'pimentaverdecosmetico@gmail.com', role: 'seller', name: 'DIOGO MENDES' },
      { email: 'kely@loghype.com', role: 'seller', name: 'KELY' },
      { email: 'caroline@loghype.com', role: 'seller', name: 'CAROLINE' },
      { email: 'davidsmendes16@gmail.com', role: 'seller', name: 'Davi dos Santos Mendes' },
      { email: 'vendedor@logistica.com', role: 'seller', name: 'Vendedor Demonstração' },
      // Entregadores
      { email: 'pimentaverdecentro@gmail.com', role: 'courier', name: 'DIOGO MENDES' },
      { email: 'luisalcantaraa5@gmail.com', role: 'courier', name: 'Luis Antonio' },
      { email: 'guilherme@lohype.com', role: 'courier', name: 'GUILHERME DE PAIVA' },
      { email: 'vinicios@loghype.com', role: 'courier', name: 'VINICIOS LUNZ' },
      { email: 'marcos@rotary.com', role: 'courier', name: 'Marcos Fernando Barbosa' },
    ]

    const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')

    for (let i = 0; i < usersToSync.length; i++) {
      const item = usersToSync[i]
      try {
        const record = app.findAuthRecordByEmail('_pb_users_auth_', item.email)
        record.setPassword('Skip@Pass')
        record.setVerified(true)
        record.set('status', 'active')
        if (!record.getString('role')) {
          record.set('role', item.role)
        }
        if (!record.getString('name')) {
          record.set('name', item.name)
        }
        app.save(record)
        console.log(`[0076] Usuário atualizado com sucesso: ${item.email}`)
      } catch (_) {
        // Se não existir, criar para garantir que os logins de teste/demo e pré-configurados funcionem
        const newRecord = new Record(usersCol)
        newRecord.setEmail(item.email)
        newRecord.setPassword('Skip@Pass')
        newRecord.setVerified(true)
        newRecord.set('status', 'active')
        newRecord.set('role', item.role)
        newRecord.set('name', item.name)
        app.save(newRecord)
        console.log(`[0076] Novo usuário criado com sucesso: ${item.email}`)
      }
    }
  },
  (app) => {
    // down migration: intentionally left blank to protect user accounts
  },
)

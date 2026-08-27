migrate(
  (app) => {
    try {
      const user = app.findAuthRecordByEmail('_pb_users_auth_', 'edjanepmendes@gmail.com')
      user.setPassword('Skip@Pass')
      user.setVerified(true)
      user.set('role', 'courier')
      user.set('status', 'active')
      app.save(user)
    } catch (err) {
      console.log('User edjanepmendes@gmail.com not found for reset, creating:', err)
      const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')
      const user = new Record(usersCol)
      user.setEmail('edjanepmendes@gmail.com')
      user.setPassword('Skip@Pass')
      user.setVerified(true)
      user.set('name', 'edjane mendes')
      user.set('role', 'courier')
      user.set('status', 'active')
      app.save(user)
    }
  },
  (app) => {
    // down migration
  },
)

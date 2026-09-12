migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')
    const adminEmail = 'tributarefacil@gmail.com'

    let adminRecord = null
    try {
      adminRecord = app.findAuthRecordByEmail('_pb_users_auth_', adminEmail)
    } catch (_) {
      // User not found
    }

    if (adminRecord) {
      adminRecord.setPassword('Skip@Pass')
      adminRecord.setVerified(true)
      adminRecord.set('role', 'admin')
      adminRecord.set('status', 'active')
      if (!adminRecord.getString('name')) {
        adminRecord.set('name', 'Administrador Principal')
      }
      app.save(adminRecord)
      console.log('Updated password, role=admin and status=active for tributarefacil@gmail.com')
    } else {
      const newAdmin = new Record(usersCol)
      newAdmin.setEmail(adminEmail)
      newAdmin.setPassword('Skip@Pass')
      newAdmin.setVerified(true)
      newAdmin.set('name', 'Administrador Principal')
      newAdmin.set('role', 'admin')
      newAdmin.set('status', 'active')
      app.save(newAdmin)
      console.log('Created new admin user tributarefacil@gmail.com')
    }
  },
  (app) => {
    // down migration: intentionally left blank to keep user account intact
  },
)

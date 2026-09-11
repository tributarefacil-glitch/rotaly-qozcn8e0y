migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')
    const targetEmail = 'davidsmendes16@gmail.com'
    const typoEmail = 'davismendes16@gmail.com'

    let typoRecord = null
    try {
      typoRecord = app.findAuthRecordByEmail('_pb_users_auth_', typoEmail)
    } catch (_) {
      // no typo record
    }

    let targetRecord = null
    try {
      targetRecord = app.findAuthRecordByEmail('_pb_users_auth_', targetEmail)
    } catch (_) {
      // not existing yet
    }

    if (typoRecord && !targetRecord) {
      // Update email on existing record and set password
      typoRecord.setEmail(targetEmail)
      typoRecord.setPassword('66174517')
      typoRecord.setVerified(true)
      typoRecord.set('role', 'seller')
      typoRecord.set('status', 'active')
      typoRecord.set('name', typoRecord.getString('name') || 'Davi dos Santos Mendes')
      typoRecord.set('phone', typoRecord.getString('phone') || '21966174517')
      app.save(typoRecord)
      console.log('Migrated typo user to davidsmendes16@gmail.com')
    } else if (targetRecord) {
      // Ensure target record is active seller with the right credentials
      targetRecord.setPassword('66174517')
      targetRecord.setVerified(true)
      targetRecord.set('role', 'seller')
      targetRecord.set('status', 'active')
      if (!targetRecord.getString('name')) {
        targetRecord.set('name', 'Davi dos Santos Mendes')
      }
      if (!targetRecord.getString('phone')) {
        targetRecord.set('phone', '21966174517')
      }
      app.save(targetRecord)
      console.log('Updated davidsmendes16@gmail.com password and active status')
    } else {
      // Create fresh record
      const newRecord = new Record(usersCol)
      newRecord.setEmail(targetEmail)
      newRecord.setPassword('66174517')
      newRecord.setVerified(true)
      newRecord.set('name', 'Davi dos Santos Mendes')
      newRecord.set('role', 'seller')
      newRecord.set('status', 'active')
      newRecord.set('phone', '21966174517')
      app.save(newRecord)
      console.log('Created new seller record for davidsmendes16@gmail.com')
    }
  },
  (app) => {
    // down migration: intentionally left blank to keep user account intact
  },
)

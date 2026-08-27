// Hook to notify admins when a new courier signs up with pending status
// One hook per file. All logic inline.

onRecordAfterCreateSuccess((e) => {
  try {
    const user = e.record
    const role = user.getString('role')
    const status = user.getString('status')
    const name = user.getString('name') || 'Novo usuário'
    const email = user.getString('email')

    // Check if new courier registered with pending status
    if (role === 'courier' && status === 'pending') {
      // Find all admin users
      let admins = []
      try {
        admins = $app.findRecordsByFilter('_pb_users_auth_', "role = 'admin'", '-created', 50, 0)
      } catch (err) {
        console.log('Error fetching admins:', err)
      }

      const notifsCol = $app.findCollectionByNameOrId('notifications')

      for (let i = 0; i < admins.length; i++) {
        const adminId = admins[i].id
        try {
          const notif = new Record(notifsCol)
          notif.set('user_id', adminId)
          notif.set('title', 'Novo cadastro de entregador')
          notif.set(
            'message',
            `O entregador ${name} (${email}) realizou cadastro e aguarda aprovação de documentos no painel.`,
          )
          notif.set('type', 'system')
          notif.set('read', false)
          $app.save(notif)
        } catch (saveErr) {
          console.log('Error saving admin notification for courier registration:', saveErr)
        }
      }
    }
  } catch (outerErr) {
    console.log('Error in on_courier_registered hook:', outerErr)
  }

  e.next()
}, 'users')

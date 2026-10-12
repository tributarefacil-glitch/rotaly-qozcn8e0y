// Admin user update hook
// Allows administrators to update user records, including setting a new password without oldPassword
// One route per file. All logic inline inside the callback.

routerAdd(
  'POST',
  '/backend/v1/admin/users/{id}',
  (e) => {
    try {
      const authUser = e.auth
      if (!authUser) {
        return e.json(401, { message: 'Autenticação necessária.' })
      }

      // Ensure caller is master or admin
      const callerRole = authUser.getString('role')
      if (callerRole !== 'master' && callerRole !== 'admin') {
        return e.json(403, { message: 'Apenas administradores podem executar esta ação.' })
      }

      const targetId = e.request.pathValue('id')
      if (!targetId) {
        return e.json(400, { message: 'ID de usuário não informado.' })
      }

      // Find the target record
      let targetRecord
      try {
        targetRecord = $app.findRecordById('_pb_users_auth_', targetId)
      } catch (findErr) {
        return e.json(404, { message: 'Usuário não encontrado.' })
      }

      // Do not allow editing own account via this endpoint to avoid lockouts
      if (targetRecord.id === authUser.id) {
        return e.json(400, {
          message: 'Não é permitido alterar o usuário administrador por este painel.',
        })
      }

      const body = e.requestInfo().body || {}

      // Update name if provided
      if (body.name !== undefined && body.name !== null) {
        const trimmedName = String(body.name).trim()
        if (!trimmedName) {
          return e.json(400, {
            message: 'O nome não pode ser vazio.',
            data: { name: { message: 'O nome é obrigatório.' } },
          })
        }
        targetRecord.set('name', trimmedName)
      }

      // Update email if provided and changed
      if (body.email !== undefined && body.email !== null) {
        const trimmedEmail = String(body.email).trim().toLowerCase()
        if (!trimmedEmail) {
          return e.json(400, {
            message: 'O e-mail não pode ser vazio.',
            data: { email: { message: 'O e-mail é obrigatório.' } },
          })
        }
        if (trimmedEmail !== targetRecord.getString('email').toLowerCase()) {
          // Check if email already in use
          try {
            const existing = $app.findAuthRecordByEmail('_pb_users_auth_', trimmedEmail)
            if (existing && existing.id !== targetRecord.id) {
              return e.json(400, {
                message: 'Este e-mail já está em uso.',
                data: {
                  email: { message: 'Este e-mail já está sendo utilizado por outro usuário.' },
                },
              })
            }
          } catch (_) {
            // Not found, safe to use
          }
          targetRecord.setEmail(trimmedEmail)
        }
      }

      // Update phone if provided
      if (body.phone !== undefined && body.phone !== null) {
        targetRecord.set('phone', String(body.phone).trim())
      }

      // Update document (CPF/CNPJ) if provided
      if (body.document !== undefined && body.document !== null) {
        targetRecord.set('document', String(body.document).trim())
      }

      // Update vehicle fields if provided
      if (body.vehicle_type !== undefined && body.vehicle_type !== null) {
        targetRecord.set('vehicle_type', String(body.vehicle_type).trim())
      }
      if (body.vehicle_model !== undefined && body.vehicle_model !== null) {
        targetRecord.set('vehicle_model', String(body.vehicle_model).trim())
      }
      if (body.vehicle_plate !== undefined && body.vehicle_plate !== null) {
        targetRecord.set('vehicle_plate', String(body.vehicle_plate).trim().toUpperCase())
      }

      // Update role if provided (admin, seller, courier)
      if (body.role !== undefined && body.role !== null) {
        const validRoles = ['master', 'admin', 'seller', 'courier']
        const newRole = String(body.role).trim()
        if (validRoles.indexOf(newRole) !== -1) {
          // Apenas master pode conceder papel master
          if (newRole === 'master' && callerRole !== 'master') {
            return e.json(403, {
              message: 'Apenas o Administrador Master pode atribuir o perfil Master.',
            })
          }
          targetRecord.set('role', newRole)
        }
      }

      // Update status if provided
      if (body.status !== undefined && body.status !== null) {
        const validStatuses = ['active', 'inactive', 'pending', 'idle', 'busy']
        const newStatus = String(body.status).trim()
        if (validStatuses.indexOf(newStatus) !== -1) {
          targetRecord.set('status', newStatus)
        }
      }

      // Redefine password if provided (só chamar user.setPassword se senha válida com length >= 8)
      if (
        body.password !== undefined &&
        body.password !== null &&
        String(body.password).trim() !== ''
      ) {
        const newPassword = String(body.password).trim()
        if (newPassword.length >= 8) {
          targetRecord.setPassword(newPassword)
        } else {
          return e.json(400, {
            message: 'A nova senha deve ter no mínimo 8 caracteres.',
            data: { password: { message: 'A nova senha deve ter no mínimo 8 caracteres.' } },
          })
        }
      }

      // Save changes
      $app.save(targetRecord)

      return e.json(200, {
        id: targetRecord.id,
        name: targetRecord.getString('name'),
        email: targetRecord.getString('email'),
        phone: targetRecord.getString('phone'),
        document: targetRecord.getString('document'),
        status: targetRecord.getString('status'),
        role: targetRecord.getString('role'),
        vehicle_type: targetRecord.getString('vehicle_type'),
        vehicle_model: targetRecord.getString('vehicle_model'),
        vehicle_plate: targetRecord.getString('vehicle_plate'),
        updated: targetRecord.getString('updated'),
      })
    } catch (err) {
      console.log('Error updating user by admin:', err)
      return e.json(500, {
        message: 'Erro interno ao atualizar usuário: ' + (err.message || String(err)),
      })
    }
  },
  $apis.requireAuth(),
)

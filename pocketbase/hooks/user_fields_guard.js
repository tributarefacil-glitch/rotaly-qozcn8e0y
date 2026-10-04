// Hook para proteção de campos sensíveis de usuários:
// opening_balance, cutoff_date e role só podem ser alterados por admin ou master.
// O próprio usuário (ou qualquer outro papel sem privilégios) NÃO pode alterar esses campos diretamente.

onRecordUpdate((e) => {
  const original = e.record.original()
  if (!original) {
    return e.next()
  }

  const authRecord = e.auth
  const requesterRole = authRecord ? authRecord.getString('role') : ''
  const isPrivileged = requesterRole === 'admin' || requesterRole === 'master'

  // Se não for admin ou master, bloqueia alteração nos campos sensíveis
  if (!isPrivileged) {
    const origOpeningBalance = original.get('opening_balance')
    const newOpeningBalance = e.record.get('opening_balance')
    if (origOpeningBalance !== newOpeningBalance && newOpeningBalance !== undefined) {
      throw new BadRequestError(
        'Apenas administradores podem alterar o saldo de abertura (opening_balance).',
      )
    }

    const origCutoffDate = original.getString('cutoff_date')
    const newCutoffDate = e.record.getString('cutoff_date')
    if (origCutoffDate !== newCutoffDate && newCutoffDate !== undefined && newCutoffDate !== '') {
      throw new BadRequestError(
        'Apenas administradores podem alterar a data de corte (cutoff_date).',
      )
    }

    const origRole = original.getString('role')
    const newRole = e.record.getString('role')
    if (origRole !== newRole && newRole !== '') {
      throw new BadRequestError('Apenas administradores podem alterar o perfil (role) de usuários.')
    }
  }

  return e.next()
}, 'users')

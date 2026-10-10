migrate(
  (app) => {
    // Migração 0132: Validações de segurança para uploads de comprovante e assinatura
    // Configura limites de 5MB e MIME types estritos nos campos file de 'orders'
    try {
      const ordersCol = app.findCollectionByNameOrId('orders')
      if (!ordersCol) return

      let modified = false

      // 1. Campo signature (assinatura do recebedor): PNG/JPEG/WEBP, máx 5MB (5242880 bytes)
      const sigField = ordersCol.fields.getByName('signature')
      if (sigField) {
        sigField.maxSize = 5242880 // 5MB
        sigField.mimeTypes = ['image/png', 'image/jpeg', 'image/webp']
        modified = true
      }

      // 2. Campo proof_photo (foto opcional do pacote/local): JPEG/PNG/WEBP, máx 5MB (5242880 bytes)
      const photoField = ordersCol.fields.getByName('proof_photo')
      if (photoField) {
        photoField.maxSize = 5242880 // 5MB
        photoField.mimeTypes = ['image/jpeg', 'image/png', 'image/webp']
        modified = true
      }

      if (modified) {
        app.save(ordersCol)
        console.log(
          '[0132] Regras de upload (maxSize=5MB e mimeTypes restritos) aplicadas com sucesso na collection orders.',
        )
      }
    } catch (err) {
      console.log('[0132] Erro ao atualizar campos de upload na collection orders:', err)
    }
  },
  (app) => {
    // Rollback no-op
  },
)

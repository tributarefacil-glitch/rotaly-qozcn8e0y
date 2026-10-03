/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration 0096:
 * 1. Atualiza o campo `amount` da coleção `fuel_advances` para remover o limite mínimo `min: 0.01`,
 *    permitindo números negativos (débitos de ajuste de saldo) e positivos (créditos / adiantamentos).
 * 2. Atualiza as API rules de `app_settings` (createRule, updateRule, deleteRule) para aceitar
 *    usuários com a role `master`, além de `admin` e `superadmin`.
 * 3. Atualiza a deleteRule de `fuel_advances` para também incluir `master` explicitamente.
 */
migrate(
  (app) => {
    // 1. Atualizar fuel_advances: amount sem min (permite negativos e positivos)
    const fuelAdvancesCol = app.findCollectionByNameOrId('fuel_advances')
    if (fuelAdvancesCol) {
      const amountField = fuelAdvancesCol.fields.getByName('amount')
      if (amountField) {
        amountField.min = null
        amountField.required = true
      }

      // Garantir que deleteRule inclua master
      fuelAdvancesCol.deleteRule =
        '@request.auth.id != "" && (@request.auth.role = "master" || @request.auth.role = "admin" || @request.auth.role = "superadmin")'

      app.save(fuelAdvancesCol)
      console.log(
        '0096: fuel_advances.amount atualizado (min removido) e deleteRule atualizada para incluir master.',
      )
    }

    // 2. Atualizar app_settings: regras para master || admin || superadmin
    const appSettingsCol = app.findCollectionByNameOrId('app_settings')
    if (appSettingsCol) {
      appSettingsCol.listRule = '@request.auth.id != ""'
      appSettingsCol.viewRule = '@request.auth.id != ""'
      appSettingsCol.createRule =
        '@request.auth.id != "" && (@request.auth.role = "master" || @request.auth.role = "admin" || @request.auth.role = "superadmin")'
      appSettingsCol.updateRule =
        '@request.auth.id != "" && (@request.auth.role = "master" || @request.auth.role = "admin" || @request.auth.role = "superadmin")'
      appSettingsCol.deleteRule =
        '@request.auth.id != "" && (@request.auth.role = "master" || @request.auth.role = "admin" || @request.auth.role = "superadmin")'

      app.save(appSettingsCol)
      console.log('0096: app_settings regras atualizadas para incluir role master.')
    }
  },
  (app) => {
    // Reversão
    try {
      const fuelAdvancesCol = app.findCollectionByNameOrId('fuel_advances')
      if (fuelAdvancesCol) {
        const amountField = fuelAdvancesCol.fields.getByName('amount')
        if (amountField) {
          amountField.min = 0.01
        }
        fuelAdvancesCol.deleteRule =
          '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "superadmin")'
        app.save(fuelAdvancesCol)
      }
    } catch (_) {}

    try {
      const appSettingsCol = app.findCollectionByNameOrId('app_settings')
      if (appSettingsCol) {
        appSettingsCol.createRule =
          '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "superadmin")'
        appSettingsCol.updateRule =
          '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "superadmin")'
        appSettingsCol.deleteRule =
          '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "superadmin")'
        app.save(appSettingsCol)
      }
    } catch (_) {}
  },
)

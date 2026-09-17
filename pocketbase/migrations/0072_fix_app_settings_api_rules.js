/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const appSettingsCol = app.findCollectionByNameOrId('app_settings')
    if (appSettingsCol) {
      appSettingsCol.listRule = '@request.auth.id != ""'
      appSettingsCol.viewRule = '@request.auth.id != ""'
      appSettingsCol.createRule =
        '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "superadmin")'
      appSettingsCol.updateRule =
        '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "superadmin")'
      appSettingsCol.deleteRule =
        '@request.auth.id != "" && (@request.auth.role = "admin" || @request.auth.role = "superadmin")'
      app.save(appSettingsCol)
      console.log('0072: Regras de app_settings atualizadas com sucesso')
    }
  },
  (app) => {
    const appSettingsCol = app.findCollectionByNameOrId('app_settings')
    if (appSettingsCol) {
      appSettingsCol.listRule = '@request.auth.id != ""'
      appSettingsCol.viewRule = '@request.auth.id != ""'
      appSettingsCol.createRule = "@request.auth.role = 'admin'"
      appSettingsCol.updateRule = "@request.auth.role = 'admin'"
      appSettingsCol.deleteRule = "@request.auth.role = 'admin'"
      app.save(appSettingsCol)
    }
  },
)

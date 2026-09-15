/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // Atualizar coordenadas reais da base Mais Saudavel (id: 811cpvr0g77m9ue)
    // lat: -22.6990563, lng: -43.2967230
    // Sem alterar endereço, nome, empresa nem flags is_default/is_end_default.
    try {
      const record = app.findRecordById('base_addresses', '811cpvr0g77m9ue')
      if (record) {
        record.set('lat', -22.6990563)
        record.set('lng', -43.296723)
        app.save(record)
      }
    } catch (err) {
      console.warn('Erro ao atualizar coordenadas da base Mais Saudavel:', err)
    }
  },
  (app) => {
    try {
      const record = app.findRecordById('base_addresses', '811cpvr0g77m9ue')
      if (record) {
        record.set('lat', -22.7001402)
        record.set('lng', -43.2982834)
        app.save(record)
      }
    } catch (err) {
      console.warn('Erro ao reverter coordenadas da base Mais Saudavel:', err)
    }
  },
)

migrate(
  (app) => {
    // Seed CPF/CNPJ for existing dummy customers if empty
    try {
      const records = app.findRecordsByFilter('customers', '', 'created', 50, 0)
      const sampleDocs = [
        '12.345.678/0001-90',
        '98.765.432/0001-11',
        '123.456.789-00',
        '234.567.890-11',
        '34.567.890/0001-22',
      ]
      records.forEach((rec, idx) => {
        if (!rec.getString('document')) {
          rec.set('document', sampleDocs[idx % sampleDocs.length])
          app.save(rec)
        }
      })
    } catch (_) {}
  },
  () => {},
)

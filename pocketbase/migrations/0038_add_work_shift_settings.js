migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('app_settings')

    // Campos para Jornada de Trabalho da Empresa:
    // work_start_time (entrada, ex: "08:00")
    // lunch_start_time (saída para almoço, ex: "12:00")
    // lunch_end_time (volta do almoço, ex: "13:00")
    // work_end_time (fim do expediente, ex: "18:30")
    if (!col.fields.getByName('work_start_time')) {
      col.fields.add(
        new TextField({
          name: 'work_start_time',
          required: false,
        }),
      )
    }
    if (!col.fields.getByName('lunch_start_time')) {
      col.fields.add(
        new TextField({
          name: 'lunch_start_time',
          required: false,
        }),
      )
    }
    if (!col.fields.getByName('lunch_end_time')) {
      col.fields.add(
        new TextField({
          name: 'lunch_end_time',
          required: false,
        }),
      )
    }
    if (!col.fields.getByName('work_end_time')) {
      col.fields.add(
        new TextField({
          name: 'work_end_time',
          required: false,
        }),
      )
    }

    app.save(col)

    // Atualizar registro padrão com valores iniciais se ainda não definidos
    try {
      const record = app.findFirstRecordByData('app_settings', 'key', 'global_settings')
      if (!record.get('work_start_time')) {
        record.set('work_start_time', '08:00')
      }
      if (!record.get('lunch_start_time')) {
        record.set('lunch_start_time', '12:00')
      }
      if (!record.get('lunch_end_time')) {
        record.set('lunch_end_time', '13:00')
      }
      if (!record.get('work_end_time')) {
        record.set('work_end_time', '18:30')
      }
      app.save(record)
    } catch (_) {}
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('app_settings')
      const fieldsToRemove = [
        'work_start_time',
        'lunch_start_time',
        'lunch_end_time',
        'work_end_time',
      ]
      for (const f of fieldsToRemove) {
        const field = col.fields.getByName(f)
        if (field) {
          col.fields.removeByName(f)
        }
      }
      app.save(col)
    } catch (_) {}
  },
)

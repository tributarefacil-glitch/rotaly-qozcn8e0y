migrate(
  (app) => {
    // 0034_cleanup_off_route_spam.js
    // Limpeza de spam de paradas inesperadas (unexpected_stop) criadas repetidamente a cada ping de GPS.
    // Regra:
    // 1. Manter apenas episódios válidos de parada com duração real stop_duration_seconds >= 180s.
    // 2. Para registros com stop_duration_seconds = 0 ou < 180 criados em rajada no mesmo local/dia,
    //    remover o spam pontual duplicado. Se houver sequência de pings no mesmo local (> 180s de intervalo entre primeiro e último),
    //    consolidar a duração real no primeiro registro e deletar os clones. Caso o episódio total não chegue a 180s,
    //    remover o falso positivo.
    try {
      // 1. Identificar registros de unexpected_stop
      const records = app.findRecordsByFilter(
        'off_route_events',
        "event_type = 'unexpected_stop'",
        'created',
        2000,
        0,
      )

      if (records.length === 0) return

      // Agrupar por courier_id + order_id + arredondamento de coordenadas (~50m: lat/lng arredondados a 3 casas decimais)
      const groups = new Map()

      for (let i = 0; i < records.length; i++) {
        const rec = records[i]
        const courierId = rec.getString('courier_id')
        const orderId = rec.getString('order_id')
        const lat = rec.getFloat('lat')
        const lng = rec.getFloat('lng')
        const createdStr = rec.getString('created')
        const createdDate = new Date(createdStr)

        // Chave espacial/temporal aproximada (mesmo courier, mesmo pedido ou mesma posição geográfica aproximada no mesmo dia)
        const dayStr = createdStr.slice(0, 10)
        const latKey = lat.toFixed(3)
        const lngKey = lng.toFixed(3)
        const groupKey = `${courierId}_${dayStr}_${latKey}_${lngKey}`

        const list = groups.get(groupKey) || []
        list.push(rec)
        groups.set(groupKey, list)
      }

      const toDeleteIds = []

      groups.forEach((groupRecords) => {
        if (groupRecords.length === 1) {
          const single = groupRecords[0]
          const duration = single.getFloat('stop_duration_seconds') || 0
          // Se for único e tiver duração 0 ou menor que 180s, não representa parada validada
          if (duration < 180) {
            toDeleteIds.push(single.id)
          }
          return
        }

        // Ordenar cronologicamente
        groupRecords.sort((a, b) => {
          return (
            new Date(a.getString('created')).getTime() - new Date(b.getString('created')).getTime()
          )
        })

        const first = groupRecords[0]
        const last = groupRecords[groupRecords.length - 1]

        const tFirst = new Date(first.getString('created')).getTime()
        const tLast = new Date(last.getString('created')).getTime()
        const durationSec = Math.round((tLast - tFirst) / 1000)

        // Se o tempo total entre o primeiro e o último ping parado for >= 180s (3 minutos)
        // Consolidamos a duração real no primeiro registro e deletamos todos os outros pings do grupo
        if (durationSec >= 180) {
          try {
            first.set('stop_duration_seconds', durationSec)
            first.set(
              'notes',
              `Parada não planejada consolidada (~${Math.round(durationSec / 60)} min). Registros duplicados eliminados.`,
            )
            app.save(first)
          } catch (eSave) {
            console.log('Erro ao salvar consolidacao de parada:', eSave)
          }

          for (let j = 1; j < groupRecords.length; j++) {
            toDeleteIds.push(groupRecords[j].id)
          }
        } else {
          // Todo o episódio foi menor que 3 minutos (ex.: semáforo ou breve espera < 180s)
          // Não caracteriza parada inesperada oficial: deletar todos
          for (let j = 0; j < groupRecords.length; j++) {
            toDeleteIds.push(groupRecords[j].id)
          }
        }
      })

      // Excluir registros identificados em blocos
      if (toDeleteIds.length > 0) {
        // Usar batches de 100 para a query SQL DELETE
        for (let b = 0; b < toDeleteIds.length; b += 100) {
          const batchIds = toDeleteIds.slice(b, b + 100)
          const inClause = batchIds.map((id) => `'${id}'`).join(',')
          app.db().newQuery(`DELETE FROM off_route_events WHERE id IN (${inClause})`).execute()
        }
      }
    } catch (err) {
      console.log('Erro na migration 0034_cleanup_off_route_spam:', err)
    }
  },
  (app) => {
    // Reversão não necessária para limpeza de logs espúrios duplicados
  },
)

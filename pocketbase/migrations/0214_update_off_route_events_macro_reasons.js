/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration 0214:
 * Atualiza os valores permitidos do select event_type em off_route_events
 * para incluir as ocorrências de 1 clique do entregador:
 * 'rua_bloqueada', 'area_de_risco', 'alagamento', 'retorno_mais_rapido',
 * mantendo retrocompatibilidade com 'route_deviation', 'unexpected_stop', 'blitz_transito', 'beco_a_pe'.
 */
migrate(
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('off_route_events')
      const eventTypeField = col.fields.getByName('event_type')
      if (eventTypeField) {
        eventTypeField.values = [
          'route_deviation',
          'unexpected_stop',
          'rua_bloqueada',
          'area_de_risco',
          'alagamento',
          'retorno_mais_rapido',
          'blitz_transito',
          'beco_a_pe',
        ]
        app.save(col)
        console.log('[0214] Campo event_type em off_route_events atualizado com novos motivos.')
      }
    } catch (err) {
      console.log('[0214] Erro ao atualizar event_type em off_route_events:', err)
    }
  },
  (app) => {
    try {
      const col = app.findCollectionByNameOrId('off_route_events')
      const eventTypeField = col.fields.getByName('event_type')
      if (eventTypeField) {
        eventTypeField.values = ['route_deviation', 'unexpected_stop']
        app.save(col)
      }
    } catch (_) {}
  },
)

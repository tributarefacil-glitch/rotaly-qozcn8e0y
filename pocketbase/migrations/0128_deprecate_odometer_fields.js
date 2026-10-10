/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration 0128: Deprecação de campos de odômetro no banco (preservando histórico existente).
 * Conforme decisão do usuário (ITEM 3):
 * "Remover TODO odômetro do sistema, nada de foto nem leitura manual; visões únicas = km trajeto viário e km telemetria".
 * "colunas do banco deprecadas em migração, sem apagar histórico; nenhum fluxo pede dado de odômetro".
 */
migrate(
  (app) => {
    // Registra entrada formal em audit_trail da deprecação do odômetro
    try {
      const auditCol = app.findCollectionByNameOrId('audit_trail')
      if (auditCol) {
        const auditRec = new Record(auditCol)
        auditRec.set('action', 'odometer_system_deprecated')
        auditRec.set('actor_name', 'Sistema')
        auditRec.set('user_id', '')
        auditRec.set(
          'old_value',
          'odometro_inicial,odometro_final,km_odometro,foto_odometro_inicial,foto_odometro_final',
        )
        auditRec.set('new_value', 'deprecated_v1_motor_km_real')
        auditRec.set('metadata', {
          system_trigger: true,
          reason:
            'Decisão do usuário Item 3: Remoção de todo odômetro do sistema em favor de KM viário oficial e KM telemetria snap-to-roads.',
          version: '0128',
        })
        app.save(auditRec)
      }
    } catch (e) {
      console.log('Aviso ao registrar migração 0128 em audit_trail:', e)
    }
  },
  (app) => {
    // Reversão no-op
  },
)

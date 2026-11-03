// pocketbase/hooks/app_version_guard.js
// Endpoint público para guarda de versão mínima e atualizações OTA do Rotaly APK
// Retorna a versão mínima exigida, versão mais recente, link direto do APK e metadados de telas

routerAdd('GET', '/backend/v1/app-version', (c) => {
  try {
    let minVersion = '0.0.530'
    let latestVersion = '0.0.534'
    let apkDownloadUrl =
      'https://github.com/tributarefacil-glitch/rotaly-qozcn8e0y/releases/download/apk-latest/Rotaly.apk'
    let releaseNotes =
      'Atualização obrigatória: melhorias na telemetria GPS e estabilidade em segundo plano.'
    let forceUpdate = false
    let bundleUrl = ''
    let bundleHash = ''

    // Tentar ler configurações de app_settings se configurado dinamicamente
    try {
      const records = $app.findRecordsByFilter(
        'app_settings',
        "key = 'app_version_config' || key = 'global_settings'",
        '-created',
        2,
        0,
      )
      if (records && records.length > 0) {
        for (let i = 0; i < records.length; i++) {
          const r = records[i]
          let extra = {}
          try {
            const raw = r.getString('extra')
            if (raw) extra = JSON.parse(raw)
          } catch (_) {}

          if (extra.min_app_version) minVersion = String(extra.min_app_version).trim()
          if (extra.latest_app_version) latestVersion = String(extra.latest_app_version).trim()
          if (extra.apk_download_url) apkDownloadUrl = String(extra.apk_download_url).trim()
          if (extra.release_notes) releaseNotes = String(extra.release_notes).trim()
          if (extra.bundle_url) bundleUrl = String(extra.bundle_url).trim()
          if (extra.bundle_hash) bundleHash = String(extra.bundle_hash).trim()
        }
      }
    } catch (e) {
      console.log('[app_version_guard] Aviso ao ler app_settings:', e)
    }

    return c.json(200, {
      min_version: minVersion,
      latest_version: latestVersion,
      apk_download_url: apkDownloadUrl,
      release_notes: releaseNotes,
      force_update: forceUpdate,
      server_time: new Date().toISOString(),
      ota: {
        enabled: true,
        bundle_url: bundleUrl,
        bundle_hash: bundleHash,
        target_version: latestVersion,
      },
    })
  } catch (err) {
    console.error('[app_version_guard] Erro no endpoint /backend/v1/app-version:', err)
    return c.json(500, { error: 'Erro ao consultar versão do aplicativo.' })
  }
})

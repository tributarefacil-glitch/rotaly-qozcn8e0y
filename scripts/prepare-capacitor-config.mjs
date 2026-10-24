#!/usr/bin/env node
/**
 * scripts/prepare-capacitor-config.mjs
 *
 * Gera/atualiza o capacitor.config.json a partir do capacitor.config.ts
 * ou com os valores canônicos do Rotaly, garantindo que o Capacitor CLI
 * nunca tente rodar loaders TypeScript (ts-node / jiti) em runners CI limpos.
 */

import fs from 'node:fs'
import path from 'node:path'

const canonicalConfig = {
  appId: 'br.com.rotaly.app',
  appName: 'Rotaly',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    url: 'https://www.rotaly.com.br',
    androidScheme: 'https',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#0E1738',
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
}

// 1. Tentar ler valores dinâmicos do capacitor.config.ts via regex segura
const tsPath = path.resolve('capacitor.config.ts')
if (fs.existsSync(tsPath)) {
  try {
    const tsContent = fs.readFileSync(tsPath, 'utf8')
    const appIdMatch = tsContent.match(/appId\s*:\s*['"`]([^'"`]+)['"`]/)
    const appNameMatch = tsContent.match(/appName\s*:\s*['"`]([^'"`]+)['"`]/)
    const webDirMatch = tsContent.match(/webDir\s*:\s*['"`]([^'"`]+)['"`]/)
    const serverUrlMatch = tsContent.match(/url\s*:\s*['"`]([^'"`]+)['"`]/)
    const bgColorMatch = tsContent.match(/backgroundColor\s*:\s*['"`]([^'"`]+)['"`]/)

    if (appIdMatch) canonicalConfig.appId = appIdMatch[1]
    if (appNameMatch) canonicalConfig.appName = appNameMatch[1]
    if (webDirMatch) canonicalConfig.webDir = webDirMatch[1]
    if (serverUrlMatch && canonicalConfig.server) canonicalConfig.server.url = serverUrlMatch[1]
    if (bgColorMatch && canonicalConfig.android)
      canonicalConfig.android.backgroundColor = bgColorMatch[1]
  } catch (err) {
    console.warn(
      '[prepare-capacitor-config] Aviso: Nao foi possivel parsear capacitor.config.ts, usando fallback canonico.',
      err.message,
    )
  }
}

// 2. Gravar capacitor.config.json na raiz do projeto
const rootJsonPath = path.resolve('capacitor.config.json')
fs.writeFileSync(rootJsonPath, JSON.stringify(canonicalConfig, null, 2) + '\n', 'utf8')
console.log(`[prepare-capacitor-config] SUCESSO: Gerado ${rootJsonPath}`)

// 3. Se android/app/src/main/assets existir, sincronizar tambem la dentro
const androidAssetsPath = path.resolve('android/app/src/main/assets')
if (fs.existsSync(androidAssetsPath)) {
  const assetConfigPath = path.join(androidAssetsPath, 'capacitor.config.json')
  fs.writeFileSync(assetConfigPath, JSON.stringify(canonicalConfig, null, 2) + '\n', 'utf8')
  console.log(`[prepare-capacitor-config] SUCESSO: Sincronizado ${assetConfigPath}`)
}

// 4. Se android-overlay/app/src/main/assets existir, manter espelhado
const overlayAssetsPath = path.resolve('android-overlay/app/src/main/assets')
if (fs.existsSync(overlayAssetsPath)) {
  const overlayConfigPath = path.join(overlayAssetsPath, 'capacitor.config.json')
  fs.writeFileSync(overlayConfigPath, JSON.stringify(canonicalConfig, null, 2) + '\n', 'utf8')
  console.log(`[prepare-capacitor-config] SUCESSO: Sincronizado ${overlayConfigPath}`)
}

import packageJson from '../../package.json'

/**
 * Versão real da aplicação extraída diretamente do package.json.
 * Sempre reflete a versão canônica do build empacotado.
 */
export const APP_VERSION: string = packageJson.version || '0.0.340'
export const APP_VERSION_LABEL: string = `v${APP_VERSION}`

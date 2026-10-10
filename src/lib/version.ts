// Fonte única de versão do Rotaly (alimentada em sincronia com public/version.json e package.json)
import versionData from '../../public/version.json'

export const APP_VERSION: string = (versionData?.version || '0.0.351').trim()
export const APP_VERSION_LABEL: string = APP_VERSION.startsWith('v')
  ? APP_VERSION
  : `v${APP_VERSION}`

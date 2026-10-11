// Fonte única de versão do Rotaly (alimentada em sincronia com public/version.json e package.json)
import versionData from '../../public/version.json'

export const APP_VERSION: string = (versionData?.version || '0.0.395').trim()
export const APP_VERSION_LABEL: string = APP_VERSION.startsWith('v')
  ? APP_VERSION
  : `v${APP_VERSION}`

export const APP_BUILD_DATE: string = (() => {
  const timeStr = versionData?.buildTime
  if (timeStr) {
    try {
      const d = new Date(timeStr)
      if (!isNaN(d.getTime())) {
        const yyyy = d.getUTCFullYear()
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
        const dd = String(d.getUTCDate()).padStart(2, '0')
        return `${yyyy}-${mm}-${dd}`
      }
    } catch {
      // fallback
    }
  }
  return '2026-10-11'
})()

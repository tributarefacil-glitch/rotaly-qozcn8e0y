export interface CapacitorConfig {
  appId: string
  appName: string
  webDir: string
  bundledWebRuntime?: boolean
  server?: {
    androidScheme?: string
    cleartext?: boolean
    hostname?: string
  }
  android?: {
    allowMixedContent?: boolean
    captureInput?: boolean
    webContentsDebuggingEnabled?: boolean
    backgroundColor?: string
  }
  plugins?: Record<string, any>
}

const config: CapacitorConfig = {
  appId: 'br.com.rotaly.app',
  appName: 'Rotaly',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
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

export default config

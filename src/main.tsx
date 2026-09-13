/* Main entry point for the application - renders the root React component */
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './main.css'

// Invalidação de cache legado de empresa ativa entre versões
const APP_BUILD_VERSION = '2025-05-15.01'
if (typeof window !== 'undefined') {
  try {
    const currentStoredVersion = localStorage.getItem('rotaly_app_build_version')
    if (currentStoredVersion !== APP_BUILD_VERSION) {
      localStorage.removeItem('rotaly_active_empresa_id')
      localStorage.removeItem('rotaly_active_company')
      localStorage.removeItem('rotaly_empresa_id')
      localStorage.setItem('rotaly_app_build_version', APP_BUILD_VERSION)
    }
  } catch {
    /* intentionally ignored */
  }
}

// Register Service Worker for PWA Offline Caching
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        console.log('[PWA] Service Worker registrado com sucesso no escopo:', reg.scope)
      })
      .catch((err) => {
        console.warn('[PWA] Falha ao registrar Service Worker:', err)
      })
  })
}

// @skip-protected: Do not remove. Required for React rendering.
createRoot(document.getElementById('root')!).render(<App />)

import React, { Component, ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RotateCw, Home } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

export class GlobalErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(
      '[GlobalErrorBoundary] Erro capturado na renderização:',
      error,
      errorInfo.componentStack,
    )
    this.setState({
      error,
      errorInfo,
    })
  }

  private handleReload = () => {
    window.location.reload()
  }

  private handleGoHome = () => {
    window.location.href = '/'
  }

  public render() {
    if (this.state.hasError) {
      const errorMessage = this.state.error?.message || 'Erro inesperado'
      const stack = this.state.errorInfo?.componentStack || this.state.error?.stack || ''

      return (
        <div
          className="min-h-screen w-full flex items-center justify-center p-4"
          style={{ backgroundColor: '#0A1128' }}
        >
          <div className="max-w-md w-full bg-slate-900/80 border border-slate-800 rounded-2xl p-6 sm:p-8 text-white shadow-2xl backdrop-blur-sm text-center">
            <div className="mx-auto w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-5 text-amber-400">
              <AlertTriangle className="w-7 h-7" />
            </div>

            <h1 className="text-2xl font-bold tracking-tight text-white mb-2">
              Algo saiu do trilho
            </h1>

            <p className="text-slate-400 text-sm mb-6">Tivemos um problema ao exibir esta tela.</p>

            <details className="text-left bg-slate-950/60 border border-slate-800 rounded-lg p-3 mb-6 text-xs text-slate-400 overflow-hidden">
              <summary className="cursor-pointer font-medium text-slate-300 hover:text-white transition-colors">
                Detalhes do erro
              </summary>
              <div className="mt-2 space-y-1 font-mono text-[11px] text-red-400/90 break-words max-h-48 overflow-y-auto">
                <p className="font-semibold">{errorMessage}</p>
                {stack && (
                  <pre className="text-slate-500 whitespace-pre-wrap font-mono mt-1">{stack}</pre>
                )}
              </div>
            </details>

            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                variant="outline"
                className="w-full bg-transparent border-slate-700 hover:bg-slate-800 text-white hover:text-white"
                onClick={this.handleReload}
              >
                <RotateCw className="w-4 h-4 mr-2" />
                Recarregar página
              </Button>
              <Button
                className="w-full bg-blue-600 hover:bg-blue-500 text-white"
                onClick={this.handleGoHome}
              >
                <Home className="w-4 h-4 mr-2" />
                Ir para o início
              </Button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default GlobalErrorBoundary

import React, { Component, ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface FormErrorBoundaryProps {
  children: ReactNode
  formName?: string
  onReset?: () => void
}

interface FormErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

/**
 * FormErrorBoundary: Error Boundary local para modais e formulários críticos (ex: Vendas e Clientes).
 * Impede que erros de manipulação do DOM provocados por extensões de navegador (Google Translate,
 * gerenciadores de senhas, etc.) subam até o RouteErrorBoundary da página, preservando a sessão
 * da vendedora e os dados em andamento.
 */
export class FormErrorBoundary extends Component<FormErrorBoundaryProps, FormErrorBoundaryState> {
  public state: FormErrorBoundaryState = {
    hasError: false,
    error: null,
    errorInfo: null,
  }

  public static getDerivedStateFromError(error: Error): FormErrorBoundaryState {
    return {
      hasError: true,
      error,
      errorInfo: null,
    }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(
      `[FormErrorBoundary] Erro contido no formulário [${this.props.formName || 'form'}]:`,
      error,
      errorInfo?.componentStack,
    )
    this.setState({
      error,
      errorInfo,
    })
  }

  public handleRecover = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    })
    if (this.props.onReset) {
      this.props.onReset()
    }
  }

  public render() {
    if (this.state.hasError) {
      const errorMessage =
        this.state.error?.message || 'Ocorreu um erro inesperado na interface deste formulário.'
      const isDomExtError =
        errorMessage.includes('removeChild') ||
        errorMessage.includes('insertBefore') ||
        errorMessage.includes('Node')

      return (
        <div className="p-4 sm:p-5 m-2 rounded-2xl border border-rose-300 bg-rose-50/90 text-rose-950 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-100 shadow-md">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-300 shrink-0 mt-0.5">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="flex-1 space-y-2 min-w-0">
              <h4 className="font-heading font-bold text-sm text-rose-900 dark:text-rose-100">
                Instabilidade evitada no formulário{' '}
                {this.props.formName ? `(${this.props.formName})` : ''}
              </h4>
              <p className="text-xs text-rose-800 dark:text-rose-200 leading-relaxed">
                {isDomExtError
                  ? 'Uma extensão do navegador ou tradução automática alterou o conteúdo da tela. O painel foi protegido para evitar a perda da sua venda/cadastro.'
                  : 'Ocorreu uma falha temporária de interface. Seus dados e a sessão do painel foram preservados.'}
              </p>

              <div className="rounded-lg bg-white/80 dark:bg-slate-900/80 p-2.5 border border-rose-200 dark:border-rose-900/40 font-mono text-[11px] text-rose-700 dark:text-rose-300 break-words max-h-28 overflow-y-auto">
                {errorMessage}
              </div>

              <div className="pt-2 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={this.handleRecover}
                  className="h-8 gap-1.5 text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white shadow-sm"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Restaurar Formulário
                </Button>
                <span className="text-[11px] text-rose-700 dark:text-rose-300">
                  Dica: Se estiver usando o Google Tradutor, tente desativá-lo para esta página.
                </span>
              </div>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default FormErrorBoundary

// Cores e rótulos REAIS do app do entregador (fonte: CourierApp.tsx / modais).
// Qualquer mudança de rótulo no app deve refletir aqui e no teste de regressão.
export const GUIDE_BUTTON_LABELS = {
  iniciarEntrega: 'Iniciar Entrega (GPS)',
  concluirEntrega: 'Concluir Entrega',
  confirmarEntregaModal: 'Confirmar Entrega de Pedido',
  whatsapp: 'WhatsApp',
  pontoA: 'Cliente em outro endereço (Gravar Ponto A)',
  naoAtendido: 'Não Atendido (Ausente / Recusa / Endereço)',
  foraDeOrdem: 'Entrega fora de ordem',
  voltarBaseBloqueado: 'Voltar para base: bloqueado',
  finalizeTodas: 'Finalize todas as entregas',
  finalizarManualmente: 'Finalizar Manualmente',
  entregarAgora: 'Entregar Agora',
  confirmarEntregaRedirecionada: 'Confirmar Entrega Redirecionada',
} as const

export const APK_DOWNLOAD_URL =
  'https://github.com/tributarefacil-glitch/rotaly-qozcn8e0y/releases/download/apk-latest/Rotaly.apk'

export const IPHONE_GPS_GUIDE_ROUTE = '/guia-gps-iphone'

// Cores reais usadas nos botões do CourierApp (mesmos valores hex do código)
export const GUIDE_COLORS = {
  azulIniciar: '#0052CC',
  azulIniciarGrad: 'linear-gradient(90deg, #0052CC 0%, #0066FF 100%)',
  verdeConcluir: 'linear-gradient(90deg, #10B981 0%, #059669 100%)',
  verdeModal: '#00AA44',
  laranjaPin: '#FF6B35',
  amberPontoA: '#F59E0B',
  vermelhoNaoAtendido: '#E74C3C',
  fundoEscuro: '#0E1738',
  fundoEscuro2: '#0A1128',
  bordaEscuro: '#1E2B58',
  azulClaro: '#60A5FA',
  header: '#003380',
} as const

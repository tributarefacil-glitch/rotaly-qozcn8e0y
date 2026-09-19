/**
 * Paleta estável e utilitários de cores de rota para entregadores.
 * Fornece 8 cores de alto contraste para diferenciar visualmente
 * cada entregador e suas rotas no mapa da Torre de Controle.
 */

export interface CourierColorTheme {
  id: string
  name: string
  stroke: string // Cor principal da rota
  inner: string // Tom claro de brilho interno
  returnLeg: string // Tom da perna de volta
  badgeBg: string // Background Tailwind
  badgeText: string // Texto Tailwind
  badgeBorder: string // Borda Tailwind
  dotBg: string // Background Tailwind para bolinha
}

export const COURIER_ROUTE_PALETTE: CourierColorTheme[] = [
  {
    id: 'blue',
    name: 'Azul',
    stroke: '#2563EB',
    inner: '#93C5FD',
    returnLeg: '#60A5FA',
    badgeBg: 'bg-blue-500/20',
    badgeText: 'text-blue-300',
    badgeBorder: 'border-blue-500/50',
    dotBg: 'bg-blue-500',
  },
  {
    id: 'orange',
    name: 'Laranja',
    stroke: '#EA580C',
    inner: '#FDBA74',
    returnLeg: '#FB923C',
    badgeBg: 'bg-orange-500/20',
    badgeText: 'text-orange-300',
    badgeBorder: 'border-orange-500/50',
    dotBg: 'bg-orange-500',
  },
  {
    id: 'purple',
    name: 'Roxo',
    stroke: '#7C3AED',
    inner: '#C4B5FD',
    returnLeg: '#A78BFA',
    badgeBg: 'bg-purple-500/20',
    badgeText: 'text-purple-300',
    badgeBorder: 'border-purple-500/50',
    dotBg: 'bg-purple-500',
  },
  {
    id: 'green',
    name: 'Verde',
    stroke: '#059669',
    inner: '#6EE7B7',
    returnLeg: '#34D399',
    badgeBg: 'bg-emerald-500/20',
    badgeText: 'text-emerald-300',
    badgeBorder: 'border-emerald-500/50',
    dotBg: 'bg-emerald-500',
  },
  {
    id: 'pink',
    name: 'Rosa',
    stroke: '#DB2777',
    inner: '#F9A8D4',
    returnLeg: '#F472B6',
    badgeBg: 'bg-pink-500/20',
    badgeText: 'text-pink-300',
    badgeBorder: 'border-pink-500/50',
    dotBg: 'bg-pink-500',
  },
  {
    id: 'cyan',
    name: 'Ciano',
    stroke: '#0891B2',
    inner: '#67E8F9',
    returnLeg: '#22D3EE',
    badgeBg: 'bg-cyan-500/20',
    badgeText: 'text-cyan-300',
    badgeBorder: 'border-cyan-500/50',
    dotBg: 'bg-cyan-500',
  },
  {
    id: 'amber',
    name: 'Âmbar',
    stroke: '#D97706',
    inner: '#FCD34D',
    returnLeg: '#FBBF24',
    badgeBg: 'bg-amber-500/20',
    badgeText: 'text-amber-300',
    badgeBorder: 'border-amber-500/50',
    dotBg: 'bg-amber-500',
  },
  {
    id: 'teal',
    name: 'Teal',
    stroke: '#0D9488',
    inner: '#5EEAD4',
    returnLeg: '#2DD4BF',
    badgeBg: 'bg-teal-500/20',
    badgeText: 'text-teal-300',
    badgeBorder: 'border-teal-500/50',
    dotBg: 'bg-teal-500',
  },
]

/**
 * Retorna uma cor de rota consistente para o entregador a partir de um hash estável do id.
 * O mesmo entregador receberá a mesma cor mesmo após refreshes.
 */
export function getCourierRouteColor(courierId?: string | null): CourierColorTheme {
  if (!courierId) {
    return COURIER_ROUTE_PALETTE[0]
  }

  let hash = 0
  for (let i = 0; i < courierId.length; i++) {
    hash = (hash << 5) - hash + courierId.charCodeAt(i)
    hash |= 0 // converte para inteiro 32-bit
  }

  const index = Math.abs(hash) % COURIER_ROUTE_PALETTE.length
  return COURIER_ROUTE_PALETTE[index]
}

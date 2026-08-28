import React from 'react'

interface LoghypeLogoProps {
  className?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  variant?: 'full' | 'icon' | 'badge'
  theme?: 'dark' | 'light'
  showTagline?: boolean
}

export const LoghypeLogo: React.FC<LoghypeLogoProps> = ({
  className = '',
  size = 'md',
  variant = 'full',
  theme = 'dark',
  showTagline = false,
}) => {
  const sizeMap = {
    sm: { icon: 32, text: 'text-base', tagline: 'text-[9px]', gap: 'gap-2' },
    md: { icon: 44, text: 'text-xl sm:text-2xl', tagline: 'text-[11px]', gap: 'gap-2.5' },
    lg: { icon: 60, text: 'text-3xl sm:text-4xl', tagline: 'text-xs', gap: 'gap-3.5' },
    xl: { icon: 90, text: 'text-5xl sm:text-6xl', tagline: 'text-sm', gap: 'gap-4' },
  }

  const currentSize = sizeMap[size]

  // Pure SVG reproduction of the LOGHYPE logistics route line emblem
  // Matching reference: Dark navy canvas, multi-segment route ribbon with Green (#22C55E) -> Yellow (#FBBF24) -> Orange (#F97316) -> Red (#EF4444),
  // Blue node network connections, rider on motorcycle near green/yellow start, truck delivery vehicle at top orange/red curve, and concentric bullseye end node.
  const EmblemSvg = (
    <svg
      viewBox="0 0 240 220"
      className="shrink-0 drop-shadow-md overflow-visible select-none"
      style={{ width: currentSize.icon, height: (currentSize.icon * 220) / 240 }}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* Route ribbon gradient: Green -> Yellow -> Orange -> Red */}
        <linearGradient
          id="lhRouteGrad"
          x1="20"
          y1="200"
          x2="210"
          y2="30"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#22C55E" />
          <stop offset="28%" stopColor="#84CC16" />
          <stop offset="48%" stopColor="#EAB308" />
          <stop offset="68%" stopColor="#F97316" />
          <stop offset="100%" stopColor="#EF4444" />
        </linearGradient>

        {/* Outer glow filter */}
        <filter id="lhGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>

        <linearGradient
          id="lhBlueNet"
          x1="0"
          y1="0"
          x2="240"
          y2="220"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#60A5FA" />
          <stop offset="100%" stopColor="#3B82F6" />
        </linearGradient>
      </defs>

      {/* Network background nodes & connecting blue lines */}
      <g
        stroke="#60A5FA"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.9"
      >
        {/* Connection from start node to upper left node */}
        <line x1="26" y1="185" x2="65" y2="125" />
        {/* Connection between left nodes */}
        <line x1="65" y1="125" x2="100" y2="155" />
        <line x1="65" y1="125" x2="105" y2="90" />
        {/* Network under the truck and right curve */}
        <line x1="100" y1="155" x2="140" y2="190" />
        <line x1="140" y1="190" x2="185" y2="145" />
        <line x1="185" y1="145" x2="208" y2="40" />
        <line x1="100" y1="155" x2="185" y2="145" />
        <line x1="140" y1="190" x2="100" y2="155" />
      </g>

      {/* Network Nodes (Circles with blue borders and dark center) */}
      {/* Node 1: Near mid left */}
      <circle cx="65" cy="125" r="9" fill="#0A1128" stroke="#60A5FA" strokeWidth="3.5" />
      <circle cx="65" cy="125" r="3.5" fill="#60A5FA" />

      {/* Node 2: Center lower */}
      <circle cx="100" cy="155" r="7" fill="#0A1128" stroke="#60A5FA" strokeWidth="3" />
      <circle cx="100" cy="155" r="2.5" fill="#60A5FA" />

      {/* Node 3: Bottom middle */}
      <circle cx="140" cy="190" r="8" fill="#0A1128" stroke="#60A5FA" strokeWidth="3" />
      <circle cx="140" cy="190" r="3" fill="#60A5FA" />

      {/* Node 4: Right lower */}
      <circle cx="185" cy="145" r="8.5" fill="#0A1128" stroke="#60A5FA" strokeWidth="3" />
      <circle cx="185" cy="145" r="3" fill="#60A5FA" />

      {/* Main S-Curve Logistics Route Line (Thick colored ribbon) */}
      <path
        d="M 26 185 C 30 140, 75 160, 95 130 C 115 95, 145 60, 208 40"
        stroke="url(#lhRouteGrad)"
        strokeWidth="14"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Inner Route Highlight Core */}
      <path
        d="M 26 185 C 30 140, 75 160, 95 130 C 115 95, 145 60, 208 40"
        stroke="#FFFFFF"
        strokeWidth="3.5"
        strokeLinecap="round"
        opacity="0.35"
      />

      {/* START POINT: Node Bullseye (Bottom Left) */}
      <circle cx="26" cy="185" r="14" fill="#0A1128" stroke="#60A5FA" strokeWidth="4" />
      <circle cx="26" cy="185" r="7" fill="#22C55E" />

      {/* END POINT: Node Bullseye (Top Right) */}
      <circle cx="208" cy="40" r="15" fill="#0A1128" stroke="#60A5FA" strokeWidth="4.5" />
      <circle cx="208" cy="40" r="7.5" fill="#60A5FA" />
      <circle cx="208" cy="40" r="3" fill="#FFFFFF" />

      {/* MOTORCYCLE & RIDER ICON (Moving along lower curve) */}
      <g
        transform="translate(32, 115) scale(0.9)"
        stroke="#93C5FD"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        {/* Rear & front wheels */}
        <circle cx="10" cy="28" r="6.5" fill="#0A1128" stroke="#93C5FD" strokeWidth="2.5" />
        <circle cx="34" cy="28" r="6.5" fill="#0A1128" stroke="#93C5FD" strokeWidth="2.5" />
        {/* Bike frame / engine */}
        <path d="M 10 28 L 22 26 L 34 28" />
        <path d="M 22 26 L 20 18 L 29 18 L 34 28" />
        <path d="M 20 18 L 13 22" />
        {/* Handlebars */}
        <path d="M 29 18 L 27 12" />
        {/* Rider Helmet / Head */}
        <circle cx="22" cy="7" r="4.5" fill="#93C5FD" />
        {/* Rider Body & Arms */}
        <path d="M 20 11 L 15 19 L 23 23" />
        <path d="M 17 14 L 27 13" />
      </g>

      {/* TRUCK DELIVERY VEHICLE ICON (Moving along upper route) */}
      <g
        transform="translate(100, 50) scale(1.05)"
        stroke="#93C5FD"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        {/* Cargo Box */}
        <rect
          x="5"
          y="6"
          width="34"
          height="24"
          rx="2"
          fill="#0A1128"
          stroke="#93C5FD"
          strokeWidth="2.8"
        />
        {/* Truck Cabin */}
        <path
          d="M 39 12 L 49 12 L 54 20 L 54 30 L 39 30 Z"
          fill="#0A1128"
          stroke="#93C5FD"
          strokeWidth="2.8"
        />
        {/* Cabin Window */}
        <path d="M 42 15 L 47 15 L 50 20 L 42 20 Z" fill="#93C5FD" opacity="0.6" stroke="none" />
        {/* Wheels */}
        <circle cx="15" cy="31" r="4.5" fill="#0A1128" stroke="#93C5FD" strokeWidth="2.8" />
        <circle cx="47" cy="31" r="4.5" fill="#0A1128" stroke="#93C5FD" strokeWidth="2.8" />
        {/* Cargo Detail line */}
        <line x1="9" y1="10" x2="9" y2="26" stroke="#60A5FA" strokeWidth="1.8" />
      </g>
    </svg>
  )

  if (variant === 'icon') {
    return <div className={`inline-flex items-center justify-center ${className}`}>{EmblemSvg}</div>
  }

  if (variant === 'badge') {
    return (
      <div
        className={`inline-flex items-center gap-2 rounded-xl bg-[#0A1128] border border-[#1E293B] px-3 py-1.5 shadow-md ${className}`}
      >
        {EmblemSvg}
        <span className="font-heading font-black tracking-wider text-white text-sm">LOGHYPE</span>
      </div>
    )
  }

  // Full Variant with Typography "LOGHYPE"
  return (
    <div className={`inline-flex items-center ${currentSize.gap} ${className}`}>
      {EmblemSvg}
      <div className="flex flex-col justify-center select-none">
        <span
          className={`font-heading font-black tracking-[0.08em] leading-none uppercase ${
            theme === 'dark' ? 'text-white' : 'text-[#0A1128]'
          } ${currentSize.text}`}
          style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 900 }}
        >
          LOGHYPE
        </span>
        {showTagline && (
          <span
            className={`font-sans tracking-wide uppercase font-semibold leading-tight mt-1 ${
              theme === 'dark' ? 'text-slate-300/80' : 'text-slate-600'
            } ${currentSize.tagline}`}
          >
            Gestão &amp; Rastreamento
          </span>
        )}
      </div>
    </div>
  )
}

export default LoghypeLogo

import React from 'react'
import { rotalyLogoImg } from '@/assets/logo-rotaly'

export interface RotalyLogoProps {
  className?: string
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  variant?: 'full' | 'icon' | 'badge' | 'image'
  theme?: 'dark' | 'light'
  showTagline?: boolean
}

// Stylized isolated "R" emblem of Rotaly with vehicles and chevron
export const RotalyEmblem: React.FC<{ size?: number; className?: string }> = ({
  size = 40,
  className = '',
}) => {
  return (
    <svg
      viewBox="0 0 160 160"
      width={size}
      height={size}
      className={`shrink-0 select-none overflow-visible ${className}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="rotalyGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#001845" floodOpacity="0.15" />
        </filter>
      </defs>

      <g filter="url(#rotalyGlow)">
        {/* Main "R" Navy Blue #1B3A8C */}
        {/* Vertical Spine */}
        <path d="M 28 32 L 44 32 L 44 116 L 28 116 Z" fill="#1B3A8C" />
        {/* Upper loop of R */}
        <path
          d="M 44 32 L 86 32 C 108 32 120 42 120 60 C 120 76 108 86 86 86 L 44 86 L 44 70 L 84 70 C 94 70 102 66 102 60 C 102 52 94 48 84 48 L 44 48 Z"
          fill="#1B3A8C"
        />
        {/* Diagonal Leg of R */}
        <path d="M 72 80 L 118 126 L 100 126 L 60 84 Z" fill="#1B3A8C" />

        {/* Cyan Chevron Track (#00A8E8) flowing under the R */}
        <path
          d="M 28 120 L 64 96 L 110 130"
          stroke="#00A8E8"
          strokeWidth="9"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />

        {/* Small Delivery Van / Truck on left side (#1B3A8C) */}
        <g transform="translate(18, 120) scale(0.65)">
          <path
            d="M 0 6 L 0 28 C 0 30 1 31 3 31 L 36 31 C 37 31 38 30 38 28 L 38 16 L 30 6 Z"
            fill="#1B3A8C"
          />
          <path d="M 22 10 L 28 10 L 33 17 L 22 17 Z" fill="#FFFFFF" opacity="0.9" />
          <circle cx="8" cy="31" r="5" fill="#0A1128" />
          <circle cx="8" cy="31" r="2" fill="#FFFFFF" />
          <circle cx="28" cy="31" r="5" fill="#0A1128" />
          <circle cx="28" cy="31" r="2" fill="#FFFFFF" />
        </g>

        {/* Delivery Motorcycle on right side */}
        <g transform="translate(104, 120) scale(0.65)">
          {/* Delivery Box (Cyan #00A8E8) */}
          <rect x="0" y="4" width="16" height="15" rx="2" fill="#00A8E8" />
          {/* Bike chassis */}
          <path
            d="M 10 18 L 22 18 L 30 10 L 35 10"
            stroke="#1B3A8C"
            strokeWidth="3"
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="10" cy="26" r="6" fill="#1B3A8C" stroke="#FFFFFF" strokeWidth="1" />
          <circle cx="36" cy="26" r="6" fill="#1B3A8C" stroke="#FFFFFF" strokeWidth="1" />
          <circle cx="10" cy="26" r="2.5" fill="#FFFFFF" />
          <circle cx="36" cy="26" r="2.5" fill="#FFFFFF" />
        </g>
      </g>
    </svg>
  )
}

export const RotalyLogo: React.FC<RotalyLogoProps> = ({
  className = '',
  size = 'md',
  variant = 'image',
  theme = 'dark',
  showTagline = false,
}) => {
  const sizeMap = {
    xs: { imgHeight: 'h-6', icon: 24, text: 'text-sm', tagline: 'text-[8px]', gap: 'gap-1.5' },
    sm: { imgHeight: 'h-8', icon: 32, text: 'text-base', tagline: 'text-[9px]', gap: 'gap-2' },
    md: {
      imgHeight: 'h-11 sm:h-12 md:h-13',
      icon: 46,
      text: 'text-xl sm:text-2xl',
      tagline: 'text-[11px]',
      gap: 'gap-2.5',
    },
    lg: {
      imgHeight: 'h-12 sm:h-13 md:h-[50px]',
      icon: 54,
      text: 'text-2xl sm:text-3xl',
      tagline: 'text-xs',
      gap: 'gap-3',
    },
    xl: {
      imgHeight: 'h-20 sm:h-24',
      icon: 90,
      text: 'text-5xl sm:text-6xl',
      tagline: 'text-sm',
      gap: 'gap-4',
    },
  }

  const currentSize = sizeMap[size]

  // Icon only (the official stylized "R" with vehicles & chevron)
  if (variant === 'icon') {
    return (
      <div className={`inline-flex items-center justify-center ${className}`}>
        <div className="bg-white rounded-lg p-1 shadow-sm flex items-center justify-center">
          <RotalyEmblem size={currentSize.icon} />
        </div>
      </div>
    )
  }

  // Badge variant
  if (variant === 'badge') {
    return (
      <div
        className={`inline-flex items-center gap-2 rounded-xl bg-white/95 border border-[#1E2B58] px-3 py-1.5 shadow-md ${className}`}
      >
        <RotalyEmblem size={24} />
        <span className="font-heading font-black tracking-wide text-[#1B3A8C] text-sm">Rotaly</span>
      </div>
    )
  }

  // Official uploaded image mode with clean white backdrop container for dark headers / transparent cards
  return (
    <div className={`inline-flex items-center ${currentSize.gap} ${className}`}>
      <div className="flex items-center">
        {/* Render the official user-provided image on clean rounded badge */}
        <div className="bg-white rounded-xl px-2 py-1 shadow-sm flex items-center justify-center transition-transform duration-150 hover:scale-[1.02]">
          <img
            src={rotalyLogoImg}
            alt="Rotaly — Sua rota, nossa entrega"
            className={`${currentSize.imgHeight} w-auto object-contain select-none`}
            draggable={false}
          />
        </div>

        {showTagline && (
          <span
            className={`font-sans tracking-wide font-medium leading-tight ml-2.5 ${
              theme === 'dark' ? 'text-slate-300' : 'text-slate-600'
            } ${currentSize.tagline}`}
          >
            Sua rota, nossa entrega.
          </span>
        )}
      </div>
    </div>
  )
}

// LoghypeLogo alias for backwards-compatibility during migration
export const LoghypeLogo = RotalyLogo
export default RotalyLogo

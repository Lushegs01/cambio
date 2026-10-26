import React from 'react';

export type HalftoneVariant =
  | 'grid'
  | 'sphere'
  | 'fade-right'
  | 'fade-down'
  | 'corner'
  | 'orbit'
  | 'badge';

interface HalftonePatternProps {
  variant?: HalftoneVariant;
  className?: string;
  dotColor?: string;
  opacity?: number;
}

export const HalftonePattern: React.FC<HalftonePatternProps> = ({
  variant = 'grid',
  className = '',
  dotColor,
  opacity,
}) => {
  // Common container styling with pointer-events-none so it never interferes with user interactions
  const baseClasses = `pointer-events-none select-none overflow-hidden ${className}`;
  const style = opacity !== undefined ? { opacity } : undefined;

  switch (variant) {
    case 'sphere':
      // Dense editorial halftone sphere with progressive dot scale
      return (
        <svg
          viewBox="0 0 280 280"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`${baseClasses} text-[#111111] dark:text-[#FFFFFF]`}
          style={style}
          aria-hidden="true"
        >
          <g fill={dotColor || 'currentColor'}>
            {/* High-density halftone sphere generated with progressive dot radii */}
            {Array.from({ length: 19 }).flatMap((_, row) =>
              Array.from({ length: 19 }).map((_, col) => {
                const x = 20 + col * 13;
                const y = 20 + row * 13;
                const dx = x - 130;
                const dy = y - 130;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 115) return null;

                // Modulate dot radius based on distance from focal point (offset highlight at top-left)
                const fdx = x - 90;
                const fdy = y - 90;
                const fdist = Math.sqrt(fdx * fdx + fdy * fdy);
                const norm = Math.max(0, 1 - fdist / 170);
                const radius = Math.max(0.7, norm * 4.6);

                return (
                  <circle
                    key={`sph-${row}-${col}`}
                    cx={x}
                    cy={y}
                    r={radius.toFixed(2)}
                    opacity={(0.15 + norm * 0.75).toFixed(2)}
                  />
                );
              })
            )}
          </g>
        </svg>
      );

    case 'orbit':
      // Halftone orbital wave ring
      return (
        <svg
          viewBox="0 0 320 180"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`${baseClasses} text-[#111111] dark:text-[#FFFFFF]`}
          style={style}
          aria-hidden="true"
        >
          <g fill={dotColor || 'currentColor'}>
            {Array.from({ length: 24 }).flatMap((_, col) =>
              Array.from({ length: 14 }).map((_, row) => {
                const x = 15 + col * 12.5;
                const waveY = Math.sin(col * 0.28) * 22;
                const y = 25 + row * 10 + waveY;
                const factor = Math.sin((col / 24) * Math.PI) * Math.sin((row / 14) * Math.PI);
                const r = Math.max(0.6, factor * 3.4);
                return (
                  <circle
                    key={`orb-${row}-${col}`}
                    cx={x}
                    cy={y}
                    r={r.toFixed(2)}
                    opacity={(factor * 0.65).toFixed(2)}
                  />
                );
              })
            )}
          </g>
        </svg>
      );

    case 'corner':
      // Dense triangular/corner halftone flourish
      return (
        <svg
          viewBox="0 0 160 160"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`${baseClasses} text-[#111111] dark:text-[#FFFFFF]`}
          style={style}
          aria-hidden="true"
        >
          <g fill={dotColor || 'currentColor'}>
            {Array.from({ length: 12 }).flatMap((_, row) =>
              Array.from({ length: 12 }).map((_, col) => {
                if (row + col > 15) return null;
                const x = 10 + col * 11.5;
                const y = 10 + row * 11.5;
                const factor = Math.max(0, 1 - (row + col) / 16);
                const r = Math.max(0.6, factor * 3.2);
                return (
                  <circle
                    key={`crn-${row}-${col}`}
                    cx={x}
                    cy={y}
                    r={r.toFixed(2)}
                    opacity={(factor * 0.7).toFixed(2)}
                  />
                );
              })
            )}
          </g>
        </svg>
      );

    case 'fade-right':
      // Horizontal linear dot gradation (denser on left, dissolving to right)
      return (
        <svg
          viewBox="0 0 240 80"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`${baseClasses} text-[#111111] dark:text-[#FFFFFF]`}
          style={style}
          aria-hidden="true"
        >
          <g fill={dotColor || 'currentColor'}>
            {Array.from({ length: 22 }).flatMap((_, col) =>
              Array.from({ length: 8 }).map((_, row) => {
                const x = 10 + col * 10;
                const y = 8 + row * 9;
                const decay = Math.max(0, 1 - col / 21);
                const r = Math.max(0.5, decay * 3.0);
                return (
                  <circle
                    key={`fr-${row}-${col}`}
                    cx={x}
                    cy={y}
                    r={r.toFixed(2)}
                    opacity={(decay * 0.6).toFixed(2)}
                  />
                );
              })
            )}
          </g>
        </svg>
      );

    case 'fade-down':
      // Vertical dot gradation (denser at top, dissolving down)
      return (
        <svg
          viewBox="0 0 160 120"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`${baseClasses} text-[#111111] dark:text-[#FFFFFF]`}
          style={style}
          aria-hidden="true"
        >
          <g fill={dotColor || 'currentColor'}>
            {Array.from({ length: 16 }).flatMap((_, col) =>
              Array.from({ length: 12 }).map((_, row) => {
                const x = 8 + col * 9.5;
                const y = 8 + row * 9;
                const decay = Math.max(0, 1 - row / 11);
                const r = Math.max(0.5, decay * 2.8);
                return (
                  <circle
                    key={`fd-${row}-${col}`}
                    cx={x}
                    cy={y}
                    r={r.toFixed(2)}
                    opacity={(decay * 0.55).toFixed(2)}
                  />
                );
              })
            )}
          </g>
        </svg>
      );

    case 'badge':
      // Micro halftone matrix for tags & metadata badges
      return (
        <svg
          width="18"
          height="12"
          viewBox="0 0 18 12"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`${baseClasses} text-[#111111] dark:text-[#FFFFFF] inline-block align-middle`}
          style={style}
          aria-hidden="true"
        >
          <circle cx="3" cy="3" r="1.2" fill="currentColor" opacity="0.9" />
          <circle cx="9" cy="3" r="1.0" fill="currentColor" opacity="0.6" />
          <circle cx="15" cy="3" r="0.8" fill="currentColor" opacity="0.3" />
          <circle cx="3" cy="9" r="1.4" fill="currentColor" opacity="1.0" />
          <circle cx="9" cy="9" r="1.2" fill="currentColor" opacity="0.8" />
          <circle cx="15" cy="9" r="0.9" fill="currentColor" opacity="0.4" />
        </svg>
      );

    case 'grid':
    default:
      // High-precision repeating halftone grid matrix
      return (
        <div
          className={`${baseClasses} halftone-pattern-grid`}
          style={style}
          aria-hidden="true"
        />
      );
  }
};

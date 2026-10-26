import React, { useState, useRef, useMemo } from 'react';

interface LandingHalftoneArtProps {
  className?: string;
}

export const LandingHalftoneArt: React.FC<LandingHalftoneArtProps> = ({ className = '' }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mousePos, setMousePos] = useState({ x: 0.5, y: 0.5 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setMousePos({ x, y });
  };

  // Generate a mathematically rich halftone dot matrix
  // Formed by two interfering wave sources and a central toroidal field
  const dots = useMemo(() => {
    const gridCols = 38;
    const gridRows = 38;
    const items = [];

    const cx1 = 250;
    const cy1 = 240;
    const cx2 = 330;
    const cy2 = 320;

    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const x = 30 + c * 13;
        const y = 30 + r * 13;

        // Wave equations
        const d1 = Math.sqrt((x - cx1) ** 2 + (y - cy1) ** 2);
        const d2 = Math.sqrt((x - cx2) ** 2 + (y - cy2) ** 2);
        const wave = Math.sin(d1 * 0.045) * Math.cos(d2 * 0.038);

        // Radial boundary envelope
        const distCenter = Math.sqrt((x - 275) ** 2 + (y - 275) ** 2);
        if (distCenter > 240) continue;

        // Density modulation
        const envelope = Math.max(0, 1 - distCenter / 245);
        const intensity = (wave * 0.5 + 0.5) * envelope;

        if (intensity < 0.05) continue;

        const radius = Math.max(0.6, intensity * 4.8);
        const opacity = Math.min(0.95, Math.max(0.12, intensity * 0.9 + 0.08));

        items.push({
          key: `${r}-${c}`,
          cx: x,
          cy: y,
          r: radius,
          opacity,
          highlight: intensity > 0.65,
        });
      }
    }
    return items;
  }, []);

  // Subtle interactive parallax offset
  const offsetX = isHovered ? (mousePos.x - 0.5) * 16 : 0;
  const offsetY = isHovered ? (mousePos.y - 0.5) * 16 : 0;
  const rotateX = isHovered ? (mousePos.y - 0.5) * -7 : 0;
  const rotateY = isHovered ? (mousePos.x - 0.5) * 7 : 0;

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setMousePos({ x: 0.5, y: 0.5 });
      }}
      className={`relative w-full h-full min-h-[380px] lg:min-h-[580px] flex items-center justify-center p-4 sm:p-8 select-none overflow-hidden transition-all duration-300 ${className}`}
      style={{ perspective: 1200 }}
    >
      {/* Background Subtle Coordinate Grid */}
      <div 
        className="absolute inset-0 halftone-pattern-grid opacity-30 dark:opacity-20 pointer-events-none" 
      />

      {/* Editorial Frame with Registration Marks and Metadata */}
      <div className="absolute inset-4 sm:inset-8 border border-[#E2E2E0] dark:border-[#26262B] pointer-events-none rounded-2xl flex flex-col justify-between p-4 sm:p-6 transition-colors duration-200">
        {/* Top Registration Bar */}
        <div className="flex items-center justify-between text-[9px] sm:text-[10px] font-mono tracking-widest text-[#777777] dark:text-[#A0A0A0] uppercase">
          <div className="flex items-center gap-2">
            <span className="text-[#111111] dark:text-[#FFFFFF] font-bold">+</span>
            <span>FIG. 01 / HALFTONE INTERFERENCE</span>
          </div>
          <div className="hidden sm:flex items-center gap-4">
            <span>RES: 38×38 MATRIX</span>
            <span className="w-1 h-1 rounded-full bg-[#111111] dark:bg-[#FFFFFF]" />
            <span>MEZO 31612</span>
          </div>
          <div className="flex items-center gap-2">
            <span>LAT 31.61° N</span>
            <span className="text-[#111111] dark:text-[#FFFFFF] font-bold">+</span>
          </div>
        </div>

        {/* Center Crosshairs */}
        <div className="absolute top-1/2 left-4 -translate-y-1/2 text-[10px] text-[#A0A0A0] dark:text-[#666666] font-mono select-none">
          +
        </div>
        <div className="absolute top-1/2 right-4 -translate-y-1/2 text-[10px] text-[#A0A0A0] dark:text-[#666666] font-mono select-none">
          +
        </div>

        {/* Bottom Registration Bar */}
        <div className="flex items-center justify-between text-[9px] sm:text-[10px] font-mono tracking-widest text-[#777777] dark:text-[#A0A0A0] uppercase">
          <div className="flex items-center gap-2">
            <span className="text-[#111111] dark:text-[#FFFFFF] font-bold">+</span>
            <span>MONOCHROME EDITORIAL</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 border border-current rounded-full" />
            <span>CALIBRATED 0.16–4.80 PT</span>
            <span className="text-[#111111] dark:text-[#FFFFFF] font-bold">+</span>
          </div>
        </div>
      </div>

      {/* Expressive Halftone Sculpture */}
      <div
        className="relative w-full max-w-[480px] aspect-square flex items-center justify-center transition-transform duration-200 ease-out"
        style={{
          transform: `translate3d(${offsetX}px, ${offsetY}px, 0) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`,
        }}
      >
        {/* Soft background aura (monochrome) */}
        <div className="absolute inset-8 rounded-full bg-[#F0F0EE] dark:bg-[#18181B] -z-10 blur-2xl opacity-60 dark:opacity-40" />

        <svg
          viewBox="0 0 550 550"
          className="w-full h-full text-[#111111] dark:text-[#FFFFFF] drop-shadow-xs"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="Monochrome Halftone Artwork"
        >
          <defs>
            {/* Precision clip path for circular boundary */}
            <clipPath id="halftone-lens-clip">
              <circle cx="275" cy="275" r="230" />
            </clipPath>
          </defs>

          {/* Concentric Guide Rings */}
          <g className="text-[#E2E2E0] dark:text-[#26262B]" stroke="currentColor" strokeWidth="1" strokeDasharray="3 6">
            <circle cx="275" cy="275" r="70" />
            <circle cx="275" cy="275" r="140" />
            <circle cx="275" cy="275" r="210" />
          </g>

          {/* Outer Boundary Ring */}
          <circle
            cx="275"
            cy="275"
            r="230"
            stroke="currentColor"
            strokeWidth="1.2"
            className="text-[#111111] dark:text-[#FFFFFF] opacity-20"
          />

          {/* Halftone Dots Layer */}
          <g clipPath="url(#halftone-lens-clip)">
            {dots.map((dot) => (
              <circle
                key={dot.key}
                cx={dot.cx}
                cy={dot.cy}
                r={dot.r}
                fill="currentColor"
                opacity={dot.opacity}
              />
            ))}
          </g>

          {/* Center Focal Dial */}
          <g className="text-[#111111] dark:text-[#FFFFFF]">
            <circle cx="275" cy="275" r="22" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.3" />
            <circle cx="275" cy="275" r="6" fill="currentColor" opacity="0.8" />
            <line x1="275" y1="245" x2="275" y2="255" stroke="currentColor" strokeWidth="1.5" />
            <line x1="275" y1="295" x2="275" y2="305" stroke="currentColor" strokeWidth="1.5" />
            <line x1="245" y1="275" x2="255" y2="275" stroke="currentColor" strokeWidth="1.5" />
            <line x1="295" y1="275" x2="305" y2="275" stroke="currentColor" strokeWidth="1.5" />
          </g>
        </svg>

        {/* Small Floating Technical Tag */}
        <div className="absolute -bottom-2 right-6 bg-[#FFFFFF] dark:bg-[#141416] border border-[#E2E2E0] dark:border-[#26262B] px-3 py-1.5 rounded-lg shadow-sm text-[10px] font-mono tracking-wider text-[#777777] dark:text-[#A0A0A0] flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#111111] dark:bg-[#FFFFFF] animate-pulse" />
          <span>CAMBIO / MEZO DOT MATRIX</span>
        </div>
      </div>
    </div>
  );
};

import React from 'react';

/** Decorative iridescent glass shapes drawn in SVG (no WebGL). */

export const GlassStar: React.FC<{ className?: string }> = ({ className = '' }) => {
  // Eight-point star: alternate outer/inner radii.
  const pts = Array.from({ length: 16 }, (_, i) => {
    const r = i % 2 === 0 ? 46 : 33;
    const a = (Math.PI / 8) * i - Math.PI / 2;
    return `${(50 + r * Math.cos(a)).toFixed(2)},${(50 + r * Math.sin(a)).toFixed(2)}`;
  }).join(' ');
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="gs-edge" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F6E37A" />
          <stop offset="0.3" stopColor="#F49BE0" />
          <stop offset="0.6" stopColor="#8E8CFF" />
          <stop offset="1" stopColor="#5BC8F5" />
        </linearGradient>
        <radialGradient id="gs-face" cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.95" />
          <stop offset="0.7" stopColor="#EEF2FF" stopOpacity="0.7" />
          <stop offset="1" stopColor="#DDE6FF" stopOpacity="0.5" />
        </radialGradient>
        <filter id="gs-soft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
      </defs>
      <polygon points={pts} transform="translate(3 4)" fill="url(#gs-edge)" opacity="0.55" filter="url(#gs-soft)" />
      <polygon points={pts} fill="url(#gs-face)" stroke="url(#gs-edge)" strokeWidth="3.2" strokeLinejoin="round" />
      <polygon points={pts} fill="none" stroke="#FFFFFF" strokeWidth="0.8" strokeLinejoin="round" opacity="0.9" transform="translate(50 50) scale(0.9) translate(-50 -50)" />
    </svg>
  );
};

export const GlassBubbles: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg viewBox="0 0 120 100" className={className} aria-hidden="true">
    <defs>
      <radialGradient id="gb-fill" cx="0.35" cy="0.3" r="0.75">
        <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.85" />
        <stop offset="0.65" stopColor="#E8F4FF" stopOpacity="0.25" />
        <stop offset="1" stopColor="#B9C6FF" stopOpacity="0.35" />
      </radialGradient>
      <linearGradient id="gb-edge" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#7DEBD0" />
        <stop offset="0.5" stopColor="#5BC8F5" />
        <stop offset="1" stopColor="#C68CFF" />
      </linearGradient>
    </defs>
    <ellipse cx="44" cy="44" rx="34" ry="32" fill="url(#gb-fill)" stroke="url(#gb-edge)" strokeWidth="2.2" opacity="0.9" />
    <ellipse cx="74" cy="56" rx="36" ry="34" fill="url(#gb-fill)" stroke="url(#gb-edge)" strokeWidth="2.2" opacity="0.85" />
    <path d="M24 30 Q30 18 44 16" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" opacity="0.9" />
  </svg>
);

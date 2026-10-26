import React from 'react';

interface ReceivePlaneIconProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
  size?: number | string;
}

export const ReceivePlaneIcon: React.FC<ReceivePlaneIconProps> = ({
  className = 'w-4 h-4',
  size,
  ...props
}) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      width={size || undefined}
      height={size || undefined}
      fill="none"
      stroke="currentColor"
      className={className}
      {...props}
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="14"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M 84 41 Q 91 18 105 36 L 143 109 L 215 146 Q 238 159 212 169 L 51 223 Q 25 231 34 203 Z" />
        <path d="M 143 109 L 70 183" />
      </g>
    </svg>
  );
};

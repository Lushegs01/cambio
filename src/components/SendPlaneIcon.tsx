import React from 'react';

interface SendPlaneIconProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
  size?: number | string;
}

export const SendPlaneIcon: React.FC<SendPlaneIconProps> = ({
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
      <path
        d="M 39 79 L 201 29 Q 219 24 224 39 Q 226 43 224 51 L 169 214 Q 164 231 153 219 L 110 143 L 39 105 Q 22 96 39 79 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="14"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 110 143 L 185 70"
        fill="none"
        stroke="currentColor"
        strokeWidth="14"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

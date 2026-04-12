import React from 'react';

export interface SkeletonProps {
  variant?: 'text' | 'circular' | 'rectangular';
  width?: string | number;
  height?: string | number;
  className?: string;
  lines?: number;
}

export default function Skeleton({
  variant = 'text',
  width,
  height,
  className = '',
  lines = 1
}: SkeletonProps) {
  const baseStyles = 'animate-pulse bg-[rgba(255,255,255,0.06)]';

  const variantStyles = {
    text: 'rounded h-4',
    circular: 'rounded-full',
    rectangular: 'rounded-lg'
  };

  const style: React.CSSProperties = {};
  if (width) style.width = typeof width === 'number' ? `${width}px` : width;
  if (height) style.height = typeof height === 'number' ? `${height}px` : height;

  if (variant === 'text' && lines > 1) {
    return (
      <div className={`space-y-2 ${className}`}>
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className={`${baseStyles} ${variantStyles.text}`}
            style={{ ...style, width: i === lines - 1 ? '75%' : style.width || '100%' }}
          />
        ))}
      </div>
    );
  }

  return <div className={`${baseStyles} ${variantStyles[variant]} ${className}`} style={style} />;
}

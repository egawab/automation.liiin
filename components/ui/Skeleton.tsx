import React from 'react';

interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'circle' | 'rect';
  width?: string;
  height?: string;
}

export default function Skeleton({ className = '', variant = 'rect', width, height }: SkeletonProps) {
  const baseStyles = 'bg-surface-hover animate-pulse';

  const variantStyles = {
    text: 'rounded h-4',
    circle: 'rounded-full',
    rect: 'rounded-lg',
  };

  return (
    <div
      className={`${baseStyles} ${variantStyles[variant]} ${className}`}
      style={{ width, height }}
    />
  );
}

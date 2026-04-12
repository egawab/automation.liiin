import React from 'react';

export interface NexoraLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
}

export default function NexoraLogo({ size = 'md', showText = true, className = '' }: NexoraLogoProps) {
  const sizeStyles = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-xl'
  };

  return (
    <span className={`font-semibold text-white tracking-tight ${sizeStyles[size]} ${className}`}>
      {showText ? 'Nexora' : 'N'}
    </span>
  );
}

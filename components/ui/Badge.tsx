import React from 'react';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'primary' | 'secondary';
  size?: 'sm' | 'md' | 'lg';
  dot?: boolean;
  icon?: React.ReactNode;
  className?: string;
}

export default function Badge({
  children,
  variant = 'neutral',
  size = 'md',
  dot = false,
  icon,
  className = ''
}: BadgeProps) {
  const baseStyles = 'inline-flex items-center gap-1.5 font-semibold rounded-full whitespace-nowrap';

  const variantStyles = {
    success: 'bg-[rgba(52,199,89,0.12)] text-[#34c759]',
    warning: 'bg-[rgba(255,159,10,0.12)] text-[#ff9f0a]',
    error: 'bg-[rgba(255,59,48,0.12)] text-[#ff3b30]',
    info: 'bg-[rgba(0,113,227,0.12)] text-[#0071e3]',
    neutral: 'bg-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.56)]',
    primary: 'bg-[rgba(0,113,227,0.12)] text-[#0071e3]',
    secondary: 'bg-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.48)]'
  };

  const sizeStyles = {
    sm: 'px-2 py-0.5 text-[10px]',
    md: 'px-2.5 py-0.5 text-xs',
    lg: 'px-3 py-1 text-sm'
  };

  const dotColors = {
    success: 'bg-[#34c759]',
    warning: 'bg-[#ff9f0a]',
    error: 'bg-[#ff3b30]',
    info: 'bg-[#0071e3]',
    neutral: 'bg-[rgba(255,255,255,0.32)]',
    primary: 'bg-[#0071e3]',
    secondary: 'bg-[rgba(255,255,255,0.32)]'
  };

  return (
    <span className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotColors[variant]}`} />}
      {icon && <span className="flex-shrink-0">{icon}</span>}
      {children}
    </span>
  );
}

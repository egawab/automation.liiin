import React from 'react';

export interface CardProps {
  children: React.ReactNode;
  variant?: 'default' | 'elevated' | 'glass' | 'gradient' | 'dashboard';
  accent?: 'analytics' | 'activity' | 'settings' | 'campaigns' | 'extension';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  hover?: boolean;
  className?: string;
  onClick?: () => void;
}

const accentMap: Record<string, string> = {
  analytics: 'dash-card-analytics',
  activity: 'dash-card-activity',
  settings: 'dash-card-settings',
  campaigns: 'dash-card-campaigns',
  extension: 'dash-card-extension',
};

export default function Card({
  children,
  variant = 'default',
  accent,
  padding = 'md',
  hover = false,
  className = '',
  onClick
}: CardProps) {
  const baseStyles = 'rounded-lg overflow-hidden transition-all duration-200';

  const variantStyles = {
    default: 'bg-surface',
    elevated: 'bg-surface-elevated apple-shadow',
    glass: 'glass-nav',
    gradient: 'bg-surface-hover',
    dashboard: 'dash-card',
  };

  const paddingStyles = {
    none: '',
    sm: 'p-4 md:p-5',
    md: 'p-5 md:p-7',
    lg: 'p-7 md:p-10'
  };

  const hoverStyle = hover
    ? variant === 'dashboard' ? 'dash-glow-hover' : 'hover:bg-surface-hover'
    : '';

  const accentStyle = accent ? accentMap[accent] || '' : '';

  const combinedStyles = `${baseStyles} ${variantStyles[variant]} ${paddingStyles[padding]} ${hoverStyle} ${accentStyle} ${onClick ? 'cursor-pointer' : ''} ${className}`;

  return (
    <div className={combinedStyles} onClick={onClick}>
      {children}
    </div>
  );
}

export interface CardHeaderProps { children: React.ReactNode; className?: string; }
export function CardHeader({ children, className = '' }: CardHeaderProps) {
  return <div className={`mb-5 ${className}`}>{children}</div>;
}

export interface CardTitleProps { children: React.ReactNode; className?: string; }
export function CardTitle({ children, className = '' }: CardTitleProps) {
  return <h3 className={`text-card-title text-primary ${className}`}>{children}</h3>;
}

export interface CardDescriptionProps { children: React.ReactNode; className?: string; }
export function CardDescription({ children, className = '' }: CardDescriptionProps) {
  return <p className={`text-caption text-tertiary mt-1 ${className}`}>{children}</p>;
}

export interface CardContentProps { children: React.ReactNode; className?: string; }
export function CardContent({ children, className = '' }: CardContentProps) {
  return <div className={className}>{children}</div>;
}

export interface CardFooterProps { children: React.ReactNode; className?: string; }
export function CardFooter({ children, className = '' }: CardFooterProps) {
  return <div className={`mt-5 pt-5 border-t border-subtle ${className}`}>{children}</div>;
}

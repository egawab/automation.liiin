import React from 'react';

export interface CardProps {
  children: React.ReactNode;
  variant?: 'default' | 'elevated' | 'glass' | 'gradient';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  hover?: boolean;
  className?: string;
  onClick?: () => void;
}

export default function Card({
  children,
  variant = 'default',
  padding = 'md',
  hover = false,
  className = '',
  onClick
}: CardProps) {
  const baseStyles = 'rounded-lg overflow-hidden transition-all duration-200';

  const variantStyles = {
    default: 'bg-[#272729]',
    elevated: 'bg-[#272729] apple-shadow',
    glass: 'bg-[rgba(39,39,41,0.8)] backdrop-blur-xl',
    gradient: 'bg-[#2a2a2d]'
  };

  const paddingStyles = {
    none: '',
    sm: 'p-4 md:p-5',
    md: 'p-5 md:p-7',
    lg: 'p-7 md:p-10'
  };

  const hoverStyle = hover ? 'hover:bg-[#2a2a2d]' : '';

  const combinedStyles = `${baseStyles} ${variantStyles[variant]} ${paddingStyles[padding]} ${hoverStyle} ${onClick ? 'cursor-pointer' : ''} ${className}`;

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
  return <h3 className={`text-card-title text-white ${className}`}>{children}</h3>;
}

export interface CardDescriptionProps { children: React.ReactNode; className?: string; }
export function CardDescription({ children, className = '' }: CardDescriptionProps) {
  return <p className={`text-caption text-[rgba(255,255,255,0.48)] mt-1 ${className}`}>{children}</p>;
}

export interface CardContentProps { children: React.ReactNode; className?: string; }
export function CardContent({ children, className = '' }: CardContentProps) {
  return <div className={className}>{children}</div>;
}

export interface CardFooterProps { children: React.ReactNode; className?: string; }
export function CardFooter({ children, className = '' }: CardFooterProps) {
  return <div className={`mt-5 pt-5 border-t border-white/5 ${className}`}>{children}</div>;
}

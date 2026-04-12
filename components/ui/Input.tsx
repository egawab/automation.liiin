import React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

export default function Input({
  label,
  error,
  helperText,
  leftIcon,
  rightIcon,
  fullWidth = false,
  className = '',
  id,
  ...props
}: InputProps) {
  const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;

  const baseStyles = 'px-4 py-3 bg-surface-hover border rounded-lg text-sm text-primary transition-all duration-200 focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed placeholder:text-tertiary';

  const stateStyles = error
    ? 'border-error focus:ring-error/30'
    : 'border-border-subtle focus:border-apple-blue focus:ring-apple-blue/30 hover:border-border-default';

  const iconStyles = leftIcon ? 'pl-10' : rightIcon ? 'pr-10' : '';
  const widthStyle = fullWidth ? 'w-full' : '';

  const combinedStyles = `${baseStyles} ${stateStyles} ${iconStyles} ${widthStyle} ${className}`;

  return (
    <div className={fullWidth ? 'w-full' : ''}>
      {label && (
        <label htmlFor={inputId} className="block text-micro-bold text-secondary mb-1.5">
          {label}
        </label>
      )}

      <div className="relative">
        {leftIcon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-tertiary flex items-center pointer-events-none">
            {leftIcon}
          </div>
        )}
        <input id={inputId} className={combinedStyles} {...props} />
        {rightIcon && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-tertiary flex items-center pointer-events-none">
            {rightIcon}
          </div>
        )}
      </div>

      {error && <p className="mt-1 text-micro text-error">{error}</p>}
      {!error && helperText && <p className="mt-1 text-micro text-tertiary">{helperText}</p>}
    </div>
  );
}

export interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
  fullWidth?: boolean;
  showCharCount?: boolean;
  maxLength?: number;
}

export function TextArea({
  label,
  error,
  helperText,
  fullWidth = false,
  showCharCount = false,
  maxLength,
  className = '',
  id,
  value,
  ...props
}: TextAreaProps) {
  const textareaId = id || `textarea-${Math.random().toString(36).substr(2, 9)}`;
  const currentLength = value ? value.toString().length : 0;

  const baseStyles = 'px-4 py-3 bg-surface-hover border rounded-lg text-sm text-primary transition-all duration-200 focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed placeholder:text-tertiary resize-y';

  const stateStyles = error
    ? 'border-error focus:ring-error/30'
    : 'border-border-subtle focus:border-apple-blue focus:ring-apple-blue/30 hover:border-border-default';

  const widthStyle = fullWidth ? 'w-full' : '';
  const combinedStyles = `${baseStyles} ${stateStyles} ${widthStyle} ${className}`;

  return (
    <div className={fullWidth ? 'w-full' : ''}>
      {label && (
        <label htmlFor={textareaId} className="block text-micro-bold text-secondary mb-1.5">
          {label}
        </label>
      )}
      <textarea id={textareaId} className={combinedStyles} maxLength={maxLength} value={value} {...props} />
      <div className="flex items-center justify-between mt-1">
        <div className="flex-1">
          {error && <p className="text-micro text-error">{error}</p>}
          {!error && helperText && <p className="text-micro text-tertiary">{helperText}</p>}
        </div>
        {showCharCount && maxLength && (
          <p className={`text-micro ml-2 ${currentLength > maxLength * 0.9 ? 'text-warning' : 'text-tertiary'}`}>
            {currentLength}/{maxLength}
          </p>
        )}
      </div>
    </div>
  );
}

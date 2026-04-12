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

  const baseStyles = 'px-4 py-3 bg-[#1d1d1f] border rounded-lg text-sm text-white transition-all duration-200 focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed placeholder:text-[rgba(255,255,255,0.24)]';

  const stateStyles = error
    ? 'border-[#ff3b30] focus:ring-[#ff3b30]/30'
    : 'border-[rgba(255,255,255,0.08)] focus:border-[#0071e3] focus:ring-[#0071e3]/30';

  const iconStyles = leftIcon ? 'pl-10' : rightIcon ? 'pr-10' : '';
  const widthStyle = fullWidth ? 'w-full' : '';

  const combinedStyles = `${baseStyles} ${stateStyles} ${iconStyles} ${widthStyle} ${className}`;

  return (
    <div className={fullWidth ? 'w-full' : ''}>
      {label && (
        <label htmlFor={inputId} className="block text-micro-bold text-[rgba(255,255,255,0.56)] mb-1.5">
          {label}
        </label>
      )}

      <div className="relative">
        {leftIcon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(255,255,255,0.32)] flex items-center pointer-events-none">
            {leftIcon}
          </div>
        )}
        <input id={inputId} className={combinedStyles} {...props} />
        {rightIcon && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[rgba(255,255,255,0.32)] flex items-center pointer-events-none">
            {rightIcon}
          </div>
        )}
      </div>

      {error && <p className="mt-1 text-micro text-[#ff3b30]">{error}</p>}
      {!error && helperText && <p className="mt-1 text-micro text-[rgba(255,255,255,0.32)]">{helperText}</p>}
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

  const baseStyles = 'px-4 py-3 bg-[#1d1d1f] border rounded-lg text-sm text-white transition-all duration-200 focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed placeholder:text-[rgba(255,255,255,0.24)] resize-y';

  const stateStyles = error
    ? 'border-[#ff3b30] focus:ring-[#ff3b30]/30'
    : 'border-[rgba(255,255,255,0.08)] focus:border-[#0071e3] focus:ring-[#0071e3]/30';

  const widthStyle = fullWidth ? 'w-full' : '';
  const combinedStyles = `${baseStyles} ${stateStyles} ${widthStyle} ${className}`;

  return (
    <div className={fullWidth ? 'w-full' : ''}>
      {label && (
        <label htmlFor={textareaId} className="block text-micro-bold text-[rgba(255,255,255,0.56)] mb-1.5">
          {label}
        </label>
      )}
      <textarea id={textareaId} className={combinedStyles} maxLength={maxLength} value={value} {...props} />
      <div className="flex items-center justify-between mt-1">
        <div className="flex-1">
          {error && <p className="text-micro text-[#ff3b30]">{error}</p>}
          {!error && helperText && <p className="text-micro text-[rgba(255,255,255,0.32)]">{helperText}</p>}
        </div>
        {showCharCount && maxLength && (
          <p className={`text-micro ml-2 ${currentLength > maxLength * 0.9 ? 'text-[#ff9f0a]' : 'text-[rgba(255,255,255,0.32)]'}`}>
            {currentLength}/{maxLength}
          </p>
        )}
      </div>
    </div>
  );
}

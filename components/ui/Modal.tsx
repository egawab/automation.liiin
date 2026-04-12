'use client';

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  showCloseButton?: boolean;
  closeOnBackdropClick?: boolean;
  closeOnEsc?: boolean;
}

export default function Modal({
  isOpen, onClose, children, size = 'md',
  showCloseButton = true, closeOnBackdropClick = true, closeOnEsc = true
}: ModalProps) {
  const sizeStyles = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl', full: 'max-w-full mx-4' };

  useEffect(() => {
    if (!isOpen || !closeOnEsc) return;
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, closeOnEsc, onClose]);

  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : 'unset';
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={closeOnBackdropClick ? onClose : undefined}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', duration: 0.3 }}
            className={`relative z-10 bg-surface rounded-lg apple-shadow w-full ${sizeStyles[size]} max-h-[90vh] overflow-y-auto`}
            onClick={(e) => e.stopPropagation()}
          >
            {showCloseButton && (
              <button
                onClick={onClose}
                className="absolute top-5 right-5 text-tertiary hover:text-primary transition-colors focus:outline-none focus:ring-2 focus:ring-apple-blue rounded-lg p-1"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            )}
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export interface ModalHeaderProps { children: React.ReactNode; className?: string; }
export function ModalHeader({ children, className = '' }: ModalHeaderProps) {
  return <div className={`p-6 border-b border-subtle ${className}`}>{children}</div>;
}

export interface ModalTitleProps { children: React.ReactNode; className?: string; }
export function ModalTitle({ children, className = '' }: ModalTitleProps) {
  return <h2 className={`text-card-title text-primary pr-8 ${className}`}>{children}</h2>;
}

export interface ModalDescriptionProps { children: React.ReactNode; className?: string; }
export function ModalDescription({ children, className = '' }: ModalDescriptionProps) {
  return <p className={`text-caption text-tertiary mt-1 ${className}`}>{children}</p>;
}

export interface ModalContentProps { children: React.ReactNode; className?: string; }
export function ModalContent({ children, className = '' }: ModalContentProps) {
  return <div className={`p-6 ${className}`}>{children}</div>;
}

export interface ModalFooterProps { children: React.ReactNode; className?: string; }
export function ModalFooter({ children, className = '' }: ModalFooterProps) {
  return <div className={`p-6 border-t border-subtle bg-surface-hover rounded-b-lg flex gap-3 justify-end ${className}`}>{children}</div>;
}

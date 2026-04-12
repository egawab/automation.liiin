'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Menu, X, Sun, Moon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useTheme } from '@/components/theme-provider';

export default function Navigation() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = isMobileMenuOpen ? 'hidden' : 'unset';
    return () => { document.body.style.overflow = 'unset'; };
  }, [isMobileMenuOpen]);

  return (
    <>
      {/* Apple Glass Navigation — 48px, translucent + blur */}
      <motion.nav
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        className={`fixed top-0 left-0 right-0 z-50 h-12 glass-nav transition-all duration-200 ${
          isScrolled ? 'border-b border-border-subtle' : ''
        }`}
      >
        <div className="max-w-[980px] mx-auto px-4 sm:px-6 h-full">
          <div className="flex items-center justify-between h-full">
            {/* Logo */}
            <Link href="/" className="text-primary text-sm font-semibold tracking-tight hover:opacity-80 transition-opacity">
              Nexora
            </Link>

            {/* Desktop Nav Links */}
            <div className="hidden md:flex items-center gap-6">
              {[
                { href: '#features', label: 'Features' },
                { href: '#pricing', label: 'Pricing' },
              ].map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="text-xs font-normal text-secondary hover:text-primary transition-colors"
                >
                  {link.label}
                </a>
              ))}
            </div>

            {/* Desktop CTA + Theme Toggle */}
            <div className="hidden md:flex items-center gap-4">
              {/* Theme Toggle */}
              <button
                onClick={toggleTheme}
                className="p-1.5 rounded-full bg-surface-hover hover:bg-surface-elevated transition-premium text-secondary hover:text-primary"
                aria-label="Toggle theme"
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              <Link
                href="/login"
                className="text-xs font-normal text-secondary hover:text-primary transition-colors"
              >
                Sign In
              </Link>
              <Link href="/login?mode=register">
                <button className="btn-apple-primary text-xs px-4 py-1.5">
                  Get Started
                </button>
              </Link>
            </div>

            {/* Mobile: Theme + Menu */}
            <div className="flex md:hidden items-center gap-2">
              <button
                onClick={toggleTheme}
                className="p-1.5 rounded-full bg-surface-hover text-secondary"
                aria-label="Toggle theme"
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="p-1 text-secondary hover:text-primary transition-colors"
                aria-label="Toggle mobile menu"
              >
                {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
      </motion.nav>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 md:hidden bg-page/60 backdrop-blur-sm"
              onClick={() => setIsMobileMenuOpen(false)}
            />
            <motion.div
              initial={{ y: '-100%' }}
              animate={{ y: 0 }}
              exit={{ y: '-100%' }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed top-12 left-0 right-0 z-50 md:hidden glass-nav border-b border-border-subtle"
            >
              <div className="max-w-[980px] mx-auto px-6 py-4 space-y-1">
                {[
                  { href: '#features', label: 'Features' },
                  { href: '#pricing', label: 'Pricing' },
                ].map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="block py-3 text-sm font-normal text-secondary hover:text-primary transition-colors border-b border-border-subtle"
                  >
                    {link.label}
                  </a>
                ))}
                <Link
                  href="/login"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="block py-3 text-sm font-normal text-secondary hover:text-primary transition-colors border-b border-border-subtle"
                >
                  Sign In
                </Link>
                <div className="pt-3">
                  <Link href="/login?mode=register" onClick={() => setIsMobileMenuOpen(false)}>
                    <button className="w-full py-3 btn-apple-primary text-sm rounded-lg">
                      Get Started
                    </button>
                  </Link>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

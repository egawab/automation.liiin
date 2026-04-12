'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function Navigation() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

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
      {/* Apple Glass Navigation — 48px, translucent dark + blur */}
      <motion.nav
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        className={`fixed top-0 left-0 right-0 z-50 h-12 glass-nav transition-all duration-200 ${
          isScrolled ? 'border-b border-white/10' : ''
        }`}
      >
        <div className="max-w-[980px] mx-auto px-4 sm:px-6 h-full">
          <div className="flex items-center justify-between h-full">
            {/* Logo — Clean white wordmark */}
            <Link href="/" className="text-white text-sm font-semibold tracking-tight hover:opacity-80 transition-opacity">
              Nexora
            </Link>

            {/* Desktop Nav Links — 12px, weight 400, white */}
            <div className="hidden md:flex items-center gap-6">
              {[
                { href: '#features', label: 'Features' },
                { href: '#pricing', label: 'Pricing' },
              ].map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="text-xs font-normal text-white/80 hover:text-white transition-colors"
                >
                  {link.label}
                </a>
              ))}
            </div>

            {/* Desktop CTA */}
            <div className="hidden md:flex items-center gap-5">
              <Link
                href="/login"
                className="text-xs font-normal text-white/80 hover:text-white transition-colors"
              >
                Sign In
              </Link>
              <Link href="/login?mode=register">
                <button className="px-4 py-1.5 bg-[#0071e3] hover:bg-[#0077ed] text-white text-xs font-normal rounded-full transition-colors">
                  Get Started
                </button>
              </Link>
            </div>

            {/* Mobile Menu Button */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden p-1 text-white/80 hover:text-white transition-colors"
              aria-label="Toggle mobile menu"
            >
              {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
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
              className="fixed inset-0 z-40 md:hidden bg-black/60 backdrop-blur-sm"
              onClick={() => setIsMobileMenuOpen(false)}
            />
            <motion.div
              initial={{ y: '-100%' }}
              animate={{ y: 0 }}
              exit={{ y: '-100%' }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed top-12 left-0 right-0 z-50 md:hidden glass-nav border-b border-white/10"
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
                    className="block py-3 text-sm font-normal text-white/80 hover:text-white transition-colors border-b border-white/5"
                  >
                    {link.label}
                  </a>
                ))}
                <Link
                  href="/login"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="block py-3 text-sm font-normal text-white/80 hover:text-white transition-colors border-b border-white/5"
                >
                  Sign In
                </Link>
                <div className="pt-3">
                  <Link href="/login?mode=register" onClick={() => setIsMobileMenuOpen(false)}>
                    <button className="w-full py-3 bg-[#0071e3] hover:bg-[#0077ed] text-white text-sm font-normal rounded-lg transition-colors">
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

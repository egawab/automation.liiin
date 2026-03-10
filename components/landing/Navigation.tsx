'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import NexoraLogo from '@/components/ui/NexoraLogo';

export default function Navigation() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Handle scroll effect
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isMobileMenuOpen]);

  return (
    <>
      {/* Clean Light Navigation */}
      <motion.nav
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-200 ${
          isScrolled 
            ? 'bg-gray-900/95 backdrop-blur-xl border-b border-gray-800' 
            : 'bg-gray-900/80 backdrop-blur-sm border-b border-gray-800'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-20">
            {/* Refined Logo */}
            <Link href="/" className="group">
              <NexoraLogo size="md" showText={true} />
            </Link>

            {/* Refined Desktop Navigation Links */}
            <div className="hidden md:flex items-center gap-1">
              {[
                { href: '#features', label: 'Features' },
                { href: '#how-it-works', label: 'How It Works' },
                { href: '#pricing', label: 'Pricing' },
              ].map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white transition-colors"
                >
                  {link.label}
                </a>
              ))}
            </div>

            {/* Clean Desktop CTA */}
            <div className="hidden md:flex items-center gap-4">
              <Link
                href="/login"
                className="text-sm font-medium text-gray-300 hover:text-white transition-colors"
              >
                Sign In
              </Link>
              <Link href="/login?mode=register">
                <button className="px-6 py-2.5 bg-white hover:bg-gray-100 text-gray-900 font-semibold rounded-xl transition-colors duration-200">
                  Get Started
                </button>
              </Link>
            </div>

            {/* Mobile Menu Button with Animation */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden relative p-2 text-gray-300 hover:text-white transition-colors focus:outline-none"
              aria-label="Toggle mobile menu"
            >
              {isMobileMenuOpen ? (
                <X className="w-6 h-6" />
              ) : (
                <Menu className="w-6 h-6" />
              )}
            </button>
          </div>
        </div>
      </motion.nav>

      {/* Refined Mobile Menu */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 md:hidden bg-black/40 backdrop-blur-sm"
              onClick={() => setIsMobileMenuOpen(false)}
            />

            {/* Menu Panel */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed top-20 right-0 bottom-0 z-50 w-80 md:hidden bg-gray-900 border-l border-gray-800 shadow-2xl overflow-y-auto"
            >
              <div className="p-6 space-y-2">
                {/* Navigation Links */}
                {[
                  { href: '#features', label: 'Features' },
                  { href: '#how-it-works', label: 'How It Works' },
                  { href: '#pricing', label: 'Pricing' },
                ].map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="block py-3 px-4 text-base font-medium text-gray-300 hover:bg-gray-800 hover:text-white rounded-xl transition-colors"
                  >
                    {link.label}
                  </a>
                ))}

                {/* Divider */}
                <div className="h-px bg-gray-800 my-4" />

                {/* Sign In Link */}
                <Link
                  href="/login"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="block py-3 px-4 text-base font-medium text-gray-300 hover:bg-gray-800 hover:text-white rounded-xl transition-colors"
                >
                  Sign In
                </Link>

                {/* Get Started Button - Clean Design */}
                <div className="pt-4">
                  <Link href="/login?mode=register" onClick={() => setIsMobileMenuOpen(false)}>
                    <button className="w-full px-6 py-4 bg-white hover:bg-gray-100 text-gray-900 font-semibold rounded-xl transition-colors">
                      Get Started
                    </button>
                  </Link>
                </div>

                {/* Bottom Info */}
                <div className="pt-8 text-center">
                  <p className="text-xs text-gray-400">
                    Join 1,000+ professionals growing on LinkedIn
                  </p>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

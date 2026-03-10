import React from 'react';
import Link from 'next/link';
import { Twitter, Linkedin, Github, Mail } from 'lucide-react';
import NexoraLogo from '@/components/ui/NexoraLogo';

export default function Footer() {
  return (
    <footer className="border-t border-gray-800 bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 py-12">
        {/* Main Footer Content */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
          {/* Brand Column */}
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="inline-block mb-4 group">
              <NexoraLogo size="md" showText={true} />
            </Link>
            <p className="text-sm text-gray-400 mb-6 max-w-xs">
              Your AI LinkedIn Presence. Elevate your professional brand with intelligent automation.
            </p>
            
            {/* Social Links */}
            <div className="flex items-center gap-3">
              <a
                href="https://twitter.com"
                target="_blank"
                rel="noopener noreferrer"
                className="w-9 h-9 rounded-lg bg-gray-800 hover:bg-gray-700 flex items-center justify-center text-gray-400 hover:text-primary-400 transition-all"
                aria-label="Twitter"
              >
                <Twitter className="w-4 h-4" />
              </a>
              <a
                href="https://linkedin.com"
                target="_blank"
                rel="noopener noreferrer"
                className="w-9 h-9 rounded-lg bg-gray-800 hover:bg-gray-700 flex items-center justify-center text-gray-400 hover:text-primary-400 transition-all"
                aria-label="LinkedIn"
              >
                <Linkedin className="w-4 h-4" />
              </a>
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                className="w-9 h-9 rounded-lg bg-gray-800 hover:bg-gray-700 flex items-center justify-center text-gray-400 hover:text-primary-400 transition-all"
                aria-label="GitHub"
              >
                <Github className="w-4 h-4" />
              </a>
              <a
                href="mailto:hello@linqin.ai"
                className="w-9 h-9 rounded-lg bg-gray-800 hover:bg-gray-700 flex items-center justify-center text-gray-400 hover:text-primary-400 transition-all"
                aria-label="Email"
              >
                <Mail className="w-4 h-4" />
              </a>
            </div>
          </div>

          {/* Product Column */}
          <div>
            <h3 className="text-xs font-bold text-white uppercase tracking-wide mb-4">
              Product
            </h3>
            <ul className="space-y-3">
              <li>
                <a href="#features" className="text-sm text-gray-400 hover:text-white transition-colors">
                  Features
                </a>
              </li>
              <li>
                <a href="#pricing" className="text-sm text-gray-400 hover:text-white transition-colors">
                  Pricing
                </a>
              </li>
              <li>
                <a href="#how-it-works" className="text-sm text-gray-400 hover:text-white transition-colors">
                  How It Works
                </a>
              </li>
              <li>
                <Link href="/login?mode=register" className="text-sm text-gray-400 hover:text-white transition-colors">
                  Get Started
                </Link>
              </li>
            </ul>
          </div>

          {/* Company Column */}
          <div>
            <h3 className="text-xs font-bold text-white uppercase tracking-wide mb-4">
              Company
            </h3>
            <ul className="space-y-3">
              <li>
                <a href="#about" className="text-sm text-gray-400 hover:text-white transition-colors">
                  About Us
                </a>
              </li>
              <li>
                <a href="#blog" className="text-sm text-gray-400 hover:text-white transition-colors">
                  Blog
                </a>
              </li>
              <li>
                <a href="#careers" className="text-sm text-gray-400 hover:text-white transition-colors">
                  Careers
                </a>
              </li>
              <li>
                <a href="#contact" className="text-sm text-gray-400 hover:text-white transition-colors">
                  Contact
                </a>
              </li>
            </ul>
          </div>

          {/* Legal Column */}
          <div>
            <h3 className="text-xs font-bold text-white uppercase tracking-wide mb-4">
              Legal
            </h3>
            <ul className="space-y-3">
              <li>
                <a href="#privacy" className="text-sm text-gray-400 hover:text-white transition-colors">
                  Privacy Policy
                </a>
              </li>
              <li>
                <a href="#terms" className="text-sm text-gray-400 hover:text-white transition-colors">
                  Terms of Service
                </a>
              </li>
              <li>
                <a href="#cookies" className="text-sm text-gray-400 hover:text-white transition-colors">
                  Cookie Policy
                </a>
              </li>
              <li>
                <a href="#security" className="text-sm text-gray-400 hover:text-white transition-colors">
                  Security
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="pt-8 border-t border-gray-800">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-sm text-gray-500">
              © {new Date().getFullYear()} Nexora. All rights reserved.
            </p>
            <div className="flex items-center gap-6">
              <a href="#privacy" className="text-xs text-gray-500 hover:text-white transition-colors">
                Privacy
              </a>
              <a href="#terms" className="text-xs text-gray-500 hover:text-white transition-colors">
                Terms
              </a>
              <a href="#cookies" className="text-xs text-gray-500 hover:text-white transition-colors">
                Cookies
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

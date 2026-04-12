import React from 'react';
import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="bg-page border-t border-border-subtle">
      <div className="max-w-[980px] mx-auto px-4 py-8">
        {/* Footer Links Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
          {/* Product */}
          <div>
            <h3 className="text-micro-bold text-primary mb-3">Product</h3>
            <ul className="space-y-2">
              {['Features', 'Pricing', 'How It Works'].map((item) => (
                <li key={item}>
                  <a href={`#${item.toLowerCase().replace(/ /g, '-')}`} className="text-micro text-secondary hover:text-apple-blue transition-colors">
                    {item}
                  </a>
                </li>
              ))}
              <li>
                <Link href="/login?mode=register" className="text-micro text-secondary hover:text-apple-blue transition-colors">
                  Get Started
                </Link>
              </li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <h3 className="text-micro-bold text-primary mb-3">Company</h3>
            <ul className="space-y-2">
              {['About Us', 'Blog', 'Careers', 'Contact'].map((item) => (
                <li key={item}>
                  <a href="#" className="text-micro text-secondary hover:text-apple-blue transition-colors">
                    {item}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h3 className="text-micro-bold text-primary mb-3">Legal</h3>
            <ul className="space-y-2">
              {['Privacy Policy', 'Terms of Service', 'Cookie Policy', 'Security'].map((item) => (
                <li key={item}>
                  <a href="#" className="text-micro text-secondary hover:text-apple-blue transition-colors">
                    {item}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Brand */}
          <div>
            <Link href="/" className="text-caption-bold text-primary hover:opacity-70 transition-opacity">
              Nexora
            </Link>
            <p className="text-micro text-tertiary mt-2">
              Your AI LinkedIn Presence. Elevate your professional brand with intelligent automation.
            </p>
          </div>
        </div>

        {/* Bottom Bar — Apple micro text */}
        <div className="pt-4 border-t border-border-subtle">
          <div className="flex flex-col md:flex-row justify-between items-center gap-3">
            <p className="text-micro text-tertiary">
              Copyright © {new Date().getFullYear()} Nexora. All rights reserved.
            </p>
            <div className="flex items-center gap-4">
              {['Privacy', 'Terms', 'Cookies'].map((item, i) => (
                <a key={i} href="#" className="text-micro text-tertiary hover:text-apple-blue transition-colors">
                  {item}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

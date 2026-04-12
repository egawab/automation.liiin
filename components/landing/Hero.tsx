'use client';

import React from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';

export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-center bg-hero overflow-hidden">
      <div className="max-w-[980px] mx-auto px-4 sm:px-6 py-32 w-full">
        <div className="text-center">
          {/* Display Hero — 56px, weight 600, line-height 1.07 */}
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="text-display-hero text-primary mb-4"
          >
            Automate Your LinkedIn
            <br />
            <span className="text-secondary">Growth on Autopilot.</span>
          </motion.h1>

          {/* Subtitle — 21px, weight 400 */}
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="text-xl text-secondary mb-10 max-w-2xl mx-auto"
            style={{ fontWeight: 400, lineHeight: 1.19, letterSpacing: '0.231px' }}
          >
            Professional AI-powered engagement that builds your presence, generates leads,
            and grows your network — while you focus on what matters.
          </motion.p>

          {/* Two Apple Pill CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="flex items-center justify-center gap-4 mb-16"
          >
            <Link href="/login?mode=register">
              <button className="btn-apple-primary text-base px-6 py-3 press-effect">
                Get Started
              </button>
            </Link>
            <a href="#features">
              <button className="btn-apple-pill-dark px-6 py-3 press-effect">
                Learn more
              </button>
            </a>
          </motion.div>

          {/* Trust Badges — 14px, tertiary text */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className="flex flex-wrap justify-center gap-8 text-caption text-tertiary mb-20"
          >
            {['No credit card required', 'Setup in 2 minutes', 'Cancel anytime'].map((text, i) => (
              <span key={i}>{text}</span>
            ))}
          </motion.div>

          {/* Stats — Clean, no borders */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="pt-12 border-t border-border-subtle"
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-10">
              {[
                { value: '10K+', label: 'Comments Posted' },
                { value: '500+', label: 'Active Users' },
                { value: '2M+', label: 'Reach Generated' },
                { value: '99.9%', label: 'Uptime' },
              ].map((stat, idx) => (
                <div key={idx} className="text-center">
                  <div className="text-section-heading text-primary mb-1">{stat.value}</div>
                  <div className="text-caption text-tertiary">{stat.label}</div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

'use client';

import React from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';

export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-center bg-black overflow-hidden">
      <div className="max-w-[980px] mx-auto px-4 sm:px-6 py-32 w-full">
        <div className="text-center">
          {/* Display Hero — 56px, weight 600, line-height 1.07 */}
          <motion.h1
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6 }}
            className="text-display-hero text-white mb-4"
          >
            Automate Your LinkedIn
            <br />
            <span className="text-[rgba(255,255,255,0.48)]">Growth on Autopilot.</span>
          </motion.h1>

          {/* Subtitle — 21px, weight 400 */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-xl text-[rgba(255,255,255,0.8)] mb-10 max-w-2xl mx-auto"
            style={{ fontWeight: 400, lineHeight: 1.19, letterSpacing: '0.231px' }}
          >
            Professional AI-powered engagement that builds your presence, generates leads,
            and grows your network — while you focus on what matters.
          </motion.p>

          {/* Two Apple Pill CTAs */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="flex items-center justify-center gap-4 mb-16"
          >
            <Link href="/login?mode=register">
              <button className="btn-apple-primary text-base px-6 py-3 rounded-[980px]">
                Get Started
              </button>
            </Link>
            <a href="#features">
              <button className="btn-apple-pill-dark px-6 py-3">
                Learn more
              </button>
            </a>
          </motion.div>

          {/* Trust Badges — 14px, tertiary text */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="flex flex-wrap justify-center gap-8 text-caption text-[rgba(255,255,255,0.48)] mb-20"
          >
            {['No credit card required', 'Setup in 2 minutes', 'Cancel anytime'].map((text, i) => (
              <span key={i}>{text}</span>
            ))}
          </motion.div>

          {/* Stats — Clean white on black, no borders */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="pt-12 border-t border-white/10"
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-10">
              {[
                { value: '10K+', label: 'Comments Posted' },
                { value: '500+', label: 'Active Users' },
                { value: '2M+', label: 'Reach Generated' },
                { value: '99.9%', label: 'Uptime' },
              ].map((stat, idx) => (
                <div key={idx} className="text-center">
                  <div className="text-section-heading text-white mb-1">{stat.value}</div>
                  <div className="text-caption text-[rgba(255,255,255,0.48)]">{stat.label}</div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

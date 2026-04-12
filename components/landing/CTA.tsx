'use client';

import React from 'react';
import { motion } from 'motion/react';
import Link from 'next/link';

export default function CTA() {
  return (
    <section className="py-24 px-4 bg-section-alt">
      <div className="max-w-[980px] mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="text-center"
        >
          <h2 className="text-display-hero text-primary mb-4">
            Ready to grow?
          </h2>
          <p className="text-xl text-secondary mb-10 max-w-xl mx-auto" style={{ fontWeight: 400, lineHeight: 1.19 }}>
            Join thousands of professionals automating their LinkedIn presence. Start your 14-day free trial today.
          </p>

          {/* Apple Pill CTAs */}
          <div className="flex items-center justify-center gap-4 mb-12">
            <Link href="/login?mode=register">
              <button className="btn-apple-primary text-base px-6 py-3 press-effect">
                Start Free Trial
              </button>
            </Link>
            <button className="btn-apple-pill-dark px-6 py-3 press-effect">
              Schedule Demo
            </button>
          </div>

          {/* Trust */}
          <div className="flex flex-wrap justify-center gap-8 text-caption text-tertiary">
            <span>No credit card required</span>
            <span className="text-border-subtle">·</span>
            <span>14-day free trial</span>
            <span className="text-border-subtle">·</span>
            <span>Cancel anytime</span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

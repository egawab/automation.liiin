'use client';

import React from 'react';
import { motion } from 'motion/react';
import { Check, Star } from 'lucide-react';
import Link from 'next/link';

export default function Pricing() {
  return (
    <section id="pricing" className="py-24 px-4 bg-page">
      <div className="max-w-5xl mx-auto">
        {/* Section Header */}
        <motion.div
           initial={{ opacity: 0, y: 8 }}
           whileInView={{ opacity: 1, y: 0 }}
           viewport={{ once: true }}
           transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
           className="text-center mb-16"
        >
          <h2 className="text-section-heading text-primary mb-4">
            Simple, Transparent Value.
          </h2>
          <p className="text-body text-secondary max-w-xl mx-auto">
            Experience the power of Nexora with zero risk, then upgrade to lock in your automation pipeline for the entire year.
          </p>
        </motion.div>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {/* Free Trial Card */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="flex flex-col rounded-3xl p-8 bg-surface border border-border-subtle hover-lift transition-premium h-full"
          >
            <div className="mb-6">
              <h3 className="text-2xl font-bold text-primary mb-2">30-Day Free Trial</h3>
              <p className="text-sm text-tertiary h-10">
                Experience full automation completely free. No credit card required.
              </p>
            </div>

            <div className="mb-8">
              <div className="flex items-baseline gap-1">
                <span className="text-5xl font-extrabold tracking-tight text-primary">$0</span>
                <span className="text-secondary font-medium">/ first month</span>
              </div>
            </div>

            <Link href="/login?mode=register" className="w-full mb-8">
              <button className="w-full py-3.5 rounded-2xl bg-surface-elevated hover:bg-surface-hover border border-border-default text-primary font-semibold transition-colors press-effect">
                Start Free Trial
              </button>
            </Link>

            <div className="space-y-4 flex-1">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-secondary mb-4">What's included in Trial</h4>
              {[
                'Full access to AI Engine',
                'Up to 10 automated comments/day',
                'Basic Hunter Mode',
                'Saved posts library',
                'Standard Email Support',
                'Easy 1-click extension setup'
              ].map((feature, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="mt-1 w-5 h-5 rounded-full bg-apple-blue/10 flex items-center justify-center flex-shrink-0">
                    <Check className="w-3 h-3 text-apple-blue" />
                  </div>
                  <span className="text-sm font-medium text-secondary">{feature}</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Yearly Pro Card */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="relative flex flex-col rounded-3xl p-8 bg-surface apple-shadow-lg ring-1 ring-apple-blue border border-apple-blue/20 hover-lift transition-premium h-full"
          >
            <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
              <div className="bg-apple-blue text-white text-xs font-bold px-4 py-1.5 rounded-full shadow-md flex items-center gap-1.5">
                <Star className="w-3.5 h-3.5 fill-current" /> Most Popular
              </div>
            </div>

            <div className="mb-6">
              <h3 className="text-2xl font-bold text-primary mb-2 text-transparent bg-clip-text bg-gradient-to-r from-apple-blue to-purple-500">Yearly Pro Plan</h3>
              <p className="text-sm text-tertiary h-10">
                Unrestricted access for serious professionals looking to scale their network.
              </p>
            </div>

            <div className="mb-8">
              <div className="flex items-baseline gap-1">
                <span className="text-5xl font-extrabold tracking-tight text-primary">$150</span>
                <span className="text-secondary font-medium">/ year</span>
              </div>
              <p className="text-xs text-apple-blue font-medium mt-2">Just $12.50 per month</p>
            </div>

            <Link href="/login?mode=register" className="w-full mb-8">
              <button className="w-full py-3.5 rounded-2xl bg-apple-blue hover:opacity-90 text-white font-semibold transition-all press-effect shadow-md shadow-apple-blue/20">
                Upgrade to Pro
              </button>
            </Link>

            <div className="space-y-4 flex-1">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-apple-blue mb-4">Everything in Trial, plus</h4>
              {[
                'Unlimited active campaigns',
                'Unlimited automated comments',
                'Advanced A.I. Persona customization',
                'Priority 24/7 Support',
                'Priority feature updates',
                'White-glove onboarding assistance'
              ].map((feature, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="mt-1 w-5 h-5 rounded-full bg-apple-blue text-white flex items-center justify-center flex-shrink-0">
                    <Check className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-sm font-medium text-primary">{feature}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

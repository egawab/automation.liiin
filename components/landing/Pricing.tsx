'use client';

import React from 'react';
import { motion } from 'motion/react';
import { Check } from 'lucide-react';
import Link from 'next/link';

const plans = [
  {
    name: 'Starter',
    price: '29',
    period: '/month',
    description: 'Perfect for professionals starting their LinkedIn journey.',
    features: [
      '50 comments per day',
      '2 keyword searches',
      'Basic analytics',
      'Email support',
      'Auto-engagement',
    ],
    popular: false,
    cta: 'Start Free Trial'
  },
  {
    name: 'Professional',
    price: '79',
    period: '/month',
    description: 'For serious professionals scaling their presence.',
    features: [
      '200 comments per day',
      'Unlimited keyword searches',
      'Advanced analytics & insights',
      'Priority support',
      'Custom comment templates',
      'Lead tracking',
      'Performance reports',
    ],
    popular: true,
    cta: 'Start Free Trial'
  },
  {
    name: 'Enterprise',
    price: '199',
    period: '/month',
    description: 'Maximum power for teams and agencies.',
    features: [
      'Unlimited comments',
      'Unlimited keywords',
      'White-label reports',
      'Dedicated account manager',
      'API access',
      'Custom integrations',
      'Team collaboration',
      'SLA guarantee',
    ],
    popular: false,
    cta: 'Contact Sales'
  }
];

export default function Pricing() {
  return (
    <section id="pricing" className="py-24 px-4 bg-page">
      <div className="max-w-[980px] mx-auto">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="text-center mb-16"
        >
          <h2 className="text-section-heading text-primary mb-4">
            Simple, transparent pricing.
          </h2>
          <p className="text-body text-secondary max-w-xl mx-auto">
            Choose the plan that fits your growth goals. All plans include a 14-day free trial.
          </p>
        </motion.div>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-3 gap-5">
          {plans.map((plan, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.08, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="relative"
            >
              {/* Popular Badge */}
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 z-10">
                  <div className="bg-apple-blue text-white text-micro-bold px-4 py-1 rounded-full">
                    Most Popular
                  </div>
                </div>
              )}

              <div className={`h-full rounded-xl p-7 border transition-premium hover-lift ${
                plan.popular
                  ? 'bg-surface apple-shadow-lg ring-2 ring-apple-blue border-apple-blue/20'
                  : 'bg-surface border-border-subtle'
              }`}>
                {/* Plan Name */}
                <h3 className="text-card-title text-primary mb-1">{plan.name}</h3>
                <p className="text-caption text-tertiary mb-5">{plan.description}</p>

                {/* Price */}
                <div className="mb-6">
                  <span className="text-section-heading text-primary">${plan.price}</span>
                  <span className="text-caption text-tertiary">{plan.period}</span>
                </div>

                {/* CTA */}
                <Link href="/login?mode=register" className="block mb-6">
                  <button className={`w-full py-3 rounded-[980px] text-body-emphasis transition-premium press-effect ${
                    plan.popular
                      ? 'bg-apple-blue hover:opacity-90 text-white'
                      : 'bg-surface-elevated hover:bg-surface-hover text-primary border border-border-default'
                  }`}>
                    {plan.cta}
                  </button>
                </Link>

                {/* Features */}
                <ul className="space-y-3">
                  {plan.features.map((feature, idx) => (
                    <li key={idx} className="flex items-start gap-2.5">
                      <Check className="w-4 h-4 text-apple-blue flex-shrink-0 mt-0.5" />
                      <span className="text-caption text-primary">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Guarantee */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mt-12 text-center"
        >
          <p className="text-caption text-tertiary">
            <span className="text-caption-bold text-primary">30-day money-back guarantee.</span> No questions asked.
          </p>
        </motion.div>
      </div>
    </section>
  );
}

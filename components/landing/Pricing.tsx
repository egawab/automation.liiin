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
    <section id="pricing" className="py-24 px-4 bg-[#f5f5f7]">
      <div className="max-w-[980px] mx-auto">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <h2 className="text-section-heading text-[#1d1d1f] mb-4">
            Simple, transparent pricing.
          </h2>
          <p className="text-body text-[rgba(0,0,0,0.56)] max-w-xl mx-auto">
            Choose the plan that fits your growth goals. All plans include a 14-day free trial.
          </p>
        </motion.div>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-3 gap-5">
          {plans.map((plan, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: index * 0.08 }}
              className="relative"
            >
              {/* Popular Badge */}
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 z-10">
                  <div className="bg-[#0071e3] text-white text-micro-bold px-4 py-1 rounded-full">
                    Most Popular
                  </div>
                </div>
              )}

              <div className={`h-full rounded-lg p-7 ${
                plan.popular
                  ? 'bg-white apple-shadow ring-2 ring-[#0071e3]'
                  : 'bg-white'
              }`}>
                {/* Plan Name */}
                <h3 className="text-card-title text-[#1d1d1f] mb-1">{plan.name}</h3>
                <p className="text-caption text-[rgba(0,0,0,0.48)] mb-5">{plan.description}</p>

                {/* Price */}
                <div className="mb-6">
                  <span className="text-section-heading text-[#1d1d1f]">${plan.price}</span>
                  <span className="text-caption text-[rgba(0,0,0,0.48)]">{plan.period}</span>
                </div>

                {/* CTA */}
                <Link href="/login?mode=register" className="block mb-6">
                  <button className={`w-full py-3 rounded-[980px] text-body-emphasis transition-colors ${
                    plan.popular
                      ? 'bg-[#0071e3] hover:bg-[#0077ed] text-white'
                      : 'bg-[#1d1d1f] hover:bg-[#333336] text-white'
                  }`}>
                    {plan.cta}
                  </button>
                </Link>

                {/* Features */}
                <ul className="space-y-3">
                  {plan.features.map((feature, idx) => (
                    <li key={idx} className="flex items-start gap-2.5">
                      <Check className="w-4 h-4 text-[#0071e3] flex-shrink-0 mt-0.5" />
                      <span className="text-caption text-[rgba(0,0,0,0.8)]">{feature}</span>
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
          transition={{ duration: 0.4, delay: 0.3 }}
          className="mt-12 text-center"
        >
          <p className="text-caption text-[rgba(0,0,0,0.48)]">
            <span className="text-caption-bold text-[#1d1d1f]">30-day money-back guarantee.</span> No questions asked.
          </p>
        </motion.div>
      </div>
    </section>
  );
}

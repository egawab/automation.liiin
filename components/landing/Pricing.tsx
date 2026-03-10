'use client';

import React from 'react';
import { motion } from 'motion/react';
import { Check, Zap, Crown, Rocket } from 'lucide-react';
import Link from 'next/link';

const plans = [
  {
    name: 'Starter',
    icon: Zap,
    price: '29',
    period: '/month',
    description: 'Perfect for professionals starting their LinkedIn journey',
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
    icon: Crown,
    price: '79',
    period: '/month',
    description: 'For serious professionals scaling their presence',
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
    icon: Rocket,
    price: '199',
    period: '/month',
    description: 'Maximum power for teams and agencies',
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
    <section id="pricing" className="relative py-32 px-4 overflow-hidden bg-transparent">
      <div className="max-w-7xl mx-auto">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
          className="text-center mb-16"
        >
          <h2 className="text-4xl sm:text-5xl font-bold text-white mb-4">
            Simple, Transparent Pricing
          </h2>
          <p className="text-xl text-gray-300 max-w-2xl mx-auto">
            Choose the plan that fits your growth goals. All plans include a 14-day free trial.
          </p>
        </motion.div>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-3 gap-8">
          {plans.map((plan, index) => {
            const Icon = plan.icon;
            return (
              <motion.div
                key={index}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: index * 0.1 }}
                className="group relative"
              >
                {/* Popular Badge */}
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 z-10">
                    <div className="bg-white text-gray-900 text-xs font-bold px-4 py-1.5 rounded-full shadow-lg">
                      MOST POPULAR
                    </div>
                  </div>
                )}

                {/* Card */}
                <div className={`h-full rounded-2xl p-8 transition-colors duration-200 backdrop-blur-sm ${
                  plan.popular
                    ? 'bg-gray-800/70 border-2 border-white'
                    : 'bg-gray-800/50 border border-gray-700 hover:border-gray-600'
                }`}>
                  {/* Icon */}
                  <div className="w-12 h-12 rounded-xl bg-gray-700 border border-gray-600 flex items-center justify-center mb-6">
                    <Icon className="w-6 h-6 text-gray-300" />
                  </div>

                  {/* Plan Name */}
                  <h3 className="text-2xl font-bold text-white mb-2">
                    {plan.name}
                  </h3>

                  {/* Description */}
                  <p className="text-gray-300 text-sm mb-6">
                    {plan.description}
                  </p>

                  {/* Price */}
                  <div className="mb-6">
                    <div className="flex items-baseline gap-1">
                      <span className="text-5xl font-bold text-white">
                        ${plan.price}
                      </span>
                      <span className="text-gray-400">
                        {plan.period}
                      </span>
                    </div>
                  </div>

                  {/* CTA Button */}
                  <Link href="/login?mode=register" className="block mb-6">
                    <button className={`w-full py-4 rounded-xl font-semibold transition-colors duration-200 ${
                      plan.popular
                        ? 'bg-white hover:bg-gray-100 text-gray-900'
                        : 'bg-gray-700 hover:bg-gray-600 text-white border border-gray-600'
                    }`}>
                      {plan.cta}
                    </button>
                  </Link>

                  {/* Features */}
                  <ul className="space-y-3">
                    {plan.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-3">
                        <Check className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                        <span className="text-gray-300 text-sm">
                          {feature}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Money Back Guarantee */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: 0.3 }}
          className="mt-16 text-center"
        >
          <p className="text-gray-300">
            <span className="font-semibold text-white">30-day money-back guarantee.</span> No questions asked.
          </p>
        </motion.div>
      </div>
    </section>
  );
}

'use client';

import React from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import { ArrowRight, Check } from 'lucide-react';

export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-center overflow-hidden bg-transparent">

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-32 relative">
        <div className="max-w-4xl mx-auto text-center">
          {/* Premium Headline - Clean, Confident */}
          <motion.h1
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
            className="text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight leading-[1.1] mb-8 text-white"
          >
            Automate Your LinkedIn
            <br />
            <span className="text-gray-400">Growth on Autopilot</span>
          </motion.h1>

          {/* Refined Subheadline */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-xl md:text-2xl text-gray-300 mb-16 max-w-3xl mx-auto leading-relaxed font-light"
          >
            Professional AI-powered engagement that builds your presence, generates leads, 
            and grows your network—while you focus on what matters.
          </motion.p>

          {/* Premium CTA Buttons - Clean Design */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20"
          >
            <Link href="/login?mode=register">
              <button className="px-10 py-4 bg-white hover:bg-gray-100 text-gray-900 font-semibold rounded-xl transition-colors duration-200 flex items-center gap-2">
                <span>Get Started Free</span>
                <ArrowRight className="w-5 h-5" />
              </button>
            </Link>
            <button className="px-10 py-4 bg-transparent hover:bg-white/10 text-white font-semibold rounded-xl transition-colors duration-200 border border-gray-600 hover:border-gray-400">
              Watch Demo
            </button>
          </motion.div>

          {/* Refined Trust Badges */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="flex flex-wrap justify-center gap-8 text-sm"
          >
            {[
              { text: 'No credit card required' },
              { text: 'Setup in 2 minutes' },
              { text: 'Cancel anytime' },
            ].map((item, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Check className="w-4 h-4 text-green-400" />
                <span className="text-gray-400 font-medium">{item.text}</span>
              </div>
            ))}
          </motion.div>

          {/* Refined Stats - Minimal & Professional */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="mt-24 pt-12 border-t border-gray-700"
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-12">
              {[
                { value: '10K+', label: 'Comments Posted' },
                { value: '500+', label: 'Active Users' },
                { value: '2M+', label: 'Reach Generated' },
                { value: '99.9%', label: 'Uptime' },
              ].map((stat, idx) => (
                <div key={idx} className="text-center">
                  <div className="text-3xl md:text-4xl font-bold text-white mb-2">
                    {stat.value}
                  </div>
                  <div className="text-sm text-gray-400 font-medium">{stat.label}</div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

'use client';

import React from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Sparkles } from 'lucide-react';
import Link from 'next/link';

export default function CTA() {
  return (
    <section className="relative py-32 px-4 overflow-hidden bg-transparent">
      <div className="max-w-5xl mx-auto">
        {/* CTA Card */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
          className="relative"
        >
          {/* Clean Background */}
          <div className="relative bg-gray-800/50 border border-gray-700 rounded-3xl p-12 md:p-16 overflow-hidden backdrop-blur-sm">

            {/* Content */}
            <div className="relative text-center">
              {/* Icon */}
              <motion.div
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4 }}
                className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-700 border border-gray-600 mb-8"
              >
                <Sparkles className="w-8 h-8 text-white" />
              </motion.div>

              {/* Headline */}
              <h2 className="text-4xl sm:text-5xl md:text-6xl font-bold text-white mb-6 leading-tight">
                Ready to Scale Your
                <br />
                LinkedIn Presence?
              </h2>

              {/* Subheadline */}
              <p className="text-xl text-gray-300 mb-10 max-w-2xl mx-auto leading-relaxed">
                Join thousands of professionals automating their growth. Start your 14-day free trial today.
              </p>

              {/* CTA Buttons */}
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link href="/login?mode=register">
                  <button className="px-10 py-5 bg-white hover:bg-gray-100 text-gray-900 font-semibold rounded-xl transition-colors duration-200 flex items-center gap-2">
                    <span className="text-lg">Start Free Trial</span>
                    <ArrowRight className="w-5 h-5" />
                  </button>
                </Link>
                
                <button className="px-10 py-5 bg-transparent hover:bg-white/10 text-white font-semibold rounded-xl transition-colors duration-200 border border-gray-600 hover:border-gray-400 text-lg">
                  Schedule Demo
                </button>
              </div>

              {/* Trust Indicators */}
              <div className="mt-10 flex flex-wrap items-center justify-center gap-6 text-sm text-gray-300">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span>No credit card required</span>
                </div>
                <span className="text-gray-600">•</span>
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span>14-day free trial</span>
                </div>
                <span className="text-gray-600">•</span>
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span>Cancel anytime</span>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

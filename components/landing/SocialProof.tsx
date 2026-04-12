'use client';

import React from 'react';
import { motion } from 'motion/react';

const testimonials = [
  {
    name: 'Sarah Chen',
    role: 'Marketing Director',
    company: 'TechFlow',
    content: 'Nexora transformed my LinkedIn presence. 3x more engagement in just 2 weeks without lifting a finger.',
  },
  {
    name: 'Michael Rodriguez',
    role: 'Founder & CEO',
    company: 'GrowthLabs',
    content: 'The ROI is incredible. Our lead generation increased by 250% while I focus on closing deals.',
  },
  {
    name: 'Emily Watson',
    role: 'VP of Sales',
    company: 'SaaS Corp',
    content: 'Smart automation that actually works. My network grew by 500+ quality connections in 30 days.',
  }
];

export default function SocialProof() {
  return (
    <section className="py-24 px-4 bg-black">
      <div className="max-w-[980px] mx-auto">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <h2 className="text-section-heading text-white mb-4">
            Trusted by professionals.
          </h2>
          <p className="text-body text-[rgba(255,255,255,0.56)] max-w-xl mx-auto">
            Join thousands growing their LinkedIn presence on autopilot.
          </p>
        </motion.div>

        {/* Testimonials */}
        <div className="grid md:grid-cols-3 gap-5">
          {testimonials.map((t, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: index * 0.08 }}
            >
              <div className="h-full bg-[#272729] rounded-lg p-7">
                <p className="text-body text-[rgba(255,255,255,0.8)] mb-6 leading-relaxed">
                  &ldquo;{t.content}&rdquo;
                </p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#1d1d1f] flex items-center justify-center">
                    <span className="text-white font-semibold text-sm">{t.name.charAt(0)}</span>
                  </div>
                  <div>
                    <div className="text-caption-bold text-white">{t.name}</div>
                    <div className="text-micro text-[rgba(255,255,255,0.48)]">
                      {t.role} at {t.company}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Bottom stats */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: 0.3 }}
          className="mt-14 text-center"
        >
          <div className="inline-flex flex-wrap items-center justify-center gap-8 text-caption text-[rgba(255,255,255,0.48)]">
            <span>10,000+ happy users</span>
            <span className="text-[rgba(255,255,255,0.16)]">·</span>
            <span>4.9/5 average rating</span>
            <span className="text-[rgba(255,255,255,0.16)]">·</span>
            <span>2M+ comments posted</span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

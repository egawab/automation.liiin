'use client';

import React from 'react';
import { motion } from 'motion/react';
import { Star, Quote } from 'lucide-react';

const testimonials = [
  {
    name: 'Sarah Chen',
    role: 'Marketing Director',
    company: 'TechFlow',
    content: 'Nexora transformed my LinkedIn presence. 3x more engagement in just 2 weeks without lifting a finger.',
    rating: 5,
    image: null
  },
  {
    name: 'Michael Rodriguez',
    role: 'Founder & CEO',
    company: 'GrowthLabs',
    content: 'The ROI is incredible. Our lead generation increased by 250% while I focus on closing deals.',
    rating: 5,
    image: null
  },
  {
    name: 'Emily Watson',
    role: 'VP of Sales',
    company: 'SaaS Corp',
    content: 'Smart automation that actually works. My network grew by 500+ quality connections in 30 days.',
    rating: 5,
    image: null
  }
];

export default function SocialProof() {
  return (
    <section className="relative py-24 px-4 overflow-hidden bg-transparent">
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
            Trusted by Professionals
          </h2>
          <p className="text-xl text-gray-300 max-w-2xl mx-auto">
            Join thousands growing their LinkedIn presence on autopilot
          </p>
        </motion.div>

        {/* Testimonials Grid */}
        <div className="grid md:grid-cols-3 gap-8">
          {testimonials.map((testimonial, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: index * 0.1 }}
              className="group relative"
            >
              {/* Card */}
              <div className="h-full bg-gray-800/50 border border-gray-700 rounded-2xl p-8 hover:border-gray-600 transition-colors duration-200 backdrop-blur-sm">
                {/* Quote Icon */}
                <Quote className="w-10 h-10 text-gray-500 mb-4" />
                
                {/* Rating */}
                <div className="flex gap-1 mb-4">
                  {[...Array(testimonial.rating)].map((_, i) => (
                    <Star key={i} className="w-4 h-4 fill-yellow-500 text-yellow-500" />
                  ))}
                </div>

                {/* Content */}
                <p className="text-gray-300 mb-6 leading-relaxed">
                  "{testimonial.content}"
                </p>

                {/* Author */}
                <div className="flex items-center gap-3">
                  {/* Avatar Placeholder */}
                  <div className="w-12 h-12 rounded-full bg-gray-700 flex items-center justify-center">
                    <span className="text-white font-semibold text-lg">
                      {testimonial.name.charAt(0)}
                    </span>
                  </div>
                  
                  <div>
                    <div className="font-semibold text-white">
                      {testimonial.name}
                    </div>
                    <div className="text-sm text-gray-400">
                      {testimonial.role} at {testimonial.company}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Social Proof Stats */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4, delay: 0.3 }}
          className="mt-16 text-center"
        >
          <div className="inline-flex flex-wrap items-center justify-center gap-8 text-gray-300">
            <div className="flex items-center gap-2">
              <div className="flex -space-x-2">
                {[...Array(5)].map((_, i) => (
                  <div 
                    key={i} 
                    className="w-8 h-8 rounded-full bg-gray-700 border-2 border-gray-900 flex items-center justify-center text-white text-xs font-bold"
                  >
                    {String.fromCharCode(65 + i)}
                  </div>
                ))}
              </div>
              <span className="text-sm font-medium">10,000+ happy users</span>
            </div>
            <span className="text-gray-600">•</span>
            <span className="text-sm font-medium">4.9/5 average rating</span>
            <span className="text-gray-600">•</span>
            <span className="text-sm font-medium">2M+ comments posted</span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

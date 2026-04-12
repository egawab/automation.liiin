'use client';

import React from 'react';
import { motion } from 'motion/react';
import { MessageSquare, Target, TrendingUp, Shield, Zap, PenTool } from 'lucide-react';

const features = [
  {
    icon: MessageSquare,
    title: 'Smart Comment Engine',
    description: 'AI analyzes trending posts in your niche and generates contextual, value-adding comments that attract attention.'
  },
  {
    icon: PenTool,
    title: 'Auto-Generated Posts',
    description: 'Create thought leadership content automatically based on real trends and your brand voice.'
  },
  {
    icon: Target,
    title: 'Keyword Targeting',
    description: 'Set your target keywords and topics. The AI finds relevant conversations and engages authentically.'
  },
  {
    icon: TrendingUp,
    title: 'Borrow Influencer Reach',
    description: 'Comment on high-reach posts to get your brand in front of thousands without paying for ads.'
  },
  {
    icon: Shield,
    title: 'Human-Like Behavior',
    description: 'Built-in delays, engagement limits, and human emulation to keep your account safe.'
  },
  {
    icon: Zap,
    title: 'Set It & Forget It',
    description: 'Configure once, then let the AI run 24/7. Monitor performance from your dashboard.'
  }
];

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } }
};

const item = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0 }
};

export default function Features() {
  return (
    <section id="features" className="py-24 px-4 bg-[#f5f5f7]">
      <div className="max-w-[980px] mx-auto">
        {/* Section Heading — Apple style */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <h2 className="text-section-heading text-[#1d1d1f] mb-4">
            Everything you need.
          </h2>
          <p className="text-body text-[rgba(0,0,0,0.56)] max-w-xl mx-auto">
            Professional automation that builds authority, generates leads,
            and grows your network.
          </p>
        </motion.div>

        {/* Feature Grid */}
        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          className="grid md:grid-cols-2 lg:grid-cols-3 gap-5"
        >
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <motion.div key={index} variants={item}>
                <div className="h-full bg-white rounded-lg p-7 transition-shadow duration-200 hover:apple-shadow">
                  <div className="mb-5">
                    <div className="w-10 h-10 rounded-full bg-[#f5f5f7] flex items-center justify-center">
                      <Icon className="w-5 h-5 text-[#1d1d1f]" />
                    </div>
                  </div>
                  <h3 className="text-card-title text-[#1d1d1f] mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-caption text-[rgba(0,0,0,0.56)] leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}

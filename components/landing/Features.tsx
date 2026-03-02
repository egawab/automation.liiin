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
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
};

const item = {
  hidden: { opacity: 0 },
  show: { opacity: 1 }
};

export default function Features() {
  return (
    <section id="features" className="relative py-32 px-4 overflow-hidden bg-transparent">

      <div className="max-w-7xl mx-auto relative">
        {/* Refined Section Header */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
          className="text-center mb-20"
        >
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-6 text-white">
            Everything You Need
          </h2>
          
          <p className="text-xl text-gray-300 max-w-2xl mx-auto leading-relaxed font-light">
            Professional automation that builds authority, generates leads, 
            and grows your network.
          </p>
        </motion.div>

        {/* Refined Features Grid - Minimal & Professional */}
        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          className="grid md:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <motion.div 
                key={index} 
                variants={item}
                className="group relative"
              >
                {/* Clean Card with Minimal Design */}
                <div className="h-full bg-gray-800/50 border border-gray-700 rounded-2xl p-8 hover:border-gray-600 transition-colors duration-200 backdrop-blur-sm">
                  
                  {/* Icon with clean styling */}
                  <div className="mb-6 relative">
                    <div className="w-12 h-12 rounded-xl bg-gray-700 border border-gray-600 flex items-center justify-center">
                      <Icon className="w-6 h-6 text-gray-300" />
                    </div>
                  </div>

                  {/* Content */}
                  <h3 className="text-xl font-semibold text-white mb-3 relative">
                    {feature.title}
                  </h3>
                  
                  <p className="text-gray-300 leading-relaxed font-light relative">
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

'use client';

import React from 'react';
import { motion } from 'motion/react';
import Card from '@/components/ui/Card';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  iconColor?: 'primary' | 'secondary' | 'accent' | 'success' | 'warning' | 'gray';
  trend?: string;
  trendUp?: boolean;
  maxValue?: number;
  showProgress?: boolean;
  delay?: number;
}

const iconBgMap: Record<string, string> = {
  primary: 'bg-[rgba(0,113,227,0.12)] text-[#0071e3]',
  secondary: 'bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.56)]',
  accent: 'bg-[rgba(0,113,227,0.12)] text-[#0071e3]',
  success: 'bg-[rgba(52,199,89,0.12)] text-[#34c759]',
  warning: 'bg-[rgba(255,159,10,0.12)] text-[#ff9f0a]',
  gray: 'bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.48)]'
};

const progressColorMap: Record<string, string> = {
  primary: 'bg-[#0071e3]',
  secondary: 'bg-[rgba(255,255,255,0.32)]',
  accent: 'bg-[#0071e3]',
  success: 'bg-[#34c759]',
  warning: 'bg-[#ff9f0a]',
  gray: 'bg-[rgba(255,255,255,0.32)]'
};

export default function StatCard({
  title, value, icon, iconColor = 'primary',
  trend, trendUp, maxValue, showProgress = false, delay = 0
}: StatCardProps) {
  const progressPercentage = maxValue ? Math.min(100, (Number(value) / maxValue) * 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
    >
      <Card className="h-full">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <p className="text-micro text-[rgba(255,255,255,0.48)] mb-1.5">{title}</p>
            <div className="flex items-baseline gap-2">
              <h3 className="text-tile-heading text-white">{value}</h3>
              {maxValue && (
                <span className="text-caption text-[rgba(255,255,255,0.32)]">/ {maxValue}</span>
              )}
            </div>
            {trend && (
              <div className="flex items-center gap-1 mt-1.5">
                <span className={`text-micro-bold ${trendUp ? 'text-[#34c759]' : 'text-[#ff3b30]'}`}>
                  {trendUp ? '↑' : '↓'} {trend}
                </span>
                <span className="text-micro text-[rgba(255,255,255,0.32)]">from last week</span>
              </div>
            )}
          </div>
          <div className={`p-2.5 rounded-lg flex-shrink-0 ${iconBgMap[iconColor]}`}>
            {icon}
          </div>
        </div>

        {showProgress && maxValue && (
          <div className="w-full bg-[rgba(255,255,255,0.06)] rounded-full h-1.5 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progressPercentage}%` }}
              transition={{ duration: 1, delay: delay + 0.2, ease: 'easeOut' }}
              className={`h-full rounded-full ${progressColorMap[iconColor]}`}
            />
          </div>
        )}
      </Card>
    </motion.div>
  );
}

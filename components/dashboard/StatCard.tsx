'use client';

import React from 'react';
import { motion } from 'motion/react';

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

const iconAccentMap: Record<string, string> = {
  primary: 'var(--section-analytics)',
  secondary: 'var(--text-secondary)',
  accent: 'var(--section-analytics)',
  success: 'var(--section-activity)',
  warning: 'var(--section-settings)',
  gray: 'var(--text-tertiary)',
};

export default function StatCard({
  title, value, icon, iconColor = 'primary',
  trend, trendUp, maxValue, showProgress = false, delay = 0
}: StatCardProps) {
  const progressPercentage = maxValue ? Math.min(100, (Number(value) / maxValue) * 100) : 0;
  const accent = iconAccentMap[iconColor];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
    >
      <div className="dash-card h-full p-5 md:p-7 dash-glow-hover">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <p className="text-micro text-secondary mb-1.5">{title}</p>
            <div className="flex items-baseline gap-2">
              <h3 className="text-tile-heading text-primary">{value}</h3>
              {maxValue && (
                <span className="text-caption text-tertiary">/ {maxValue}</span>
              )}
            </div>
            {trend && (
              <div className="flex items-center gap-1 mt-1.5">
                <span className={`text-micro-bold ${trendUp ? 'text-success' : 'text-error'}`}>
                  {trendUp ? '↑' : '↓'} {trend}
                </span>
                <span className="text-micro text-tertiary">from last week</span>
              </div>
            )}
          </div>
          <div className="p-2.5 rounded-lg flex-shrink-0"
               style={{ background: `color-mix(in srgb, ${accent} 12%, transparent)` }}>
            <div style={{ color: accent }}>
              {icon}
            </div>
          </div>
        </div>

        {showProgress && maxValue && (
          <div className="w-full rounded-full h-1.5 overflow-hidden" style={{ background: 'var(--dash-surface-3)' }}>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progressPercentage}%` }}
              transition={{ duration: 1, delay: delay + 0.2, ease: 'easeOut' }}
              className="h-full rounded-full"
              style={{ background: accent }}
            />
          </div>
        )}
      </div>
    </motion.div>
  );
}

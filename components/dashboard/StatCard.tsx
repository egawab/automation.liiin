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
  primary: 'bg-apple-blue/15 text-apple-blue',
  secondary: 'bg-surface-elevated text-secondary',
  accent: 'bg-apple-blue/15 text-apple-blue',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  gray: 'bg-surface-hover text-tertiary'
};

const progressColorMap: Record<string, string> = {
  primary: 'bg-apple-blue',
  secondary: 'bg-secondary',
  accent: 'bg-apple-blue',
  success: 'bg-success',
  warning: 'bg-warning',
  gray: 'bg-secondary'
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
          <div className={`p-2.5 rounded-lg flex-shrink-0 ${iconBgMap[iconColor]}`}>
            {icon}
          </div>
        </div>

        {showProgress && maxValue && (
          <div className="w-full bg-surface-hover rounded-full h-1.5 overflow-hidden">
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

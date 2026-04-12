'use client';

import React from 'react';
import Card from '@/components/ui/Card';
import { Target, Zap, Activity } from 'lucide-react';
import Badge from '@/components/ui/Badge';

interface DailySummaryProps {
  stats: {
    commentsToday: number;
    postsScanned: number;
    profileViews: number;
  };
  settings: {
    maxCommentsPerDay: number;
    systemActive: boolean;
  };
}

export default function DailySummaryCard({ stats, settings }: DailySummaryProps) {
  const maxComments = settings.maxCommentsPerDay || 15;
  const commentsPct = Math.min(100, Math.round((stats.commentsToday / maxComments) * 100)) || 0;
  const estimatedReach = stats.commentsToday * 500;

  return (
    <Card className="mb-6">
      <div className="p-6 md:p-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div>
            <h3 className="text-tile-heading text-white flex items-center gap-2">
              <Activity className="w-5 h-5 text-[#0071e3]" />
              Daily Summary
            </h3>
            <p className="text-caption text-[rgba(255,255,255,0.48)] mt-1">Real-time overview of your agent&apos;s activity</p>
          </div>
          
          <Badge variant={settings.systemActive ? 'success' : 'neutral'} size="lg" dot>
            {settings.systemActive ? 'Agent Running' : 'Agent Paused'}
          </Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Main Metric */}
          <div className="col-span-1 md:col-span-2 bg-[#1d1d1f] rounded-lg p-6 border border-white/5 flex flex-col justify-center">
            <div className="flex justify-between items-end mb-4">
              <div>
                <p className="text-micro-bold text-[rgba(255,255,255,0.48)] uppercase tracking-wider mb-1">Safe Comment Payload</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-display-hero text-white leading-none">{stats.commentsToday}</span>
                  <span className="text-card-title text-[rgba(255,255,255,0.32)]">/ {maxComments}</span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-micro-bold text-[#34c759] bg-[rgba(52,199,89,0.12)] px-2 py-1 rounded-md inline-block">
                  {commentsPct}% Quota
                </p>
              </div>
            </div>
            
            <div className="w-full bg-[rgba(255,255,255,0.06)] rounded-full h-2 overflow-hidden">
              <div 
                className="bg-[#0071e3] h-full rounded-full transition-all duration-1000 ease-out relative" 
                style={{ width: `${commentsPct}%` }}
              />
            </div>
          </div>

          {/* Secondary Metrics */}
          <div className="col-span-1 space-y-4">
            <div className="bg-[#1d1d1f] rounded-lg p-5 border border-white/5 flex items-center justify-between h-[calc(50%-8px)]">
              <div>
                <p className="text-micro-bold text-[rgba(255,255,255,0.48)] uppercase tracking-wider mb-1">Posts Scanned</p>
                <p className="text-card-title text-white">{stats.postsScanned}</p>
              </div>
              <div className="w-10 h-10 bg-[rgba(255,255,255,0.06)] rounded-full flex items-center justify-center">
                <Target className="w-5 h-5 text-white" />
              </div>
            </div>

            <div className="bg-[#1d1d1f] rounded-lg p-5 border border-white/5 flex items-center justify-between h-[calc(50%-8px)]">
              <div>
                <p className="text-micro-bold text-[rgba(255,255,255,0.48)] uppercase tracking-wider mb-1">Est. Reach</p>
                <p className="text-card-title text-white">~{(estimatedReach / 1000).toFixed(1)}k</p>
              </div>
              <div className="w-10 h-10 bg-[rgba(255,255,255,0.06)] rounded-full flex items-center justify-center">
                <Zap className="w-5 h-5 text-white" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

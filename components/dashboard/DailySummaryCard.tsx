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
  
  // Calculate estimated reach (assuming each comment gets roughly 500 impressions)
  const estimatedReach = stats.commentsToday * 500;

  return (
    <Card className="overflow-hidden bg-white border-2 border-gray-100 mb-6">
      <div className="p-6 md:p-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8">
          <div>
            <h3 className="text-xl font-extrabold text-gray-900 flex items-center gap-2">
              <Activity className="w-6 h-6 text-primary-500" />
              Daily Performance Summary
            </h3>
            <p className="text-sm text-gray-500 mt-1">Real-time overview of your agent's activity today</p>
          </div>
          
          <Badge variant={settings.systemActive ? 'success' : 'neutral'} size="lg" className="px-4 py-2 font-bold text-sm">
            {settings.systemActive ? (
              <span className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-success-500 animate-pulse"></span>
                Agent Running
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-gray-400"></span>
                Agent Paused
              </span>
            )}
          </Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Main Metric: Comments */}
          <div className="col-span-1 md:col-span-2 bg-gray-50 rounded-2xl p-6 border border-gray-100 flex flex-col justify-center">
            <div className="flex justify-between items-end mb-4">
              <div>
                <p className="text-sm font-bold text-gray-500 uppercase tracking-widest mb-1">Safe Comment Payload</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-black text-gray-900">{stats.commentsToday}</span>
                  <span className="text-lg font-bold text-gray-400">/ {maxComments}</span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs font-bold text-success-600 bg-success-50 px-3 py-1 rounded-lg inline-block">
                  {commentsPct}% Quota
                </p>
              </div>
            </div>
            
            <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
              <div 
                className="bg-primary-500 h-4 rounded-full transition-all duration-1000 ease-out relative overflow-hidden" 
                style={{ width: `${commentsPct}%` }}
              >
                <div className="absolute inset-0 bg-white/20 w-full h-full animate-[shimmer_2s_infinite]" 
                     style={{ backgroundImage: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)' }}>
                </div>
              </div>
            </div>
          </div>

          {/* Secondary Metrics */}
          <div className="col-span-1 space-y-4">
            <div className="bg-primary-50 rounded-2xl p-4 border border-primary-100 flex items-center justify-between h-full">
              <div>
                <p className="text-[10px] font-bold text-primary-600 uppercase tracking-widest mb-1">Posts Scanned</p>
                <p className="text-2xl font-black text-primary-900">{stats.postsScanned}</p>
              </div>
              <div className="w-12 h-12 bg-white rounded-xl shadow-sm flex items-center justify-center">
                <Target className="w-6 h-6 text-primary-500" />
              </div>
            </div>

            <div className="bg-amber-50 rounded-2xl p-4 border border-amber-100 flex items-center justify-between h-full">
              <div>
                <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mb-1">Est. Reach</p>
                <p className="text-2xl font-black text-amber-900">~{(estimatedReach / 1000).toFixed(1)}k</p>
              </div>
              <div className="w-12 h-12 bg-white rounded-xl shadow-sm flex items-center justify-center">
                <Zap className="w-6 h-6 text-amber-500" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

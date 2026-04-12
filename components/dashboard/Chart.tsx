'use client';

import React from 'react';
import { motion } from 'motion/react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import Card, { CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { TrendingUp } from 'lucide-react';

interface ChartDataPoint { name: string; value: number; [key: string]: any; }
interface ChartProps {
  data: ChartDataPoint[]; title?: string; description?: string;
  dataKey?: string; type?: 'line' | 'area'; color?: string; height?: number;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-surface rounded-lg p-3 apple-shadow border border-subtle">
        <p className="text-micro-bold text-primary mb-0.5">{label}</p>
        <p className="text-caption text-apple-blue">{payload[0].value} comments</p>
      </div>
    );
  }
  return null;
};

export default function Chart({
  data, title = 'Weekly Activity', description = 'Comments and engagement over time',
  dataKey = 'value', type = 'area', color = '#0071e3', height = 300
}: ChartProps) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }}>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-apple-blue" />
              <CardTitle>{title}</CardTitle>
            </div>
            <div className="flex gap-1.5">
              <button className="px-3 py-1 text-micro-bold rounded-md bg-apple-blue text-white">7 Days</button>
              <button className="px-3 py-1 text-micro rounded-md text-secondary hover:bg-surface-hover transition-colors">30 Days</button>
            </div>
          </div>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={height}>
            {type === 'area' ? (
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={color} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis dataKey="name" stroke="var(--text-tertiary)" style={{ fontSize: '11px', fontWeight: 400 }} />
                <YAxis stroke="var(--text-tertiary)" style={{ fontSize: '11px', fontWeight: 400 }} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill="url(#colorValue)" animationDuration={1000} />
              </AreaChart>
            ) : (
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis dataKey="name" stroke="var(--text-tertiary)" style={{ fontSize: '11px', fontWeight: 400 }} />
                <YAxis stroke="var(--text-tertiary)" style={{ fontSize: '11px', fontWeight: 400 }} />
                <Tooltip content={<CustomTooltip />} />
                <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={{ fill: color, r: 3 }} activeDot={{ r: 5 }} animationDuration={1000} />
              </LineChart>
            )}
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </motion.div>
  );
}

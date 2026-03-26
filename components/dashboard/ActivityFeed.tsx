'use client';

import React from 'react';
import { motion } from 'motion/react';
import Card, { CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { MessageSquareText, Bot, Activity, Clock } from 'lucide-react';

interface ActivityLog {
  id: string;
  action: string;
  status: 'Success' | 'Failed' | 'Pending';
  time: string;
  postUrl?: string;
  commentUrl?: string;
  comment?: string;
}

interface ActivityFeedProps {
  logs: ActivityLog[];
  maxHeight?: string;
}

const statusVariants = {
  Success: 'success',
  Failed: 'error',
  Pending: 'warning'
} as const;

const statusIcons = {
  Success: MessageSquareText,
  Failed: Bot,
  Pending: Clock
};

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05
    }
  }
};

const item = {
  hidden: { opacity: 0, x: -20 },
  show: { opacity: 1, x: 0 }
};

export default function ActivityFeed({ logs, maxHeight = '500px' }: ActivityFeedProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center mb-1">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary-500" />
            <CardTitle>Live Activity Feed</CardTitle>
          </div>
          <Badge variant="error" size="sm" className="bg-red-50 text-red-600 border-red-200 uppercase tracking-widest text-[10px] font-black px-2 py-0.5 shadow-sm shadow-red-500/10">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse mr-1.5 inline-block"></span>
            Live
          </Badge>
        </div>
        <CardDescription>
          Real-time updates from your LinkedIn automation agent
        </CardDescription>
      </CardHeader>
      
      <CardContent>
        {logs.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
              <Activity className="w-8 h-8 text-gray-400" />
            </div>
            <p className="text-sm font-semibold text-gray-900 mb-1">No Activity Yet</p>
            <p className="text-sm text-gray-500">
              Start your agent to see live updates here
            </p>
          </div>
        ) : (
          <motion.div
            variants={container}
            initial="hidden"
            animate="show"
            className="space-y-3"
            style={{ maxHeight, overflowY: 'auto' }}
          >
            {logs.map((log) => {
              const StatusIcon = log.action.includes('Commented') 
                ? MessageSquareText 
                : Bot;
              
              return (
                <motion.div
                  key={log.id}
                  variants={item}
                  className="flex items-start gap-4 p-4 rounded-2xl bg-gray-50 border border-gray-100 hover:border-gray-200 transition-colors"
                >
                  {/* Icon */}
                  <div className={`p-2.5 rounded-xl flex-shrink-0 ${
                    log.status === 'Success' 
                      ? 'bg-success-100 text-success-600'
                      : log.status === 'Failed'
                      ? 'bg-error-100 text-error-600'
                      : 'bg-warning-100 text-warning-600'
                  }`}>
                    <StatusIcon className="w-4 h-4" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 mb-1">
                      {log.action}
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 text-xs text-gray-500">
                        <Clock className="w-3 h-3" />
                        {new Date(log.time).toLocaleTimeString()}
                      </div>
                      <span className="text-gray-300">•</span>
                      <Badge
                        variant={statusVariants[log.status]}
                        size="sm"
                      >
                        {log.status}
                      </Badge>
                      {/* Show comment link if available */}
                      {log.commentUrl && (
                        <>
                          <span className="text-gray-300">•</span>
                          <a
                            href={log.commentUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-semibold text-primary-600 hover:text-primary-700 hover:underline flex items-center gap-1"
                          >
                            🔗 View Comment
                          </a>
                        </>
                      )}
                      {/* Fallback to post link if no comment URL */}
                      {!log.commentUrl && log.postUrl && log.postUrl !== 'N/A' && log.postUrl !== 'unknown' && (
                        <>
                          <span className="text-gray-300">•</span>
                          <a
                            href={log.postUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-medium text-gray-600 hover:text-gray-900 hover:underline flex items-center gap-1"
                          >
                            📄 View Post
                          </a>
                        </>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}

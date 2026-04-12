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

export default function ActivityFeed({ logs, maxHeight = '500px' }: ActivityFeedProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center mb-1">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-apple-blue" />
            <CardTitle>Live Activity Feed</CardTitle>
          </div>
          <Badge variant="error" size="sm" dot>Live</Badge>
        </div>
        <CardDescription>
          Real-time updates from your automated agent
        </CardDescription>
      </CardHeader>
      
      <CardContent>
        {logs.length === 0 ? (
          <div className="text-center py-10">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-surface-hover flex items-center justify-center">
              <Activity className="w-5 h-5 text-tertiary" />
            </div>
            <p className="text-caption-bold text-primary mb-1">No Activity Yet</p>
            <p className="text-micro text-secondary">
              Start your agent to see live updates here.
            </p>
          </div>
        ) : (
          <motion.div
            initial="hidden" animate="show"
            variants={{ hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.05 } } }}
            className="space-y-2" style={{ maxHeight, overflowY: 'auto' }}
          >
            {logs.map((log) => {
              const StatusIcon = log.action.includes('Commented') ? MessageSquareText : Bot;
              
              return (
                <motion.div
                  key={log.id}
                  variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
                  className="flex items-start gap-3 p-4 rounded-lg bg-surface border border-subtle"
                >
                  <div className={`p-2 rounded-md flex-shrink-0 ${
                    log.status === 'Success' ? 'bg-success/15 text-success' :
                    log.status === 'Failed' ? 'bg-error/15 text-error' :
                    'bg-warning/15 text-warning'
                  }`}>
                    <StatusIcon className="w-4 h-4" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-caption-bold text-primary mb-1">{log.action}</p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <div className="flex items-center gap-1 text-micro text-secondary">
                        <Clock className="w-3 h-3" />
                        {new Date(log.time).toLocaleTimeString()}
                      </div>
                      <span className="text-tertiary">·</span>
                      <Badge variant={statusVariants[log.status]} size="sm">{log.status}</Badge>

                      {log.commentUrl && (
                        <>
                          <span className="text-tertiary">·</span>
                          <a href={log.commentUrl} target="_blank" rel="noopener noreferrer" className="text-micro text-apple-blue hover:underline">
                            View Comment
                          </a>
                        </>
                      )}
                      {!log.commentUrl && log.postUrl && log.postUrl !== 'N/A' && log.postUrl !== 'unknown' && (
                        <>
                          <span className="text-tertiary">·</span>
                          <a href={log.postUrl} target="_blank" rel="noopener noreferrer" className="text-micro text-apple-blue hover:underline">
                            View Post
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

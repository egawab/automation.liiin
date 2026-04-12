'use client';

import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Eye, Terminal, Camera, AlertCircle } from 'lucide-react';

interface WorkerEvent {
  type: 'screenshot' | 'action' | 'log' | 'status' | 'error';
  timestamp: string;
  data: {
    message: string;
    screenshot?: string;
    metadata?: Record<string, any>;
  };
}

interface ManualSubmitState {
  isWaiting: boolean;
  postUrl?: string;
  commentPreview?: string;
  instruction?: string;
}

export default function LiveWorkerViewer() {
  const [events, setEvents] = useState<WorkerEvent[]>([]);
  const [currentScreenshot, setCurrentScreenshot] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [manualSubmitState, setManualSubmitState] = useState<ManualSubmitState>({ isWaiting: false });
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Get current user ID from settings
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const fetchUserId = async () => {
      try {
        const response = await fetch('/api/settings');
        if (response.ok) {
          const data = await response.json();
          setUserId(data.userId);
        }
      } catch (error) {
        console.error('Failed to fetch user ID:', error);
      }
    };
    fetchUserId();
  }, []);

  // Real-time SSE connection for live updates
  useEffect(() => {
    if (!userId) return; // Wait for userId to be loaded

    console.log('🔌 Connecting to SSE stream...');
    
    // Create EventSource for SSE
    const eventSource = new EventSource(`/api/stream?userId=${encodeURIComponent(userId)}`);

    eventSource.onopen = () => {
      console.log('✅ SSE connection established');
      setIsConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Handle different event types
        if (data.type === 'connected') {
          console.log('📡 Connected to live stream');
          return;
        }

        // Handle manual submit status
        if (data.type === 'status' && data.data?.metadata?.status === 'WAITING_FOR_MANUAL_SUBMIT') {
          setManualSubmitState({
            isWaiting: true,
            postUrl: data.data.metadata.postUrl,
            commentPreview: data.data.metadata.commentText
          });
        } else if (data.type === 'action' && data.data?.metadata?.type === 'WAITING_FOR_MANUAL_SUBMIT') {
          setManualSubmitState({
            isWaiting: true,
            postUrl: data.data.metadata.postUrl,
            commentPreview: data.data.metadata.commentPreview,
            instruction: data.data.metadata.instruction
          });
        } else if (data.type === 'status' && data.data?.metadata?.status === 'RUNNING') {
          // Clear manual submit state when worker resumes
          setManualSubmitState({ isWaiting: false });
        }

        // Add new event to the list
        setEvents((prev) => {
          const updated = [...prev, data];
          // Keep only last 100 events
          return updated.slice(-100);
        });

        // Update screenshot if this is a screenshot event
        if (data.type === 'screenshot' && data.data?.screenshot) {
          setCurrentScreenshot(data.data.screenshot);
        }

      } catch (error) {
        console.error('Error parsing SSE event:', error);
      }
    };

    eventSource.onerror = (error) => {
      console.error('❌ SSE connection error:', error);
      setIsConnected(false);
      eventSource.close();
    };

    // Cleanup on unmount
    return () => {
      console.log('🔌 Closing SSE connection');
      eventSource.close();
    };
  }, [userId]);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [events, autoScroll]);

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'screenshot': return <Camera className="w-4 h-4" />;
      case 'action': return <Activity className="w-4 h-4" />;
      case 'status': return <Eye className="w-4 h-4" />;
      case 'error': return <AlertCircle className="w-4 h-4" />;
      default: return <Terminal className="w-4 h-4" />;
    }
  };

  const getEventColor = (type: string) => {
    switch (type) {
      case 'screenshot': return 'text-apple-blue';
      case 'action': return 'text-success';
      case 'status': return 'text-[#af52de]';
      case 'error': return 'text-error';
      default: return 'text-secondary';
    }
  };

  return (
    <div className="space-y-6">
      {/* Manual Submit Alert Banner */}
      {manualSubmitState.isWaiting && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="bg-warning/10 border-2 border-warning/40 rounded-xl p-6"
        >
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0">
              <div className="w-12 h-12 bg-warning/20 rounded-full flex items-center justify-center animate-pulse">
                <AlertCircle className="w-6 h-6 text-warning" />
              </div>
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-bold text-warning mb-2">⏸️ WAITING FOR MANUAL SUBMIT</h3>
              <p className="text-primary text-lg mb-4">
                {manualSubmitState.instruction || 'Click the POST button in the browser window to submit the comment'}
              </p>
              
              {manualSubmitState.commentPreview && (
                <div className="bg-surface rounded-lg p-4 mb-3 border border-border-subtle">
                  <p className="text-sm text-secondary mb-1">Comment Preview:</p>
                  <p className="text-primary font-mono text-sm">&quot;{manualSubmitState.commentPreview}&quot;</p>
                </div>
              )}
              
              {manualSubmitState.postUrl && (
                <div className="bg-surface rounded-lg p-4 mb-4 border border-border-subtle">
                  <p className="text-sm text-secondary mb-1">Post URL:</p>
                  <a 
                    href={manualSubmitState.postUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-apple-blue hover:underline text-sm break-all"
                  >
                    {manualSubmitState.postUrl}
                  </a>
                </div>
              )}
              
              <div className="flex items-center gap-2 text-warning">
                <div className="w-2 h-2 bg-warning rounded-full animate-pulse"></div>
                <span className="text-sm font-semibold">Worker is paused - Waiting for you to click submit...</span>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Live Browser View */}
      <div className="bg-surface border border-border-subtle rounded-xl p-6 apple-shadow">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-success animate-pulse' : 'bg-tertiary'}`} />
            <h3 className="text-lg font-semibold text-primary">Live Browser View</h3>
          </div>
          <div className="flex items-center gap-2 text-sm text-secondary">
            <Camera className="w-4 h-4" />
            <span>Real-time</span>
          </div>
        </div>

        <div className="relative bg-surface-hover rounded-lg overflow-hidden aspect-video flex items-center justify-center border border-border-subtle">
          {currentScreenshot ? (
            <motion.img
              key={currentScreenshot}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
              src={`data:image/jpeg;base64,${currentScreenshot}`}
              alt="Live browser view"
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="text-center text-tertiary">
              <Camera className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Waiting for worker activity...</p>
              <p className="text-xs mt-1">Screenshots will appear here when automation starts</p>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between text-xs text-secondary">
          <span className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-success animate-pulse' : 'bg-tertiary'}`} />
            {isConnected ? 'Live connected' : 'Disconnected'}
          </span>
          <span>{events.length} events captured</span>
        </div>
      </div>

      {/* Live Action Log */}
      <div className="bg-surface border border-border-subtle rounded-xl p-6 apple-shadow">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Terminal className="w-5 h-5 text-secondary" />
            <h3 className="text-lg font-semibold text-primary">Live Action Log</h3>
          </div>
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`text-xs px-3 py-1 rounded-lg transition-premium ${
              autoScroll 
                ? 'bg-success/15 text-success border border-success/25' 
                : 'bg-surface-hover text-secondary border border-border-subtle'
            }`}
          >
            Auto-scroll: {autoScroll ? 'ON' : 'OFF'}
          </button>
        </div>

        <div className="bg-surface-hover border border-border-subtle rounded-lg p-4 h-96 overflow-y-auto font-mono text-sm scrollbar-thin">
          {events.length === 0 ? (
            <div className="flex items-center justify-center h-full text-tertiary">
              <div className="text-center">
                <Terminal className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No activity yet</p>
                <p className="text-xs mt-1">Logs will appear when worker starts</p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <AnimatePresence>
                {events.map((event, index) => (
                  <motion.div
                    key={`${event.timestamp}-${index}`}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="flex items-start gap-2 text-xs"
                  >
                    <span className="text-tertiary flex-shrink-0">
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </span>
                    <span className={`flex-shrink-0 ${getEventColor(event.type)}`}>
                      {getEventIcon(event.type)}
                    </span>
                    <span className="text-primary flex-1">
                      {event.data.message}
                    </span>
                  </motion.div>
                ))}
              </AnimatePresence>
              <div ref={logsEndRef} />
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between text-xs text-secondary">
          <span>Showing last 50 events</span>
          <button
            onClick={async () => {
              if (userId) {
                await fetch(`/api/worker-events?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
                setEvents([]);
                setCurrentScreenshot(null);
              }
            }}
            className="text-error hover:opacity-80 transition-premium"
          >
            Clear logs
          </button>
        </div>
      </div>
    </div>
    </div>
  );
}

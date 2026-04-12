import React, { useEffect, useRef } from 'react';
import { Terminal as TerminalIcon, ShieldCheck, XCircle, AlertTriangle, Info, Trash2 } from 'lucide-react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'SUCCESS' | 'WARN' | 'ERROR' | 'INFO';
  text: string;
  source: 'background' | 'content';
}

interface TerminalProps {
  logs: LogEntry[];
  onClear: () => void;
  systemActive: boolean;
}

export default function Terminal({ logs, onClear, systemActive }: TerminalProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const getLogColor = (level: string) => {
    switch(level) {
      case 'SUCCESS': return 'text-success';
      case 'WARN': return 'text-warning';
      case 'ERROR': return 'text-error';
      default: return 'text-apple-blue';
    }
  };

  const getLogIcon = (level: string) => {
    switch(level) {
      case 'SUCCESS': return <ShieldCheck className="w-4 h-4 text-success" />;
      case 'WARN': return <AlertTriangle className="w-4 h-4 text-warning" />;
      case 'ERROR': return <XCircle className="w-4 h-4 text-error" />;
      default: return <Info className="w-4 h-4 text-apple-blue" />;
    }
  };

  return (
    <Card className="overflow-hidden border border-border-subtle apple-shadow flex flex-col h-[700px]">
      {/* Terminal Header */}
      <div className="px-6 py-4 border-b border-border-subtle bg-surface-hover flex justify-between items-center z-10 shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <TerminalIcon className="w-5 h-5 text-secondary" />
            <h3 className="text-lg font-black text-primary tracking-tight font-mono">LIVE_LOGS</h3>
          </div>
          <div className="flex gap-2 items-center">
            <span className="flex h-3 w-3 relative">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${systemActive ? 'bg-success' : 'bg-tertiary'}`}></span>
              <span className={`relative inline-flex rounded-full h-3 w-3 ${systemActive ? 'bg-success' : 'bg-tertiary'}`}></span>
            </span>
            <span className="text-xs font-bold text-secondary font-mono uppercase tracking-widest">
              {systemActive ? 'Engine Online' : 'Engine Standby'}
            </span>
          </div>
        </div>
        <button 
          onClick={onClear}
          className="flex items-center gap-2 text-xs font-bold text-secondary hover:text-primary bg-surface-hover hover:bg-surface-elevated px-3 py-1.5 rounded-md transition-premium"
        >
          <Trash2 className="w-3.5 h-3.5" />
          CLEAR
        </button>
      </div>

      {/* Code Stream Container */}
      <div 
        ref={scrollRef}
        className="p-6 flex-1 overflow-y-auto font-mono text-[13px] leading-relaxed relative scrollbar-thin"
        style={{ scrollBehavior: 'smooth' }}
      >
        <div className="space-y-3 pb-8">
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-tertiary mt-20">
              <TerminalIcon className="w-12 h-12 mb-4 opacity-20" />
              <p>Waiting for connection...</p>
              <p className="text-[10px] mt-2 opacity-50">Click START to wake up the engine</p>
            </div>
          ) : (
            logs.map((log) => (
              <div 
                key={log.id} 
                className="flex items-start gap-4 hover:bg-surface-hover p-2 -mx-2 rounded-lg transition-premium group cursor-default"
              >
                {/* Timestamp */}
                <div className="text-tertiary shrink-0 w-24 text-[11px] pt-1">
                  {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' })}
                </div>

                {/* Level Icon */}
                <div className="shrink-0 pt-0.5">
                  {getLogIcon(log.level)}
                </div>

                {/* Content */}
                <div className="flex-1 break-words">
                  <span className={`${getLogColor(log.level)} font-medium`}>
                    {log.text}
                  </span>
                </div>
                
                 {/* Source Badge */}
                 <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="text-[9px] uppercase font-bold tracking-wider px-2 py-1 rounded bg-surface-hover text-tertiary">
                    {log.source}
                  </span>
                 </div>
              </div>
            ))
          )}
        </div>
      </div>
    </Card>
  );
}

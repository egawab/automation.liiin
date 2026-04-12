'use client';

import React, { useEffect, useState } from 'react';
import Badge from '@/components/ui/Badge';
import { Shield, Sun, Moon, Activity, Search, Settings, Sparkles, Bookmark } from 'lucide-react';
import { useTheme } from '@/components/theme-provider';

interface HeaderProps {
  title: string;
  sessionConnected: boolean;
}

const sectionMeta: Record<string, { icon: React.ReactNode; accent: string; label: string }> = {
  'dashboard': { icon: <Activity className="w-3.5 h-3.5" />, accent: 'var(--section-analytics)', label: 'Dashboard' },
  'saved-posts': { icon: <Bookmark className="w-3.5 h-3.5" />, accent: 'var(--section-analytics)', label: 'Saved Posts' },
  'keywords': { icon: <Search className="w-3.5 h-3.5" />, accent: 'var(--section-campaigns)', label: 'Target Campaigns' },
  'autoposts': { icon: <Sparkles className="w-3.5 h-3.5" />, accent: 'var(--section-campaigns)', label: 'Auto Posts' },
  'extension-connect': { icon: <Shield className="w-3.5 h-3.5" />, accent: 'var(--section-extension)', label: 'Connect Extension' },
  'settings': { icon: <Settings className="w-3.5 h-3.5" />, accent: 'var(--section-settings)', label: 'Settings' },
};

export default function Header({ title, sessionConnected }: HeaderProps) {
  const { theme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const meta = sectionMeta[title] || sectionMeta['dashboard'];

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <header className="dash-header px-6 md:px-8 py-4 flex flex-col md:flex-row md:justify-between md:items-center gap-3 sticky top-0 z-10">
      <div className="flex items-center gap-3">
        {/* Section color dot */}
        <div
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ background: meta.accent }}
        />
        <h1 className="text-xl font-semibold text-primary tracking-tight">
          {meta.label}
        </h1>
      </div>
      <div className="flex items-center gap-3">
        <Badge variant="success" size="md" dot icon={<Shield className="w-3 h-3" />}>
          Extension Active
        </Badge>
        {mounted && (
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg transition-all duration-200"
            style={{
              background: 'var(--dash-surface-2)',
              border: '1px solid var(--dash-border)',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.boxShadow = 'var(--dash-hover-glow)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.boxShadow = 'none';
            }}
            aria-label="Toggle Theme"
          >
            {theme === 'light' ? <Moon className="w-4 h-4 text-secondary" /> : <Sun className="w-4 h-4 text-secondary" />}
          </button>
        )}
      </div>
    </header>
  );
}

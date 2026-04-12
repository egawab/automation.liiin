'use client';

import React, { useEffect, useState } from 'react';
import Badge from '@/components/ui/Badge';
import { Shield, Sun, Moon } from 'lucide-react';
import { useTheme } from '@/components/theme-provider';

interface HeaderProps {
  title: string;
  sessionConnected: boolean;
}

export default function Header({ title, sessionConnected }: HeaderProps) {
  const { theme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <header className="glass-nav border-b border-subtle px-6 md:px-8 py-5 flex flex-col md:flex-row md:justify-between md:items-center gap-3 sticky top-0 z-10">
      <h1 className="text-tile-heading text-primary capitalize">
        {title.replace('-', ' ')}
      </h1>
      <div className="flex items-center gap-4">
        <Badge variant="success" size="md" dot icon={<Shield className="w-3 h-3" />}>
          Extension Mode: Active
        </Badge>
        {mounted && (
          <button
            onClick={toggleTheme}
            className="p-2 rounded-full hover:bg-surface-hover text-secondary hover:text-primary transition-colors focus:outline-none focus:ring-2 focus:ring-apple-blue"
            aria-label="Toggle Theme"
          >
            {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
          </button>
        )}
      </div>
    </header>
  );
}

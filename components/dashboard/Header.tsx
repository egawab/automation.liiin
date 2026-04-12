'use client';

import React from 'react';
import Badge from '@/components/ui/Badge';
import { Shield } from 'lucide-react';

interface HeaderProps {
  title: string;
  sessionConnected: boolean;
}

export default function Header({ title, sessionConnected }: HeaderProps) {
  return (
    <header className="glass-nav border-b border-white/5 px-6 md:px-8 py-5 flex flex-col md:flex-row md:justify-between md:items-center gap-3 sticky top-0 z-10">
      <h1 className="text-tile-heading text-white capitalize">
        {title.replace('-', ' ')}
      </h1>
      <div className="flex items-center gap-4">
        <Badge variant="success" size="md" dot icon={<Shield className="w-3 h-3" />}>
          Extension Mode: Active
        </Badge>
      </div>
    </header>
  );
}

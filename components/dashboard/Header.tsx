'use client';

import React from 'react';
import Badge from '@/components/ui/Badge';
import { CheckCircle, AlertCircle, Shield } from 'lucide-react';

interface HeaderProps {
  title: string;
  sessionConnected: boolean;
}

export default function Header({ title, sessionConnected }: HeaderProps) {
  return (
    <header className="bg-gray-900/95 backdrop-blur-md border-b border-gray-800 px-6 md:px-8 py-6 flex flex-col md:flex-row md:justify-between md:items-center gap-4 sticky top-0 z-10">
      {/* Page Title */}
      <h1 className="text-2xl md:text-3xl font-extrabold text-white capitalize tracking-tight">
        {title.replace('-', ' ')}
      </h1>

      {/* Session Status */}
      <div className="flex items-center gap-4">
        <Badge
          variant="success"
          size="md"
          dot
          icon={<Shield className="w-3.5 h-3.5" />}
        >
          Extension Mode: Active
        </Badge>
      </div>
    </header>
  );
}

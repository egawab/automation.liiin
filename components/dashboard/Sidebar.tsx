'use client';

import React from 'react';
import Link from 'next/link';
import { LayoutDashboard, Search, Settings, Sparkles, Shield, Bookmark } from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  systemActive: boolean;
}

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'saved-posts', label: 'Saved Posts', icon: Bookmark },
  { id: 'keywords', label: 'Target Campaigns', icon: Search },
  { id: 'autoposts', label: 'Auto Posts', icon: Sparkles },
  { id: 'extension-connect', label: 'Connect Extension', icon: Shield },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function Sidebar({ activeTab, onTabChange, systemActive }: SidebarProps) {
  return (
    <div className="w-64 bg-surface border-r border-subtle flex flex-col">
      {/* Logo */}
      <div className="p-5 border-b border-subtle">
        <Link href="/" className="text-primary text-base font-semibold tracking-tight hover:opacity-80 transition-opacity">
          Nexora
        </Link>
      </div>

      {/* Navigation */}
      <div className="flex-1 py-4 px-3 space-y-0.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-caption rounded-lg transition-all ${
                isActive
                  ? 'bg-apple-blue text-white'
                  : 'text-secondary hover:bg-surface-hover hover:text-primary'
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {item.label}
            </button>
          );
        })}
      </div>

      {/* User */}
      <div className="p-3 border-t border-subtle">
        <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-hover">
          <div className="w-8 h-8 rounded-full bg-apple-blue flex items-center justify-center text-white text-micro-bold">
            N
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-micro-bold text-primary truncate">Pro Account</p>
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${systemActive ? 'bg-success' : 'bg-secondary opacity-50'}`} />
              <p className="text-[10px] text-tertiary">
                Agent: {systemActive ? 'Active' : 'Off'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

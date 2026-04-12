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
    <div className="w-64 bg-black border-r border-white/5 flex flex-col">
      {/* Logo */}
      <div className="p-5 border-b border-white/5">
        <Link href="/" className="text-white text-base font-semibold tracking-tight hover:opacity-80 transition-opacity">
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
                  ? 'bg-[#0071e3] text-white'
                  : 'text-[rgba(255,255,255,0.56)] hover:bg-white/5 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {item.label}
            </button>
          );
        })}
      </div>

      {/* User */}
      <div className="p-3 border-t border-white/5">
        <div className="flex items-center gap-3 p-3 rounded-lg bg-[#272729]">
          <div className="w-8 h-8 rounded-full bg-[#0071e3] flex items-center justify-center text-white text-micro-bold">
            N
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-micro-bold text-white truncate">Pro Account</p>
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${systemActive ? 'bg-[#34c759]' : 'bg-[rgba(255,255,255,0.24)]'}`} />
              <p className="text-[10px] text-[rgba(255,255,255,0.48)]">
                Agent: {systemActive ? 'Active' : 'Off'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

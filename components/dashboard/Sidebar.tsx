'use client';

import React from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import { LayoutDashboard, Search, Settings, Sparkles, Shield, Bookmark, Crown, CreditCard } from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  systemActive: boolean;
  isAdmin?: boolean;
  subscriptionStatus?: string;
  trialDaysRemaining?: number;
}

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, accent: 'var(--section-analytics)' },
  { id: 'saved-posts', label: 'Saved Posts', icon: Bookmark, accent: 'var(--section-analytics)' },
  { id: 'keywords', label: 'Target Campaigns', icon: Search, accent: 'var(--section-campaigns)' },
  { id: 'autoposts', label: 'Auto Posts', icon: Sparkles, accent: 'var(--section-campaigns)' },
  { id: 'extension-connect', label: 'Connect Extension', icon: Shield, accent: 'var(--section-extension)' },
  { id: 'billing', label: 'Billing & Plan', icon: CreditCard, accent: 'var(--section-billing)' },
  { id: 'settings', label: 'Settings', icon: Settings, accent: 'var(--section-settings)' },
];

export default function Sidebar({ activeTab, onTabChange, systemActive, isAdmin, subscriptionStatus, trialDaysRemaining }: SidebarProps) {
  let displayStatus = 'Free Trial';
  if (isAdmin) displayStatus = 'Admin Control';
  else if (subscriptionStatus === 'ACTIVE') displayStatus = 'Yearly Subscriber';
  else if (subscriptionStatus === 'EXPIRED') displayStatus = 'Expired Account';
  else if (subscriptionStatus === 'TRIAL') displayStatus = `Free Trial (${trialDaysRemaining} days left)`;

  return (
    <div className="w-64 dash-sidebar flex flex-col">
      {/* Logo */}
      <div className="px-5 py-5" style={{ borderBottom: '1px solid var(--dash-border)' }}>
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm"
               style={{ background: 'linear-gradient(135deg, #0071e3 0%, #2997ff 100%)' }}>
            N
          </div>
          <span className="text-primary text-[15px] font-semibold tracking-tight group-hover:opacity-70 transition-opacity">
            Nexora
          </span>
        </Link>
      </div>

      {/* Navigation */}
      <div className="flex-1 py-3 px-3 space-y-0.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-tertiary px-3 mb-2">
          Workspace
        </p>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className="w-full relative flex items-center gap-3 px-3 py-2.5 text-caption rounded-lg transition-all duration-200"
              style={{
                background: isActive ? 'var(--dash-sidebar-active)' : 'transparent',
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.background = 'var(--dash-sidebar-hover)';
                  (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.background = 'transparent';
                  (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)';
                }
              }}
            >
              {/* Active indicator bar */}
              {isActive && (
                <motion.div
                  layoutId="sidebar-active-indicator"
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full"
                  style={{ background: item.accent || '#0a84ff' }}
                  transition={{ type: "spring", stiffness: 350, damping: 30 }}
                />
              )}
              <Icon className="w-4 h-4 flex-shrink-0" style={isActive ? { color: item.accent || '#0a84ff' } : {}} />
              <span className="font-medium">{item.label}</span>
            </button>
          );
        })}
        
        {/* Admin Link */}
        {isAdmin && (
          <Link href="/admin" className="w-full relative flex items-center gap-3 px-3 py-2.5 mt-4 text-caption rounded-lg transition-all duration-200"
            style={{ color: '#0a84ff', background: 'rgba(10,132,255,0.1)' }}>
            <Crown className="w-4 h-4 flex-shrink-0" />
            <span className="font-bold">Admin Panel</span>
          </Link>
        )}
      </div>

      {/* User Section */}
      <div className="p-3" style={{ borderTop: '1px solid var(--dash-border)' }}>
        <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'var(--dash-surface-2)' }}>
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-micro-bold"
               style={{ background: 'linear-gradient(135deg, #0071e3 0%, #2997ff 100%)' }}>
            N
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-micro-bold text-primary truncate" style={{ 
              color: isAdmin ? '#0a84ff' : (subscriptionStatus === 'ACTIVE' ? '#30d158' : (subscriptionStatus === 'EXPIRED' ? '#ff3b30' : 'var(--text-primary)'))
            }}>
              {displayStatus}
            </p>
            <div className="flex items-center gap-1.5">
              <div className="relative">
                <div className={`w-1.5 h-1.5 rounded-full ${systemActive ? 'bg-success' : 'bg-secondary opacity-50'}`} />
                {systemActive && (
                  <div className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-success animate-ping opacity-40" />
                )}
              </div>
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

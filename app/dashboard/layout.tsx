'use client';

import React from 'react';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="w-full h-screen overflow-hidden" style={{ background: 'var(--bg-page)' }}>
      {children}
    </div>
  );
}

'use client';

import React from 'react';

export default function AnimatedMeshBackground() {
  return (
    <>
      {/* PURE BLACK BASE - NEVER CHANGES */}
      <div className="fixed inset-0 -z-50 bg-[#0a0a0a]" />
      
      {/* VISUAL EFFECTS LAYER - On top of black */}
      <div className="fixed inset-0 -z-40 pointer-events-none">
        {/* Cinematic Light Sweep */}
        <div className="absolute inset-0 cinematic-light-sweep" />
        
        {/* Subtle Depth Grid Pattern */}
        <div className="absolute inset-0 depth-grid opacity-5" />
      </div>
    </>
  );
}

'use client';

import { useEffect, useRef } from 'react';

export default function Subtle3DBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Network nodes for connected mesh effect
    const nodes: Array<{
      x: number;
      y: number;
      z: number;
      baseX: number;
      baseY: number;
      vx: number;
      vy: number;
    }> = [];

    // Create network nodes distributed across the screen
    const nodeCount = 40;
    const cols = 8;
    const rows = 5;
    const spacingX = canvas.width / (cols + 1);
    const spacingY = canvas.height / (rows + 1);

    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const baseX = spacingX * (j + 1);
        const baseY = spacingY * (i + 1);
        nodes.push({
          x: baseX,
          y: baseY,
          z: Math.random() * 500,
          baseX: baseX,
          baseY: baseY,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
        });
      }
    }

    let time = 0;

    // Animation loop
    let animationFrameId: number;
    const animate = () => {
      // Clear with solid dark background
      ctx.fillStyle = '#111827';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      time += 0.005;

      // Update and draw connections first (so they're behind nodes)
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        
        // Gentle floating motion with sine waves
        node.x = node.baseX + Math.sin(time + i * 0.5) * 30;
        node.y = node.baseY + Math.cos(time + i * 0.3) * 20;
        node.z = 250 + Math.sin(time * 0.8 + i * 0.4) * 150;

        // Draw connections to nearby nodes
        for (let j = i + 1; j < nodes.length; j++) {
          const other = nodes[j];
          const dx = node.x - other.x;
          const dy = node.y - other.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          // Connect nodes that are close together
          if (distance < 200) {
            // Calculate 3D perspective for both nodes
            const scale1 = 800 / (800 + node.z);
            const scale2 = 800 / (800 + other.z);
            
            const x1 = node.x * scale1 + canvas.width / 2 * (1 - scale1);
            const y1 = node.y * scale1 + canvas.height / 2 * (1 - scale1);
            const x2 = other.x * scale2 + canvas.width / 2 * (1 - scale2);
            const y2 = other.y * scale2 + canvas.height / 2 * (1 - scale2);

            // Calculate opacity based on distance and depth
            const avgZ = (node.z + other.z) / 2;
            const depthOpacity = 1 - (avgZ / 500);
            const distanceOpacity = 1 - (distance / 200);
            const lineOpacity = depthOpacity * distanceOpacity * 0.15;

            // Draw connection line
            ctx.strokeStyle = `rgba(156, 163, 175, ${lineOpacity})`;
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
          }
        }
      }

      // Draw nodes on top
      nodes.forEach((node, i) => {
        // Calculate 3D perspective
        const scale = 800 / (800 + node.z);
        const x2d = node.x * scale + canvas.width / 2 * (1 - scale);
        const y2d = node.y * scale + canvas.height / 2 * (1 - scale);
        
        // Draw node with depth-based opacity and size
        const depthOpacity = 1 - (node.z / 500);
        const opacity = 0.2 + depthOpacity * 0.3;
        const size = 2 + (1 - node.z / 500) * 2;
        
        ctx.fillStyle = `rgba(156, 163, 175, ${opacity})`;
        ctx.beginPath();
        ctx.arc(x2d, y2d, size, 0, Math.PI * 2);
        ctx.fill();
      });

      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full -z-10"
      style={{ background: 'linear-gradient(to bottom, #111827, #1f2937)' }}
    />
  );
}

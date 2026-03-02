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

    // Particle system for subtle depth effect
    const particles: Array<{
      x: number;
      y: number;
      z: number;
      vx: number;
      vy: number;
      vz: number;
    }> = [];

    // Create subtle particles
    for (let i = 0; i < 50; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        z: Math.random() * 1000,
        vx: (Math.random() - 0.5) * 0.2,
        vy: (Math.random() - 0.5) * 0.2,
        vz: (Math.random() - 0.5) * 0.5,
      });
    }

    // Animation loop
    let animationFrameId: number;
    const animate = () => {
      ctx.fillStyle = 'rgba(17, 24, 39, 0.1)'; // Very subtle trail effect
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      particles.forEach((particle) => {
        // Update position
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.z += particle.vz;

        // Wrap around screen
        if (particle.x < 0) particle.x = canvas.width;
        if (particle.x > canvas.width) particle.x = 0;
        if (particle.y < 0) particle.y = canvas.height;
        if (particle.y > canvas.height) particle.y = 0;
        if (particle.z < 0) particle.z = 1000;
        if (particle.z > 1000) particle.z = 0;

        // Calculate 3D perspective
        const scale = 1000 / (1000 + particle.z);
        const x2d = particle.x * scale + canvas.width / 2 * (1 - scale);
        const y2d = particle.y * scale + canvas.height / 2 * (1 - scale);
        
        // Draw particle with depth-based opacity and size
        const opacity = 0.1 + (1 - particle.z / 1000) * 0.15;
        const size = 1 + (1 - particle.z / 1000) * 2;
        
        ctx.fillStyle = `rgba(156, 163, 175, ${opacity})`; // Subtle gray
        ctx.beginPath();
        ctx.arc(x2d, y2d, size, 0, Math.PI * 2);
        ctx.fill();

        // Draw subtle connections between nearby particles
        particles.forEach((other) => {
          const dx = particle.x - other.x;
          const dy = particle.y - other.y;
          const dz = particle.z - other.z;
          const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (distance < 150) {
            const otherScale = 1000 / (1000 + other.z);
            const otherX2d = other.x * otherScale + canvas.width / 2 * (1 - otherScale);
            const otherY2d = other.y * otherScale + canvas.height / 2 * (1 - otherScale);
            
            const lineOpacity = (1 - distance / 150) * 0.05;
            ctx.strokeStyle = `rgba(156, 163, 175, ${lineOpacity})`;
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(x2d, y2d);
            ctx.lineTo(otherX2d, otherY2d);
            ctx.stroke();
          }
        });
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

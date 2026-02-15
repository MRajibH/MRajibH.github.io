"use client";

import { useEffect, useRef } from "react";

const PARTICLE_COUNT_BASE = 100;
const CURSOR_RADIUS = 200;
const REPEL_STRENGTH = 3;
const FRICTION = 0.96;
const RETURN_SPEED = 0.008;
const DRIFT_SPEED = 0.05; // Autonomous movement
const CONNECTION_DISTANCE = 120; // Distance for constellation lines

export function CodingBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -10000, y: -10000 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    let animationId: number;
    let particles: Particle[] = [];
    let time = 0;

    type Particle = {
      x: number;
      y: number;
      originX: number;
      originY: number;
      vx: number;
      vy: number;
      size: number;
      color: string;
      baseAlpha: number; // For pulsing
      pulseSpeed: number;
    };

    const initParticles = () => {
      const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      particles = [];
      const count = Math.max(70, Math.floor((width * height) / 12000));

      for (let i = 0; i < count; i++) {
        const x = Math.random() * width;
        const y = Math.random() * height;
        const isCyan = Math.random() > 0.8;
        const baseAlpha = isCyan ? 0.6 : 0.25;
        const color = isCyan ? `rgba(0, 170, 255, ${baseAlpha})` : `rgba(255, 255, 255, ${baseAlpha})`;

        particles.push({
          x,
          y,
          originX: x,
          originY: y,
          vx: 0,
          vy: 0,
          size: isCyan ? 1.5 + Math.random() * 1.5 : 1 + Math.random(),
          color,
          baseAlpha,
          pulseSpeed: 0.02 + Math.random() * 0.03,
        });
      }
    };

    const setSize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      initParticles();
    };

    setSize();
    window.addEventListener("resize", setSize);

    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    const handleMouseLeave = () => {
      mouseRef.current = { x: -10000, y: -10000 };
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseleave", handleMouseLeave);

    const draw = () => {
      time += 1;
      ctx.clearRect(0, 0, width, height);
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;

      // Draw Connections (Constellation Effect) behind particles
      ctx.lineWidth = 0.5;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < CONNECTION_DISTANCE) {
            // Fade out based on distance
            const alpha = (1 - dist / CONNECTION_DISTANCE) * 0.15;
            ctx.strokeStyle = `rgba(0, 170, 255, ${alpha})`;
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }

      particles.forEach((p, i) => {
        // 1. Mouse Repulsion
        const dx = p.x - mx;
        const dy = p.y - my;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const angle = Math.atan2(dy, dx);

        if (mx > 0 && dist < CURSOR_RADIUS) {
          const force = (CURSOR_RADIUS - dist) / CURSOR_RADIUS;
          const push = force * REPEL_STRENGTH;
          p.vx += Math.cos(angle) * push;
          p.vy += Math.sin(angle) * push;
        }

        // 2. Autonomous Drift (Perlin-like noise using sine waves)
        // Each particle has a unique drift pattern based on its index and time
        const noiseX = Math.sin(time * 0.01 + i * 0.5) * DRIFT_SPEED;
        const noiseY = Math.cos(time * 0.01 + i * 0.5) * DRIFT_SPEED;
        p.vx += noiseX;
        p.vy += noiseY;

        // 3. Elastic Return
        const ox = p.originX - p.x;
        const oy = p.originY - p.y;
        p.vx += ox * RETURN_SPEED;
        p.vy += oy * RETURN_SPEED;

        // 4. Physics Update
        p.vx *= FRICTION;
        p.vy *= FRICTION;
        p.x += p.vx;
        p.y += p.vy;

        // 5. Draw
        // Pulsing opacity
        const pulse = Math.sin(time * p.pulseSpeed) * 0.2;
        const alpha = Math.max(0.1, p.baseAlpha + pulse);

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        // Extract RGB from color string to apply new alpha
        ctx.fillStyle = p.color.replace(/[\d.]+\)$/g, `${alpha})`);
        ctx.fill();
      });

      animationId = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", setSize);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none z-0 transition-opacity duration-1000 ease-in-out opacity-100"
      style={{ background: "transparent" }}
      aria-hidden
    />
  );
}

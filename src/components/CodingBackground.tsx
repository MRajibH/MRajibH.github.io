"use client";

import { useEffect, useRef } from "react";

const CODE_TOKENS = [
  "const", "let", "=>", "()", "{}", "[]", "function", "return", "import", "export",
  "async", "await", "</>", "<div>", "useState", "useEffect", "type", "interface",
  "null", "true", "false", "try", "catch", "if", "else", "for", "map", "filter",
  "reduce", "className", "href", "Promise", "React", "Next", "TypeScript", "void",
  "string", "number", "boolean", "API", "fetch", "await", "=>", "{}", "[]",
  "ls", "cd", "grep", "sudo", "apt", "chmod", "chown", "top", "htop", "vim",
  "cat", "ssh", "ping", "systemctl", "rm -rf", "docker", "kubectl", "git",
  "bash", "zsh", "alias", "tar", "unzip", "curl", "wget", "ps aux", "kill",
];

function getRandomToken() {
  return CODE_TOKENS[Math.floor(Math.random() * CODE_TOKENS.length)];
}

const CURSOR_RADIUS = 140;
const REPEL_STRENGTH = 160;
const DAMPING = 0.88;

export function CodingBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -10000, y: -10000 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
    let width = window.innerWidth;
    let height = window.innerHeight;
    let animationId: number;

    const setSize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    type Particle = {
      x: number;
      y: number;
      vx: number;
      vy: number;
      text: string;
      baseSpeed: number;
      opacity: number;
      fontSize: number;
      drift: number;
    };

    const particles: Particle[] = [];
    const colCount = Math.max(10, Math.floor(width / 120));
    const spacing = width / (colCount + 1);

    for (let i = 0; i < colCount * 5; i++) {
      particles.push({
        x: (i % colCount) * spacing + (spacing * 0.2 + Math.random() * spacing * 0.6),
        y: Math.random() * height,
        vx: 0,
        vy: 0,
        text: getRandomToken(),
        baseSpeed: 0.05 + Math.random() * 0.2,
        opacity: 0.15 + Math.random() * 0.25,
        fontSize: 12 + Math.floor(Math.random() * 10),
        drift: (Math.random() - 0.5) * 0.03,
      });
    }

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
      ctx.clearRect(0, 0, width, height);
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;

      particles.forEach((p) => {
        p.vx += p.drift;

        if (mx > 0 && my > 0) {
          const dx = p.x - mx;
          const dy = p.y - my;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          if (dist < CURSOR_RADIUS) {
            const force = (REPEL_STRENGTH * (1 - dist / CURSOR_RADIUS)) / dist;
            p.vx += (dx / dist) * force;
            p.vy += (dy / dist) * force;
          }
        }

        p.x += p.vx;
        p.y -= p.baseSpeed;
        p.y += p.vy;
        p.vx *= DAMPING;
        p.vy *= DAMPING;

        // Reset if it goes off the top
        if (p.y < -30) {
          p.y = height + 30;
          p.x = (Math.random() * colCount) * spacing + spacing * 0.2;
          p.text = getRandomToken();
          p.vx = 0;
          p.vy = 0;
        }
        if (p.x < -50 || p.x > width + 50) p.drift *= -1;

        const wave = 0.75 + 0.25 * Math.sin(p.y * 0.015 + p.x * 0.01);
        ctx.globalAlpha = Math.min(1, p.opacity * wave);
        ctx.font = `600 ${p.fontSize}px ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace`;
        ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(0, 170, 255, 0.5)";
        ctx.shadowBlur = 8;
        ctx.fillStyle = "#00aaff";
        ctx.fillText(p.text, p.x, p.y);
        ctx.shadowBlur = 0;
      });

      ctx.globalAlpha = 1;
      ctx.textBaseline = "alphabetic";
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
      className="fixed inset-0 w-full h-full pointer-events-none z-0"
      style={{ background: "transparent" }}
      aria-hidden
    />
  );
}

"use client";

import {
  HiOutlineWifi,
  HiOutlineSquares2X2,
  HiOutlineShieldCheck,
  HiOutlinePhone,
  HiOutlineServerStack,
} from "react-icons/hi2";
import { IconType } from "react-icons";

const projectIconMap: Record<string, IconType> = {
  "Smart Cabin Router": HiOutlineWifi,
  "Intelligent Ops Center": HiOutlineSquares2X2,
  "Cybersecurity Firewall Platform": HiOutlineShieldCheck,
  "Second Phone Line": HiOutlinePhone,
  "RMM Software for MSPs": HiOutlineServerStack,
};

const defaultProjectIcon = HiOutlineSquares2X2;

export function ProjectIcon({ title, className = "" }: { title: string; className?: string }) {
  const Icon = projectIconMap[title] ?? defaultProjectIcon;
  return (
    <span
      className={`inline-flex items-center justify-center w-12 h-12 rounded-xl bg-accent/10 text-accent icon-float hover:icon-pause flex-shrink-0 ${className}`}
      aria-hidden
    >
      <Icon className="w-6 h-6" />
    </span>
  );
}

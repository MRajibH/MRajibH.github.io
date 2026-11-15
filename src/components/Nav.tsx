"use client";

import { useState } from "react";
import { FiMenu, FiX } from "react-icons/fi";

const links = [
  { label: "About", href: "#about" },
  { label: "Skills", href: "#skills" },
  { label: "Experience", href: "#experience" },
  { label: "Projects", href: "#projects" },
  { label: "Education", href: "#education" },
  { label: "Contact", href: "#contact" },
];

export function Nav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-navy/90 backdrop-blur border-b border-white/5">
      <nav className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between" aria-label="Main">
        <a href="#" className="text-xl font-bold" onClick={() => setOpen(false)}>
          <span className="text-accent">Rajib</span>
          <span className="text-slate-light">.uk</span>
        </a>
        <ul className="hidden md:flex gap-8 text-slate text-sm">
          {links.map(({ label, href }) => (
            <li key={href}>
              <a href={href} className="hover:text-accent transition-colors">
                {label}
              </a>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="md:hidden p-2 -mr-2 text-slate-light hover:text-accent transition-colors"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <FiX className="w-6 h-6" /> : <FiMenu className="w-6 h-6" />}
        </button>
      </nav>
      {open && (
        <ul id="mobile-menu" className="md:hidden border-t border-white/5 px-6 py-2 text-slate">
          {links.map(({ label, href }) => (
            <li key={href}>
              <a
                href={href}
                className="block py-3 hover:text-accent transition-colors"
                onClick={() => setOpen(false)}
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </header>
  );
}

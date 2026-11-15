"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FiMenu, FiX, FiSun, FiMoon } from "react-icons/fi";

function ThemeToggle() {
  const toggle = () => {
    const root = document.documentElement;
    const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Private mode or blocked storage: the choice just won't be remembered.
    }
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Switch between light and dark theme"
      className="w-11 h-11 rounded-lg border border-line bg-navy-light text-slate-light flex items-center justify-center hover:text-accent hover:border-accent transition-colors"
    >
      <FiSun className="w-[18px] h-[18px] hidden [[data-theme=dark]_&]:block" />
      <FiMoon className="w-[18px] h-[18px] hidden [[data-theme=light]_&]:block" />
    </button>
  );
}

export function Header({ hasPosts }: { hasPosts: boolean }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // The Blog link only appears once there is something to read there.
  const links = [
    ...(hasPosts ? [{ label: "Blog", href: "/blog/" }] : []),
    { label: "About", href: "/about/" },
    { label: "Contact", href: "/contact/" },
  ];
  const isActive = (href: string) => pathname === href || pathname.startsWith(href);

  return (
    <header className="sticky top-0 z-50 bg-navy/90 backdrop-blur border-b border-line">
      <nav className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between gap-4" aria-label="Main">
        <Link href="/" className="font-display text-xl font-bold" onClick={() => setOpen(false)}>
          <span className="text-accent">rajib</span>
          <span className="text-slate-light">.uk</span>
        </Link>
        <div className="flex items-center gap-2 md:gap-7">
          <ul className="hidden md:flex gap-7 text-sm">
            {links.map(({ label, href }) => (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={isActive(href) ? "page" : undefined}
                  className={`py-2 transition-colors hover:text-accent ${isActive(href) ? "text-slate-light font-semibold" : "text-slate"}`}
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
          <ThemeToggle />
          <button
            type="button"
            className="md:hidden w-11 h-11 flex items-center justify-center text-slate-light hover:text-accent transition-colors"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <FiX className="w-6 h-6" /> : <FiMenu className="w-6 h-6" />}
          </button>
        </div>
      </nav>
      {open && (
        <ul id="mobile-menu" className="md:hidden border-t border-line px-6 py-2 text-slate">
          {links.map(({ label, href }) => (
            <li key={href}>
              <Link
                href={href}
                className="block py-3 hover:text-accent transition-colors"
                onClick={() => setOpen(false)}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </header>
  );
}

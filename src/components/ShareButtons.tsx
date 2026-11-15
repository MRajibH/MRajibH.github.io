"use client";

import { useState } from "react";
import { FiCheck, FiLink, FiMail } from "react-icons/fi";
import {
  SiFacebook,
  SiLinkedin,
  SiReddit,
  SiTelegram,
  SiWhatsapp,
  SiX,
  SiYcombinator,
} from "react-icons/si";
import type { IconType } from "react-icons";

/**
 * Share links for an article. These are ordinary links to each network's own
 * share page: no third-party scripts are loaded and nothing is tracked.
 */
export function ShareButtons({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);

  const networks: { label: string; href: string; Icon: IconType }[] = [
    { label: "X", href: `https://twitter.com/intent/tweet?url=${u}&text=${t}`, Icon: SiX },
    { label: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}`, Icon: SiLinkedin },
    { label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${u}`, Icon: SiFacebook },
    { label: "Reddit", href: `https://www.reddit.com/submit?url=${u}&title=${t}`, Icon: SiReddit },
    { label: "Hacker News", href: `https://news.ycombinator.com/submitlink?u=${u}&t=${t}`, Icon: SiYcombinator },
    { label: "WhatsApp", href: `https://wa.me/?text=${t}%20${u}`, Icon: SiWhatsapp },
    { label: "Telegram", href: `https://t.me/share/url?url=${u}&text=${t}`, Icon: SiTelegram },
    { label: "Email", href: `mailto:?subject=${t}&body=${u}`, Icon: FiMail },
  ];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the address bar still has the link.
    }
  };

  const button =
    "w-11 h-11 rounded-lg border border-line bg-navy-light text-slate-light flex items-center justify-center hover:text-accent hover:border-accent transition-colors";

  return (
    <section aria-label="Share this article" className="mt-8">
      <h2 className="mb-3 text-xs uppercase tracking-[0.12em] text-slate">Share this article</h2>
      <ul className="flex flex-wrap gap-2.5">
        {networks.map(({ label, href, Icon }) => (
          <li key={label}>
            <a
              href={href}
              target={href.startsWith("mailto:") ? undefined : "_blank"}
              rel="noopener noreferrer"
              aria-label={`Share on ${label}`}
              title={label}
              className={button}
            >
              <Icon className="w-[18px] h-[18px]" aria-hidden />
            </a>
          </li>
        ))}
        <li>
          <button type="button" onClick={copy} aria-label="Copy link" title="Copy link" className={button}>
            {copied ? <FiCheck className="w-[18px] h-[18px]" aria-hidden /> : <FiLink className="w-[18px] h-[18px]" aria-hidden />}
          </button>
          <span role="status" className="sr-only">
            {copied ? "Link copied" : ""}
          </span>
        </li>
      </ul>
    </section>
  );
}

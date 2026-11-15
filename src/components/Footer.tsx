import Link from "next/link";
import { profiles } from "@/data/resume";
import { site } from "@/lib/site";
import { ProfileSocialIcon } from "@/components/ProfileSocialIcon";

export function Footer({ hasPosts }: { hasPosts: boolean }) {
  const links = [
    ...(hasPosts ? [{ label: "Blog", href: "/blog/" }] : []),
    { label: "About", href: "/about/" },
    { label: "Contact", href: "/contact/" },
    { label: "Privacy Policy", href: "/privacy/" },
    { label: "Terms", href: "/terms/" },
  ];
  return (
    <footer className="border-t border-line">
      <div className="max-w-5xl mx-auto px-6 py-10 flex flex-col gap-6 text-sm text-slate">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <nav aria-label="Footer">
            <ul className="flex flex-wrap gap-x-6 gap-y-2">
              {links.map(({ label, href }) => (
                <li key={href}>
                  <Link href={href} className="inline-block py-2 hover:text-accent transition-colors">
                    {label}
                  </Link>
                </li>
              ))}
              {hasPosts && (
                <li>
                  <a href="/feed.xml" className="inline-block py-2 hover:text-accent transition-colors">
                    RSS
                  </a>
                </li>
              )}
            </ul>
          </nav>
          <div className="flex gap-2">
            {profiles.map(({ label, url, icon }) => (
              <a
                key={label}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={label}
                className="w-11 h-11 rounded-lg bg-navy-light text-accent flex items-center justify-center hover:bg-accent/20 transition-colors"
              >
                <ProfileSocialIcon icon={icon} className="w-5 h-5" moving={false} />
              </a>
            ))}
          </div>
        </div>
        <p>
          &copy; {new Date().getFullYear()} {site.author}
        </p>
      </div>
    </footer>
  );
}

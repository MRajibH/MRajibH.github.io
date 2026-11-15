import type { Metadata } from "next";
import { contact } from "@/data/resume";
import { adsense, site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `What information ${site.name} collects, how it is used, and the choices you have.`,
  alternates: { canonical: "/privacy/" },
};

const adsEnabled = adsense.client !== "";

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight text-slate-light mb-3">
        Privacy Policy
      </h1>
      <p className="text-slate mb-10">Last updated: 15 November 2026</p>

      <div className="prose-article text-slate-light">
        <p>
          {site.name} is a personal website and blog run by {site.author}. This page explains what
          information is collected when you visit, how it is used, and the choices you have.
        </p>

        <h2>Information you send me</h2>
        <p>
          If you use the form on the Contact page, the name, email address and message you enter are
          sent to me by email through a third-party mail delivery service. I use them only to read
          and reply to your message. I do not add you to a mailing list and I do not sell or share
          your details.
        </p>

        <h2>Information collected automatically</h2>
        <p>
          The site is made of static files served by a hosting provider. Like any web host, the
          provider may record technical details of each request, such as your IP address, browser
          type and the page requested, in order to deliver the site and keep it secure. I do not
          combine this with any other information to identify you.
        </p>

        <h2>Cookies and browser storage</h2>
        <p>
          The site itself sets no tracking cookies. If you switch between the light and dark theme,
          your choice is saved in your browser&apos;s local storage so it is remembered on your next
          visit. It never leaves your device, and you can remove it by clearing site data in your
          browser.
        </p>

        <h2>Advertising</h2>
        {adsEnabled ? (
          <>
            <p>
              Some article pages show advertisements served by Google AdSense. Third-party vendors,
              including Google, use cookies to serve ads based on your earlier visits to this and
              other websites. Google&apos;s use of advertising cookies lets it and its partners show
              you ads based on those visits.
            </p>
            <ul>
              <li>
                You can turn off personalised advertising in{" "}
                <a href="https://adssettings.google.com" rel="noopener noreferrer">
                  Google Ads Settings
                </a>
                .
              </li>
              <li>
                You can opt out of some other vendors&apos; use of cookies for personalised
                advertising at{" "}
                <a href="https://www.aboutads.info/choices/" rel="noopener noreferrer">
                  aboutads.info
                </a>
                .
              </li>
              <li>
                Google explains{" "}
                <a href="https://policies.google.com/technologies/partner-sites" rel="noopener noreferrer">
                  how it uses information from sites that use its services
                </a>
                .
              </li>
            </ul>
            <p>
              Visitors in the United Kingdom, the European Economic Area and Switzerland are asked
              for consent before advertising cookies are used, and can change that choice at any
              time from the consent message.
            </p>
          </>
        ) : (
          <p>
            This site does not currently show advertising and loads no advertising scripts. If that
            changes, this section will be updated first to explain which advertising service is
            used, what cookies it sets and how to opt out.
          </p>
        )}

        <h2>Links to other sites</h2>
        <p>
          Articles link to other websites, and my profile links go to services such as LinkedIn and
          GitHub. Those sites have their own privacy policies, which I do not control.
        </p>

        <h2>Your choices</h2>
        <p>
          If you have contacted me and would like a copy of your message, or want it deleted, email{" "}
          <a href={`mailto:${contact.email}`}>{contact.email}</a> and I will do so.
        </p>

        <h2>Changes to this policy</h2>
        <p>
          If this policy changes, the new version will be published on this page with a new
          &quot;last updated&quot; date.
        </p>
      </div>
    </div>
  );
}

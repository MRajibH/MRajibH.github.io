import type { Metadata } from "next";
import { contact } from "@/data/resume";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: `The terms that apply when you read and use the articles and code on ${site.name}.`,
  alternates: { canonical: "/terms/" },
};

export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight text-slate-light mb-3">
        Terms of Use
      </h1>
      <p className="text-slate mb-10">Last updated: 15 November 2026</p>

      <div className="prose-article text-slate-light">
        <p>
          {site.name} is the personal website and blog of {site.author}. By using the site you agree
          to the terms on this page.
        </p>

        <h2>Using the articles</h2>
        <p>
          The articles are written by me and are my copyright unless stated otherwise. You are
          welcome to quote short passages with a link back to the original article. Please do not
          republish whole articles without asking first.
        </p>

        <h2>Using the code</h2>
        <p>
          Code samples in the articles are there to be used. Unless an article says otherwise, you
          may copy and adapt them in your own projects, including commercial ones, without
          attribution.
        </p>

        <h2>No warranty</h2>
        <p>
          The articles describe what worked for me in a particular setup at a particular time.
          Software changes, and your environment will differ. Everything here is provided as is,
          without warranty of any kind. Read and understand any command before you run it,
          especially on a production system, and keep backups. I am not liable for loss or damage
          that results from using the information or code on this site.
        </p>

        <h2>Security content</h2>
        <p>
          Articles about security are written for defence: hardening your own systems and
          understanding how attacks are detected. Only test systems you own or have written
          permission to test.
        </p>

        <h2>Opinions</h2>
        <p>
          The views here are my own and do not represent my employer or any client. Product and
          company names are used only to identify them and belong to their owners.
        </p>

        <h2>Links to other sites</h2>
        <p>
          Links to other websites are provided for reference. I do not control those sites and am
          not responsible for their content.
        </p>

        <h2>Changes and contact</h2>
        <p>
          These terms may be updated, and the new version will be published on this page. Questions
          can be sent to <a href={`mailto:${contact.email}`}>{contact.email}</a>.
        </p>
      </div>
    </div>
  );
}

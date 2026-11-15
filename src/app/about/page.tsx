import type { Metadata } from "next";
import Image, { type StaticImageData } from "next/image";
import { site } from "@/lib/site";
import {
  contact,
  profiles,
  summary,
  skills,
  experience,
  education,
  certifications,
  projects,
} from "@/data/resume";
import { AnimateIn } from "@/components/AnimateIn";
import { SkillIcon } from "@/components/SkillIcon";
import { ProjectIcon } from "@/components/ProjectIcon";
import { ProfileSocialIcon } from "@/components/ProfileSocialIcon";
import profileImg from "../profile.jpg";
import universityLogo from "../university-logo.png";
import ndcLogo from "../notre-dame-college-dhaka-seeklogo.png";

const educationLogos: Record<string, StaticImageData> = {
  ewu: universityLogo,
  ndc: ndcLogo,
};

function Summary() {
  return (
    <section id="summary" className="section-padding border-t border-line">
      <AnimateIn>
        <h2 className="text-2xl font-bold text-slate-light mb-4 flex items-center gap-2">
          <span className="w-8 h-1 rounded bg-gradient-to-r from-accent to-transparent" />
          Summary
        </h2>
        <div className="space-y-4 max-w-3xl">
          {summary.map((paragraph) => (
            <p key={paragraph} className="text-slate leading-relaxed">
              {paragraph}
            </p>
          ))}
        </div>
      </AnimateIn>
    </section>
  );
}

function SkillsSection() {
  return (
    <section id="skills" className="section-padding border-t border-line">
      <AnimateIn>
        <h2 className="text-2xl font-bold text-slate-light mb-10 flex items-center gap-2">
          <span className="w-8 h-1 rounded bg-gradient-to-r from-accent to-transparent" />
          Technical Skills
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {skills.map((group, gi) => (
            <div
              key={group.category}
              className="glass-card rounded-xl p-6 group"
              style={{ animationDelay: `${gi * 80}ms` }}
            >
              <h3 className="text-base font-bold text-slate-light mb-1">
                {group.category}
              </h3>
              <p className="text-xs text-slate mb-4 leading-relaxed">
                {group.description}
              </p>
              <div className="flex flex-wrap gap-2">
                {group.items.map((item, si) => (
                  <span
                    key={item}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 hover:border-accent/40 hover:shadow-glow-sm transition-all duration-300 cursor-default"
                    style={{ animationDelay: `${(gi * 4 + si) * 60}ms` }}
                  >
                    <SkillIcon name={item} className={`icon-delay-${si % 6} !w-4 !h-4 !bg-transparent !rounded-none`} />
                    {item}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </AnimateIn>
    </section>
  );
}

function ExperienceSection() {
  return (
    <section id="experience" className="section-padding border-t border-line">
      <AnimateIn>
        <h2 className="text-2xl font-bold text-slate-light mb-10 flex items-center gap-2">
          <span className="w-8 h-0.5 bg-accent" />
          Experience
        </h2>
        <div className="relative pl-6 md:pl-8 border-l-2 border-slate/30 space-y-10">
          {experience.map((job) => (
            <div key={job.title + job.dates} className="relative -left-[29px] md:-left-[33px] group">
              <span className="absolute left-0 w-3 h-3 rounded-full bg-accent border-2 border-navy group-hover:shadow-glow transition-all duration-300" />
              <div className="pl-6 md:pl-8">
                <div className="glass-card p-6 rounded-xl">
                  <div className="flex flex-wrap items-baseline gap-2 mb-1">
                    <span className="text-slate text-sm font-mono">{job.dates}</span>
                    <span className="text-slate-light font-bold text-lg">{job.title}</span>
                  </div>
                  <p className="text-accent text-sm mb-4">
                    {job.company} · {job.location}
                  </p>
                  <ul className="text-slate text-sm space-y-2 list-disc list-inside">
                    {job.bullets.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>
      </AnimateIn>
    </section>
  );
}

function EducationSection() {
  return (
    <section id="education" className="section-padding border-t border-line relative z-10">
      <AnimateIn>
        <h2 className="text-2xl font-bold text-slate-light mb-10 flex items-center gap-2">
          <span className="w-8 h-0.5 bg-accent" />
          Education
        </h2>
        <div className="relative pl-6 md:pl-8 border-l-2 border-slate/30 space-y-8">
          {education.map((edu) => (
            <div key={edu.degree} className="relative -left-[29px] md:-left-[33px]">
              <span className="absolute left-0 w-3 h-3 rounded-full bg-accent/80 border-2 border-navy" />
              <div className="pl-6 md:pl-8 flex flex-col sm:flex-row sm:items-start gap-4">
                {"logoKey" in edu && educationLogos[edu.logoKey as string] && (
                  <div className="flex-shrink-0 w-16 h-16 sm:w-20 sm:h-20 relative rounded-lg overflow-hidden bg-navy-light border border-line">
                    <Image
                      src={educationLogos[edu.logoKey as string]}
                      alt={edu.institution}
                      fill
                      className="object-contain p-1"
                      sizes="80px"
                    />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2 mb-1">
                    <span className="text-slate text-sm">{edu.date}</span>
                    <span className="text-slate text-sm">{edu.location}</span>
                    <span className="text-slate-light font-bold">{edu.degree}</span>
                    {"batch" in edu && edu.batch && (
                      <span className="text-accent text-sm font-medium">Batch {edu.batch}</span>
                    )}
                  </div>
                  <p className="text-slate text-sm">{edu.institution}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </AnimateIn>
    </section>
  );
}

function ProjectsSection() {
  return (
    <section id="projects" className="section-padding border-t border-line">
      <AnimateIn>
        <h2 className="text-2xl font-bold text-slate-light mb-8 flex items-center gap-2">
          <span className="w-8 h-0.5 bg-accent" />
          Project Highlights
        </h2>
        <div className="space-y-10">
          {projects.map((project, i) => (
            <div
              key={project.title}
              className="flex flex-col md:flex-row gap-6 p-6 rounded-xl glass-card"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <div className="flex-shrink-0">
                <div className="w-12 h-12 rounded-lg bg-navy-light/50 flex items-center justify-center text-accent">
                  <ProjectIcon title={project.title} className={`icon-delay-${i % 6} w-6 h-6`} />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-xl font-bold text-slate-light mb-2 group-hover:text-accent transition-colors">{project.title}</h3>
                <p className="text-slate text-sm mb-4 leading-relaxed">{project.intro}</p>
                <ul className="text-slate text-sm space-y-2 list-disc list-inside bg-navy/30 p-4 rounded-lg">
                  {project.bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </AnimateIn>
    </section>
  );
}

function CertificationsSection() {
  return (
    <section id="certifications" className="section-padding border-t border-line relative z-10">
      <AnimateIn>
        <h2 className="text-2xl font-bold text-slate-light mb-8 flex items-center gap-2">
          <span className="w-8 h-0.5 bg-accent" />
          Licenses &amp; Certifications
        </h2>
        <div className="space-y-6">
          {certifications.map((cert) => (
            <div key={cert.name} className="glass-card p-6 rounded-xl">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-1">
                <h3 className="text-lg font-bold text-slate-light">{cert.name}</h3>
                <span className="text-slate text-sm font-mono">Issued {cert.issued}</span>
              </div>
              <p className="text-accent text-sm mb-4">{cert.issuer}</p>
              <p className="text-slate text-sm leading-relaxed mb-4">{cert.description}</p>
              <a
                href={cert.credentialUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent text-sm font-medium hover:underline"
              >
                Verify credential
              </a>
            </div>
          ))}
        </div>
      </AnimateIn>
    </section>
  );
}

export const metadata: Metadata = {
  title: "About",
  description:
    "Muhammad Rajib Hawlader is a Senior Software Engineer at Brotecs Technologies Limited: experience, skills, projects, education and certifications.",
  alternates: { canonical: "/about/" },
};

const personJsonLd = {
  "@context": "https://schema.org",
  "@type": "Person",
  name: site.author,
  url: `${site.url}/about/`,
  jobTitle: "Senior Software Engineer",
  worksFor: { "@type": "Organization", name: "Brotecs Technologies Limited" },
  sameAs: profiles.map((p) => p.url),
};

function Intro() {
  return (
    <section className="section-padding pt-16 flex flex-col-reverse md:flex-row md:items-center gap-10">
      <div className="flex-1 min-w-0">
        <p className="text-accent text-sm font-mono mb-3">About the author</p>
        <h1 className="font-display text-4xl md:text-5xl font-bold text-slate-light leading-tight mb-4">
          Muhammad Rajib Hawlader
        </h1>
        <p className="text-slate text-lg mb-6">Senior Software Engineer · {contact.location}</p>
        <div className="flex flex-wrap items-center gap-4">
          <a
            href={contact.resumeFile}
            download
            className="px-6 py-3 bg-accent text-navy font-semibold rounded-lg hover:shadow-glow transition-shadow"
          >
            Download Resume
          </a>
          <a
            href="/contact/"
            className="px-6 py-3 border border-line text-slate-light font-semibold rounded-lg hover:border-accent hover:text-accent transition-colors"
          >
            Contact
          </a>
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
      </div>
      <div className="relative flex-shrink-0 w-40 h-40 md:w-52 md:h-52 rounded-2xl overflow-hidden border border-line">
        <Image src={profileImg} alt={site.author} fill className="object-cover" sizes="208px" priority />
      </div>
    </section>
  );
}

export default function AboutPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(personJsonLd) }} />
      <Intro />
      <Summary />
      <SkillsSection />
      <ExperienceSection />
      <ProjectsSection />
      <EducationSection />
      <CertificationsSection />
    </>
  );
}

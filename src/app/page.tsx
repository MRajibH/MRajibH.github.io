import Image, { type StaticImageData } from "next/image";
import {
  contact,
  profiles,
  summary,
  skills,
  experience,
  education,
  projects,
} from "@/data/resume";
import { AnimateIn } from "@/components/AnimateIn";
import { SkillIcon } from "@/components/SkillIcon";
import { ProjectIcon } from "@/components/ProjectIcon";
import { ProfileSocialIcon } from "@/components/ProfileSocialIcon";
import { CodingBackground } from "@/components/CodingBackground";
import { ContactForm } from "@/components/ContactForm";
import profileImg from "./profile.jpg";
import universityLogo from "./university-logo.png";
import ndcLogo from "./notre-dame-college-dhaka-seeklogo.png";

const educationLogos: Record<string, StaticImageData> = {
  ewu: universityLogo,
  ndc: ndcLogo,
};

function Nav() {
  const links = [
    { label: "Summary", href: "#summary" },
    { label: "Skills", href: "#skills" },
    { label: "Experience", href: "#experience" },
    { label: "Education", href: "#education" },
    { label: "Projects", href: "#projects" },
    { label: "Contact", href: "#contact" },
  ];
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-navy/90 backdrop-blur border-b border-white/5">
      <nav className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <a href="#" className="text-xl font-bold">
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
      </nav>
    </header>
  );
}

function Hero() {
  return (
    <section className="min-h-screen flex flex-col lg:flex-row items-center justify-center gap-12 lg:gap-16 section-padding pt-24">
      <div className="relative flex-1">
        <div className="absolute top-0 right-0 w-72 h-72 bg-accent/10 rounded-full blur-3xl" />
        <p className="text-accent text-sm font-mono mb-2 opacity-0 animate-fade animate-delay-1">Hi, I&apos;m</p>
        <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-slate-light leading-tight mb-4 opacity-0 animate-fade animate-delay-2">
          {contact.name.split(" ").slice(0, 2).join(" ")}
          <br />
          <span className="text-accent">{contact.name.split(" ").slice(2).join(" ")}</span>
        </h1>
        <p className="text-slate text-lg max-w-xl mb-8 opacity-0 animate-fade animate-delay-3">{summary}</p>
        <div className="flex flex-wrap gap-4 opacity-0 animate-fade animate-delay-4">
          <a
            href="#contact"
            className="px-6 py-3 bg-accent text-navy font-semibold rounded hover:shadow-glow transition-all duration-300 hover:scale-[1.02]"
          >
            Get in Touch
          </a>
          <a
            href={contact.website}
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-3 border border-slate/50 text-slate-light rounded hover:border-accent hover:text-accent transition-colors"
          >
            View Portfolio
          </a>
        </div>
      </div>
      <div className="flex-shrink-0 w-56 h-56 md:w-72 md:h-72 relative z-10 animate-scale-in animate-delay-5">
        <div className="absolute inset-0 profile-img-float rounded-2xl overflow-hidden border-2 border-accent/30 shadow-glow ring-4 ring-accent/10">
          <Image
            src={profileImg}
            alt="Muhammad Rajib Hawlader"
            fill
            className="object-cover"
            sizes="(max-width: 768px) 224px, 288px"
            priority
          />
        </div>
      </div>
    </section>
  );
}

function Summary() {
  return (
    <section id="summary" className="section-padding border-t border-white/5">
      <AnimateIn>
        <h2 className="text-2xl font-bold text-slate-light mb-4 flex items-center gap-2">
          <span className="w-8 h-0.5 bg-accent" />
          Summary
        </h2>
        <p className="text-slate max-w-2xl leading-relaxed">
          {summary}
        </p>
      </AnimateIn>
    </section>
  );
}

function SkillsSection() {
  return (
    <section id="skills" className="section-padding border-t border-white/5">
      <AnimateIn>
        <h2 className="text-2xl font-bold text-slate-light mb-8 flex items-center gap-2">
          <span className="w-8 h-0.5 bg-accent" />
          Skills
        </h2>
        <div className="grid md:grid-cols-2 gap-10">
          <ul className="space-y-5">
            {skills.left.map(({ category, items }) => (
              <li key={category}>
                <span className="font-semibold text-slate-light">{category}:</span>
                <ul className="mt-2 flex flex-wrap gap-2 text-slate text-sm">
                  {items.map((item, i) => (
                    <li key={item} className="flex items-center gap-2">
                      <SkillIcon name={item} className={`icon-delay-${i % 6}`} />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <ul className="space-y-5">
            {skills.right.map(({ category, items }) => (
              <li key={category}>
                <span className="font-semibold text-slate-light">{category}:</span>
                <ul className="mt-2 flex flex-wrap gap-2 text-slate text-sm">
                  {items.map((item, i) => (
                    <li key={item} className="flex items-center gap-2">
                      <SkillIcon name={item} className={`icon-delay-${i % 6}`} />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      </AnimateIn>
    </section>
  );
}

function ExperienceSection() {
  return (
    <section id="experience" className="section-padding border-t border-white/5">
      <AnimateIn>
        <h2 className="text-2xl font-bold text-slate-light mb-10 flex items-center gap-2">
          <span className="w-8 h-0.5 bg-accent" />
          Experience
        </h2>
        <div className="relative pl-6 md:pl-8 border-l-2 border-slate/30 space-y-10">
          {experience.map((job) => (
            <div key={job.title + job.dates} className="relative -left-[29px] md:-left-[33px]">
              <span className="absolute left-0 w-3 h-3 rounded-full bg-accent border-2 border-navy" />
              <div className="pl-6 md:pl-8">
                <div className="flex flex-wrap items-baseline gap-2 mb-1">
                  <span className="text-slate text-sm">{job.dates}</span>
                  <span className="text-slate-light font-bold">{job.title}</span>
                </div>
                <p className="text-slate text-sm mb-2">
                  {job.company} · {job.location}
                </p>
                <ul className="text-slate text-sm space-y-1 list-disc list-inside">
                  {job.bullets.map((b) => (
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

function EducationSection() {
  return (
    <section id="education" className="section-padding border-t border-white/5 relative z-10">
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
                  <div className="flex-shrink-0 w-16 h-16 sm:w-20 sm:h-20 relative rounded-lg overflow-hidden bg-white/5 border border-white/10">
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
    <section id="projects" className="section-padding border-t border-white/5">
      <AnimateIn>
        <h2 className="text-2xl font-bold text-slate-light mb-8 flex items-center gap-2">
          <span className="w-8 h-0.5 bg-accent" />
          Project Highlights
        </h2>
        <div className="space-y-10">
          {projects.map((project, i) => (
            <div
              key={project.title}
              className="flex gap-4 p-6 rounded-lg bg-navy-light/50 border border-white/5 hover:border-accent/30 transition-all duration-300 hover:shadow-glow-sm"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <ProjectIcon title={project.title} className={`icon-delay-${i % 6}`} />
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-bold text-slate-light mb-2">{project.title}</h3>
                <p className="text-slate text-sm mb-3">{project.intro}</p>
                <ul className="text-slate text-sm space-y-1 list-disc list-inside">
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

function ProfilesSection() {
  return (
    <section className="section-padding border-t border-white/5 relative z-10">
      <AnimateIn>
        <h2 className="text-2xl font-bold text-slate-light mb-6 flex items-center gap-2">
          <span className="w-8 h-0.5 bg-accent" />
          Profiles
        </h2>
        <ul className="space-y-3">
          {profiles.map(({ label, url, icon }) => (
            <li key={label}>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate hover:text-accent transition-colors flex items-center gap-3 group"
              >
                <span className="flex-shrink-0 w-9 h-9 rounded-lg bg-navy-light/60 text-accent flex items-center justify-center group-hover:bg-accent/20 transition-colors">
                  <ProfileSocialIcon icon={icon} className="w-5 h-5" moving />
                </span>
                <span className="min-w-0 truncate">{label}: {url}</span>
              </a>
            </li>
          ))}
        </ul>
      </AnimateIn>
    </section>
  );
}

function ContactSection() {
  return (
    <section id="contact" className="section-padding border-t border-white/5">
      <AnimateIn>
        <ContactForm />
      </AnimateIn>
    </section>
  );
}

function Footer() {
  const companyLinks = [
    { label: "About", href: "#summary" },
    { label: "Experience", href: "#experience" },
    { label: "Education", href: "#education" },
    { label: "Projects", href: "#projects" },
  ];
  return (
    <footer className="border-t border-white/5">
      <div className="max-w-6xl mx-auto px-6 py-12 md:px-12 lg:px-24">
        <div className="grid md:grid-cols-3 gap-10 mb-10">
          <div>
            <p className="text-xl font-bold mb-3">
              <span className="text-accent">Rajib</span>
              <span className="text-slate-light">.uk</span>
            </p>
            <p className="text-slate text-sm">{contact.location}</p>
            <p className="text-slate text-sm">{contact.phone}</p>
            <a href={`mailto:${contact.email}`} className="text-slate text-sm hover:text-accent">
              {contact.email}
            </a>
            <div className="flex gap-3 mt-3 flex-wrap">
              {profiles.map(({ label, url, icon }) => (
                <a
                  key={label}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-10 h-10 rounded-lg bg-navy-light/60 text-accent flex items-center justify-center hover:bg-accent/20 hover:text-slate-light transition-colors"
                  aria-label={label}
                >
                  <ProfileSocialIcon icon={icon} className="w-5 h-5" moving />
                </a>
              ))}
            </div>
          </div>
          <div>
            <h4 className="font-semibold text-slate-light mb-3">Sitemap</h4>
            <ul className="space-y-2 text-slate text-sm">
              {companyLinks.map(({ label, href }) => (
                <li key={href}>
                  <a href={href} className="hover:text-accent transition-colors">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-slate-light mb-3">Connect</h4>
            <div className="flex flex-wrap gap-2">
              {profiles.map(({ label, url, icon }) => (
                <a
                  key={label}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate text-sm hover:text-accent flex items-center gap-2"
                >
                  <ProfileSocialIcon icon={icon} className="w-4 h-4" moving={false} />
                  {label}
                </a>
              ))}
            </div>
          </div>
        </div>
        <div className="pt-6 border-t border-white/5 flex flex-wrap justify-between items-center gap-4 text-slate text-sm">
          <span>© {new Date().getFullYear()} Muhammad Rajib Hawlader. All rights reserved.</span>
          <div className="flex gap-6">
            <a href="#" className="hover:text-accent">Privacy Policy</a>
            <a href="#" className="hover:text-accent">Terms of Service</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen bg-navy text-slate-light relative">
      <CodingBackground />
      <div className="relative z-10">
        <Nav />
        <main>
          <Hero />
          <Summary />
          <SkillsSection />
          <ExperienceSection />
          <EducationSection />
          <ProjectsSection />
          <ProfilesSection />
          <ContactSection />
          <Footer />
        </main>
      </div>
    </div>
  );
}

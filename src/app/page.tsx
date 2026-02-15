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
        <h1 className="text-4xl md:text-5xl lg:text-7xl font-bold text-slate-light leading-tight mb-4 opacity-0 animate-fade animate-delay-2">
          Muhammad Rajib
          <br />
          <span className="text-gradient inline-block">Hawlader</span>
        </h1>
        <div className="opacity-0 animate-fade animate-delay-3 mb-8">
          <h2 className="text-xl md:text-2xl text-slate font-mono typing-effect">
            Full Stack Software Engineer
          </h2>
          <p className="text-slate text-lg max-w-xl mt-4 leading-relaxed">
            {summary}
          </p>
        </div>
        <div className="flex flex-wrap gap-4 opacity-0 animate-fade animate-delay-4">
          <a
            href="#contact"
            className="px-6 py-3 bg-accent text-navy font-semibold rounded hover:shadow-glow transition-all duration-300 hover:scale-[1.02]"
          >
            Get in Touch
          </a>
          <a
            href="#projects"
            className="px-6 py-3 border border-slate/50 text-slate-light rounded hover:border-accent hover:text-accent transition-colors"
          >
            View My Work
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
          <span className="w-8 h-1 rounded bg-gradient-to-r from-accent to-transparent" />
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
    <section id="experience" className="section-padding border-t border-white/5">
      <AnimateIn>
        <h2 className="text-2xl font-bold text-slate-light mb-10 flex items-center gap-2">
          <span className="w-8 h-0.5 bg-accent" />
          Experience
        </h2>
        <div className="relative pl-6 md:pl-8 border-l-2 border-slate/30 space-y-10">
          {experience.map((job) => (
            <div key={job.title + job.dates} className="relative -left-[29px] md:-left-[33px] group">
              <span className="absolute left-0 w-3 h-3 rounded-full bg-accent border-2 border-navy group-hover:bg-white group-hover:shadow-[0_0_10px_#00aaff] transition-all duration-300" />
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

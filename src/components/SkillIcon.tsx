"use client";

import {
  SiPython,
  SiJavascript,
  SiTypescript,
  SiPhp,
  SiNodedotjs,
  SiReact,
  SiNextdotjs,
  SiAngular,
  SiExpress,
  SiHtml5,
  SiCss3,
  SiPostgresql,
  SiMysql,
  SiAmazon,
  SiDocker,
  SiGit,
  SiGithub,
  SiOpenai,
  SiJira,
  SiSwagger,
  SiJenkins,
  SiDebian,
  SiRockylinux,
  SiCentos,
  SiFreebsd,
} from "react-icons/si";
import { IconType } from "react-icons";

const skillIconMap: Record<string, IconType> = {
  Python: SiPython,
  JavaScript: SiJavascript,
  TypeScript: SiTypescript,
  PHP: SiPhp,
  "Node.js": SiNodedotjs,
  React: SiReact,
  "Next.js": SiNextdotjs,
  Angular: SiAngular,
  Express: SiExpress,
  HTML5: SiHtml5,
  CSS3: SiCss3,
  SQL: SiPostgresql, // Using generic DB icon or Postgres for SQL
  MySQL: SiMysql,
  PostgreSQL: SiPostgresql,
  "Debian": SiDebian,
  "Rocky Linux": SiRockylinux,
  "CentOS": SiCentos,
  "FreeBSD": SiFreebsd,
  AWS: SiAmazon,
  Docker: SiDocker,
  Git: SiGit,
  GitHub: SiGithub,
  "Git/GitHub": SiGithub,
  Jira: SiJira,
  "OpenAI APIs": SiOpenai,
  "LLM integration": SiOpenai,
  "REST APIs": SiSwagger,
  "CI/CD": SiJenkins,
};

const defaultIcon = SiJavascript;

export function SkillIcon({ name, className = "" }: { name: string; className?: string }) {
  const Icon = skillIconMap[name] ?? defaultIcon;
  return (
    <span
      className={`inline-flex items-center justify-center w-6 h-6 rounded-md bg-navy-light/60 text-accent icon-float transition-all duration-300 hover:shadow-glow hover:text-white ${className}`}
      title={name}
    >
      <Icon className="w-3.5 h-3.5" />
    </span>
  );
}

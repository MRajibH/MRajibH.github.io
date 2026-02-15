"use client";

import {
  SiPython,
  SiJavascript,
  SiTypescript,
  SiNodedotjs,
  SiReact,
  SiNextdotjs,
  SiExpress,
  SiHtml5,
  SiCss3,
  SiPostgresql,
  SiMongodb,
  SiAmazon,
  SiDocker,
  SiGit,
  SiGithub,
  SiOpenai,
  SiJira,
  SiSwagger,
  SiJenkins,
} from "react-icons/si";
import { IconType } from "react-icons";

const skillIconMap: Record<string, IconType> = {
  Python: SiPython,
  JavaScript: SiJavascript,
  TypeScript: SiTypescript,
  "Node.js": SiNodedotjs,
  React: SiReact,
  "Next.js": SiNextdotjs,
  Express: SiExpress,
  HTML5: SiHtml5,
  CSS3: SiCss3,
  SQL: SiPostgresql,
  MongoDB: SiMongodb,
  PostgreSQL: SiPostgresql,
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
      className={`inline-flex items-center justify-center w-6 h-6 rounded-md bg-navy-light/60 text-accent icon-float ${className}`}
      title={name}
    >
      <Icon className="w-3.5 h-3.5" />
    </span>
  );
}

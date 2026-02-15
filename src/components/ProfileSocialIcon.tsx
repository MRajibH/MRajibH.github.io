"use client";

import { SiLinkedin, SiGithub, SiResearchgate, SiX, SiFacebook } from "react-icons/si";
import { IconType } from "react-icons";

const iconMap: Record<string, IconType> = {
  linkedin: SiLinkedin,
  github: SiGithub,
  researchgate: SiResearchgate,
  x: SiX,
  facebook: SiFacebook,
};

export function ProfileSocialIcon({
  icon,
  className = "",
  moving = true,
}: {
  icon: string;
  className?: string;
  moving?: boolean;
}) {
  const Icon = iconMap[icon] ?? SiGithub;
  return (
    <span
      className={`inline-flex items-center justify-center transition-transform duration-300 hover:scale-110 ${moving ? "profile-icon-float" : ""} ${className}`}
    >
      <Icon className="w-full h-full" />
    </span>
  );
}

import { ogImage, ogSize } from "@/lib/og";

export const dynamic = "force-static";
export const size = ogSize;
export const contentType = "image/png";
export const alt = "rajib.uk: engineering notes on self-hosted AI and Linux systems";

export default function Image() {
  return ogImage({
    eyebrow: "Engineering notes",
    title: "Self-hosted AI and Linux systems, built for production.",
  });
}

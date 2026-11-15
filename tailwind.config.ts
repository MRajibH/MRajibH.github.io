import type { Config } from "tailwindcss";

// Colours come from CSS variables in globals.css so the same class names work
// in the dark and light themes. The names are historical: navy = page
// background, navy-light = raised surface, slate = muted text, slate-light =
// main text.
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: [
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: v("bg"),
        "navy-light": v("surface"),
        line: v("line"),
        accent: v("accent"),
        accent2: v("accent2"),
        slate: v("muted"),
        "slate-light": v("text"),
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 0 20px rgb(var(--accent) / 0.3)",
        "glow-sm": "0 0 10px rgb(var(--accent) / 0.2)",
      },
    },
  },
  plugins: [],
};
export default config;

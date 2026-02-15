import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: "#0A192F",
        "navy-light": "#112240",
        accent: "#00aaff",
        "accent-dim": "rgba(0, 170, 255, 0.15)",
        slate: "#8892b0",
        "slate-light": "#ccd6f6",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 20px rgba(0, 170, 255, 0.3)",
        "glow-sm": "0 0 10px rgba(0, 170, 255, 0.2)",
      },
    },
  },
  plugins: [],
};
export default config;

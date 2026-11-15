"use client";

import { useEffect, useState } from "react";

async function writeClipboard(value: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }
  // Fallback for browsers or pages without the async clipboard API.
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  if (!ok) throw new Error("copy failed");
}

/**
 * Makes the copy buttons in article code blocks work (the buttons themselves
 * are rendered into the static HTML by src/lib/code-blocks.ts). One listener
 * handles every block on the page.
 */
export function CodeCopy() {
  const [message, setMessage] = useState("");

  useEffect(() => {
    const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

    const onClick = async (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(".code-copy");
      if (!button) return;
      const code = button.closest(".code-block")?.querySelector("pre code, pre");
      if (!code) return;

      const label = button.querySelector(".code-copy-text");
      let state: "copied" | "failed" = "copied";
      try {
        await writeClipboard((code.textContent ?? "").replace(/\n$/, ""));
      } catch {
        state = "failed";
      }
      button.dataset.state = state;
      if (label) label.textContent = state === "copied" ? "Copied" : "Press Ctrl+C";
      setMessage(state === "copied" ? "Code copied to clipboard" : "Copy failed");

      clearTimeout(timers.get(button));
      timers.set(
        button,
        setTimeout(() => {
          delete button.dataset.state;
          if (label) label.textContent = "Copy";
          setMessage("");
        }, 2000),
      );
    };

    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);

  return (
    <span role="status" aria-live="polite" className="sr-only">
      {message}
    </span>
  );
}

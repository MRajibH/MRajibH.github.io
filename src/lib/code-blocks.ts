/**
 * rehype plugin: wraps every fenced code block in a frame with a header that
 * shows the language and a copy button.
 *
 * The button is plain HTML in the static page; `CodeCopy` attaches the click
 * behaviour in the browser.
 */

type HNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HNode[];
  value?: string;
};

const LABELS: Record<string, string> = {
  bash: "Bash",
  sh: "Shell",
  shell: "Shell",
  zsh: "Shell",
  python: "Python",
  py: "Python",
  yaml: "YAML",
  yml: "YAML",
  ini: "INI",
  toml: "TOML",
  json: "JSON",
  dockerfile: "Dockerfile",
  http: "HTTP",
  sql: "SQL",
  nginx: "nginx",
  nft: "nftables",
  ts: "TypeScript",
  typescript: "TypeScript",
  js: "JavaScript",
  javascript: "JavaScript",
  markdown: "Markdown",
  md: "Markdown",
  css: "CSS",
  html: "HTML",
  xml: "XML",
  diff: "Diff",
  go: "Go",
  rust: "Rust",
  caddyfile: "Caddyfile",
  text: "Text",
  txt: "Text",
  plaintext: "Text",
};

export function languageLabel(lang: string | undefined) {
  if (!lang) return "Text";
  return LABELS[lang.toLowerCase()] ?? lang.charAt(0).toUpperCase() + lang.slice(1);
}

const el = (tagName: string, properties: Record<string, unknown>, children: HNode[] = []): HNode => ({
  type: "element",
  tagName,
  properties,
  children,
});
const text = (value: string): HNode => ({ type: "text", value });

const icon = (className: string, shapes: HNode[]) =>
  el(
    "svg",
    {
      className: [className],
      viewBox: "0 0 24 24",
      width: 16,
      height: 16,
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      ariaHidden: "true",
    },
    shapes,
  );

const copyIcon = () =>
  icon("code-icon-copy", [
    el("rect", { x: 9, y: 9, width: 13, height: 13, rx: 2 }),
    el("path", { d: "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" }),
  ]);
const checkIcon = () => icon("code-icon-done", [el("path", { d: "M20 6 9 17l-5-5" })]);

function languageOf(code: HNode) {
  const cls = code.properties?.className;
  const list = Array.isArray(cls) ? cls.map(String) : [];
  return list.find((c) => c.startsWith("language-"))?.slice("language-".length);
}

function wrap(pre: HNode): HNode {
  const code = pre.children?.find((c) => c.type === "element" && c.tagName === "code");
  const label = languageLabel(code ? languageOf(code) : undefined);
  return el("div", { className: ["code-block"] }, [
    el("div", { className: ["code-head"] }, [
      el("span", { className: ["code-lang"] }, [text(label)]),
      el(
        "button",
        { type: "button", className: ["code-copy"], ariaLabel: `Copy ${label} code` },
        [copyIcon(), checkIcon(), el("span", { className: ["code-copy-text"] }, [text("Copy")])],
      ),
    ]),
    pre,
  ]);
}

function visit(node: HNode) {
  if (!node.children) return;
  node.children = node.children.map((child) => {
    if (child.type === "element" && child.tagName === "pre") return wrap(child);
    visit(child);
    return child;
  });
}

export function rehypeCodeBlocks() {
  return (tree: HNode) => visit(tree);
}

import type { Art } from "@/lib/posts";

/**
 * The illustration at the top of an article: an animated diagram drawn from
 * the article's own front matter (`art:`), so it is original artwork that
 * explains the article rather than a stock picture.
 *
 * The animation is a highlight that moves from step to step. It never hides
 * content, so the diagram reads the same with animations off.
 */
export function ArticleArt({ art }: { art: Art }) {
  const n = art.items.length;
  // One full cycle lights each item in turn.
  const style = (i: number) =>
    ({ "--art-delay": `${i * 0.9}s`, "--art-cycle": `${n * 0.9}s` }) as React.CSSProperties;

  let body: React.ReactNode;

  if (art.kind === "flow") {
    body = (
      <ol className="flex flex-col md:flex-row md:items-stretch gap-2 md:gap-0">
        {art.items.map((item, i) => (
          <li key={item} className="flex flex-col md:flex-row md:items-center md:flex-1 gap-2 md:gap-0">
            <span
              style={style(i)}
              className="art-step flex-1 flex items-center justify-center text-center px-3 py-4 rounded-xl border border-line bg-navy text-sm font-medium text-slate-light"
            >
              {item}
            </span>
            {i < n - 1 && (
              <span aria-hidden className="self-center px-1.5 text-accent rotate-90 md:rotate-0">
                →
              </span>
            )}
          </li>
        ))}
      </ol>
    );
  } else if (art.kind === "layers") {
    body = (
      <ol className="flex flex-col items-center gap-2">
        {art.items.map((item, i) => (
          <li
            key={item}
            style={{ ...style(i), width: `${100 - i * (40 / Math.max(n - 1, 1))}%` }}
            className="art-step min-w-[70%] sm:min-w-0 px-4 py-3 rounded-xl border border-line bg-navy text-center text-sm font-medium text-slate-light"
          >
            {item}
          </li>
        ))}
      </ol>
    );
  } else if (art.kind === "compare") {
    body = (
      <ul className="grid gap-3 sm:grid-cols-3">
        {art.items.map((item, i) => {
          const [name, note] = item.split(" | ");
          return (
            <li
              key={item}
              style={style(i)}
              className="art-step flex flex-col gap-1.5 px-4 py-5 rounded-xl border border-line bg-navy text-center"
            >
              <span className="font-display text-lg font-semibold text-slate-light">{name}</span>
              {note && <span className="text-sm text-slate">{note}</span>}
            </li>
          );
        })}
      </ul>
    );
  } else {
    body = (
      <div className="rounded-xl border border-line overflow-hidden" style={{ background: "rgb(var(--code-bg))" }}>
        <div aria-hidden className="flex gap-1.5 px-4 py-3 border-b border-white/10">
          <span className="w-2.5 h-2.5 rounded-full bg-white/25" />
          <span className="w-2.5 h-2.5 rounded-full bg-white/25" />
          <span className="w-2.5 h-2.5 rounded-full bg-white/25" />
        </div>
        <ol className="p-4 flex flex-col gap-1 font-mono text-[13px] sm:text-sm text-[#e6edf7] overflow-x-auto">
          {art.items.map((item, i) => (
            <li key={item} style={style(i)} className="art-line whitespace-nowrap px-2 py-1 rounded">
              <span aria-hidden className="text-[#5cc0ff] select-none">$ </span>
              {item}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <figure className="mb-10">
      <div className="art-frame relative overflow-hidden rounded-2xl border border-line bg-navy-light p-5 sm:p-7">
        {body}
      </div>
      <figcaption className="mt-3 text-sm text-slate text-center">{art.caption}</figcaption>
    </figure>
  );
}

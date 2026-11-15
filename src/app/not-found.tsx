import Link from "next/link";

export default function NotFound() {
  return (
    <section className="section-padding py-28 text-center">
      <p className="font-mono text-accent mb-3">404</p>
      <h1 className="font-display text-4xl font-bold text-slate-light mb-4">Page not found</h1>
      <p className="text-slate mb-8">The page you were looking for has moved or never existed.</p>
      <Link
        href="/"
        className="inline-block px-6 py-3 rounded-lg bg-accent text-navy font-semibold hover:shadow-glow transition-shadow"
      >
        Go to the home page
      </Link>
    </section>
  );
}

import Link from "next/link";
import { LogoMark } from "@/components/Logo";

export function Wordmark({ className = "text-xl" }: { className?: string }) {
  return (
    <span className={`wordmark ${className}`} aria-label="QuickFurno">
      <LogoMark className="wordmark-mark" />
      <span className="wordmark-text">
        <span className="q">Quick</span>
        <span className="f">Furno</span>
      </span>
    </span>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-navy-ink/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <Link href="/" className="transition hover:opacity-90">
          <Wordmark />
        </Link>
        <nav className="hidden items-center gap-7 font-sans text-sm text-muted md:flex">
          <Link href="/#how" className="transition hover:text-ivory">How it works</Link>
          <Link href="/pricing" className="transition hover:text-ivory">Lead packs</Link>
          <Link href="/vendors/register" className="transition hover:text-ivory">For partners</Link>
          <Link href="/login" className="transition hover:text-ivory">Sign in</Link>
        </nav>
        <Link href="/enquiry" className="btn-gold !px-5 !py-2.5 text-xs">Get free quotes</Link>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-white/10">
      <div className="mx-auto max-w-6xl px-5 py-12">
        <div className="grid gap-8 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Wordmark className="text-lg" />
            <p className="mt-3 max-w-sm font-sans text-sm text-muted">
              Verified interior &amp; carpentry leads, matched to trusted local studios. Pune, Maharashtra.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/enquiry" className="btn-gold !px-5 !py-2.5 text-xs">Get free quotes</Link>
              <Link href="/vendors/register" className="btn-ghost !px-5 !py-2.5 text-xs">Register as partner</Link>
            </div>
          </div>
          <div>
            <p className="eyebrow">Explore</p>
            <ul className="mt-3 space-y-2 font-sans text-sm text-muted">
              <li><Link href="/enquiry" className="transition hover:text-ivory">Get free quotes</Link></li>
              <li><Link href="/vendors/register" className="transition hover:text-ivory">Become a partner</Link></li>
              <li><Link href="/pricing" className="transition hover:text-ivory">Lead packs</Link></li>
              <li><Link href="/login" className="transition hover:text-ivory">Sign in</Link></li>
            </ul>
          </div>
          <div>
            <p className="eyebrow">Contact</p>
            <ul className="mt-3 space-y-1 font-sans text-sm text-muted">
              <li>Kharadi Annex, Pune 411014</li>
              <li>+91 77200 00553</li>
              <li>quickfurno@gmail.com</li>
            </ul>
          </div>
        </div>
        <p className="mt-10 text-xs text-muted/60">© {new Date().getFullYear()} QuickFurno Marketplace · Pune, Maharashtra</p>
      </div>
    </footer>
  );
}

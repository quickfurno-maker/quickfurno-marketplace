import Link from "next/link";

export function Wordmark({ className = "text-xl" }: { className?: string }) {
  return (
    <span className={`wordmark ${className}`} aria-label="QuickFurno">
      <span className="q">QUICK</span>
      <span className="f">FURNO</span>
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
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-10 md:flex-row md:items-center md:justify-between">
        <div>
          <Wordmark className="text-lg" />
          <p className="mt-2 max-w-sm font-sans text-sm text-muted">
            Verified interior &amp; carpentry leads, matched to trusted local studios.
          </p>
        </div>
        <div className="font-sans text-sm text-muted">
          <p>Kharadi Annex, Pune 411014</p>
          <p>quickfurno@gmail.com · +91 77200 00553</p>
          <p className="mt-3 text-xs text-muted/60">© {new Date().getFullYear()} QuickFurno</p>
        </div>
      </div>
    </footer>
  );
}

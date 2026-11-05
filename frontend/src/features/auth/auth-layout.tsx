import { ArrowUpRight, Landmark, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

interface AuthLayoutProps {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}

export function AuthLayout({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: AuthLayoutProps) {
  return (
    <main className="grid min-h-screen bg-white lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.9fr)]">
      <section className="flex min-h-screen flex-col px-5 py-7 sm:px-10 lg:px-16">
        <a aria-label="FinPilot home" className="inline-flex w-fit items-center gap-3" href="/">
          <span className="grid size-11 place-items-center rounded-2xl bg-slate-950 text-cyan-300 shadow-lg shadow-slate-300/50">
            <Landmark aria-hidden="true" className="size-5" />
          </span>
          <span className="text-lg font-bold tracking-tight text-slate-950">FinPilot</span>
        </a>

        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-14">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-800">
            {eyebrow}
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            {title}
          </h1>
          <p className="mt-3 max-w-sm text-sm leading-6 text-slate-600">{subtitle}</p>
          <div className="mt-8">{children}</div>
          <div className="mt-7 text-sm text-slate-600">{footer}</div>
          <p className="mt-10 flex items-center gap-2 text-xs text-slate-500">
            <ShieldCheck aria-hidden="true" className="size-4 text-emerald-700" />
            Your company data stays scoped to your membership.
          </p>
        </div>
        <p className="text-xs text-slate-400">FinPilot · Financial operations for small teams</p>
      </section>

      <aside className="relative hidden min-h-screen overflow-hidden bg-slate-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(148,163,184,.18)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,.18)_1px,transparent_1px)] [background-size:48px_48px]"
        />
        <div
          aria-hidden="true"
          className="absolute -right-24 top-20 size-[28rem] rounded-full bg-cyan-500/20 blur-[100px]"
        />
        <div className="relative flex items-center gap-2 text-sm font-medium text-slate-300">
          <span className="size-2 rounded-full bg-emerald-400" />
          One clear view of your operations
        </div>

        <div className="relative max-w-xl">
          <div className="mb-8 flex items-end gap-2" aria-hidden="true">
            {[32, 54, 42, 76, 62, 92, 70].map((height, index) => (
              <span
                className="w-7 rounded-t-lg bg-gradient-to-t from-cyan-500/30 to-cyan-300"
                key={index}
                style={{ height }}
              />
            ))}
            <span className="mb-2 ml-3 h-px flex-1 bg-gradient-to-r from-cyan-300/80 to-transparent" />
          </div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-cyan-300">
            Company finance, made legible
          </p>
          <h2 className="mt-4 text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">
            The details stay close. The bigger picture gets clearer.
          </h2>
          <p className="mt-5 max-w-lg text-base leading-7 text-slate-300">
            Bring transactions, invoices, budgets, and useful financial context into one
            company-scoped workspace.
          </p>
          <div className="mt-8 flex items-center gap-2 text-sm text-slate-300">
            <span>Built for owners, accountants, and viewers</span>
            <ArrowUpRight aria-hidden="true" className="size-4 text-cyan-300" />
          </div>
        </div>

        <p className="relative text-xs text-slate-500">Your access follows your company role.</p>
      </aside>
    </main>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheckIcon, SparklesIcon } from "lucide-react";
import { useState } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";
import { IDLE_LIMIT_MS } from "@/lib/idle-logout";

export const Route = createFileRoute("/login")({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): { reason?: string } => ({
    reason: typeof search.reason === "string" ? search.reason : undefined,
  }),
});

function RouteComponent() {
  const { reason } = Route.useSearch();
  const [showSignIn, setShowSignIn] = useState(true);

  return (
    <div className="grid min-h-svh bg-background lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-hero p-12 text-hero-foreground lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="ledger-lines absolute inset-x-0 top-[17px] bottom-[17px] opacity-60" />
        <div className="relative flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-hero-foreground font-display text-xl text-hero">D</span>
          <div>
            <p className="font-display text-xl leading-none">DreamDev</p>
            <p className="text-micro mt-1.5 text-hero-muted">Team Fund</p>
          </div>
        </div>

        <div className="relative max-w-md">
          <p className="text-micro text-hero-accent">Members' ledger</p>
          <h1 className="mt-4 font-display text-5xl leading-[1.04]">
            Every taka,
            <br />
            accounted for.
          </h1>
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-hero-muted">
            Monthly shares, contributions, dues, and interest-free loans — held in one clear ledger for the whole team.
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-hero-foreground/15 bg-hero-foreground/5 px-3 py-1 text-xs text-hero-muted">
              <ShieldCheckIcon className="size-3.5" /> One team, one fund
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-hero-foreground/15 bg-hero-foreground/5 px-3 py-1 text-xs text-hero-muted">
              <SparklesIcon className="size-3.5" /> Interest-free loans
            </span>
          </div>
        </div>

        <dl className="relative grid grid-cols-3 gap-6 border-t border-hero-foreground/15 pt-6">
          <div>
            <dt className="text-micro text-hero-muted">Currency</dt>
            <dd className="mt-1 font-display text-2xl">৳ BDT</dd>
          </div>
          <div>
            <dt className="text-micro text-hero-muted">Loan interest</dt>
            <dd className="mt-1 font-display text-2xl">0%</dd>
          </div>
          <div>
            <dt className="text-micro text-hero-muted">Funds</dt>
            <dd className="mt-1 font-display text-2xl">One</dd>
          </div>
        </dl>
      </section>

      <div className="flex min-h-svh flex-col">
        <header className="flex h-20 items-center justify-between px-5 sm:px-10">
          <div className="flex items-center gap-3 lg:hidden">
            <span className="grid size-9 place-items-center rounded-xl bg-primary font-display text-lg text-primary-foreground">D</span>
            <div>
              <p className="font-display text-lg leading-none">DreamDev</p>
              <p className="text-micro mt-1 text-muted-foreground">Team Fund</p>
            </div>
          </div>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center px-5 pb-12 sm:px-10">
          <div className="w-full max-w-sm">
            {reason === "idle" ? (
              <p className="mb-4 rounded-lg border border-border bg-muted px-3 py-2 text-center text-xs text-muted-foreground">
                You were signed out after {IDLE_LIMIT_MS / 60_000} minutes of inactivity — sign in to continue.
              </p>
            ) : null}
            {showSignIn ? (
              <SignInForm onSwitchToSignUp={() => setShowSignIn(false)} />
            ) : (
              <SignUpForm onSwitchToSignIn={() => setShowSignIn(true)} />
            )}
          </div>
        </main>

        <footer className="px-5 pb-6 text-[11px] text-muted-foreground sm:px-10">
          DreamDev · Team savings fund · All amounts in BDT
        </footer>
      </div>
    </div>
  );
}

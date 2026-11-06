import { Button } from "@DreamDev/ui/components/button";
import { Link, useMatchRoute, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeftRightIcon,
  ChevronRightIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  MenuIcon,
  PlusIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UsersIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { AgentPanel } from "./agent/agent-panel";
import { ThemeToggle } from "./theme-toggle";
import UserMenu from "./user-menu";

export interface ShellUser {
  name: string;
  email: string;
  role: string;
}

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

const NAV: { label: string; items: NavItem[] }[] = [
  { label: "Overview", items: [{ to: "/dashboard", label: "Dashboard", icon: LayoutDashboardIcon }] },
  {
    label: "Fund",
    items: [
      { to: "/members", label: "Members", icon: UsersIcon },
      { to: "/transactions", label: "Transactions", icon: ArrowLeftRightIcon },
      { to: "/banks", label: "Bank accounts", icon: LandmarkIcon },
    ],
  },
  {
    label: "Administration",
    items: [
      { to: "/users", label: "Users", icon: ShieldCheckIcon, adminOnly: true },
      { to: "/settings", label: "Settings", icon: SettingsIcon },
    ],
  },
];

const SECTION_TITLES: [prefix: string, title: string][] = [
  ["/dashboard", "Overview"],
  ["/members", "Members"],
  ["/transactions", "Transactions"],
  ["/banks", "Bank accounts"],
  ["/users", "Users"],
  ["/settings", "Settings"],
];

function Brand() {
  return (
    <Link to="/dashboard" className="flex items-center gap-3 rounded-lg focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none">
      <span className="grid size-10 place-items-center rounded-xl bg-primary font-display text-xl text-primary-foreground shadow-sm">D</span>
      <span className="flex flex-col">
        <span className="font-display text-lg leading-none tracking-tight">DreamDev</span>
        <span className="text-micro mt-1 text-muted-foreground">Team Fund</span>
      </span>
    </Link>
  );
}

function NavLink({ item, user, onNavigate }: { item: NavItem; user: ShellUser; onNavigate?: () => void }) {
  const matchRoute = useMatchRoute();
  const active = Boolean(matchRoute({ to: item.to, fuzzy: true }));
  if (item.adminOnly && user.role !== "admin") return null;
  const Icon = item.icon;

  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={[
        "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
      ].join(" ")}
    >
      <Icon className={active ? "size-4 text-primary" : "size-4 text-muted-foreground transition-colors group-hover:text-foreground"} />
      <span className="flex-1">{item.label}</span>
      {active && <span aria-hidden className="size-1.5 rounded-full bg-primary" />}
    </Link>
  );
}

function SidebarContent({ user, onNavigate }: { user: ShellUser; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-20 items-center border-b border-sidebar-border px-5">
        <Brand />
      </div>
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-6">
        {NAV.map((group) => (
          <div key={group.label} className="mb-6 last:mb-0">
            <p className="text-micro mb-2 px-3 text-muted-foreground/70">{group.label}</p>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <NavLink key={item.to} item={item} user={user} onNavigate={onNavigate} />
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-sidebar-border p-4">
        <div className="flex items-start gap-3 rounded-lg bg-sidebar-accent/50 p-3">
          <LandmarkIcon className="mt-0.5 size-4 text-primary" />
          <div>
            <p className="text-xs font-medium text-sidebar-foreground">One team, one ledger</p>
            <p className="mt-0.5 text-xs text-muted-foreground">All amounts in ৳ BDT</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function MobileNav({ open, onClose, user }: { open: boolean; onClose: () => void; user: ShellUser }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button aria-label="Close navigation" className="absolute inset-0 cursor-default bg-foreground/30 backdrop-blur-[2px]" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className="absolute inset-y-0 left-0 w-[86%] max-w-xs border-r border-sidebar-border bg-sidebar shadow-float duration-200 animate-in slide-in-from-left"
      >
        <div className="absolute top-5 right-4 z-10">
          <Button variant="ghost" size="icon" aria-label="Close navigation" onClick={onClose}>
            <XIcon />
          </Button>
        </div>
        <SidebarContent user={user} onNavigate={onClose} />
      </aside>
    </div>
  );
}

export function AppShell({ user, children }: { user: ShellUser; children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const section = /^\/members\/[^/]+$/.test(pathname)
    ? "Member profile"
    : SECTION_TITLES.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? "Overview";

  return (
    <div className="min-h-svh bg-background lg:grid lg:grid-cols-[264px_1fr]">
      <a
        href="#main"
        className="sr-only z-[60] rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-4 focus:left-4"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-svh border-r border-sidebar-border bg-sidebar lg:block">
        <SidebarContent user={user} />
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
            <MenuIcon />
          </Button>

          <div className="flex min-w-0 items-center gap-2 text-sm">
            <Link to="/dashboard" className="font-display text-base text-foreground lg:hidden">
              DreamDev
            </Link>
            <span className="hidden items-center gap-2 lg:flex">
              <Link to="/dashboard" className="text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline">
                DreamDev
              </Link>
              <ChevronRightIcon className="size-3.5 text-muted-foreground/60" />
              <span className="font-medium text-foreground">{section}</span>
            </span>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <Link
              to="/transactions"
              search={{ page: 1, pageSize: 20, order: "desc" }}
              className="hidden h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/88 sm:inline-flex"
            >
              <PlusIcon className="size-4" />
              New entry
            </Link>
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
          {children}
        </main>
      </div>

      <MobileNav open={mobileOpen} onClose={() => setMobileOpen(false)} user={user} />
      <AgentPanel user={user} />
    </div>
  );
}

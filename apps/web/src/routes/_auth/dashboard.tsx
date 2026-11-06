import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  HandCoinsIcon,
  InfoIcon,
  ReceiptTextIcon,
  TrendingUpIcon,
  TriangleAlertIcon,
  UsersIcon,
} from "lucide-react";
import { useState } from "react";

import { formatTaka } from "@DreamDev/db/domain/money";
import { monthOfDate } from "@DreamDev/db/domain/month";
import { Button, buttonVariants } from "@DreamDev/ui/components/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@DreamDev/ui/components/card";
import { Progress } from "@DreamDev/ui/components/progress";
import { Skeleton } from "@DreamDev/ui/components/skeleton";
import { cn } from "@DreamDev/ui/lib/utils";

import type { DashboardData } from "@/api/dashboard/service";
import { Amount } from "@/components/amount";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { TransactionIcon, TYPE_LABELS } from "@/components/transaction-icon";
import { api } from "@/lib/api";
import { formatDay, formatMonth, todayLong } from "@/lib/format";

const MEMBERS_SEARCH = { page: 1, pageSize: 10, sort: "createdAt", order: "desc" } as const;
const TRANSACTIONS_SEARCH = { page: 1, pageSize: 20, order: "desc" } as const;

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const Route = createFileRoute("/_auth/dashboard")({
  validateSearch: (search: Record<string, unknown>): { year?: number } => ({ year: search.year ? Number(search.year) : undefined }),
  component: DashboardPage,
});

function DashboardPage() {
  const { year } = Route.useSearch();
  const navigate = Route.useNavigate();

  const dashboardQuery = useQuery({
    queryKey: ["dashboard", year],
    queryFn: () => api<DashboardData>(`/api/dashboard${year ? `?year=${year}` : ""}`),
  });

  if (dashboardQuery.isLoading) return <DashboardSkeleton />;

  if (dashboardQuery.isError || !dashboardQuery.data) {
    return (
      <div className="mx-auto w-full max-w-[1440px]">
        <EmptyState
          icon={TriangleAlertIcon}
          title="Couldn't load the dashboard"
          description="The fund figures didn't arrive. Try again in a moment."
          action={<Button onClick={() => dashboardQuery.refetch()}>Retry</Button>}
        />
      </div>
    );
  }

  const data = dashboardQuery.data;
  const { kpis } = data;
  const currentMonth = monthOfDate(new Date());
  const totalHoldings = kpis.bankBalances.reduce((sum, bank) => sum + bank.currentBalance, 0);
  const collectionRate = kpis.thisMonthBilled > 0 ? Math.round((kpis.thisMonthCollected / kpis.thisMonthBilled) * 100) : null;

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-8">
      <PageHeader
        eyebrow="Overview"
        title="Fund overview"
        description={todayLong()}
        actions={
          <>
            <Link to="/members" search={MEMBERS_SEARCH} className={cn(buttonVariants({ variant: "outline" }), "gap-2")}>
              Members
              <UsersIcon className="size-4" />
            </Link>
            <Link to="/transactions" search={TRANSACTIONS_SEARCH} className={cn(buttonVariants(), "gap-2")}>
              Record entry
              <ArrowRightIcon className="size-4" />
            </Link>
          </>
        }
      />

      <section aria-labelledby="holdings-heading" className="relative overflow-hidden rounded-2xl bg-hero text-hero-foreground shadow-card">
        <div aria-hidden className="ledger-lines absolute inset-x-0 top-[17px] bottom-[17px]" />
        <div className="relative grid gap-8 p-6 sm:p-8 lg:grid-cols-[1.15fr_1fr] lg:gap-12">
          <div className="flex flex-col justify-between gap-8">
            <div>
              <p id="holdings-heading" className="text-micro text-hero-muted">
                Total fund holdings
              </p>
              <p className="mt-3 font-display text-4xl leading-none tracking-tight tabular sm:text-5xl">{formatTaka(totalHoldings)}</p>
              <p className="mt-3 text-sm text-hero-muted">
                Across {kpis.bankBalances.length} {kpis.bankBalances.length === 1 ? "bank account" : "bank accounts"} · {kpis.activeMembers} active{" "}
                {kpis.activeMembers === 1 ? "member" : "members"} · {kpis.totalShares} shares
              </p>
            </div>

            <div className="max-w-md">
              <div className="flex items-baseline justify-between gap-4">
                <p className="text-xs font-medium text-hero-muted">This month&rsquo;s collection</p>
                <p className="text-xs text-hero-muted tabular">{collectionRate === null ? "No billing yet" : `${collectionRate}% collected`}</p>
              </div>
              <Progress value={collectionRate ?? 0} className="mt-2 bg-hero-foreground/15 text-hero-accent" aria-label="Share of this month's billing collected" />
              <p className="mt-2 text-xs text-hero-muted tabular">
                {formatTaka(kpis.thisMonthCollected)} collected of {formatTaka(kpis.thisMonthBilled)} billed
              </p>
            </div>
          </div>

          <div className="rounded-xl bg-[color-mix(in_oklch,var(--hero)_92%,var(--hero-foreground))] p-4 ring-1 ring-hero-foreground/10 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-hero-muted">Bank accounts</p>
              <Link to="/banks" search={{}} className="text-xs text-hero-accent underline-offset-4 hover:underline">
                Manage
              </Link>
            </div>
            {kpis.bankBalances.length > 0 ? (
              <ul className="mt-4 flex flex-col gap-4">
                {kpis.bankBalances.map((bank) => {
                  const peak = Math.max(...kpis.bankBalances.map((b) => b.currentBalance), 1);
                  return (
                    <li key={bank.id}>
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm">{bank.bankName}</span>
                        <span className="shrink-0 text-sm font-medium tabular">{formatTaka(bank.currentBalance)}</span>
                      </div>
                      <Progress
                        value={(bank.currentBalance / peak) * 100}
                        className="mt-2 bg-hero-foreground/12 text-hero-accent/80"
                        aria-label={`${bank.bankName} share of the largest balance`}
                      />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-hero-muted">No bank accounts yet. Add one to start tracking balances.</p>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active members"
          value={String(kpis.activeMembers)}
          hint={`${kpis.totalShares} shares allotted in total`}
          icon={UsersIcon}
          tone="primary"
        />
        <StatCard
          label="Collected this month"
          value={formatTaka(kpis.thisMonthCollected)}
          hint={`${formatTaka(kpis.thisMonthBilled)} billed · ${formatTaka(kpis.totalAdvance)} in advance`}
          icon={TrendingUpIcon}
          tone="success"
        />
        <StatCard
          label="Outstanding due"
          value={formatTaka(kpis.totalDueOutstanding)}
          hint={
            kpis.totalDueOutstanding > 0
              ? `${data.topDues.length} ${data.topDues.length === 1 ? "member" : "members"} with a balance`
              : "Everyone is up to date"
          }
          icon={ReceiptTextIcon}
          tone={kpis.totalDueOutstanding > 0 ? "destructive" : "default"}
        />
        <StatCard
          label="Loans outstanding"
          value={formatTaka(kpis.loansOutstanding)}
          hint={data.loansPerMember.length > 0 ? `Across ${data.loansPerMember.length} ${data.loansPerMember.length === 1 ? "member" : "members"}` : "No open loans"}
          icon={HandCoinsIcon}
          tone={kpis.loansOutstanding > 0 ? "warning" : "default"}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Collections</CardTitle>
            <CardDescription>Contributions received over the last 12 months.</CardDescription>
          </CardHeader>
          <CardContent>
            <CollectionsChart series={data.monthlySeries} />
          </CardContent>
        </Card>

        <AttentionPanel topDues={data.topDues} loans={data.loansPerMember} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Billing grid</CardTitle>
          <CardDescription>
            Monthly standing per member for {data.gridYear}. Months after {formatMonth(currentMonth)} are upcoming — projected at today&rsquo;s shares
            and price. Hover or focus a cell for its bill and applied amount.
          </CardDescription>
          <CardAction>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="icon-sm" aria-label="Previous year" onClick={() => navigate({ search: (prev) => ({ ...prev, year: data.gridYear - 1 }) })}>
                <span aria-hidden>←</span>
              </Button>
              <span className="min-w-14 text-center text-sm font-medium tabular">{data.gridYear}</span>
              <Button variant="outline" size="icon-sm" aria-label="Next year" onClick={() => navigate({ search: (prev) => ({ ...prev, year: data.gridYear + 1 }) })}>
                <span aria-hidden>→</span>
              </Button>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          {data.grid.length > 0 ? (
            <div className="relative">
              <div className="overflow-x-auto pb-1">
              <table className="w-full min-w-[720px] border-separate border-spacing-0 text-xs">
                <thead>
                  <tr>
                    <th scope="col" className="text-micro sticky left-0 z-10 bg-card px-3 pb-2 text-left font-medium text-muted-foreground">
                      Member
                    </th>
                    {MONTH_LABELS.map((label) => (
                      <th key={label} scope="col" className="text-micro px-1 pb-2 text-center font-medium text-muted-foreground">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.grid.map((row) => (
                    <tr key={row.memberId} className="group">
                      <th scope="row" className="sticky left-0 z-10 max-w-[180px] truncate bg-card px-3 py-1.5 text-left font-normal group-hover:bg-muted/50">
                        <Link to="/members/$id" params={{ id: row.memberId }} search={{}} className="text-sm text-foreground underline-offset-4 hover:underline">
                          {row.name}
                        </Link>
                      </th>
                      {MONTH_LABELS.map((_, index) => {
                        const month = `${data.gridYear}-${String(index + 1).padStart(2, "0")}`;
                        const cell = row.cells.find((entry) => entry.month === month);
                        const upcoming = month > currentMonth;
                        const label = cell
                          ? `${row.name}, ${MONTH_LABELS[index]} ${data.gridYear}${upcoming ? " (upcoming projection)" : ""}: ${cell.status}, bill ${formatTaka(cell.bill)}, applied ${formatTaka(cell.applied)}`
                          : `${row.name}, ${MONTH_LABELS[index]} ${data.gridYear}${upcoming ? " (upcoming projection)" : ""}: not billed`;
                        return (
                          <td key={month} className="px-1 py-1.5 text-center">
                            <span
                              role="img"
                              tabIndex={0}
                              aria-label={label}
                              title={label}
                              className={cn(
                                "mx-auto block size-6 rounded-md outline-none ring-offset-2 ring-offset-card transition-[box-shadow,background-color] duration-150 hover:ring-2 hover:ring-ring/40 focus-visible:ring-2 focus-visible:ring-ring",
                                cellColor(cell?.status),
                                upcoming && "opacity-45 outline-dashed outline-1 -outline-offset-1 outline-foreground/30",
                              )}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 right-0 w-10 rounded-r-xl bg-gradient-to-l from-card to-transparent sm:hidden"
              />
            </div>
          ) : (
            <EmptyState icon={UsersIcon} title="No members yet" description="Add members to see their monthly billing position here." />
          )}

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4 text-xs text-muted-foreground">
            {(
              [
                ["Paid", "bg-success"],
                ["Advance", "bg-info"],
                ["Partial", "bg-warning"],
                ["Due", "bg-destructive"],
                ["Not billed", "bg-muted-foreground/20"],
                ["Upcoming", "outline-dashed outline-1 outline-foreground/30"],
              ] as const
            ).map(([label, className]) => (
              <span key={label} className="flex items-center gap-1.5">
                <span aria-hidden className={cn("size-3 rounded-[4px]", className)} />
                {label}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>The latest entries across every ledger.</CardDescription>
            <CardAction>
              <Link to="/transactions" search={TRANSACTIONS_SEARCH} className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                View all
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            {data.recent.length > 0 ? (
              <ul className="-mx-2 divide-y divide-border/70">
                {data.recent.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-3 px-2 py-3">
                    <TransactionIcon type={entry.type} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {TYPE_LABELS[entry.type] ?? entry.type}
                        {entry.memberName ? ` · ${entry.memberName}` : ""}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatDay(entry.date)}
                        {entry.bankName ? ` · ${entry.bankName}` : ""}
                        {entry.toBankName ? ` → ${entry.toBankName}` : ""}
                        {entry.note ? ` · ${entry.note}` : ""}
                      </p>
                    </div>
                    <Amount value={entry.amount} showPlus className="text-right text-sm" />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={ReceiptTextIcon} title="No transactions yet" description="Entries you record will appear here, newest first." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top dues</CardTitle>
            <CardDescription>Largest unpaid balances across the fund.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.topDues.length > 0 ? (
              <ul className="flex flex-col gap-4">
                {data.topDues.map((due, index) => {
                  const peak = Math.max(...data.topDues.map((row) => row.due), 1);
                  return (
                    <li key={due.memberId}>
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex min-w-0 items-center gap-2.5">
                          <span className="grid size-6 shrink-0 place-items-center rounded-md bg-muted text-[11px] font-medium text-muted-foreground tabular">{index + 1}</span>
                          <Link to="/members/$id" params={{ id: due.memberId }} search={{}} className="truncate text-sm text-foreground underline-offset-4 hover:underline">
                            {due.name}
                          </Link>
                        </span>
                        <span className="shrink-0 text-sm font-medium text-destructive tabular">{formatTaka(due.due)}</span>
                      </div>
                      <Progress value={(due.due / peak) * 100} className="mt-2 bg-muted text-destructive/70" aria-label={`${due.name} due relative to the largest`} />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <span className="grid size-10 place-items-center rounded-full bg-success/10 text-success">
                  <HandCoinsIcon className="size-5" />
                </span>
                <p className="text-sm font-medium">Everyone is up to date</p>
                <p className="text-xs text-muted-foreground">No outstanding dues right now.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

type AttentionTab = "dues" | "loans";

function AttentionPanel({
  topDues,
  loans,
}: {
  topDues: DashboardData["topDues"];
  loans: DashboardData["loansPerMember"];
}) {
  const [tab, setTab] = useState<AttentionTab>("dues");
  const rows =
    tab === "dues"
      ? topDues.map((row) => ({ id: row.memberId, name: row.name, value: row.due, tone: "negative" as const }))
      : loans.map((row) => ({ id: row.memberId, name: row.name, value: row.outstanding, tone: "neutral" as const }));

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>Needs attention</CardTitle>
        <CardDescription>Who owes, and who is carrying a loan.</CardDescription>
        <CardAction>
          <div role="tablist" aria-label="Attention category" className="flex rounded-lg border border-border bg-muted/40 p-0.5">
            {(
              [
                ["dues", "Dues", topDues.length],
                ["loans", "Loans", loans.length],
              ] as const
            ).map(([value, label, count]) => (
              <button
                key={value}
                role="tab"
                type="button"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={cn(
                  "cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  tab === value ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label} <span className="tabular opacity-60">{count}</span>
              </button>
            ))}
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="flex-1">
        {rows.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {rows.map((row) => (
              <li key={row.id}>
                <Link
                  to="/members/$id"
                  params={{ id: row.id }}
                  search={{}}
                  className="flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/60"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className={cn("size-2 shrink-0 rounded-full", tab === "dues" ? "bg-destructive" : "bg-warning")} />
                    <span className="truncate text-sm text-foreground">{row.name}</span>
                  </span>
                  <span className="shrink-0 text-sm font-medium tabular">
                    <Amount value={row.value} tone={row.tone} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center gap-1 py-10 text-center">
            <InfoIcon className="size-5 text-muted-foreground" />
            <p className="text-sm font-medium">Nothing outstanding</p>
            <p className="text-xs text-muted-foreground">{tab === "dues" ? "No members owe the fund." : "No loans are open."}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CollectionsChart({ series }: { series: { month: string; collected: number }[] }) {
  const max = Math.max(...series.map((point) => point.collected), 1);
  const step = niceStep(max / 4);
  const top = Math.max(step * 4, max);
  const ticks = Array.from({ length: 5 }, (_, index) => step * index);
  const lastIndex = series.length - 1;

  return (
    <figure className="mt-2">
      <div className="flex gap-3">
        <div className="relative h-52 w-11 shrink-0 text-[10px] text-muted-foreground tabular sm:w-12" aria-hidden>
          {ticks.map((tick) => (
            <span key={tick} className="absolute right-0 -translate-y-1/2" style={{ bottom: `${(tick / top) * 100}%` }}>
              {compactTaka(tick)}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div className="relative h-52">
            <div aria-hidden className="absolute inset-0 flex flex-col justify-between">
              {ticks.map((tick) => (
                <div key={tick} className={tick === 0 ? "border-t border-border" : "border-t border-dashed border-border/60"} />
              ))}
            </div>
            <div className="relative flex h-full items-end gap-1.5 sm:gap-2">
              {series.map((point, index) => {
                const label = `${MONTH_LABELS[Number(point.month.slice(5, 7)) - 1]} ${point.month.slice(0, 4)}`;
                const height = point.collected > 0 ? Math.max((point.collected / top) * 100, 1.5) : 0;
                return (
                  <div key={point.month} className="group flex h-full flex-1 items-end justify-center">
                    <div
                      role="img"
                      tabIndex={0}
                      title={`${label}: ${formatTaka(point.collected)}`}
                      aria-label={`${label}: ${formatTaka(point.collected)} collected`}
                      className={cn(
                        "w-full max-w-[32px] rounded-t-md outline-none ring-offset-2 ring-offset-card transition-[background-color,box-shadow] duration-150 hover:ring-2 hover:ring-ring/40 focus-visible:ring-2 focus-visible:ring-ring",
                        point.collected === 0 ? "bg-transparent" : index === lastIndex ? "bg-primary" : "bg-chart-1/70 group-hover:bg-chart-1",
                      )}
                      style={{ height: `${height}%` }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-2 flex gap-1.5 sm:gap-2">
            {series.map((point, index) => (
              <span
                key={point.month}
                className={cn(
                  "flex-1 text-center text-[10px] tabular",
                  index === lastIndex ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {MONTH_LABELS[Number(point.month.slice(5, 7)) - 1]}
              </span>
            ))}
          </div>
        </div>
      </div>
      <figcaption className="sr-only">
        {series.map((point) => `${MONTH_LABELS[Number(point.month.slice(5, 7)) - 1]} ${point.month.slice(0, 4)}: ${formatTaka(point.collected)}`).join(". ")}
      </figcaption>
    </figure>
  );
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-8">
      <div className="space-y-3">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-4 w-52" />
      </div>
      <Skeleton className="h-64 w-full rounded-2xl" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-32 w-full rounded-xl" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Skeleton className="h-80 w-full rounded-xl" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    </div>
  );
}

/** Compact ৳ label for axis ticks: 12K, 1.2L, 3.4Cr. */
function compactTaka(value: number): string {
  if (value === 0) return "৳0";
  if (value >= 10_000_000) return `৳${(value / 10_000_000).toFixed(value % 10_000_000 === 0 ? 0 : 1)}Cr`;
  if (value >= 100_000) return `৳${(value / 100_000).toFixed(value % 100_000 === 0 ? 0 : 1)}L`;
  if (value >= 1_000) return `৳${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}K`;
  return `৳${Math.round(value)}`;
}

function niceStep(value: number): number {
  const exponent = Math.floor(Math.log10(Math.max(value, 1)));
  const fraction = value / 10 ** exponent;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * 10 ** exponent;
}

function cellColor(status: string | undefined): string {
  switch (status) {
    case "paid":
      return "bg-success/85 hover:bg-success";
    case "advance":
      return "bg-info/85 hover:bg-info";
    case "partial":
      return "bg-warning/85 hover:bg-warning";
    case "due":
      return "bg-destructive/85 hover:bg-destructive";
    default:
      return "bg-muted-foreground/15 hover:bg-muted-foreground/25";
  }
}

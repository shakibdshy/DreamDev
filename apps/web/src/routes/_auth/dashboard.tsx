import { barY, defineChart } from "@tanstack/charts";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "@tanstack/react-charts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";

import { formatTaka } from "@DreamDev/db/domain/money";
import { Card } from "@DreamDev/ui/components/card";
import { Button } from "@DreamDev/ui/components/button";

import type { DashboardData } from "@/api/dashboard/service";
import { api } from "@/lib/api";

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

  if (dashboardQuery.isLoading) return <p className="p-4 text-muted-foreground">Loading…</p>;
  if (!dashboardQuery.data) return <p className="p-4 text-muted-foreground">Nothing to show yet.</p>;

  const data = dashboardQuery.data;
  const { kpis } = data;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {formatTaka(kpis.thisMonthCollected)} collected of {formatTaka(kpis.thisMonthBilled)} billed this month
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Active Members" value={String(kpis.activeMembers)} />
        <KpiCard label="Total Shares" value={String(kpis.totalShares)} />
        <KpiCard label="Outstanding Due" value={formatTaka(kpis.totalDueOutstanding)} tone={kpis.totalDueOutstanding > 0 ? "danger" : "default"} />
        <KpiCard label="Loans Outstanding" value={formatTaka(kpis.loansOutstanding)} tone={kpis.loansOutstanding > 0 ? "warn" : "default"} />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {kpis.bankBalances.map((bank) => (
          <KpiCard key={bank.id} label={bank.bankName} value={formatTaka(bank.currentBalance)} sub="Current Balance" />
        ))}
      </div>

      <Card className="p-4">
        <h2 className="mb-2 font-semibold">Collections — last 12 months</h2>
        <CollectionsChart series={data.monthlySeries} />
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">{data.gridYear} — member × month</h2>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate({ search: (prev) => ({ ...prev, year: data.gridYear - 1 }) })}>←</Button>
            <span className="text-sm">{data.gridYear}</span>
            <Button variant="outline" size="sm" onClick={() => navigate({ search: (prev) => ({ ...prev, year: data.gridYear + 1 }) })}>→</Button>
          </div>
        </div>
        {data.grid.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th className="px-2 py-1 text-left font-medium">Member</th>
                  {MONTH_LABELS.map((label) => (
                    <th key={label} className="px-1 py-1 font-medium">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.grid.map((row) => (
                  <tr key={row.memberId} className="border-t">
                    <td className="px-2 py-1">
                      <Link to="/members/$id" params={{ id: row.memberId }} search={{}} className="underline-offset-2 hover:underline">
                        {row.name}
                      </Link>
                    </td>
                    {MONTH_LABELS.map((_, i) => {
                      const month = `${data.gridYear}-${String(i + 1).padStart(2, "0")}`;
                      const cell = row.cells.find((c) => c.month === month);
                      return (
                        <td key={month} className="px-1 py-1 text-center">
                          <span className={`inline-block h-5 w-5 rounded ${cellColor(cell?.status)}`} title={cell ? `${cell.status} · bill ${formatTaka(cell.bill)} · applied ${formatTaka(cell.applied)}` : ""} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No members yet.</p>
        )}
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
          {[
            ["paid", "bg-emerald-500"],
            ["advance", "bg-teal-500"],
            ["partial", "bg-amber-500"],
            ["due", "bg-red-500"],
            ["not-billed", "bg-muted"],
          ].map(([label, className]) => (
            <span key={label} className="flex items-center gap-1">
              <span className={`inline-block h-3 w-3 rounded ${className}`} /> {label}
            </span>
          ))}
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="p-4">
          <h2 className="mb-2 font-semibold">Top dues</h2>
          {data.topDues.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm">
              {data.topDues.map((d) => (
                <li key={d.memberId} className="flex justify-between">
                  <Link to="/members/$id" params={{ id: d.memberId }} search={{}} className="underline-offset-2 hover:underline">{d.name}</Link>
                  <span className="font-semibold text-destructive">{formatTaka(d.due)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nobody owes anything. 🎉</p>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 font-semibold">Loans outstanding</h2>
          {data.loansPerMember.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm">
              {data.loansPerMember.map((l) => (
                <li key={l.memberId} className="flex justify-between">
                  <Link to="/members/$id" params={{ id: l.memberId }} search={{}} className="underline-offset-2 hover:underline">{l.name}</Link>
                  <span className="font-semibold">{formatTaka(l.outstanding)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No outstanding loans.</p>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 font-semibold">Recent transactions</h2>
          {data.recent.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm">
              {data.recent.map((r) => (
                <li key={r.id} className="flex justify-between gap-2">
                  <span className="truncate text-muted-foreground">
                    {r.date} · {r.type.replace("_", " ")}{r.memberName ? ` · ${r.memberName}` : ""}
                  </span>
                  <span className={r.amount < 0 ? "text-red-600" : "text-emerald-700"}>{formatTaka(r.amount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No transactions yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub, tone = "default" }: { label: string; value: string; sub?: string; tone?: "default" | "danger" | "warn" }) {
  const toneClass = tone === "danger" ? "text-destructive" : tone === "warn" ? "text-amber-600" : "";
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
}

function CollectionsChart({ series }: { series: { month: string; collected: number }[] }) {
  const rows = useMemo(
    () => series.map((point) => ({ ...point, label: `${MONTH_LABELS[Number(point.month.slice(5, 7)) - 1]} ${point.month.slice(2, 4)}` })),
    [series],
  );
  const chart = useMemo(
    () =>
      defineChart({
        marks: [barY(rows, { x: "label", y: "collected" })],
        scales: {
          x: { scale: () => scaleBand().padding(0.18) },
          y: { scale: scaleLinear, nice: true, grid: true },
        },
        tooltip,
      }),
    [rows],
  );
  return <Chart definition={chart} height={260} ariaLabel="Collections over the last 12 months" ariaDescription="Bar chart of monthly contributions collected" />;
}

function cellColor(status: string | undefined): string {
  switch (status) {
    case "paid":
      return "bg-emerald-500";
    case "advance":
      return "bg-teal-500";
    case "partial":
      return "bg-amber-500";
    case "due":
      return "bg-red-500";
    default:
      return "bg-muted";
  }
}

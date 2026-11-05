import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

import { todayInDhaka } from "@DreamDev/db/domain/month";
import { formatTaka } from "@DreamDev/db/domain/money";
import { Button } from "@DreamDev/ui/components/button";

import { api } from "@/lib/api";

interface MemberDetail {
  member: {
    id: string;
    name: string;
    mobile: string;
    joiningDate: string;
    address: string | null;
    photo: string | null;
    notes: string | null;
    status: string;
    exitDate: string | null;
  };
  shares: { quantity: number; effectiveMonth: string }[];
  summary: { billed: number; contributed: number; adjusted: number; due: number; advance: number };
  timelineYear: number;
  timeline: { month: string; bill: number; applied: number; status: string }[];
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const Route = createFileRoute("/_auth/members/$id")({
  validateSearch: (search: Record<string, unknown>) => ({ year: search.year ? Number(search.year) : undefined }),
  component: MemberDetailPage,
});

function MemberDetailPage() {
  const { id } = Route.useParams();
  const { year } = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const { session } = Route.useRouteContext();
  const isAdmin = session?.user.role === "admin";

  const detailQuery = useQuery({
    queryKey: ["member", id, year],
    queryFn: () => api<MemberDetail>(`/api/members/${id}${year ? `?year=${year}` : ""}`),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["member", id] });
    queryClient.invalidateQueries({ queryKey: ["members"] });
  };

  const act = useMutation({
    mutationFn: ({ path, body, method = "POST" }: { path: string; body?: unknown; method?: string }) =>
      api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }),
    onSuccess: () => {
      toast.success("Done");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (detailQuery.isLoading) return <p className="p-4 text-muted-foreground">Loading…</p>;
  if (!detailQuery.data) return <p className="p-4 text-muted-foreground">Member not found.</p>;

  const { member, shares, summary, timeline, timelineYear } = detailQuery.data;
  const currentShares = shares[shares.length - 1]?.quantity ?? 0;

  const onShareChange = () => {
    const quantity = window.prompt(`New share quantity for ${member.name} (effective from next billing)`, String(currentShares));
    if (!quantity) return;
    act.mutate({ path: `/api/members/${id}/shares`, body: { quantity: Number(quantity) } });
  };

  const onStatus = (status: "active" | "inactive" | "exited") => {
    const today = todayInDhaka();
    act.mutate({ path: `/api/members/${id}/status`, body: { status, date: today } });
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{member.name}</h1>
          <p className="text-sm text-muted-foreground">
            {member.mobile} · joined {new Date(member.joiningDate).toLocaleDateString()} ·{" "}
            <span className="capitalize">{member.status}</span>
          </p>
          {member.address && <p className="text-sm text-muted-foreground">{member.address}</p>}
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="text-right">
            {summary.advance > 0 ? (
              <p className="text-lg font-semibold text-emerald-600">Advance {formatTaka(summary.advance)}</p>
            ) : (
              <p className="text-lg font-semibold text-destructive">Due {formatTaka(summary.due)}</p>
            )}
            <p className="text-xs text-muted-foreground">
              billed {formatTaka(summary.billed)} · paid {formatTaka(summary.contributed)}
            </p>
          </div>
          <div className="flex gap-2">
            {member.status === "active" && (
              <>
                <Button variant="outline" size="sm" onClick={() => onStatus("inactive")}>Mark Inactive</Button>
                <Button variant="outline" size="sm" onClick={() => onStatus("exited")}>Exit</Button>
              </>
            )}
            {member.status === "inactive" && (
              <Button variant="outline" size="sm" onClick={() => onStatus("active")}>Reactivate</Button>
            )}
            <Button variant="outline" size="sm" onClick={() => act.mutate({ path: `/api/members/${id}`, method: "DELETE" })}>Remove</Button>
          </div>
        </div>
      </div>

      <div className="rounded-md border p-3">
        <div className="flex items-center justify-between">
          <p className="font-medium">
            Shares: <span className="font-semibold">{currentShares}</span>
            <span className="ml-2 text-xs text-muted-foreground">
              ({shares.map((s) => `${s.quantity} from ${s.effectiveMonth}`).join(" → ")})
            </span>
          </p>
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={onShareChange}>Change shares…</Button>
          )}
        </div>
        {!isAdmin && <p className="mt-1 text-xs text-muted-foreground">Only Admins can change share quantity.</p>}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">{timelineYear} billing timeline</h2>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate({ search: (prev) => ({ ...prev, year: timelineYear - 1 }) })>←</Button>
            <span className="text-sm">{timelineYear}</span>
            <Button variant="outline" size="sm" onClick={() => navigate({ search: (prev) => ({ ...prev, year: timelineYear + 1 }) })>→</Button>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-12">
          {Array.from({ length: 12 }, (_, i) => {
            const month = `${timelineYear}-${String(i + 1).padStart(2, "0")}`;
            const cell = timeline.find((c) => c.month === month);
            const label = MONTH_LABELS[i];
            return (
              <div key={month} className={`rounded-md border p-2 text-center text-xs ${cellStyle(cell?.status)}`}>
                <p className="font-medium">{label}</p>
                <p className="text-muted-foreground">{cell && cell.bill > 0 ? formatTaka(cell.bill) : "—"}</p>
                <p className="mt-1 capitalize">{cell?.status ?? "not-billed"}</p>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          bill = what that month owes (incl. Adjustments); status from the FIFO walk (ADR-0001).
        </p>
      </div>
    </div>
  );
}

function cellStyle(status: string | undefined): string {
  switch (status) {
    case "paid":
      return "border-emerald-300 bg-emerald-50 dark:bg-emerald-950";
    case "advance":
      return "border-teal-300 bg-teal-50 dark:bg-teal-950";
    case "partial":
      return "border-amber-300 bg-amber-50 dark:bg-amber-950";
    case "due":
      return "border-red-300 bg-red-50 dark:bg-red-950";
    default:
      return "";
  }
}

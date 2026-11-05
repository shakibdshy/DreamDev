import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { useState } from "react";

import { todayInDhaka } from "@DreamDev/db/domain/month";
import { formatTaka } from "@DreamDev/db/domain/money";
import { BankSelect } from "@/components/bank-select";
import { Button } from "@DreamDev/ui/components/button";
import { Input } from "@DreamDev/ui/components/input";

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
  validateSearch: (search: Record<string, unknown>): { year?: number } => ({ year: search.year ? Number(search.year) : undefined }),
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
        <div className="flex items-start gap-4">
          {member.photo ? (
            <img src={member.photo} alt={member.name} className="h-16 w-16 rounded-full object-cover" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-2xl font-semibold text-muted-foreground">
              {member.name.slice(0, 1)}
            </div>
          )}
          <div>
          <h1 className="text-2xl font-semibold">{member.name}</h1>
          <p className="text-sm text-muted-foreground">
            {member.mobile} · joined {new Date(member.joiningDate).toLocaleDateString()} ·{" "}
            <span className="capitalize">{member.status}</span>
          </p>
          {member.address && <p className="text-sm text-muted-foreground">{member.address}</p>}
          <div className="mt-1 flex items-center gap-2 text-xs">
            <label className="cursor-pointer underline">
              Replace photo
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const { uploadProfilePhoto } = await import("@/lib/photo");
                    const url = await uploadProfilePhoto(file);
                    await api(`/api/members/${id}`, { method: "PATCH", body: JSON.stringify({ photo: url }) });
                    toast.success("Photo updated");
                    invalidate();
                  } catch (error) {
                    toast.error((error as Error).message);
                  }
                }}
              />
            </label>
            {member.photo && (
              <button
                className="underline"
                onClick={() => act.mutate({ path: `/api/members/${id}`, method: "PATCH", body: { photo: null } })}
              >
                Remove photo
              </button>
            )}
          </div>
          </div>
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

      <LoansSection memberId={id} onSaved={invalidate} />

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">{timelineYear} billing timeline</h2>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate({ search: (prev) => ({ ...prev, year: timelineYear - 1 }) })}>←</Button>
            <span className="text-sm">{timelineYear}</span>
            <Button variant="outline" size="sm" onClick={() => navigate({ search: (prev) => ({ ...prev, year: timelineYear + 1 }) })}>→</Button>
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

interface LoanRowView {
  id: string;
  amount: number;
  date: string;
  note: string | null;
  repaid: number;
  outstanding: number;
  settled: boolean;
  repayments: { id: string; amount: number; creditDate: string }[];
}

function LoansSection({ memberId, onSaved }: { memberId: string; onSaved: () => void }) {
  const [repayBank, setRepayBank] = useState("");
  const queryClient = useQueryClient();
  const loansQuery = useQuery({
    queryKey: ["loans", memberId],
    queryFn: () => api<{ loans: LoanRowView[]; totalOutstanding: number }>(`/api/members/${memberId}/loans`),
  });

  const repay = useMutation({
    mutationFn: ({ loanId, amount, bankAccountId }: { loanId: string; amount: number; bankAccountId: string }) =>
      api(`/api/loans/${loanId}`, { method: "POST", body: JSON.stringify({ amount, bankAccountId, creditDate: todayInDhaka() }) }),
    onSuccess: () => {
      toast.success("Repayment recorded");
      onSaved();
      queryClient.invalidateQueries({ queryKey: ["loans", memberId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const removeLoan = useMutation({
    mutationFn: (loanId: string) => api(`/api/loans/${loanId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Loan removed");
      onSaved();
      queryClient.invalidateQueries({ queryKey: ["loans", memberId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between gap-4">
        <h2 className="font-semibold">
          Loans{" "}
          {loansQuery.data && loansQuery.data.totalOutstanding > 0 && (
            <span className="text-destructive">— {formatTaka(loansQuery.data.totalOutstanding)} outstanding</span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Repayment account:</span>
          <BankSelect value={repayBank} onChange={setRepayBank} id="repay-bank" />
        </div>
      </div>

      {loansQuery.data && loansQuery.data.loans.length > 0 ? (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1">Taken</th>
              <th className="py-1">Principal</th>
              <th className="py-1">Repaid</th>
              <th className="py-1">Outstanding</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {loansQuery.data.loans.map((loan) => (
              <tr key={loan.id} className="border-t">
                <td className="py-2">{loan.date}{loan.note ? ` · ${loan.note}` : ""}</td>
                <td className="py-2">{formatTaka(loan.amount)}</td>
                <td className="py-2">{formatTaka(loan.repaid)}</td>
                <td className={`py-2 font-semibold ${loan.settled ? "text-emerald-600" : "text-destructive"}`}>
                  {loan.settled ? "Settled" : formatTaka(loan.outstanding)}
                </td>
                <td className="py-2 text-right whitespace-nowrap">
                  {!loan.settled && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (!repayBank) {
                          toast.error("Pick the Bank Account the money returns to first");
                          return;
                        }
                        const amount = window.prompt(`Repay against the ৳${loan.outstanding.toLocaleString("en-IN")} outstanding`);
                        if (!amount) return;
                        repay.mutate({ loanId: loan.id, amount: Number(amount), bankAccountId: repayBank });
                      }}
                    >
                      Repay…
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => removeLoan.mutate(loan.id)}>Remove</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-muted-foreground">No loans — money this Member took from the fund appears here.</p>
      )}

      <NewLoanForm memberId={memberId} onSaved={() => { onSaved(); queryClient.invalidateQueries({ queryKey: ["loans", memberId] }); }} />
    </div>
  );
}

function NewLoanForm({ memberId, onSaved }: { memberId: string; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [date, setDate] = useState(todayInDhaka());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const result = await api<{ warning: string | null }>(`/api/members/${memberId}/loans`, {
        method: "POST",
        body: JSON.stringify({ amount: Number(amount), bankAccountId, date, note: note || undefined }),
      });
      toast.success("Loan recorded");
      if (result.warning) toast.warning(result.warning);
      setAmount("");
      setNote("");
      onSaved();
      queryClient.invalidateQueries({ queryKey: ["loans", memberId] });
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <details className="mt-3 rounded-md border p-2">
      <summary className="cursor-pointer text-sm font-medium">New Loan</summary>
      <form className="mt-2 grid gap-3 sm:grid-cols-4" onSubmit={submit}>
        <div className="flex flex-col gap-1">
          <label className="text-sm">Amount (৳)</label>
          <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm">Bank Account</label>
          <BankSelect value={bankAccountId} onChange={setBankAccountId} id="new-loan-bank" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm">Date</label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm">Note (optional)</label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="sm:col-span-4">
          <Button type="submit" disabled={saving || !amount || !bankAccountId}>Give Loan</Button>
          <p className="mt-1 text-xs text-muted-foreground">Loans over twice the Member's total contributions warn but record anyway.</p>
        </div>
      </form>
    </details>
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

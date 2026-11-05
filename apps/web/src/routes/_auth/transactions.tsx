import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { createCollection, queryCollectionOptions, useLiveQuery } from "@tanstack/react-db";
import { debounce } from "@tanstack/pacer";
import { toast } from "sonner";
import { useMemo } from "react";
import { z } from "zod";

import { todayInDhaka } from "@DreamDev/db/domain/month";
import { formatTaka } from "@DreamDev/db/domain/money";
import { Button } from "@DreamDev/ui/components/button";
import { Input } from "@DreamDev/ui/components/input";
import { Label } from "@DreamDev/ui/components/label";

import { BankSelect } from "@/components/bank-select";
import { MemberSelect } from "@/components/member-select";
import { FEED_TYPES, listFeedQuerySchema } from "@/api/transactions/schema";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/query-client";

type FeedRow = {
  id: string;
  type: string;
  date: string;
  amount: number;
  memberName: string | null;
  bankName: string | null;
  toBankName: string | null;
  note: string | null;
};

const TYPE_LABELS: Record<string, string> = {
  contribution: "Contribution",
  loan: "Loan",
  loan_repayment: "Loan Repayment",
  expense: "Expense",
  transfer: "Transfer",
  adjustment: "Adjustment",
};

export const Route = createFileRoute("/_auth/transactions")({
  validateSearch: (search: Record<string, unknown>) => {
    const parsed = listFeedQuerySchema.safeParse(search);
    return parsed.success ? parsed.data : listFeedQuerySchema.parse({});
  },
  component: TransactionsPage,
});

function TransactionsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const onFilter = useMemo(
    () =>
      debounce(
        (patch: Record<string, string | undefined>) =>
          navigate({ search: (prev) => ({ ...prev, ...patch, page: 1 }) }),
        { wait: 300 },
      ),
    [navigate],
  );

  // The TanStack DB collection: optimistic CRUD with automatic rollback (ticket pattern).
  const feedCollection = useMemo(
    () =>
      createCollection(
        queryCollectionOptions({
          queryKey: ["transactions", search],
          queryClient,
          queryFn: () =>
            api<{ data: FeedRow[] }>(
              `/api/transactions?${new URLSearchParams(Object.entries(search).map(([k, v]) => [k, String(v)]) as [string, string][])}`,
            ),
          getKey: (row: FeedRow) => row.id,
          onInsert: async ({ transaction, collection }) => {
            const row = transaction.mutations[0]!.modified as Record<string, unknown>;
            await api("/api/contributions", {
              method: "POST",
              body: JSON.stringify({
                memberId: row.memberId,
                bankAccountId: row.bankAccountId,
                amount: row.amount,
                creditDate: row.creditDate,
                note: row.note ?? undefined,
              }),
            });
            await collection.utils.refetch();
          },
          onUpdate: async ({ transaction, collection }) => {
            for (const mutation of transaction.mutations) {
              const row = mutation.modified as FeedRow;
              await api(`/api/contributions/${row.id}`, { method: "PATCH", body: JSON.stringify({ amount: row.amount }) });
            }
            await collection.utils.refetch();
          },
          onDelete: async ({ transaction, collection }) => {
            for (const mutation of transaction.mutations) {
              await api(`/api/contributions/${mutation.original.id}`, { method: "DELETE" });
            }
            await collection.utils.refetch();
          },
        }),
      ),
    [search],
  );

  const { data: feed } = useLiveQuery({ collection: feedCollection });
  const rows: FeedRow[] = feed?.state === "loading" && !feed.data ? [] : (feed?.data as FeedRow[] | undefined) ?? [];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">Transactions</h1>

      <ContributionForm collection={feedCollection} />

      <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-5">
        <select
          className="h-9 rounded-md border bg-transparent px-3"
          value={search.type ?? ""}
          onChange={(e) => onFilter({ type: e.target.value || undefined })}
        >
          <option value="">All types</option>
          {FEED_TYPES.map((t) => (
            <option key={t} value={t}>{TYPE_LABELS[t]}</option>
          ))}
        </select>
        <Input type="date" defaultValue={search.from ?? ""} onChange={(e) => onFilter({ from: e.target.value || undefined })} aria-label="From date" />
        <Input type="date" defaultValue={search.to ?? ""} onChange={(e) => onFilter({ to: e.target.value || undefined })} aria-label="To date" />
        <div className="text-sm text-muted-foreground sm:col-span-2">
          {rows.length > 0 ? `${rows[0]!.date} → ${rows[rows.length - 1]!.date}` : ""}
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Credit Date</th>
              <th className="px-3 py-2 text-left font-medium">Type</th>
              <th className="px-3 py-2 text-left font-medium">Member</th>
              <th className="px-3 py-2 text-left font-medium">Bank Account</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="px-3 py-2 text-left font-medium">Note</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? (
              rows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-3 py-2">{row.date}</td>
                  <td className="px-3 py-2">{TYPE_LABELS[row.type] ?? row.type}</td>
                  <td className="px-3 py-2">{row.memberName ?? "—"}</td>
                  <td className="px-3 py-2">
                    {row.bankName ?? "—"}
                    {row.toBankName ? ` → ${row.toBankName}` : ""}
                  </td>
                  <td className={`px-3 py-2 text-right font-semibold ${row.amount < 0 ? "text-red-600" : "text-emerald-700"}`}>
                    {formatTaka(row.amount)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{row.note ?? ""}</td>
                  <td className="px-3 py-2 text-right">
                    {row.type === "contribution" && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const amount = window.prompt("New amount", String(row.amount));
                            if (!amount) return;
                            feedCollection.update(row.id, (draft) => {
                              draft.amount = Number(amount);
                            });
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => feedCollection.delete(row.id)}
                        >
                          Delete
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  No transactions match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground"></p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={search.page <= 1}
            onClick={() => navigate({ search: (prev) => ({ ...prev, page: prev.page - 1 }) })}>Previous</Button>
          <span className="text-sm text-muted-foreground">{search.page}</span>
          <Button variant="outline" size="sm" disabled={rows.length < search.pageSize}
            onClick={() => navigate({ search: (prev) => ({ ...prev, page: prev.page + 1 }) })}>Next</Button>
        </div>
      </div>
    </div>
  );
}

function ContributionForm({ collection }: { collection: ReturnType<typeof createCollection<never>> }) {
  const form = useForm({
    defaultValues: { memberId: "", bankAccountId: "", amount: "", creditDate: todayInDhaka(), note: "" },
    onSubmit: async ({ value }) => {
      try {
        await collection.insert({
          id: `optimistic-${crypto.randomUUID()}`,
          type: "contribution",
          date: value.creditDate,
          amount: Number(value.amount),
          memberName: null,
          bankName: null,
          toBankName: null,
          note: value.note || null,
          ...value,
        } as never);
        toast.success("Contribution recorded");
        form.reset();
        // optimistically refresh balances and member positions
        await queryClient.invalidateQueries({ queryKey: ["banks"] });
        await queryClient.invalidateQueries({ queryKey: ["members"] });
      } catch (error) {
        toast.error((error as Error).message);
      }
    },
  });

  const memberId = form.useStore((state) => state.values.memberId);
  const positionQuery = useQuery({
    queryKey: ["position", memberId],
    queryFn: () => api<{ due: number; advance: number; shares: number; sharePrice: number }>(`/api/members/${memberId}/position`),
    enabled: memberId !== "",
  });

  return (
    <details className="rounded-md border p-3" open>
      <summary className="cursor-pointer font-medium">New entry — Contribution</summary>
      <p className="mt-1 text-xs text-muted-foreground">
        Loans, Expenses, Transfers and Adjustments get their own forms in their tickets; every type lands in this one feed.
      </p>
      <form className="mt-3 grid gap-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }}>
        <form.Field name="memberId">
          {(field) => (
            <div className="flex flex-col gap-1">
              <Label>Member</Label>
              <MemberSelect value={field.state.value} onChange={field.handleChange} />
            </div>
          )}
        </form.Field>
        <form.Field name="bankAccountId">
          {(field) => (
            <div className="flex flex-col gap-1">
              <Label>Bank Account</Label>
              <BankSelect value={field.state.value} onChange={field.handleChange} />
            </div>
          )}
        </form.Field>
        <form.Field name="creditDate" validators={{ onChange: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD") }}>
          {(field) => (
            <div className="flex flex-col gap-1">
              <Label htmlFor="t-date">Credit Date</Label>
              <Input id="t-date" type="date" value={field.state.value} onBlur={field.handleBlur} onChange={(e) => field.handleChange(e.target.value)} />
            </div>
          )}
        </form.Field>
        <form.Field name="amount" validators={{ onChange: z.string().regex(/^\d+$/, "Whole taka only") }}>
          {(field) => (
            <div className="flex flex-col gap-1">
              <Label htmlFor="t-amount">Pay amount (৳)</Label>
              <Input id="t-amount" inputMode="numeric" value={field.state.value} onBlur={field.handleBlur} onChange={(e) => field.handleChange(e.target.value)} />
            </div>
          )}
        </form.Field>
        <div className="flex flex-col gap-1">
          <Label htmlFor="t-due">Current Due</Label>
          <Input
            id="t-due"
            disabled
            value={
              positionQuery.data
                ? positionQuery.data.advance > 0
                  ? `Advance ${formatTaka(positionQuery.data.advance)}`
                  : formatTaka(positionQuery.data.due)
                : "—"
            }
          />
          {positionQuery.data && (
            <p className="text-xs text-muted-foreground">
              {positionQuery.data.shares} share(s) × {formatTaka(positionQuery.data.sharePrice)}/month
            </p>
          )}
        </div>
        <form.Field name="note">
          {(field) => (
            <div className="flex flex-col gap-1">
              <Label htmlFor="t-note">Note (optional)</Label>
              <Input id="t-note" value={field.state.value} onBlur={field.handleBlur} onChange={(e) => field.handleChange(e.target.value)} />
            </div>
          )}
        </form.Field>
        <div className="sm:col-span-3">
          <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <Button type="submit" disabled={!canSubmit || isSubmitting}>
                {isSubmitting ? "Recording…" : "Record Contribution"}
              </Button>
            )}
          </form.Subscribe>
        </div>
      </form>
    </details>
  );
}

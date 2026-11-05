import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { createCollection, queryCollectionOptions, useLiveQuery } from "@tanstack/react-db";
import { debounce } from "@tanstack/pacer";
import { toast } from "sonner";
import { useMemo, useRef, useState } from "react";
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
  const { session } = Route.useRouteContext();
  const isAdmin = session?.user.role === "admin" && session.user.status === "active";

  // Accumulate patches so two quick filter changes never drop the first
  const pendingPatch = useRef<Record<string, string | undefined>>({});
  const onFilter = useMemo(
    () =>
      debounce(
        (patch: Record<string, string | undefined>) => {
          const merged = pendingPatch.current;
          pendingPatch.current = {};
          navigate({ search: (prev) => ({ ...prev, ...merged, ...patch, page: 1 }) });
        },
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

      <EntryForms collection={feedCollection} isAdmin={isAdmin} />

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
              <th className="px-3 py-2 text-left font-medium">Date</th>
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
                    {(row.type === "contribution" || row.type === "expense" || row.type === "transfer" || row.type === "adjustment") && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            const amount = window.prompt("New amount", String(row.amount));
                            if (!amount) return;
                            try {
                              if (row.type === "contribution") {
                                await feedCollection.update(row.id, (draft) => {
                                  draft.amount = Number(amount);
                                });
                              } else {
                                await api(`/api/${row.type === "adjustment" ? "adjustments" : `${row.type}s`}/${row.id}`, {
                                  method: "PATCH",
                                  body: JSON.stringify({ amount: Number(amount) * (row.type === "adjustment" ? 1 : 1) }),
                                });
                                await queryClient.invalidateQueries({ queryKey: ["transactions"] });
                                await feedCollection.utils.refetch();
                              }
                            } catch (error) {
                              toast.error((error as Error).message);
                            }
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            try {
                              if (row.type === "contribution") {
                                await feedCollection.delete(row.id);
                              } else {
                                const path = row.type === "expense" ? "expenses" : row.type === "transfer" ? "transfers" : "adjustments";
                                await api(`/api/${path}/${row.id}`, { method: "DELETE" });
                                await queryClient.invalidateQueries({ queryKey: ["transactions"] });
                                await feedCollection.utils.refetch();
                              }
                            } catch (error) {
                              toast.error((error as Error).message);
                            }
                          }}
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

const ENTRY_TYPES = ["contribution", "expense", "transfer", "adjustment"] as const;
type EntryType = (typeof ENTRY_TYPES)[number];

function EntryForms({ collection, isAdmin }: { collection: ReturnType<typeof createCollection<never>>; isAdmin: boolean }) {
  const [entryType, setEntryType] = useState<EntryType>("contribution");
  return (
    <details className="rounded-md border p-3" open>
      <summary className="cursor-pointer font-medium">New entry</summary>
      <div className="mt-2 flex flex-wrap gap-2">
        {ENTRY_TYPES.map((type) => {
          const disabled = type === "adjustment" && !isAdmin;
          return (
            <Button
              key={type}
              type="button"
              size="sm"
              variant={entryType === type ? "default" : "outline"}
              disabled={disabled}
              onClick={() => setEntryType(type)}
            >
              {TYPE_LABELS[type]}
            </Button>
          );
        })}
      </div>
      <div className="mt-3">
        {entryType === "contribution" && <ContributionForm collection={collection} />}
        {entryType === "expense" && <ExpenseForm />}
        {entryType === "transfer" && <TransferForm />}
        {entryType === "adjustment" && isAdmin && <AdjustmentForm />}
      </div>
    </details>
  );
}

/** Shared post-and-invalidate for the secondary entry forms. */
function useEntryMutation(path: string) {
  const create = useMutation({
    mutationFn: (body: unknown) => api(path, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: async () => {
      toast.success("Recorded");
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["banks"] });
      await queryClient.invalidateQueries({ queryKey: ["members"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return create;
}

function ExpenseForm() {
  const create = useEntryMutation("/api/expenses");
  const [bankAccountId, setBank] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayInDhaka());
  const [note, setNote] = useState("");
  return (
    <form
      className="grid gap-3 sm:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate({ bankAccountId, amount: Number(amount), date, note: note || undefined });
      }}
    >
      <div className="flex flex-col gap-1">
        <Label>Bank Account</Label>
        <BankSelect value={bankAccountId} onChange={setBank} id="expense-bank" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="expense-amount">Amount (৳)</Label>
        <Input id="expense-amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="expense-date">Date</Label>
        <Input id="expense-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="expense-note">Note (optional)</Label>
        <Input id="expense-note" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="sm:col-span-4">
        <Button type="submit" disabled={!bankAccountId || !amount}>Record Expense</Button>
        <p className="mt-1 text-xs text-muted-foreground">Bank charges, cash withdrawals — money out that isn't a Loan.</p>
      </div>
    </form>
  );
}

function TransferForm() {
  const create = useEntryMutation("/api/transfers");
  const [fromAccountId, setFrom] = useState("");
  const [toAccountId, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayInDhaka());
  return (
    <form
      className="grid gap-3 sm:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate({ fromAccountId, toAccountId, amount: Number(amount), date });
      }}
    >
      <div className="flex flex-col gap-1">
        <Label>From account</Label>
        <BankSelect value={fromAccountId} onChange={setFrom} id="transfer-from" />
      </div>
      <div className="flex flex-col gap-1">
        <Label>To account</Label>
        <BankSelect value={toAccountId} onChange={setTo} id="transfer-to" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="transfer-amount">Amount (৳)</Label>
        <Input id="transfer-amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="transfer-date">Date</Label>
        <Input id="transfer-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="sm:col-span-4">
        <Button type="submit" disabled={!fromAccountId || !toAccountId || !amount}>Record Transfer</Button>
        <p className="mt-1 text-xs text-muted-foreground">Moves money between the team's own accounts — total holdings unchanged.</p>
      </div>
    </form>
  );
}

function AdjustmentForm() {
  const create = useEntryMutation("/api/adjustments");
  const [memberId, setMember] = useState("");
  const [amount, setAmount] = useState("");
  const [month, setMonth] = useState("");
  const [reason, setReason] = useState("");
  return (
    <form
      className="grid gap-3 sm:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate({ memberId, amount: Number(amount), month: month || undefined, reason });
      }}
    >
      <div className="flex flex-col gap-1">
        <Label>Member</Label>
        <MemberSelect value={memberId} onChange={setMember} id="adjustment-member" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="adjustment-amount">Amount (৳, signed)</Label>
        <Input id="adjustment-amount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="3000 or -5000" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="adjustment-month">Month label (optional)</Label>
        <Input id="adjustment-month" placeholder="YYYY-MM" value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="adjustment-reason">Reason</Label>
        <Input id="adjustment-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="opening due / waived month" />
      </div>
      <div className="sm:col-span-4">
        <Button type="submit" disabled={!memberId || !amount || !reason}>Record Adjustment</Button>
        <p className="mt-1 text-xs text-muted-foreground">Opening due positive, waiver negative — the honest-correction mechanism (Admins only).</p>
      </div>
    </form>
  );
}

function ContributionForm({ collection }: { collection: ReturnType<typeof createCollection<never>> }) {
  const form = useForm({
    defaultValues: { memberId: "", bankAccountId: "", amount: "", creditDate: todayInDhaka(), note: "" },
    onSubmit: async ({ value }) => {
      try {
        await collection.insert({
          ...value,
          id: `optimistic-${crypto.randomUUID()}`,
          type: "contribution",
          date: value.creditDate,
          amount: Number(value.amount),
          memberName: null,
          bankName: null,
          toBankName: null,
          note: value.note || null,
        } as FeedRow & Record<string, unknown>);
        toast.success("Contribution recorded");
        form.reset();
        // optimistically refresh balances and member positions
        await queryClient.invalidateQueries({ queryKey: ["banks"] });
        await queryClient.invalidateQueries({ queryKey: ["members"] });
        await queryClient.invalidateQueries({ queryKey: ["position"] });
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

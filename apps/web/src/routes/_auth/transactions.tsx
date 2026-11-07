import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { ArrowDownLeftIcon, ArrowUpRightIcon, MoreHorizontalIcon, PencilIcon, PlusIcon, ReceiptTextIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { formatTaka } from "@DreamDev/db/domain/money";
import { todayInDhaka } from "@DreamDev/db/domain/month";
import { Button } from "@DreamDev/ui/components/button";
import { Card } from "@DreamDev/ui/components/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@DreamDev/ui/components/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@DreamDev/ui/components/dropdown-menu";
import { Input } from "@DreamDev/ui/components/input";
import { NativeSelect } from "@DreamDev/ui/components/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@DreamDev/ui/components/table";
import { cn } from "@DreamDev/ui/lib/utils";

import { FEED_TYPES, listFeedQuerySchema } from "@/api/transactions/schema";
import { Amount } from "@/components/amount";
import { BankSelect, useBankBalance } from "@/components/bank-select";
import { DatePicker, isFutureDate } from "@/components/date-picker";
import { EmptyState } from "@/components/empty-state";
import { Field } from "@/components/field";
import { LoanRepaymentForm } from "@/components/loan-repayment-form";
import { MemberSelect } from "@/components/member-select";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { TransactionIcon, TYPE_LABELS } from "@/components/transaction-icon";
import { api } from "@/lib/api";
import { firstError } from "@/lib/form-errors";
import { formatDay } from "@/lib/format";
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

type FeedResponse = { data: FeedRow[]; meta: { page: number; pageSize: number; total: number } };

const ENTRY_TYPES = ["contribution", "loan_repayment", "expense", "transfer", "adjustment"] as const;
type EntryType = (typeof ENTRY_TYPES)[number];

const EDITABLE_TYPES = new Set(["contribution", "expense", "transfer", "adjustment"]);

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

  const [entryOpen, setEntryOpen] = useState(false);
  const [entryType, setEntryType] = useState<EntryType>("contribution");
  const [editing, setEditing] = useState<FeedRow | null>(null);
  const [deleting, setDeleting] = useState<FeedRow | null>(null);

  // Discrete selections apply immediately so a delayed update cannot restore cleared filters.
  const onFilter = (patch: Record<string, string | undefined>) => {
    navigate({ search: (prev) => ({ ...prev, ...patch, page: 1 }) });
  };

  const feedQueryKey = ["transactions", search] as const;
  const feedQuery = useQuery({
    queryKey: feedQueryKey,
    queryFn: () =>
      api<FeedResponse>(
        `/api/transactions?${new URLSearchParams(Object.entries(search).map(([k, v]) => [k, String(v)]) as [string, string][])}`,
      ),
  });
  const rows = feedQuery.data?.data ?? [];
  const meta = feedQuery.data?.meta;
  const activeFilters = Boolean(search.type || search.from || search.to);

  const clearFilters = () => {
    navigate({ search: (prev) => ({ ...prev, type: undefined, from: undefined, to: undefined, page: 1 }) });
  };

  const afterChange = async () => {
    await queryClient.invalidateQueries({ queryKey: ["transactions"] });
    await queryClient.invalidateQueries({ queryKey: ["banks"] });
    await queryClient.invalidateQueries({ queryKey: ["members"] });
    await queryClient.invalidateQueries({ queryKey: ["position"] });
    await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    await queryClient.invalidateQueries({ queryKey: ["member"] });
  };

  /** Optimistic CRUD on the Query cache: instant row change, rollback + toast on failure. */
  const createContribution = useMutation({
    mutationFn: (values: { memberId: string; bankAccountId: string; amount: number; creditDate: string; note?: string }) =>
      api<{ id: string }>("/api/contributions", { method: "POST", body: JSON.stringify(values) }),
    onSuccess: async () => {
      toast.success("Contribution recorded");
      await afterChange();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const editEntry = useMutation({
    mutationFn: ({ row, amount }: { row: FeedRow; amount: number }) =>
      api(`/api/${pathFor(row.type)}/${row.id}`, { method: "PATCH", body: JSON.stringify({ amount }) }),
    onMutate: async ({ row, amount }) => {
      await queryClient.cancelQueries({ queryKey: feedQueryKey });
      const previous = queryClient.getQueryData<FeedResponse>(feedQueryKey);
      const signed = row.type === "adjustment" ? amount : -Math.abs(amount);
      queryClient.setQueryData<FeedResponse>(feedQueryKey, (old) =>
        old ? { ...old, data: old.data.map((entry) => (entry.id === row.id ? { ...entry, amount: signed } : entry)) } : old,
      );
      return { previous };
    },
    onError: (error: Error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(feedQueryKey, context.previous);
      toast.error(error.message);
    },
    onSuccess: () => toast.success("Entry updated"),
    onSettled: afterChange,
  });

  const deleteEntry = useMutation({
    mutationFn: (row: FeedRow) => api(`/api/${pathFor(row.type)}/${row.id}`, { method: "DELETE" }),
    onMutate: async (row) => {
      await queryClient.cancelQueries({ queryKey: feedQueryKey });
      const previous = queryClient.getQueryData<FeedResponse>(feedQueryKey);
      queryClient.setQueryData<FeedResponse>(feedQueryKey, (old) =>
        old ? { ...old, data: old.data.filter((entry) => entry.id !== row.id) } : old,
      );
      return { previous };
    },
    onError: (error: Error, _row, context) => {
      if (context?.previous) queryClient.setQueryData(feedQueryKey, context.previous);
      toast.error(error.message);
    },
    onSuccess: () => {
      toast.success("Entry deleted");
      setDeleting(null);
    },
    onSettled: afterChange,
  });

  const inflow = rows.filter((row) => row.amount > 0).reduce((sum, row) => sum + row.amount, 0);
  const outflow = rows.filter((row) => row.amount < 0).reduce((sum, row) => sum + Math.abs(row.amount), 0);

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-8">
      <PageHeader
        eyebrow="Fund"
        title="Transactions"
        description="Every contribution, loan, expense, transfer and adjustment in one ledger."
        actions={
          <Button
            className="gap-2"
            onClick={() => {
              setEntryType("contribution");
              setEntryOpen(true);
            }}
          >
            <PlusIcon className="size-4" />
            Record entry
          </Button>
        }
      />

      <Card>
        <div className="flex flex-col gap-4 px-5">
          <div className="grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:items-end">
            <div className="col-span-2 flex flex-col gap-1.5 sm:min-w-40">
              <label htmlFor="filter-type" className="text-xs font-medium text-muted-foreground">
                Type
              </label>
              <NativeSelect id="filter-type" value={search.type ?? ""} onChange={(event) => onFilter({ type: event.target.value || undefined })}>
                <option value="">All types</option>
                {FEED_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {TYPE_LABELS[type]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="filter-from" className="text-xs font-medium text-muted-foreground">
                From
              </label>
              <DatePicker id="filter-from" value={search.from ?? ""} placeholder="Start date" onChange={(value) => onFilter({ from: value || undefined })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="filter-to" className="text-xs font-medium text-muted-foreground">
                To
              </label>
              <DatePicker id="filter-to" value={search.to ?? ""} placeholder="End date" onChange={(value) => onFilter({ to: value || undefined })} />
            </div>
            {activeFilters && (
              <Button variant="ghost" className="col-span-2 justify-self-start sm:justify-self-auto" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>

          <dl className="grid grid-cols-1 divide-y divide-border rounded-lg border border-border bg-muted/25 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {[
              { label: "Inflow", value: inflow, icon: ArrowDownLeftIcon, tone: "text-success" },
              { label: "Outflow", value: outflow, icon: ArrowUpRightIcon, tone: "text-destructive" },
              { label: "Net on page", value: inflow - outflow, icon: ReceiptTextIcon, tone: "text-foreground" },
            ].map((stat) => (
              <div key={stat.label} className="flex items-center gap-3 px-4 py-2.5 sm:py-3">
                <stat.icon className={cn("size-4 shrink-0", stat.tone)} aria-hidden />
                <div className="min-w-0">
                  <dt className="text-[11px] text-muted-foreground">{stat.label}</dt>
                  <dd className={cn("font-medium tabular", stat.tone)}>{formatTaka(stat.value)}</dd>
                </div>
              </div>
            ))}
          </dl>
        </div>

        {feedQuery.isLoading ? (
          <div className="flex flex-col gap-2 px-5">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="h-14 animate-pulse rounded-lg bg-muted/60" />
            ))}
          </div>
        ) : rows.length > 0 ? (
          <>
            <div className="hidden lg:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Entry</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Counterparty</TableHead>
                    <TableHead>Bank</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="w-12">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={`${row.type}-${row.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <TransactionIcon type={row.type} />
                          <div className="min-w-0">
                            <p className="font-medium">{TYPE_LABELS[row.type] ?? row.type}</p>
                            {row.note && <p className="max-w-56 truncate text-xs text-muted-foreground">{row.note}</p>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground tabular">{formatDay(row.date)}</TableCell>
                      <TableCell className="max-w-44 truncate">{row.memberName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="max-w-44 truncate text-muted-foreground">
                        {row.bankName ?? "—"}
                        {row.toBankName ? ` → ${row.toBankName}` : ""}
                      </TableCell>
                      <TableCell className="text-right">
                        <Amount value={row.amount} showPlus />
                      </TableCell>
                      <TableCell className="text-right">
                        {EDITABLE_TYPES.has(row.type) ? (
                          <EntryActions
                            row={row}
                            onEdit={() => setEditing(row)}
                            onDelete={() => setDeleting(row)}
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="divide-y divide-border/70 lg:hidden">
              {rows.map((row) => (
                <li key={`${row.type}-${row.id}`} className="flex items-start gap-3 px-4 py-4">
                  <TransactionIcon type={row.type} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">{TYPE_LABELS[row.type] ?? row.type}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatDay(row.date)}
                          {row.memberName ? ` · ${row.memberName}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Amount value={row.amount} showPlus />
                        {EDITABLE_TYPES.has(row.type) && (
                          <EntryActions
                            row={row}
                            onEdit={() => setEditing(row)}
                            onDelete={() => setDeleting(row)}
                          />
                        )}
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {row.bankName ?? "—"}
                      {row.toBankName ? ` → ${row.toBankName}` : ""}
                    </p>
                    {row.note && <p className="mt-1 truncate text-xs text-muted-foreground">{row.note}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="px-5">
            <EmptyState
              icon={ReceiptTextIcon}
              title={activeFilters ? "No entries match these filters" : "No transactions yet"}
              description={activeFilters ? "Try a wider date range or a different type." : "Record a contribution, expense or transfer to start the ledger."}
              action={
                activeFilters ? (
                  <Button variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : (
                  <Button onClick={() => setEntryOpen(true)} className="gap-2">
                    <PlusIcon className="size-4" />
                    Record entry
                  </Button>
                )
              }
            />
          </div>
        )}

        {rows.length > 0 && (
          <Pagination
            page={search.page}
            pageSize={search.pageSize}
            total={meta?.total}
            hasNext={meta ? search.page * search.pageSize < meta.total : undefined}
            onPrevious={() => navigate({ search: (prev) => ({ ...prev, page: prev.page - 1 }) })}
            onNext={() => navigate({ search: (prev) => ({ ...prev, page: prev.page + 1 }) })}
          />
        )}
      </Card>

      <Dialog open={entryOpen} onOpenChange={setEntryOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Record an entry</DialogTitle>
            <DialogDescription>Choose the ledger, fill the details, and it lands in the feed immediately.</DialogDescription>
          </DialogHeader>

          <div role="tablist" aria-label="Entry type" className="flex flex-wrap gap-1 rounded-lg border border-border bg-muted/40 p-1">
            {ENTRY_TYPES.map((type) => {
              const disabled = type === "adjustment" && !isAdmin;
              return (
                <button
                  key={type}
                  role="tab"
                  type="button"
                  aria-selected={entryType === type}
                  disabled={disabled}
                  onClick={() => setEntryType(type)}
                  className={cn(
                    "cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                    entryType === type ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {TYPE_LABELS[type]}
                </button>
              );
            })}
          </div>

          {entryType === "contribution" && <ContributionForm onCreate={createContribution.mutateAsync} onDone={() => setEntryOpen(false)} />}
          {entryType === "loan_repayment" && <LoanRepaymentForm onDone={() => setEntryOpen(false)} />}
          {entryType === "expense" && <ExpenseForm onDone={() => setEntryOpen(false)} />}
          {entryType === "transfer" && <TransferForm onDone={() => setEntryOpen(false)} />}
          {entryType === "adjustment" && isAdmin && <AdjustmentForm onDone={() => setEntryOpen(false)} />}
        </DialogContent>
      </Dialog>

      <EditAmountDialog
        row={editing}
        pending={editEntry.isPending}
        onClose={() => setEditing(null)}
        onSubmit={(amount) => {
          if (!editing) return;
          editEntry.mutate({ row: editing, amount });
          setEditing(null);
        }}
      />

      <Dialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this entry?</DialogTitle>
            <DialogDescription>
              {deleting
                ? `${TYPE_LABELS[deleting.type] ?? deleting.type} of ${formatTaka(Math.abs(deleting.amount))} on ${formatDay(deleting.date)} will be removed from the ledger.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleteEntry.isPending} onClick={() => deleting && deleteEntry.mutate(deleting)}>
              {deleteEntry.isPending ? "Deleting…" : "Delete entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EntryActions({ row, onEdit, onDelete }: { row: FeedRow; onEdit: () => void; onDelete: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${TYPE_LABELS[row.type] ?? row.type} entry`} />}>
        <MoreHorizontalIcon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onEdit}>
          <PencilIcon />
          Edit amount
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <Trash2Icon />
          Delete entry
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function pathFor(type: string) {
  return type === "contribution" ? "contributions" : type === "expense" ? "expenses" : type === "transfer" ? "transfers" : "adjustments";
}

function EditAmountDialog({
  row,
  pending,
  onClose,
  onSubmit,
}: {
  row: FeedRow | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (amount: number) => void;
}) {
  const initial = row ? String(Math.abs(row.amount)) : "";
  return (
    <Dialog open={Boolean(row)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit amount</DialogTitle>
          <DialogDescription>
            {row ? `${TYPE_LABELS[row.type] ?? row.type} · ${formatDay(row.date)}` : ""}
          </DialogDescription>
        </DialogHeader>
        <form
          key={row?.id ?? "none"}
          className="grid grid-cols-1 gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const amount = Number(form.get("amount"));
            if (!Number.isFinite(amount) || amount === 0) return;
            onSubmit(amount);
          }}
        >
          <Field
            label="Amount (৳)"
            htmlFor="edit-amount"
            hint={row?.type === "adjustment" ? "Signed: positive adds to the member's due, negative waives it." : undefined}
          >
            <Input id="edit-amount" name="amount" inputMode="numeric" defaultValue={initial} autoFocus />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save amount"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Shared post-and-invalidate for the secondary entry forms. */
function useEntryMutation(path: string) {
  return useMutation({
    mutationFn: (body: unknown) => api(path, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: async () => {
      toast.success("Recorded");
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["banks"] });
      await queryClient.invalidateQueries({ queryKey: ["members"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["member"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

function ExpenseForm({ onDone }: { onDone: () => void }) {
  const create = useEntryMutation("/api/expenses");
  const [bankAccountId, setBank] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayInDhaka());
  const [note, setNote] = useState("");
  const available = useBankBalance(bankAccountId);
  const over = available !== undefined && Number(amount) > available;
  return (
    <form
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      onSubmit={async (event) => {
        event.preventDefault();
        if (isFutureDate(date)) {
          toast.error("Date can't be in the future");
          return;
        }
        try {
          await create.mutateAsync({ bankAccountId, amount: Number(amount), date, note: note || undefined });
          onDone();
        } catch {
          // toast already surfaced
        }
      }}
    >
      <Field
        label="Bank account"
        htmlFor="expense-bank"
        required
        hint={available !== undefined ? `Available balance ${formatTaka(available)}` : undefined}
        error={over ? `Exceeds the available balance of ${formatTaka(available ?? 0)}` : undefined}
      >
        <BankSelect value={bankAccountId} onChange={setBank} id="expense-bank" />
      </Field>
      <Field label="Amount (৳)" htmlFor="expense-amount" required>
        <Input id="expense-amount" inputMode="numeric" placeholder="0" value={amount} onChange={(event) => setAmount(event.target.value)} />
      </Field>
      <Field label="Date" htmlFor="expense-date" required>
        <DatePicker id="expense-date" required max={todayInDhaka()} value={date} onChange={setDate} disabled={create.isPending} />
      </Field>
      <Field label="Note" htmlFor="expense-note" hint="Optional">
        <Input id="expense-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Bank charges, cash withdrawal…" />
      </Field>
      <p className="text-xs text-muted-foreground sm:col-span-2">Money out of the fund that isn&rsquo;t a loan to a member.</p>
      <DialogFooter className="sm:col-span-2">
        <Button type="submit" disabled={create.isPending || !bankAccountId || !amount || over}>
          {create.isPending ? "Recording…" : "Record expense"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function TransferForm({ onDone }: { onDone: () => void }) {
  const create = useEntryMutation("/api/transfers");
  const [fromAccountId, setFrom] = useState("");
  const [toAccountId, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayInDhaka());
  const available = useBankBalance(fromAccountId);
  const over = available !== undefined && Number(amount) > available;
  return (
    <form
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      onSubmit={async (event) => {
        event.preventDefault();
        if (isFutureDate(date)) {
          toast.error("Date can't be in the future");
          return;
        }
        try {
          await create.mutateAsync({ fromAccountId, toAccountId, amount: Number(amount), date });
          onDone();
        } catch {
          // toast already surfaced
        }
      }}
    >
      <Field
        label="From account"
        htmlFor="transfer-from"
        required
        hint={available !== undefined ? `Available balance ${formatTaka(available)}` : undefined}
        error={over ? `Exceeds the available balance of ${formatTaka(available ?? 0)}` : undefined}
      >
        <BankSelect value={fromAccountId} onChange={setFrom} id="transfer-from" />
      </Field>
      <Field label="To account" htmlFor="transfer-to" required>
        <BankSelect value={toAccountId} onChange={setTo} id="transfer-to" />
      </Field>
      <Field label="Amount (৳)" htmlFor="transfer-amount" required>
        <Input id="transfer-amount" inputMode="numeric" placeholder="0" value={amount} onChange={(event) => setAmount(event.target.value)} />
      </Field>
      <Field label="Date" htmlFor="transfer-date" required>
        <DatePicker id="transfer-date" required max={todayInDhaka()} value={date} onChange={setDate} disabled={create.isPending} />
      </Field>
      <p className="text-xs text-muted-foreground sm:col-span-2">Moves money between the team&rsquo;s own accounts — total holdings stay the same.</p>
      <DialogFooter className="sm:col-span-2">
        <Button type="submit" disabled={create.isPending || !fromAccountId || !toAccountId || fromAccountId === toAccountId || !amount || over}>
          {create.isPending ? "Recording…" : "Record transfer"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function AdjustmentForm({ onDone }: { onDone: () => void }) {
  const create = useEntryMutation("/api/adjustments");
  const [memberId, setMember] = useState("");
  const [amount, setAmount] = useState("");
  const [month, setMonth] = useState("");
  const [reason, setReason] = useState("");
  return (
    <form
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          await create.mutateAsync({ memberId, amount: Number(amount), month: month || undefined, reason });
          onDone();
        } catch {
          // toast already surfaced
        }
      }}
    >
      <Field label="Member" htmlFor="adjustment-member" required>
        <MemberSelect value={memberId} onChange={setMember} id="adjustment-member" />
      </Field>
      <Field label="Amount (৳, signed)" htmlFor="adjustment-amount" required hint="Positive adds an opening due; negative waives it.">
        <Input id="adjustment-amount" placeholder="3000 or -5000" value={amount} onChange={(event) => setAmount(event.target.value)} />
      </Field>
      <Field label="Month" htmlFor="adjustment-month" hint="Optional YYYY-MM">
        <Input id="adjustment-month" placeholder="2026-01" value={month} onChange={(event) => setMonth(event.target.value)} />
      </Field>
      <Field label="Reason" htmlFor="adjustment-reason" required>
        <Input id="adjustment-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Opening due / waived month" />
      </Field>
      <p className="text-xs text-muted-foreground sm:col-span-2">The honest-correction mechanism. Admins only.</p>
      <DialogFooter className="sm:col-span-2">
        <Button type="submit" disabled={create.isPending || !memberId || !amount || !reason}>
          {create.isPending ? "Recording…" : "Record adjustment"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Disabled Due field fed by the member position endpoint (spec). */
function DueDisplay({ memberId }: { memberId: string }) {
  const positionQuery = useQuery({
    queryKey: ["position", memberId],
    queryFn: () => api<{ due: number; advance: number; shares: number; sharePrice: number }>(`/api/members/${memberId}/position`),
    enabled: memberId !== "",
  });
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">Current due</span>
      <div className="flex h-9 items-center rounded-lg border border-border bg-muted/40 px-3 text-sm tabular">
        {positionQuery.data
          ? positionQuery.data.advance > 0
            ? `Advance ${formatTaka(positionQuery.data.advance)}`
            : formatTaka(positionQuery.data.due)
          : "Select a member"}
      </div>
      {positionQuery.data && (
        <p className="text-xs text-muted-foreground">
          {positionQuery.data.shares} {positionQuery.data.shares === 1 ? "share" : "shares"} × {formatTaka(positionQuery.data.sharePrice)}/month
        </p>
      )}
      {positionQuery.data && positionQuery.data.advance > 0 && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {(() => {
            const monthly = positionQuery.data.shares * positionQuery.data.sharePrice;
            const months = monthly > 0 ? Math.floor(positionQuery.data.advance / monthly) : 0;
            return months > 0
              ? `Enough for ${months} upcoming ${months === 1 ? "month" : "months"} — it applies automatically as each month is billed.`
              : "Applies automatically against upcoming bills.";
          })()}
        </p>
      )}
    </div>
  );
}

type CreateContribution = (values: { memberId: string; bankAccountId: string; amount: number; creditDate: string; note?: string }) => Promise<unknown>;

function ContributionForm({ onCreate, onDone }: { onCreate: CreateContribution; onDone: () => void }) {
  const [bankAccountId, setBank] = useState("");
  const form = useForm({
    defaultValues: { memberId: "", creditDate: todayInDhaka(), amount: "", note: "" },
    onSubmit: async ({ value }) => {
      try {
        await onCreate({
          memberId: value.memberId,
          bankAccountId,
          amount: Number(value.amount),
          creditDate: value.creditDate,
          note: value.note || undefined,
        });
        form.reset();
        setBank("");
        onDone();
      } catch {
        // toast already surfaced by the mutation
      }
    },
  });

  return (
    <form
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      <form.Field name="memberId" validators={{ onChange: z.string().min(1, "Choose a member") }}>
        {(field) => (
          <Field label="Member" htmlFor="t-member" required error={firstError(field.state.meta.errors)}>
            <MemberSelect value={field.state.value} onChange={field.handleChange} id="t-member" />
          </Field>
        )}
      </form.Field>

      <Field label="Bank account" htmlFor="t-bank" required>
        <BankSelect value={bankAccountId} onChange={setBank} id="t-bank" />
      </Field>

      <form.Field name="creditDate" validators={{ onChange: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date").refine((v) => !isFutureDate(v), "Date can't be in the future") }}>
        {(field) => (
          <Field label="Credit date" htmlFor="t-date" required error={firstError(field.state.meta.errors)}>
            <DatePicker id="t-date" required max={todayInDhaka()} value={field.state.value} onBlur={field.handleBlur} onChange={field.handleChange} aria-invalid={field.state.meta.errors.length > 0} />
          </Field>
        )}
      </form.Field>

      <form.Field name="amount" validators={{ onChange: z.string().regex(/^\d+$/, "Whole taka only") }}>
        {(field) => (
          <Field label="Pay amount (৳)" htmlFor="t-amount" required error={firstError(field.state.meta.errors)}>
            <Input
              id="t-amount"
              inputMode="numeric"
              placeholder="0"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </Field>
        )}
      </form.Field>

      <form.Subscribe selector={(state) => state.values.memberId}>
        {(memberId) => <DueDisplay memberId={memberId} />}
      </form.Subscribe>

      <form.Field name="note">
        {(field) => (
          <Field label="Note" htmlFor="t-note" hint="Optional">
            <Input id="t-note" value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} />
          </Field>
        )}
      </form.Field>

      <DialogFooter className="sm:col-span-2">
        <form.Subscribe selector={(state) => [state.values.memberId, state.values.amount, state.values.creditDate, state.isSubmitting] as const}>
          {([memberId, amount, creditDate, isSubmitting]) => (
            <Button
              type="submit"
              disabled={
                isSubmitting ||
                !bankAccountId ||
                !memberId ||
                !/^\d+$/.test(amount) ||
                Number(amount) <= 0 ||
                !/^\d{4}-\d{2}-\d{2}$/.test(creditDate) ||
                isFutureDate(creditDate)
              }
            >
              {isSubmitting ? "Recording…" : "Record contribution"}
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
}

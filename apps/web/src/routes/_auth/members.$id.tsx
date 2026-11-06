import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  CameraIcon,
  CalendarDaysIcon,
  HandCoinsIcon,
  LayersIcon,
  MapPinIcon,
  MoreHorizontalIcon,
  PhoneIcon,
  PlusIcon,
  RotateCcwIcon,
  UserRoundXIcon,
} from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { formatTaka } from "@DreamDev/db/domain/money";
import { addMonths, todayInDhaka } from "@DreamDev/db/domain/month";
import { Avatar, AvatarFallback, AvatarImage } from "@DreamDev/ui/components/avatar";
import { Badge } from "@DreamDev/ui/components/badge";
import { Button } from "@DreamDev/ui/components/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@DreamDev/ui/components/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@DreamDev/ui/components/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@DreamDev/ui/components/dropdown-menu";
import { Input } from "@DreamDev/ui/components/input";
import { Skeleton } from "@DreamDev/ui/components/skeleton";
import { cn } from "@DreamDev/ui/lib/utils";
import { Progress } from "@DreamDev/ui/components/progress";

import { Amount } from "@/components/amount";
import { BankSelect, useBankBalance } from "@/components/bank-select";
import { EmptyState } from "@/components/empty-state";
import { Field } from "@/components/field";
import { StatusBadge } from "@/components/status-badge";
import { api } from "@/lib/api";
import { formatDay, formatMonth, initials } from "@/lib/format";
import { uploadProfilePhoto } from "@/lib/photo";

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
  advanceCoverage: { months: number; monthlyBill: number; lastCoveredMonth: string } | null;
  timelineYear: number;
  timeline: { month: string; bill: number; applied: number; status: string }[];
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

const MEMBERS_SEARCH = { page: 1, pageSize: 10, sort: "createdAt", order: "desc" } as const;

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

  const [sharesOpen, setSharesOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);

  const detailQuery = useQuery({
    queryKey: ["member", id, year],
    queryFn: () => api<MemberDetail>(`/api/members/${id}${year ? `?year=${year}` : ""}`),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["member", id] });
    queryClient.invalidateQueries({ queryKey: ["members"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["loans", id] });
  };

  const act = useMutation({
    mutationFn: ({ path, body, method = "POST" }: { path: string; body?: unknown; method?: string }) =>
      api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }),
    onSuccess: () => {
      toast.success("Saved");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  async function onPhotoChange(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadProfilePhoto(file);
      await api(`/api/members/${id}`, { method: "PATCH", body: JSON.stringify({ photo: url }) });
      toast.success("Photo updated");
      invalidate();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setUploading(false);
      if (photoInput.current) photoInput.current.value = "";
    }
  }

  if (detailQuery.isLoading) return <MemberDetailSkeleton />;

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <EmptyState
          icon={UserRoundXIcon}
          title="Member not found"
          description="This member may have been removed, or the link is wrong."
          action={
            <Link to="/members" search={MEMBERS_SEARCH} className="inline-flex h-9 items-center rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground">
              Back to members
            </Link>
          }
        />
      </div>
    );
  }

  const { member, shares, summary, advanceCoverage, timeline, timelineYear } = detailQuery.data;
  const currentShares = shares[shares.length - 1]?.quantity ?? 0;
  const currentMonth = todayInDhaka().slice(0, 7);
  const covered = summary.contributed + summary.adjusted;
  const coverage = summary.billed > 0 ? Math.min(100, Math.round((covered / summary.billed) * 100)) : 0;
  const position = summary.advance > 0 ? "advance" : summary.due > 0 ? "due" : "settled";

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-8">
      <Link to="/members" search={MEMBERS_SEARCH} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline">
        <ArrowLeftIcon className="size-3.5" />
        All members
      </Link>

      <header className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-4 sm:gap-5">
          <div className="relative shrink-0">
            <Avatar className="size-16 text-lg sm:size-20 sm:text-xl">
              {member.photo ? <AvatarImage src={member.photo} alt={member.name} /> : null}
              <AvatarFallback>{initials(member.name)}</AvatarFallback>
            </Avatar>
            <Button
              size="icon-sm"
              aria-label={member.photo ? "Replace photo" : "Add photo"}
              className="absolute -right-1 -bottom-1 rounded-full border-2 border-background"
              onClick={() => photoInput.current?.click()}
              disabled={uploading}
            >
              <CameraIcon className="size-3.5" />
            </Button>
            <input
              ref={photoInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(event) => onPhotoChange(event.target.files?.[0])}
            />
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-display text-3xl leading-none tracking-tight sm:text-4xl">{member.name}</h1>
              <StatusBadge status={member.status} />
            </div>
            <div className="mt-3 flex flex-col gap-1.5 text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <PhoneIcon className="size-3.5" aria-hidden />
                <a href={`tel:${member.mobile}`} className="tabular hover:text-foreground hover:underline">
                  {member.mobile}
                </a>
              </span>
              <span className="flex items-center gap-2">
                <CalendarDaysIcon className="size-3.5" aria-hidden />
                Joined {formatDay(member.joiningDate)}
                {member.exitDate ? ` · Exited ${formatDay(member.exitDate)}` : ""}
              </span>
              {member.address && (
                <span className="flex items-start gap-2">
                  <MapPinIcon className="mt-0.5 size-3.5" aria-hidden />
                  {member.address}
                </span>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
              {member.photo && (
                <button type="button" className="cursor-pointer text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={() => act.mutate({ path: `/api/members/${id}`, method: "PATCH", body: { photo: null } })}>
                  Remove photo
                </button>
              )}
              {uploading && <span className="text-muted-foreground">Uploading photo…</span>}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <Button variant="outline" onClick={() => setSharesOpen(true)} className="gap-2">
              <LayersIcon className="size-4" />
              Change shares
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" className="gap-2" />}>
              <MoreHorizontalIcon className="size-4" />
              Member actions
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Membership</DropdownMenuLabel>
              {member.status === "active" && (
                <DropdownMenuItem onClick={() => act.mutate({ path: `/api/members/${id}/status`, body: { status: "inactive", date: todayInDhaka() } })}>
                  Mark inactive
                </DropdownMenuItem>
              )}
              {member.status === "inactive" && (
                <DropdownMenuItem onClick={() => act.mutate({ path: `/api/members/${id}/status`, body: { status: "active", date: todayInDhaka() } })}>
                  Reactivate member
                </DropdownMenuItem>
              )}
              {member.status !== "exited" && <DropdownMenuItem onClick={() => setStatusOpen(true)}>Mark exited…</DropdownMenuItem>}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setRemoveOpen(true)}>
                Remove member…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Current position</CardTitle>
            <CardDescription>Across all billed months.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div>
              <p className="text-micro text-muted-foreground">{position === "advance" ? "Advance balance" : position === "due" ? "Outstanding due" : "Balance"}</p>
              <p
                className={cn(
                  "mt-1 font-display text-4xl leading-none tabular",
                  position === "due" ? "text-destructive" : position === "advance" ? "text-success" : "text-foreground",
                )}
              >
                {position === "settled" ? "Settled" : formatTaka(position === "due" ? summary.due : summary.advance)}
              </p>
              {position === "advance" && advanceCoverage && (
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  <span className="font-medium text-success">
                    Covers {formatMonth(addMonths(currentMonth, 1))}
                    {advanceCoverage.months > 1 ? ` – ${formatMonth(advanceCoverage.lastCoveredMonth)}` : ""}
                  </span>{" "}
                  ({advanceCoverage.months} {advanceCoverage.months === 1 ? "month" : "months"} at {formatTaka(advanceCoverage.monthlyBill)}). Applied
                  automatically as each month is billed.
                </p>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Billing covered</span>
                <span className="tabular">{coverage}%</span>
              </div>
              <Progress value={coverage} className="mt-2 bg-muted text-primary" aria-label="Share of lifetime billing covered" />
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Billed</dt>
                <dd className="mt-0.5 font-medium tabular">{formatTaka(summary.billed)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Contributed</dt>
                <dd className="mt-0.5 font-medium tabular">{formatTaka(summary.contributed)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Adjustments</dt>
                <dd className="mt-0.5 font-medium tabular">{formatTaka(summary.adjusted)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Shares</dt>
                <dd className="mt-0.5 font-medium tabular">{currentShares}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Share allotments</CardTitle>
            <CardDescription>Effective from the month each change applies.</CardDescription>
            <CardAction>
              {isAdmin && (
                <Button variant="ghost" size="sm" onClick={() => setSharesOpen(true)}>
                  Edit
                </Button>
              )}
            </CardAction>
          </CardHeader>
          <CardContent>
            {shares.length > 0 ? (
              <ol className="relative flex flex-col gap-4 border-l border-border pl-4">
                {[...shares].reverse().map((entry, index) => (
                  <li key={`${entry.effectiveMonth}-${entry.quantity}`} className="relative">
                    <span
                      aria-hidden
                      className={cn(
                        "absolute top-1 -left-[21px] size-2.5 rounded-full ring-4 ring-card",
                        index === 0 ? "bg-primary" : "bg-border",
                      )}
                    />
                    <p className="text-sm font-medium tabular">
                      {entry.quantity} {entry.quantity === 1 ? "share" : "shares"}
                    </p>
                    <p className="text-xs text-muted-foreground">{index === 0 ? "Current · " : ""}from {formatMonth(entry.effectiveMonth)}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">No share allotments recorded.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Membership</CardTitle>
            <CardDescription>Key dates and administrative notes.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Status</dt>
                <dd>
                  <StatusBadge status={member.status} />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-border/70 pt-3">
                <dt className="text-muted-foreground">Joined</dt>
                <dd className="tabular">{formatDay(member.joiningDate)}</dd>
              </div>
              {member.exitDate && (
                <div className="flex items-center justify-between gap-3 border-t border-border/70 pt-3">
                  <dt className="text-muted-foreground">Exited</dt>
                  <dd className="tabular">{formatDay(member.exitDate)}</dd>
                </div>
              )}
              <div className="flex items-center justify-between gap-3 border-t border-border/70 pt-3">
                <dt className="text-muted-foreground">Photo</dt>
                <dd>{member.photo ? "On file" : "Not added"}</dd>
              </div>
            </dl>
            {member.notes && <p className="mt-4 rounded-lg bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">{member.notes}</p>}
            {!isAdmin && <p className="mt-4 text-xs text-muted-foreground">Only admins can change share quantity.</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Billing timeline</CardTitle>
          <CardDescription>
            {timelineYear} — each month&rsquo;s bill with payments applied oldest-first (FIFO, ADR-0001). Months after{" "}
            {formatMonth(currentMonth)} are upcoming, projected at today&rsquo;s shares and price.
          </CardDescription>
          <CardAction>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="icon-sm" aria-label="Previous year" onClick={() => navigate({ search: (prev) => ({ ...prev, year: timelineYear - 1 }) })}>
                <span aria-hidden>←</span>
              </Button>
              <span className="min-w-14 text-center text-sm font-medium tabular">{timelineYear}</span>
              <Button variant="outline" size="icon-sm" aria-label="Next year" onClick={() => navigate({ search: (prev) => ({ ...prev, year: timelineYear + 1 }) })}>
                <span aria-hidden>→</span>
              </Button>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {Array.from({ length: 12 }, (_, index) => {
              const month = `${timelineYear}-${String(index + 1).padStart(2, "0")}`;
              const cell = timeline.find((entry) => entry.month === month);
              const status = cell?.status ?? "not-billed";
              const upcoming = month > currentMonth;
              const spoken = cell
                ? `${status.replaceAll("-", " ")}, bill ${formatTaka(cell.bill)}, applied ${formatTaka(cell.applied)}`
                : "not billed";
              return (
                <div
                  key={month}
                  aria-label={`${MONTH_LABELS[index]} ${timelineYear}${upcoming ? ", upcoming projection" : ""}: ${spoken}`}
                  className={cn("flex flex-col gap-2 rounded-lg border p-3", cellTone(status), upcoming && "border-dashed")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-muted-foreground">{MONTH_LABELS[index]}</p>
                    <StatusBadge status={status} />
                  </div>
                  <p className="font-display text-lg leading-none tabular">{cell && cell.bill > 0 ? formatTaka(cell.bill) : "—"}</p>
                  <p className="text-[11px] text-muted-foreground tabular">applied {formatTaka(cell?.applied ?? 0)}</p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <LoansSection memberId={id} onSaved={invalidate} />

      <ShareChangeDialog
        key={`${currentShares}-${shares.length}`}
        open={sharesOpen}
        onOpenChange={setSharesOpen}
        memberName={member.name}
        currentShares={currentShares}
        pending={act.isPending}
        onSubmit={(quantity, effectiveMonth) => {
          act.mutate({ path: `/api/members/${id}/shares`, body: { quantity, effectiveMonth } });
          setSharesOpen(false);
        }}
      />

      <StatusChangeDialog
        open={statusOpen}
        onOpenChange={setStatusOpen}
        memberName={member.name}
        pending={act.isPending}
        onSubmit={(date, note) => {
          act.mutate({ path: `/api/members/${id}/status`, body: { status: "exited", date, note } });
          setStatusOpen(false);
        }}
      />

      <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {member.name}?</DialogTitle>
            <DialogDescription>
              The member is soft-deleted and disappears from lists and billing. Their ledger entries stay intact.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                act.mutate({ path: `/api/members/${id}`, method: "DELETE" });
                setRemoveOpen(false);
                navigate({ to: "/members", search: MEMBERS_SEARCH });
              }}
            >
              Remove member
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ShareChangeDialog({
  open,
  onOpenChange,
  memberName,
  currentShares,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberName: string;
  currentShares: number;
  pending: boolean;
  onSubmit: (quantity: number, effectiveMonth: string) => void;
}) {
  const [quantity, setQuantity] = useState(String(currentShares));
  const [effectiveMonth, setEffectiveMonth] = useState(todayInDhaka().slice(0, 7));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change shares</DialogTitle>
          <DialogDescription>Update {memberName}&rsquo;s holding. The new quantity applies from the chosen billing month.</DialogDescription>
        </DialogHeader>
        <form
          className="grid grid-cols-1 gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(Number(quantity), effectiveMonth);
          }}
        >
          <Field label="Shares" htmlFor="share-quantity" hint={`Currently ${currentShares}. Between 1 and 100.`}>
            <Input id="share-quantity" inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
          </Field>
          <Field label="Effective from" htmlFor="share-month">
            <Input id="share-month" type="month" value={effectiveMonth} onChange={(event) => setEffectiveMonth(event.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !/^[1-9]\d{0,2}$/.test(quantity)}>
              {pending ? "Saving…" : "Save shares"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StatusChangeDialog({
  open,
  onOpenChange,
  memberName,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberName: string;
  pending: boolean;
  onSubmit: (date: string, note: string | undefined) => void;
}) {
  const [date, setDate] = useState(todayInDhaka());
  const [note, setNote] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark {memberName} as exited</DialogTitle>
          <DialogDescription>Billing stops from the effective date. You can record a reason for the ledger.</DialogDescription>
        </DialogHeader>
        <form
          className="grid grid-cols-1 gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(date, note || undefined);
          }}
        >
          <Field label="Effective date" htmlFor="status-date">
            <Input id="status-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </Field>
          <Field label="Note" htmlFor="status-note" hint="Optional">
            <Input id="status-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Relocated" />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={pending || !date}>
              {pending ? "Saving…" : "Mark exited"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LoansSection({ memberId, onSaved }: { memberId: string; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const [newLoanOpen, setNewLoanOpen] = useState(false);
  const [repaying, setRepaying] = useState<LoanRowView | null>(null);
  const [removing, setRemoving] = useState<LoanRowView | null>(null);

  const loansQuery = useQuery({
    queryKey: ["loans", memberId],
    queryFn: () => api<{ loans: LoanRowView[]; totalOutstanding: number }>(`/api/members/${memberId}/loans`),
  });

  const refresh = () => {
    onSaved();
    queryClient.invalidateQueries({ queryKey: ["loans", memberId] });
  };

  const removeLoan = useMutation({
    mutationFn: (loanId: string) => api(`/api/loans/${loanId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Loan removed");
      setRemoving(null);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const loans = loansQuery.data?.loans ?? [];
  const totalOutstanding = loansQuery.data?.totalOutstanding ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Loans</CardTitle>
        <CardDescription>Money this member has taken from the fund and repaid.</CardDescription>
        <CardAction>
          <div className="flex items-center gap-2">
            {totalOutstanding > 0 && (
              <Badge variant="destructive" className="tabular">
                {formatTaka(totalOutstanding)} outstanding
              </Badge>
            )}
            <Button className="gap-2" onClick={() => setNewLoanOpen(true)}>
              <PlusIcon className="size-4" />
              New loan
            </Button>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        {loansQuery.isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : loans.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
                  <th scope="col" className="py-2 pr-4 font-semibold">Taken</th>
                  <th scope="col" className="py-2 pr-4 text-right font-semibold">Principal</th>
                  <th scope="col" className="py-2 pr-4 text-right font-semibold">Repaid</th>
                  <th scope="col" className="py-2 pr-4 text-right font-semibold">Outstanding</th>
                  <th scope="col" className="py-2 text-right font-semibold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {loans.map((loan) => (
                  <tr key={loan.id}>
                    <td className="py-3 pr-4">
                      <p className="font-medium tabular">{formatDay(loan.date)}</p>
                      {loan.note && <p className="text-xs text-muted-foreground">{loan.note}</p>}
                    </td>
                    <td className="py-3 pr-4 text-right tabular">{formatTaka(loan.amount)}</td>
                    <td className="py-3 pr-4 text-right tabular">{formatTaka(loan.repaid)}</td>
                    <td className="py-3 pr-4 text-right">
                      {loan.settled ? (
                        <Badge variant="success">Settled</Badge>
                      ) : (
                        <Amount value={loan.outstanding} tone="negative" />
                      )}
                    </td>
                    <td className="py-3 text-right whitespace-nowrap">
                      {!loan.settled && (
                        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setRepaying(loan)}>
                          <RotateCcwIcon className="size-3.5" />
                          Repay
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="ml-1 text-muted-foreground" onClick={() => setRemoving(loan)}>
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={HandCoinsIcon}
            title="No loans"
            description="Money this member takes from the fund will be listed here with its repayment history."
            action={
              <Button variant="outline" className="gap-2" onClick={() => setNewLoanOpen(true)}>
                <PlusIcon className="size-4" />
                Record a loan
              </Button>
            }
          />
        )}
      </CardContent>

      <NewLoanDialog
        open={newLoanOpen}
        onOpenChange={setNewLoanOpen}
        memberId={memberId}
        onSaved={refresh}
      />

      <RepayDialog
        key={repaying?.id ?? "none"}
        loan={repaying}
        onClose={() => setRepaying(null)}
        onSaved={refresh}
      />

      <Dialog open={Boolean(removing)} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove this loan?</DialogTitle>
            <DialogDescription>
              {removing ? `The ${formatTaka(removing.amount)} loan from ${formatDay(removing.date)}` : "This loan"} and its repayments will be soft-deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={removeLoan.isPending} onClick={() => removing && removeLoan.mutate(removing.id)}>
              {removeLoan.isPending ? "Removing…" : "Remove loan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function NewLoanDialog({
  open,
  onOpenChange,
  memberId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberId: string;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [date, setDate] = useState(todayInDhaka());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const available = useBankBalance(bankAccountId);
  const over = available !== undefined && Number(amount) > available;

  async function submit(event: FormEvent) {
    event.preventDefault();
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
      setBankAccountId("");
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record a loan</DialogTitle>
          <DialogDescription>Money leaves the chosen bank account and is tracked against this member.</DialogDescription>
        </DialogHeader>
        <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={submit}>
          <Field label="Amount (৳)" htmlFor="loan-amount" required>
            <Input id="loan-amount" inputMode="numeric" placeholder="0" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </Field>
          <Field label="Date" htmlFor="loan-date" required>
            <Input id="loan-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </Field>
          <Field
            label="Bank account"
            htmlFor="loan-bank"
            required
            className="sm:col-span-2"
            hint={available !== undefined ? `Available balance ${formatTaka(available)}` : undefined}
            error={over ? `Exceeds the available balance of ${formatTaka(available ?? 0)}` : undefined}
          >
            <BankSelect id="loan-bank" value={bankAccountId} onChange={setBankAccountId} />
          </Field>
          <Field label="Note" htmlFor="loan-note" hint="Optional" className="sm:col-span-2">
            <Input id="loan-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Purpose of the loan" />
          </Field>
          <p className="text-xs text-muted-foreground sm:col-span-2">Loans over twice the member&rsquo;s total contributions warn, but still record. A loan can never exceed the account&rsquo;s available balance.</p>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !amount || !bankAccountId || over}>
              {saving ? "Recording…" : "Give loan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RepayDialog({ loan, onClose, onSaved }: { loan: LoanRowView | null; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState("");
  const [bankAccountId, setBankAccountId] = useState("");
  const [date, setDate] = useState(todayInDhaka());
  const [saving, setSaving] = useState(false);

  const outstanding = loan?.outstanding ?? 0;
  const value = amount || String(outstanding);

  const repay = useMutation({
    mutationFn: (body: { loanId: string; amount: number; bankAccountId: string; creditDate: string }) =>
      api(`/api/loans/${body.loanId}`, { method: "POST", body: JSON.stringify({ amount: body.amount, bankAccountId: body.bankAccountId, creditDate: body.creditDate }) }),
    onSuccess: () => {
      toast.success("Repayment recorded");
      setAmount("");
      setBankAccountId("");
      onClose();
      onSaved();
    },
    onError: (error: Error) => toast.error(error.message),
    onSettled: () => setSaving(false),
  });

  return (
    <Dialog open={Boolean(loan)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record a repayment</DialogTitle>
          <DialogDescription>
            {loan ? `${formatTaka(outstanding)} outstanding on the loan from ${formatDay(loan.date)}.` : ""}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!loan) return;
            setSaving(true);
            repay.mutate({ loanId: loan.id, amount: Number(value), bankAccountId, creditDate: date });
          }}
        >
          <Field label="Amount (৳)" htmlFor="repay-amount" required>
            <Input id="repay-amount" inputMode="numeric" value={value} onChange={(event) => setAmount(event.target.value)} />
          </Field>
          <Field label="Date received" htmlFor="repay-date" required>
            <Input id="repay-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </Field>
          <Field label="Bank account" htmlFor="repay-bank" required className="sm:col-span-2">
            <BankSelect id="repay-bank" value={bankAccountId} onChange={setBankAccountId} />
          </Field>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !bankAccountId || !value || Number(value) <= 0}>
              {saving ? "Recording…" : "Record repayment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MemberDetailSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-8">
      <Skeleton className="h-3 w-24" />
      <div className="flex items-center gap-5">
        <Skeleton className="size-20 rounded-full" />
        <div className="space-y-3">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-56 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

function cellTone(status: string): string {
  switch (status) {
    case "paid":
      return "border-success/25 bg-success/[0.06]";
    case "advance":
      return "border-info/25 bg-info/[0.06]";
    case "partial":
      return "border-warning/30 bg-warning/[0.07]";
    case "due":
      return "border-destructive/25 bg-destructive/[0.06]";
    default:
      return "border-border bg-muted/20";
  }
}

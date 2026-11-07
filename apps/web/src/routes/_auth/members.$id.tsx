import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  CameraIcon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  HandCoinsIcon,
  LayersIcon,
  MapPinIcon,
  PhoneIcon,
  PlusIcon,
  RotateCcwIcon,
  UserRoundXIcon,
} from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { formatTaka } from "@DreamDev/db/domain/money";
import { addMonths, todayInDhaka } from "@DreamDev/db/domain/month";
import { displayMonthStatus, type MonthCell } from "@DreamDev/db/domain/projection";
import { Avatar, AvatarFallback, AvatarImage } from "@DreamDev/ui/components/avatar";
import { Badge } from "@DreamDev/ui/components/badge";
import { Button } from "@DreamDev/ui/components/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@DreamDev/ui/components/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@DreamDev/ui/components/dialog";
import { Input } from "@DreamDev/ui/components/input";
import { Skeleton } from "@DreamDev/ui/components/skeleton";
import { cn } from "@DreamDev/ui/lib/utils";
import { Progress } from "@DreamDev/ui/components/progress";

import type { LoanView } from "@/api/loans/service";
import { Amount } from "@/components/amount";
import { LoanRepaymentForm } from "@/components/loan-repayment-form";
import { BankSelect, useBankBalance } from "@/components/bank-select";
import { EmptyState } from "@/components/empty-state";
import { DatePicker, isFutureDate } from "@/components/date-picker";
import { MemberActions } from "@/components/member-actions";
import { MemberTelegramCard } from "@/components/telegram/member-telegram-card";
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
  timeline: MonthCell[];
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
          <MemberActions member={member} onRemoved={() => navigate({ to: "/members", search: MEMBERS_SEARCH })} />
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

      <LoansSection memberId={id} onSaved={invalidate} />

      <Card>
        <CardHeader>
          <CardTitle>Billing timeline</CardTitle>
          <CardDescription>
            Contributions cover the oldest bills first. Dashed months after {formatMonth(currentMonth)} are estimates, not amounts due.
            Blue months are covered by an advance.
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
              const status = displayMonthStatus(cell, currentMonth);
              const upcoming = month > currentMonth;
              const spoken = cell
                ? `${status.replaceAll("-", " ")}, ${upcoming ? "estimated bill" : "bill"} ${formatTaka(cell.bill)}, ${upcoming ? "advance allocated" : "applied"} ${formatTaka(cell.applied)}`
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
                  <p className="text-[11px] text-muted-foreground tabular">
                    {upcoming && cell && cell.bill > 0
                      ? cell.applied > 0 ? `${formatTaka(cell.applied)} from advance` : "Not due yet"
                      : `Applied ${formatTaka(cell?.applied ?? 0)}`}
                  </p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <MemberTelegramCard memberId={id} isAdmin={isAdmin} />

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

function LoansSection({ memberId, onSaved }: { memberId: string; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const [newLoanOpen, setNewLoanOpen] = useState(false);
  const [repaying, setRepaying] = useState<LoanView | null>(null);
  const [removing, setRemoving] = useState<LoanView | null>(null);

  const loansQuery = useQuery({
    queryKey: ["loans", memberId],
    queryFn: () => api<{ loans: LoanView[]; totalOutstanding: number }>(`/api/members/${memberId}/loans`),
  });

  const refresh = () => {
    onSaved();
    queryClient.invalidateQueries({ queryKey: ["loans", memberId] });
    queryClient.invalidateQueries({ queryKey: ["banks"] });
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
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
        <CardTitle>Loans &amp; repayments</CardTitle>
        <CardDescription>Interest-free loans, separate from savings contributions and advances.</CardDescription>
        <CardAction>
          <div className="flex items-center gap-2">
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
        ) : loansQuery.isError ? (
          <EmptyState
            icon={HandCoinsIcon}
            title="Could not load loans"
            description={loansQuery.error.message}
            action={<Button variant="outline" onClick={() => loansQuery.refetch()}>Try again</Button>}
          />
        ) : loans.length > 0 ? (
          <div className="flex flex-col gap-5">
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">Total taken</dt>
                <dd className="mt-1 font-display text-2xl tabular">{formatTaka(loans.reduce((sum, loan) => sum + loan.amount, 0))}</dd>
                <dd className="mt-1 text-xs text-muted-foreground">{loans.length} {loans.length === 1 ? "loan" : "loans"} in total</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Total repaid</dt>
                <dd className="mt-1 font-display text-2xl text-success tabular">{formatTaka(loans.reduce((sum, loan) => sum + loan.repaid, 0))}</dd>
                <dd className="mt-1 text-xs text-muted-foreground">Repayments recorded: {loans.reduce((sum, loan) => sum + loan.repayments.length, 0)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Left to repay</dt>
                <dd className="mt-1 font-display text-2xl tabular">{formatTaka(totalOutstanding)}</dd>
                <dd className="mt-1 text-xs text-muted-foreground">
                  {loans.filter((loan) => !loan.settled).length} open · {loans.filter((loan) => loan.settled).length} cleared
                </dd>
              </div>
            </dl>
            {loans.map((loan, index) => (
              <article key={loan.id} aria-label={`Loan ${index + 1} from ${formatDay(loan.date)}`} className="flex flex-col gap-4 rounded-lg border border-border p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold">Loan {index + 1} · {formatDay(loan.date)}</h3>
                      <Badge variant={loan.settled ? "success" : loan.repaid > 0 ? "info" : "outline"}>
                        {loan.settled ? "Cleared" : loan.repaid > 0 ? "Repaying" : "Not repaid"}
                      </Badge>
                    </div>
                    <p className="mt-1 break-words text-xs text-muted-foreground">From {loan.bankName} · #{loan.id.slice(0, 8)}</p>
                    {loan.note && <p className="mt-1 break-words text-sm text-muted-foreground">{loan.note}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {!loan.settled && (
                      <Button size="sm" onClick={() => setRepaying(loan)}>
                        <RotateCcwIcon data-icon="inline-start" />
                        Record repayment
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => setRemoving(loan)}>Remove</Button>
                  </div>
                </div>
                <dl className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">Principal</dt>
                    <dd className="mt-1 font-medium tabular">{formatTaka(loan.amount)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Repaid</dt>
                    <dd className="mt-1 font-medium text-success tabular">{formatTaka(loan.repaid)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Remaining</dt>
                    <dd className="mt-1"><Amount value={loan.outstanding} tone="neutral" /></dd>
                  </div>
                </dl>
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{loan.repayments.length} {loan.repayments.length === 1 ? "repayment" : "repayments"}</span>
                    <span className="tabular">{Math.round(loan.repaid / loan.amount * 100)}% repaid</span>
                  </div>
                  <Progress value={loan.repaid / loan.amount * 100} aria-label={`Loan ${index + 1} repaid`} />
                </div>
                <LoanHistory loan={loan} />
              </article>
            ))}
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

      <Dialog open={Boolean(repaying)} onOpenChange={(open) => !open && setRepaying(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Record a loan repayment</DialogTitle>
            <DialogDescription>Return money to the fund against this loan.</DialogDescription>
          </DialogHeader>
          {repaying && (
            <LoanRepaymentForm memberId={memberId} loanId={repaying.id} onDone={() => setRepaying(null)} />
          )}
        </DialogContent>
      </Dialog>

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

function LoanHistory({ loan }: { loan: LoanView }) {
  let remaining = loan.amount;
  const history = loan.repayments.map((repayment) => {
    remaining -= repayment.amount;
    return { ...repayment, remaining };
  });

  return (
    <details open className="group/history border-t border-border pt-3">
      <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 rounded-md text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        Repayment history
        <ChevronDownIcon aria-hidden className="size-4 text-muted-foreground group-open/history:rotate-180" />
      </summary>
      <ol className="mt-3 flex flex-col gap-4 border-l border-border pl-4 text-sm">
        <li className="flex flex-wrap justify-between gap-x-4 gap-y-1">
          <div>
            <p className="font-medium">Loan taken</p>
            <p className="text-xs text-muted-foreground">{formatDay(loan.date)} · {loan.bankName}</p>
          </div>
          <p className="font-medium tabular">{formatTaka(loan.amount)}</p>
        </li>
        {history.map((repayment, index) => (
          <li key={repayment.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1">
            <div className="min-w-0">
              <p className="font-medium">Repayment {index + 1}</p>
              <p className="break-words text-xs text-muted-foreground">{formatDay(repayment.creditDate)} · {repayment.bankName}</p>
            </div>
            <div className="text-right">
              <p className="font-medium text-success tabular">{formatTaka(repayment.amount)}</p>
              <p className="text-xs text-muted-foreground tabular">{formatTaka(repayment.remaining)} remaining</p>
            </div>
          </li>
        ))}
        {loan.settled && history.length > 0 && (
          <li className="flex items-start gap-2 text-success">
            <CheckCircle2Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">Loan cleared · {formatDay(history[history.length - 1]!.creditDate)}</p>
              <p className="text-xs">Fully repaid in {history.length} {history.length === 1 ? "repayment" : "repayments"}.</p>
            </div>
          </li>
        )}
      </ol>
      {history.length === 0 && <p className="mt-4 text-xs text-muted-foreground">No repayments yet. Record a repayment when money returns to a bank account.</p>}
    </details>
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
    if (isFutureDate(date)) {
      toast.error("Date can't be in the future");
      return;
    }
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
            <DatePicker id="loan-date" value={date} onChange={setDate} required max={todayInDhaka()} />
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
    case "partial-advance":
      return "border-info/25 bg-info/[0.06]";
    case "partial":
      return "border-warning/30 bg-warning/[0.07]";
    case "due":
      return "border-destructive/25 bg-destructive/[0.06]";
    default:
      return "border-border bg-muted/20";
  }
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { CoinsIcon, LandmarkIcon, MoreHorizontalIcon, PlusIcon, Trash2Icon, WalletIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { formatTaka } from "@DreamDev/db/domain/money";
import { Button } from "@DreamDev/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@DreamDev/ui/components/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@DreamDev/ui/components/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@DreamDev/ui/components/dropdown-menu";
import { Input } from "@DreamDev/ui/components/input";
import { Progress } from "@DreamDev/ui/components/progress";
import { Skeleton } from "@DreamDev/ui/components/skeleton";

import type { BankAccountItem } from "@/api/banks/service";
import { EmptyState } from "@/components/empty-state";
import { Field } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { api } from "@/lib/api";
import { firstError } from "@/lib/form-errors";

interface BankRow extends Omit<BankAccountItem, "createdAt"> {
  createdAt: string;
}

interface BanksResponse {
  data: BankRow[];
  meta: { page: number; pageSize: number; total: number };
}

export const Route = createFileRoute("/_auth/banks")({
  component: BanksPage,
});

function BanksPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [removing, setRemoving] = useState<BankRow | null>(null);

  const banksQuery = useQuery({
    queryKey: ["banks"],
    queryFn: () => api<BanksResponse>("/api/banks"),
  });

  const remove = useMutation({
    mutationFn: (bank: BankRow) => api(`/api/banks/${bank.id}`, { method: "DELETE" }),
    onSuccess: (_result, bank) => {
      toast.success(`Removed ${bank.bankName}`);
      setRemoving(null);
      queryClient.invalidateQueries({ queryKey: ["banks"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const banks = banksQuery.data?.data ?? [];
  const total = banks.reduce((sum, bank) => sum + bank.currentBalance, 0);
  const opening = banks.reduce((sum, bank) => sum + bank.openingBalance, 0);

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-8">
      <PageHeader
        eyebrow="Fund"
        title="Bank accounts"
        description="Where the fund's money actually sits, and how it moves."
        actions={
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <PlusIcon className="size-4" />
            Add account
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total holdings" value={formatTaka(total)} hint="Current balance across every account" icon={WalletIcon} tone="primary" />
        <StatCard label="Accounts" value={String(banks.length)} hint="Team-owned bank accounts" icon={LandmarkIcon} />
        <StatCard label="Opening balances" value={formatTaka(opening)} hint="Recorded starting point" icon={CoinsIcon} />
      </div>

      {banksQuery.isLoading ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-56 w-full rounded-xl" />
          ))}
        </div>
      ) : banks.length > 0 ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {banks.map((bank) => {
            const share = total > 0 ? Math.round((bank.currentBalance / total) * 100) : 0;
            return (
              <Card key={bank.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                      <LandmarkIcon className="size-5" />
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${bank.bankName}`} />}>
                        <MoreHorizontalIcon className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem variant="destructive" onClick={() => setRemoving(bank)}>
                          <Trash2Icon />
                          Remove account
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <CardTitle className="mt-1">{bank.bankName}</CardTitle>
                  <CardDescription>{bank.address ?? "No address on file"}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-micro text-muted-foreground">Current balance</p>
                  <p className="mt-1 font-display text-3xl leading-none tabular">{formatTaka(bank.currentBalance)}</p>
                  <Progress value={share} className="mt-4 bg-muted text-primary" aria-label={`${bank.bankName} share of total holdings`} />
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{share}% of holdings</span>
                    <span className="tabular">Opening {formatTaka(bank.openingBalance)}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={LandmarkIcon}
          title="No bank accounts yet"
          description="Add the team's first joint account to start tracking balances and recording entries against it."
          action={
            <Button onClick={() => setCreateOpen(true)} className="gap-2">
              <PlusIcon className="size-4" />
              Add account
            </Button>
          }
        />
      )}

      <CreateBankDialog open={createOpen} onOpenChange={setCreateOpen} />

      <Dialog open={Boolean(removing)} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {removing?.bankName}?</DialogTitle>
            <DialogDescription>
              The account is soft-deleted. Accounts with recorded transactions may be refused by the server so the ledger stays balanced.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => removing && remove.mutate(removing)}>
              {remove.isPending ? "Removing…" : "Remove account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateBankDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();

  const form = useForm({
    defaultValues: { bankName: "", address: "", openingBalance: "" },
    onSubmit: async ({ value }) => {
      try {
        await api("/api/banks", {
          method: "POST",
          body: JSON.stringify({
            bankName: value.bankName,
            address: value.address || undefined,
            openingBalance: Number(value.openingBalance || 0),
          }),
        });
        toast.success(`Added ${value.bankName}`);
        form.reset();
        onOpenChange(false);
        await queryClient.invalidateQueries({ queryKey: ["banks"] });
        await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      } catch (error) {
        toast.error((error as Error).message);
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a bank account</DialogTitle>
          <DialogDescription>Opening balance is the account&rsquo;s starting point when it joins the fund.</DialogDescription>
        </DialogHeader>
        <form
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            form.handleSubmit();
          }}
        >
          <form.Field name="bankName" validators={{ onChange: z.string().trim().min(1, "Bank name is required") }}>
            {(field) => (
              <Field label="Bank name" htmlFor="bank-name" required error={firstError(field.state.meta.errors)} className="sm:col-span-2">
                <Input
                  id="bank-name"
                  placeholder="e.g. Dutch-Bangla Bank"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="address">
            {(field) => (
              <Field label="Branch / address" htmlFor="bank-address" hint="Optional">
                <Input
                  id="bank-address"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="openingBalance" validators={{ onChange: z.string().regex(/^\d*$/, "Whole taka only") }}>
            {(field) => (
              <Field label="Opening balance (৳)" htmlFor="bank-opening" error={firstError(field.state.meta.errors)} hint="Defaults to ৳0.">
                <Input
                  id="bank-opening"
                  inputMode="numeric"
                  placeholder="0"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>

          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
              {([canSubmit, isSubmitting]) => (
                <Button type="submit" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? "Adding…" : "Add account"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { z } from "zod";

import { formatTaka } from "@DreamDev/db/domain/money";
import { Button } from "@DreamDev/ui/components/button";
import { Input } from "@DreamDev/ui/components/input";
import { Label } from "@DreamDev/ui/components/label";

import type { BankAccountItem } from "@/api/banks/service";
import { api } from "@/lib/api";

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
  const banksQuery = useQuery({
    queryKey: ["banks"],
    queryFn: () => api<BanksResponse>("/api/banks"),
  });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">Bank Accounts</h1>

      <CreateBankForm />

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Bank</th>
              <th className="px-3 py-2 text-left font-medium">Address</th>
              <th className="px-3 py-2 text-left font-medium">Opening Balance</th>
              <th className="px-3 py-2 text-right font-medium">Current Balance</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {banksQuery.isLoading ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : banksQuery.data && banksQuery.data.data.length > 0 ? (
              banksQuery.data.data.map((bank) => <BankRowView key={bank.id} bank={bank} />)
            ) : (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  No Bank Accounts yet — add the team's first joint account.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BankRowView({ bank }: { bank: BankRow }) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["banks"] });

  const remove = useMutation({
    mutationFn: () => api(`/api/banks/${bank.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(`Removed ${bank.bankName}`);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <tr className="border-t">
      <td className="px-3 py-2 font-medium">{bank.bankName}</td>
      <td className="px-3 py-2 text-muted-foreground">{bank.address ?? "—"}</td>
      <td className="px-3 py-2">{formatTaka(bank.openingBalance)}</td>
      <td className="px-3 py-2 text-right font-semibold">{formatTaka(bank.currentBalance)}</td>
      <td className="px-3 py-2 text-right">
        <Button variant="ghost" size="sm" onClick={() => remove.mutate()}>
          Remove
        </Button>
      </td>
    </tr>
  );
}

function CreateBankForm() {
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
        await queryClient.invalidateQueries({ queryKey: ["banks"] });
      } catch (error) {
        toast.error((error as Error).message);
      }
    },
  });

  return (
    <details className="rounded-md border p-3">
      <summary className="cursor-pointer font-medium">New Bank Account</summary>
      <form
        className="mt-3 grid gap-3 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
      >
        <form.Field name="bankName" validators={{ onChange: z.string().trim().min(1, "Bank name is required") }}>
          {(field) => (
            <div className="flex flex-col gap-1">
              <Label htmlFor="bank-name">Bank name</Label>
              <Input id="bank-name" value={field.state.value} onBlur={field.handleBlur} onChange={(e) => field.handleChange(e.target.value)} />
              <FieldError errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>

        <form.Field name="address">
          {(field) => (
            <div className="flex flex-col gap-1">
              <Label htmlFor="bank-address">Address (optional)</Label>
              <Input id="bank-address" value={field.state.value} onBlur={field.handleBlur} onChange={(e) => field.handleChange(e.target.value)} />
            </div>
          )}
        </form.Field>

        <form.Field
          name="openingBalance"
          validators={{ onChange: z.string().regex(/^\d*$/, "Whole taka only") }}
        >
          {(field) => (
            <div className="flex flex-col gap-1">
              <Label htmlFor="bank-opening">Opening Balance (৳)</Label>
              <Input id="bank-opening" inputMode="numeric" value={field.state.value} onBlur={field.handleBlur} onChange={(e) => field.handleChange(e.target.value)} />
              <FieldError errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>

        <div className="sm:col-span-3">
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <Button type="submit" disabled={!canSubmit || isSubmitting}>
                {isSubmitting ? "Adding…" : "Add Account"}
              </Button>
            )}
          </form.Subscribe>
        </div>
      </form>
    </details>
  );
}

function FieldError({ errors }: { errors: unknown[] }) {
  const message =
    errors[0] && typeof errors[0] === "object" && "message" in errors[0]
      ? String((errors[0] as { message: string }).message)
      : undefined;
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}

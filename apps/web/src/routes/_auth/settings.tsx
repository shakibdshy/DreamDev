import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BadgePercentIcon, CalculatorIcon, LockIcon, MonitorIcon, MoonIcon, PaletteIcon, SunIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";

import { formatTaka } from "@DreamDev/db/domain/money";
import { Badge } from "@DreamDev/ui/components/badge";
import { Button } from "@DreamDev/ui/components/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@DreamDev/ui/components/card";
import { Input } from "@DreamDev/ui/components/input";
import { Skeleton } from "@DreamDev/ui/components/skeleton";
import { cn } from "@DreamDev/ui/lib/utils";

import { Field } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";
import { formatMonth } from "@/lib/format";

export const Route = createFileRoute("/_auth/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { session } = Route.useRouteContext();
  const isAdmin = session?.user.role === "admin" && session.user.status === "active";
  const queryClient = useQueryClient();
  const [price, setPrice] = useState("");

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<{ sharePrice: number; effectiveMonth: string }>("/api/settings"),
  });

  const update = useMutation({
    mutationFn: (sharePrice: number) =>
      api<{ sharePrice: number; changed: boolean }>("/api/settings", { method: "PATCH", body: JSON.stringify({ sharePrice }) }),
    onSuccess: (result) => {
      toast.success(result.changed ? `Share price set to ${formatTaka(result.sharePrice)}` : "Price unchanged");
      setPrice("");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const sharePrice = settingsQuery.data?.sharePrice;

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-8">
      <PageHeader eyebrow="Administration" title="Settings" description="Fund-wide rules that every member and every month follow." />

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Share price</CardTitle>
              <CardDescription>One global price per share, per month.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              {settingsQuery.isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-12 w-48" />
                </div>
              ) : (
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="text-micro text-muted-foreground">Current price</p>
                    <p className="mt-2 font-display text-5xl leading-none tabular">{sharePrice === undefined ? "…" : formatTaka(sharePrice)}</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      per share / month
                      {settingsQuery.data ? ` · effective since ${formatMonth(settingsQuery.data.effectiveMonth)}` : ""}
                    </p>
                  </div>
                  {!isAdmin && (
                    <Badge variant="outline" className="gap-1.5">
                      <LockIcon className="size-3" />
                      View only
                    </Badge>
                  )}
                </div>
              )}

              {isAdmin ? (
                <form
                  className="flex flex-col gap-3 rounded-xl border border-border bg-muted/25 p-4 sm:flex-row sm:items-end"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const value = Number(price);
                    if (!Number.isFinite(value) || value <= 0) return;
                    update.mutate(value);
                  }}
                >
                  <Field label="New price (৳/share/month)" htmlFor="price" hint="Applies from the current month forward." className="flex-1">
                    <Input
                      id="price"
                      name="price"
                      inputMode="numeric"
                      placeholder={sharePrice !== undefined ? String(sharePrice) : "6000"}
                      value={price}
                      onChange={(event) => setPrice(event.target.value)}
                    />
                  </Field>
                  <Button type="submit" disabled={update.isPending || !price || Number(price) <= 0} className="sm:mb-0.5">
                    {update.isPending ? "Updating…" : "Update price"}
                  </Button>
                </form>
              ) : (
                <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                  Only administrators can change the share price.
                </p>
              )}

              <p className="text-xs leading-relaxed text-muted-foreground">
                A change applies from this month forward — past months never re-bill, and every existing contribution keeps the price snapshot it was
                recorded at.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>How billing uses this price</CardTitle>
              <CardDescription>The same arithmetic for every member, every month.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4 text-sm">
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <CalculatorIcon className="size-4" />
                  </span>
                  <p className="leading-relaxed text-muted-foreground">
                    A member&rsquo;s monthly bill is their share count at that month&rsquo;s price.
                    {sharePrice !== undefined && (
                      <span className="mt-1 block text-foreground">
                        Example: 3 shares × {formatTaka(sharePrice)} = <span className="font-medium tabular">{formatTaka(3 * sharePrice)}</span> per month.
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-start gap-3 border-t border-border/70 pt-4">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-warning/12 text-warning">
                    <BadgePercentIcon className="size-4" />
                  </span>
                  <p className="leading-relaxed text-muted-foreground">
                    Adjustments — opening dues and waivers — are the only sanctioned way to correct a member&rsquo;s position. They are admin-only and
                    always carry a reason.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <AppearanceCard />
          <Card>
            <CardHeader>
              <CardTitle>Fund rules of thumb</CardTitle>
              <CardDescription>Short reminders for day-to-day operation.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-3 text-sm text-muted-foreground">
                {[
                  "Record contributions against the member and the receiving bank account.",
                  "Loans over twice a member's contributions warn, but still record.",
                  "Exiting a member stops billing from the effective date onward.",
                  "Share changes and pricing never rewrite closed months.",
                ].map((rule) => (
                  <li key={rule} className="flex items-start gap-2.5">
                    <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                    <span className="leading-relaxed">{rule}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter>
              <p className="text-xs text-muted-foreground">All amounts in ৳ BDT</p>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}

const THEMES = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
] as const;

function AppearanceCard() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>Follow the system, or pin a theme for this browser.</CardDescription>
      </CardHeader>
      <CardContent>
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2">
          {THEMES.map((option) => {
            const active = mounted && theme === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setTheme(option.value)}
                className={cn(
                  "flex cursor-pointer flex-col items-center gap-2 rounded-xl border p-3 text-xs font-medium transition-colors",
                  active
                    ? "border-primary/40 bg-primary/8 text-foreground ring-1 ring-primary/20"
                    : "border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground",
                )}
              >
                <span className={cn("grid size-9 place-items-center rounded-lg", active ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground")}>
                  <option.icon className="size-4" />
                </span>
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <PaletteIcon className="size-3.5" aria-hidden />
          The choice is remembered on this device.
        </p>
      </CardContent>
    </Card>
  );
}

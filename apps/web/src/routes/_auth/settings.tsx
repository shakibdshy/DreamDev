import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

import { formatTaka } from "@DreamDev/db/domain/money";
import { Button } from "@DreamDev/ui/components/button";
import { Input } from "@DreamDev/ui/components/input";
import { Label } from "@DreamDev/ui/components/label";

import { api } from "@/lib/api";

export const Route = createFileRoute("/_auth/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { session } = Route.useRouteContext();
  const isAdmin = session?.user.role === "admin" && session.user.status === "active";
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => api<{ sharePrice: number; effectiveMonth: string }>("/api/settings"),
  });

  const update = useMutation({
    mutationFn: (sharePrice: number) =>
      api<{ sharePrice: number; changed: boolean }>("/api/settings", { method: "PATCH", body: JSON.stringify({ sharePrice }) }),
    onSuccess: (result) => {
      toast.success(result.changed ? `Share Price set to ${formatTaka(result.sharePrice)}` : "Price unchanged");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <div className="rounded-md border p-4">
        <p className="text-xs text-muted-foreground">Share Price — one global price per Share, per month</p>
        <p className="mt-1 text-2xl font-semibold">
          {settingsQuery.data ? formatTaka(settingsQuery.data.sharePrice) : "…"}
        </p>
        {settingsQuery.data && (
          <p className="text-xs text-muted-foreground">effective since {settingsQuery.data.effectiveMonth}</p>
        )}

        {isAdmin ? (
          <form
            className="mt-4 flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const formEl = e.currentTarget as HTMLFormElement;
              const value = (formEl.elements.namedItem("price") as HTMLInputElement).value;
              if (value) update.mutate(Number(value));
            }}
          >
            <div className="flex flex-col gap-1">
              <Label htmlFor="price">New price (৳/share/month)</Label>
              <Input id="price" name="price" inputMode="numeric" placeholder="6000" />
            </div>
            <Button type="submit" disabled={update.isPending}>Update</Button>
          </form>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">Only Admins can change the Share Price.</p>
        )}

        <p className="mt-3 text-xs text-muted-foreground">
          A change applies from this month forward — past months never re-bill, and every existing Contribution keeps its
          price snapshot.
        </p>
      </div>
    </div>
  );
}

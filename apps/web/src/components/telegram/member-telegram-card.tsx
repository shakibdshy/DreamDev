import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOffIcon, BellRingIcon, SendIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@DreamDev/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@DreamDev/ui/components/card";
import { Skeleton } from "@DreamDev/ui/components/skeleton";

import { api } from "@/lib/api";

/**
 * Receive-only Telegram channel for a Member (ticket 2/8): an admin/editor
 * generates the deep link, shares it out of band; the member binds and from
 * then on only receives notifications about their own records.
 */

interface TelegramStatus {
  configured: boolean;
  linked: boolean;
  linkedAt: string | null;
  notifyEnabled: boolean;
}

export function MemberTelegramCard({ memberId, isAdmin }: { memberId: string; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [pairing, setPairing] = useState<{ code: string; deepLink: string } | null>(null);

  const statusQuery = useQuery({
    queryKey: ["member-telegram", memberId],
    queryFn: () => api<TelegramStatus>(`/api/members/${memberId}/telegram`),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["member-telegram", memberId] });

  const connect = useMutation({
    mutationFn: () => api<{ code: string; deepLink: string }>(`/api/members/${memberId}/telegram`, { method: "POST" }),
    onSuccess: setPairing,
    onError: (error: Error) => toast.error(error.message),
  });

  const unlink = useMutation({
    mutationFn: () => api<{ linked: false }>(`/api/members/${memberId}/telegram`, { method: "DELETE" }),
    onSuccess: () => {
      setPairing(null);
      toast.success("Telegram unlinked");
      void invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggleNotify = useMutation({
    mutationFn: (enabled: boolean) =>
      api<{ notifyEnabled: boolean }>(`/api/members/${memberId}/telegram.notify`, { method: "POST", body: JSON.stringify({ notifyEnabled: enabled }) }),
    onSuccess: () => void invalidate(),
    onError: (error: Error) => toast.error(error.message),
  });

  const status = statusQuery.data;

  return (
    <Card className="lg:col-span-1">
      <CardHeader>
        <CardTitle>Telegram notifications</CardTitle>
        <CardDescription>Receive-only — the member gets messages about their own records.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {statusQuery.isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : status && !status.configured ? (
          <p className="text-muted-foreground">The Telegram bot isn&rsquo;t configured on this deployment yet.</p>
        ) : status?.linked ? (
          <div className="flex flex-col gap-3">
            <p className="flex items-center gap-2 font-medium">
              <SendIcon className="size-4 text-primary" aria-hidden />
              Linked{status.linkedAt ? ` · ${new Date(status.linkedAt).toLocaleDateString()}` : ""}
            </p>
            {isAdmin ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => toggleNotify.mutate(!status.notifyEnabled)} disabled={toggleNotify.isPending}>
                  {status.notifyEnabled ? <BellRingIcon className="size-4" /> : <BellOffIcon className="size-4" />}
                  {status.notifyEnabled ? "Notifications on" : "Notifications off"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => unlink.mutate()} disabled={unlink.isPending}>
                  Unlink
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Notify toggle and unlink are admin-only.</p>
            )}
          </div>
        ) : pairing ? (
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground">Share this link with the member — it expires in 15 minutes and works once.</p>
            <div className="flex items-center gap-2">
              <code className="rounded-lg bg-muted px-3 py-1.5 font-mono text-base tracking-[0.2em]">{pairing.code}</code>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(pairing.deepLink);
                  toast.success("Link copied — share it with the member");
                }}
              >
                Copy link
              </Button>
            </div>
            <a
              href={pairing.deepLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/88"
            >
              <SendIcon className="size-4" aria-hidden />
              Open in Telegram
            </a>
            <Button variant="ghost" size="sm" onClick={() => void invalidate()}>
              I&rsquo;ve shared it — refresh status
            </Button>
          </div>
        ) : (
          <Button onClick={() => connect.mutate()} disabled={connect.isPending} className="self-start">
            <SendIcon className="size-4" aria-hidden />
            Generate invite link
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

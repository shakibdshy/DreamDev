import { useRouter } from "@tanstack/react-router";
import { ClockAlertIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { IDLE_CHANNEL, idlePhase, secondsLeft } from "@/lib/idle-logout";

/** Events that count as activity (throttled — pointermove alone would fire constantly). */
const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "scroll"] as const;
const ACTIVITY_THROTTLE_MS = 15_000;
const CHECK_MS = 10_000;

type IdleMessage = { type: "activity"; t: number } | { type: "signed-out" };

/**
 * Signs the session out after 15 minutes of inactivity, warning 90s ahead.
 * Multi-tab aware via BroadcastChannel: activity in any tab resets the timer
 * everywhere, and a logout in one tab lands every tab on /login. No timers or
 * state persist anywhere — the count restarts from zero on a fresh page load.
 */
export function IdleLogoutGuard() {
  const router = useRouter();
  const lastActivity = useRef(Date.now());
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const signingOut = useRef(false);

  useEffect(() => {
    const channel = "BroadcastChannel" in window ? new BroadcastChannel(IDLE_CHANNEL) : null;

    const noteActivity = () => {
      lastActivity.current = Date.now();
      channel?.postMessage({ type: "activity", t: lastActivity.current } satisfies IdleMessage);
    };

    let lastBroadcast = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastBroadcast < ACTIVITY_THROTTLE_MS) return;
      lastBroadcast = now;
      noteActivity();
    };
    const listeners = ACTIVITY_EVENTS.map((event) => {
      window.addEventListener(event, onActivity, { passive: true });
      return [event, onActivity] as const;
    });

    channel?.addEventListener("message", (event: MessageEvent<IdleMessage>) => {
      const message = event.data;
      if (message.type === "activity" && message.t > lastActivity.current) {
        lastActivity.current = message.t;
        return;
      }
      if (message.type === "signed-out" && !signingOut.current) {
        signingOut.current = true; // another tab already cleared the session — just leave
        void router.navigate({ to: "/login", search: { reason: "idle" } });
      }
    });

    const timer = window.setInterval(() => {
      if (signingOut.current) return;
      const idleMs = Date.now() - lastActivity.current;
      const phase = idlePhase(idleMs);
      if (phase === "active") {
        setSecondsRemaining(null);
        return;
      }
      setSecondsRemaining(secondsLeft(idleMs));
      if (phase === "expired") {
        signingOut.current = true;
        channel?.postMessage({ type: "signed-out" } satisfies IdleMessage);
        authClient.signOut({
          fetchOptions: {
            onSuccess: () => {
              void router.navigate({ to: "/login", search: { reason: "idle" } });
            },
            onError: () => {
              // The cookie is what matters — go to login regardless.
              void router.navigate({ to: "/login", search: { reason: "idle" } });
            },
          },
        });
      }
    }, CHECK_MS);

    return () => {
      window.clearInterval(timer);
      channel?.close();
      for (const [event, handler] of listeners) window.removeEventListener(event, handler);
    };
  }, [router]);

  if (secondsRemaining === null) return null;
  return (
    <div
      role="alert"
      className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-fit items-center gap-2 rounded-full border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive shadow-lg backdrop-blur"
    >
      <ClockAlertIcon className="size-4 shrink-0" aria-hidden />
      Signing out in {secondsRemaining}s — click, scroll or type to stay signed in.
    </div>
  );
}
